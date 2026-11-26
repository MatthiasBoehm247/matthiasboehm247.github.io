#!/usr/bin/env python3
"""Native navigation, cancellation and storage-boundary checks on isolated origins.

Uses the production pages, native history navigation, native file decoders and
real browser storage failures. No production handlers or browser APIs are mocked.
The passive observer records trusted pagehide/pageshow events. BFCache use is
reported as observed; Playwright WebKit is not a physical Safari/iOS test.
"""
from __future__ import annotations

import argparse
import asyncio
import binascii
from collections import Counter
import contextlib
from datetime import datetime, timezone
import functools
import http.server
from importlib.metadata import PackageNotFoundError, version as package_version
import json
from pathlib import Path
import re
import struct
import tempfile
import threading
import traceback
from urllib.parse import parse_qs, urlsplit
import zlib

from browser_gate import BROWSERS, PageHealth, checked_browser_executable, download, ready, submit
from fixtures import generate, read_png
from pages import checked_report_path, write_report


EXPECTED_CASES = {
    'navigation-completed-result', 'navigation-pending-worker',
    'navigation-pending-image', 'navigation-qr-export',
    'storage-near-limit', 'storage-native-quota', 'storage-denied-export',
}
WORKSPACE_KEY = 'digital-labs.workspace.v1'
POST_RETURN_OBSERVATION_MS = 500

# Only observes DOM state and native events. It neither dispatches lifecycle
# events nor substitutes decoding, storage, download or application functions.
OBSERVER = r"""(() => {
  const probe = {id: String(Date.now()) + '-' + Math.random(), events: [], hidden: false};
  window.__labsNativeProbe = probe;
  function record(kind, event, extra = {}) {
    if (!/^https?:$/.test(location.protocol)) return;
    const row = {
      case: CASE_ID, document: probe.id, path: location.pathname, kind,
      trusted: event ? event.isTrusted : null,
      persisted: event && 'persisted' in event ? event.persisted : null,
      time: performance.timeOrigin + performance.now(), afterPagehide: probe.hidden,
      result: (document.querySelector('#result-output')?.value || '').slice(0, 12000),
      status: document.querySelector('#tool-status')?.textContent || '',
      statusKind: document.querySelector('#tool-status')?.dataset.kind || '',
      downloadDisabled: document.querySelector('#download-result')?.disabled ?? null,
      ...extra
    };
    probe.events.push(row);
    navigator.sendBeacon('/__labs_qa__/events', new Blob([JSON.stringify(row)], {type: 'text/plain'}));
  }
  document.addEventListener('DOMContentLoaded', () => {
    // The application modules install their pagehide listeners before DOM ready;
    // our snapshot therefore observes the state after their cancellation handler.
    addEventListener('pagehide', event => { probe.hidden = true; record('pagehide', event); });
    addEventListener('pageshow', event => { probe.hidden = false; record('pageshow', event); });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[download]');
      if (link) record('download-click', event, {filename: link.download});
    }, true);
  }, {once: true});
})();"""


class NativeServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, root):
        super().__init__(('127.0.0.1', 0), functools.partial(NativeHandler, directory=str(root)))
        self.observations = []
        self.observation_lock = threading.Lock()
        self.worker_requested = threading.Event()
        self.worker_release = threading.Event()
        self.hold_worker = False

    def events(self, case, path=None):
        with self.observation_lock:
            return [row.copy() for row in self.observations
                    if row.get('case') == case and (path is None or row.get('path') == path)]


class NativeHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        # The denied-storage case loads the real modules in an opaque sandbox
        # origin. CORS enables these test-page resources, not its blocked storage.
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def html(self, body):
        raw = ('<!doctype html><html lang="de"><meta charset="utf-8">'
               '<link rel="icon" href="data:,"><title>Native QA</title><body>'
               + body + '</body></html>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == '/__labs_qa__/away':
            return self.html('<h1>Native Navigationsgegenstelle</h1>')
        if parsed.path == '/__labs_qa__/denied':
            route = parse_qs(parsed.query).get('route', [''])[0]
            if not re.fullmatch(r'/tools/[a-z0-9-]+/[a-z0-9-]+/', route):
                self.send_error(400)
                return
            return self.html('<iframe title="Werkzeug mit browserseitig gesperrtem Speicher" '
                             'sandbox="allow-scripts allow-downloads" src="' + route + '"></iframe>')
        if parsed.path == '/assets/labs/worker.mjs' and self.server.hold_worker:
            self.server.worker_requested.set()
            if not self.server.worker_release.wait(timeout=20):
                self.send_error(504, 'Native QA worker release timed out')
                return
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            # A real navigation can cancel the intentionally delayed worker fetch.
            pass

    def do_POST(self):
        if self.path != '/__labs_qa__/events':
            self.send_error(404)
            return
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 64000:
            self.send_error(413)
            return
        data = json.loads(self.rfile.read(size))
        if data.get('case') not in EXPECTED_CASES:
            self.send_error(400)
            return
        with self.server.observation_lock:
            self.server.observations.append(data)
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()


@contextlib.contextmanager
def serve_native(root):
    server = NativeServer(root)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, f'http://127.0.0.1:{server.server_port}'
    finally:
        server.worker_release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def event_for(server, case, path, kind, *, document=None):
    for _ in range(250):
        rows = [row for row in server.events(case, path) if row['kind'] == kind
                and (document is None or row['document'] == document)]
        if rows:
            return rows[-1]
        await asyncio.sleep(.02)
    raise AssertionError(f'No observed native {kind} event for {case}: {server.events(case, path)}')


async def observed_page(browser, origin, case):
    context = await browser.new_context(viewport={'width': 1280, 'height': 900},
        accept_downloads=True, locale='de-DE', reduced_motion='reduce')
    context.set_default_timeout(15000)
    await context.add_init_script(OBSERVER.replace('CASE_ID', json.dumps(case)))
    page = await context.new_page()
    return context, page, PageHealth(page, origin)


def check_health(health, *, allowed_aborted_url=None):
    details = health.details()
    expected = []
    failed = []
    for item in details['failedRequests']:
        if item['url'] == allowed_aborted_url and any(code in (item.get('failure') or '').lower()
                for code in ('abort', 'cancel', 'binding_aborted')):
            expected.append(item)
        else:
            failed.append(item)
    failures = {**details, 'failedRequests': failed}
    if any(failures.values()):
        raise AssertionError('Unexpected browser/dependency error: ' + json.dumps(failures, ensure_ascii=False))
    return expected


async def open_from_away(page, origin, route):
    await page.goto(origin + '/__labs_qa__/away', wait_until='load')
    await page.goto(origin + route, wait_until='domcontentloaded')
    await page.locator('#tool-form').wait_for(state='visible')


async def return_forward(page, origin, route):
    await page.wait_for_url(origin + '/__labs_qa__/away')
    await page.go_forward(wait_until='domcontentloaded')
    await page.wait_for_url(origin + route)
    await page.locator('#tool-form').wait_for(state='visible')
    await page.wait_for_timeout(POST_RETURN_OBSERVATION_MS)
    return await page.evaluate('window.__labsNativeProbe.id')


def navigation_detail(server, case, route, leaving, returned):
    rows = server.events(case, route)
    late = [row for row in rows if row['kind'] == 'download-click' and row['time'] >= leaving['time']]
    assert not late, 'An unsolicited download was triggered after native pagehide: ' + json.dumps(late)
    assert leaving['trusted'] is True, 'pagehide must be a browser-generated trusted event'
    assert returned['trusted'] is True, 'pageshow must be a browser-generated trusted event'
    return {'events': rows, 'nativePagehide': True, 'nativePageshow': True,
            'bfcacheUsed': leaving['document'] == returned['document'] and returned['persisted'] is True,
            'postReturnObservationMs': POST_RETURN_OBSERVATION_MS,
            'lateDownloads': len(late)}


async def completed_result(browser, server, origin, routes, fixtures, exports):
    case, route = 'navigation-completed-result', routes['T049']
    context, page, health = await observed_page(browser, origin, case)
    try:
        await open_from_away(page, origin, route)
        await ready(page)
        text = '{"native":"Rückkehr Grüße 🚀","integer":9007199254740993}'
        await page.locator('#field-text').fill(text)
        await submit(page)
        result = await page.locator('#result-output').input_value()
        document = await page.evaluate('window.__labsNativeProbe.id')
        await page.go_back(wait_until='domcontentloaded')
        leaving = await event_for(server, case, route, 'pagehide', document=document)
        assert leaving['statusKind'] == 'success' and leaving['result'] == result and leaving['downloadDisabled'] is False, 'Native pagehide discarded a completed result'
        returned_id = await return_forward(page, origin, route)
        returned = await event_for(server, case, route, 'pageshow', document=returned_id)
        await ready(page)
        current_input = await page.locator('#field-text').input_value()
        current_output = await page.locator('#result-output').input_value()
        assert json.loads(current_output) == json.loads(current_input), 'Returned form and successful output disagree'
        detail = navigation_detail(server, case, route, leaving, returned)
        if detail['bfcacheUsed']:
            assert current_input == text and current_output == result, 'BFCache return changed the completed input/result'
        detail['completedResultAtPagehidePreserved'] = True
        detail['completedResultAfterBFCacheReturn'] = 'PASS' if detail['bfcacheUsed'] else 'NOT_OBSERVED_DOCUMENT_RELOADED'
        await download(page, page.locator('#download-result'), exports / 'returned-result.json')
        assert (exports / 'returned-result.json').read_text() == current_output
        check_health(health)
        return detail
    finally:
        await context.close()


async def pending_worker(browser, server, origin, routes, fixtures, exports):
    case, route = 'navigation-pending-worker', routes['T051']
    context, page, health = await observed_page(browser, origin, case)
    server.worker_requested.clear()
    server.worker_release.clear()
    server.hold_worker = True
    try:
        await open_from_away(page, origin, route)
        for _ in range(200):
            if server.worker_requested.is_set():
                break
            await asyncio.sleep(.02)
        assert server.worker_requested.is_set(), 'Real module-worker request was not observed'
        assert await page.locator('#tool-status').inner_text() == 'Verarbeitung …'
        document = await page.evaluate('window.__labsNativeProbe.id')
        await page.go_back(wait_until='domcontentloaded')
        leaving = await event_for(server, case, route, 'pagehide', document=document)
        assert 'beim Verlassen' in leaving['status'] and leaving['result'] == '' and leaving['downloadDisabled'] is True, 'Pending worker was not invalidated by native pagehide'
        server.hold_worker = False
        server.worker_release.set()
        returned_id = await return_forward(page, origin, route)
        returned = await event_for(server, case, route, 'pageshow', document=returned_id)
        detail = navigation_detail(server, case, route, leaving, returned)
        if detail['bfcacheUsed']:
            assert await page.locator('#result-output').input_value() == ''
            assert await page.locator('#download-result').is_disabled()
        await submit(page)
        assert (await page.locator('#result-output').input_value()).strip()
        detail['newCalculationAfterReturn'] = 'PASS'
        detail['cancelledNetworkRequests'] = check_health(health, allowed_aborted_url=origin + '/assets/labs/worker.mjs')
        return detail
    finally:
        server.hold_worker = False
        server.worker_release.set()
        await context.close()


def large_png(path):
    width, height = 4096, 4800  # Below the production 20-megapixel input limit.
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)
    row = b'\0' + bytes((40, 120, 210, 255)) * width
    compressed = zlib.compress(row * height, 6)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', compressed) + chunk(b'IEND', b''))
    return {'width': width, 'height': height, 'pixels': width * height, 'bytes': path.stat().st_size}


async def pending_image(browser, server, origin, routes, fixtures, exports):
    case, route = 'navigation-pending-image', routes['T073']
    context, page, health = await observed_page(browser, origin, case)
    try:
        await open_from_away(page, origin, route)
        await page.locator('#field-file').set_input_files(str(fixtures / 'large-native.png'))
        await page.locator('#field-width').fill('4096')
        await page.locator('#field-format').select_option('image/png')
        document = await page.evaluate('window.__labsNativeProbe.id')
        # Native form submission starts the unmodified decoder; native history
        # navigation follows in the same task to exercise the actual race.
        started = await page.evaluate("""() => {
          document.querySelector('#tool-form').requestSubmit();
          const running = document.querySelector('#tool-status').textContent;
          history.back(); return running;
        }""")
        assert started == 'Verarbeitung …', 'Native image job did not enter pending state'
        await page.wait_for_url(origin + '/__labs_qa__/away')
        leaving = await event_for(server, case, route, 'pagehide', document=document)
        assert 'beim Verlassen' in leaving['status'] and leaving['result'] == '' and leaving['downloadDisabled'] is True, 'Native image processing was not pending/cancelled at pagehide; do not claim this race was covered'
        returned_id = await return_forward(page, origin, route)
        returned = await event_for(server, case, route, 'pageshow', document=returned_id)
        detail = navigation_detail(server, case, route, leaving, returned)
        assert await page.locator('#result-output').input_value() == ''
        assert await page.locator('#download-result').is_disabled()
        await page.locator('#field-file').set_input_files(str(fixtures / 'color-grid.png'))
        await page.locator('#field-width').fill('320')
        await page.locator('#field-format').select_option('image/png')
        await submit(page)
        await download(page, page.get_by_role('button', name='Bild herunterladen', exact=True), exports / 'image-after-return.png')
        image = read_png(exports / 'image-after-return.png')
        assert (image['width'], image['height']) == (320, 240)
        detail['nativeImageCancelledAtPagehide'] = True
        detail['newImageAndDownloadAfterReturn'] = 'PASS'
        check_health(health)
        return detail
    finally:
        await context.close()


async def qr_navigation(browser, server, origin, routes, fixtures, exports):
    case, route = 'navigation-qr-export', routes['T078']
    context, page, health = await observed_page(browser, origin, case)
    downloads = []
    page.on('download', lambda item: downloads.append(item.suggested_filename))
    try:
        await open_from_away(page, origin, route)
        await ready(page)
        await page.locator('#field-text').fill('https://example.org/native-navigation?text=Gruesse')
        await submit(page)
        document = await page.evaluate('window.__labsNativeProbe.id')
        await page.evaluate("""() => {
          [...document.querySelectorAll('#tool-preview button')].find(button => button.textContent === 'PNG exportieren').click();
          history.back();
        }""")
        download_interrupted_navigation = False
        try:
            await page.wait_for_url(origin + '/__labs_qa__/away')
        except Exception as exc:
            # Firefox can finish this very short native SVG decode before the
            # pending history transition, then report that a download took its
            # place. Observe that outcome and perform the real navigation again.
            if 'Download is starting' not in str(exc):
                raise
            # sendBeacon is asynchronous; wait for the observer's real click
            # before deciding whether this was a pre-navigation download.
            await event_for(server, case, route, 'download-click', document=document)
            if any(row['kind'] == 'pagehide' for row in server.events(case, route)):
                raise
            download_interrupted_navigation = True
            await page.go_back(wait_until='domcontentloaded')
        leaving = await event_for(server, case, route, 'pagehide', document=document)
        returned_id = await return_forward(page, origin, route)
        returned = await event_for(server, case, route, 'pageshow', document=returned_id)
        await ready(page)
        detail = navigation_detail(server, case, route, leaving, returned)
        before = [row for row in detail['events'] if row['kind'] == 'download-click' and row['time'] < leaving['time']]
        assert len(before) <= 1 and len(downloads) <= len(before), 'Unexpected QR download during navigation/return'
        detail['initialExportOutcome'] = 'COMPLETED_BEFORE_PAGEHIDE' if before else 'NO_DOWNLOAD_AFTER_EXPORT_STARTED'
        detail['downloadInterruptedInitialHistoryNavigation'] = download_interrupted_navigation
        detail['pendingDecodeAtPagehide'] = 'Not instrumented; no replacement of native image.decode or canvas.toBlob'
        await download(page, page.get_by_role('button', name='PNG exportieren', exact=True), exports / 'qr-after-return.png')
        qr = read_png(exports / 'qr-after-return.png')
        assert qr['width'] == qr['height'] and qr['width'] > 0
        detail['newPNGExportAfterReturn'] = 'PASS'
        check_health(health)
        return detail
    finally:
        await context.close()


async def workspace_raw(page):
    return await page.evaluate('(key) => localStorage.getItem(key)', WORKSPACE_KEY)


async def wait_workspace(page, text):
    await page.wait_for_function('(text) => document.querySelector(".workspace-status")?.textContent.includes(text)', arg=text)


async def near_limit(browser, server, origin, routes, fixtures, exports):
    case = 'storage-near-limit'
    context, page, health = await observed_page(browser, origin, case)
    try:
        project = {'id': 'synthetic-near-limit', 'name': 'Native Grenzdatei', 'snapshots': [
            {'tool': tool, 'route': routes[tool], 'title': 'Synthetischer Grenzfall ' + tool,
             'updated': '2026-01-01T00:00:00.000Z', 'values': {'text': 'x' * 480000}, 'result': ''}
            for tool in ['T049', 'T053', 'T055', 'T057']]}
        path = fixtures / 'near-limit-project.json'
        path.write_text(json.dumps({'format': 'digital-labs-project', 'version': 1, 'project': project}))
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-import').set_input_files(str(path))
        await wait_workspace(page, 'Projekt als Kopie importiert.')
        before = await workspace_raw(page)
        assert 1900000 < len(before) < 2000000, 'The real stored workspace was not close to the application limit'
        state = json.loads(before)
        assert len(state['projects']) == 1 and state['projects'][0]['snapshots'] == project['snapshots']
        await download(page, page.get_by_role('button', name='Alles als Sicherung exportieren', exact=True), exports / 'near-limit-backup.json')
        payload = json.loads((exports / 'near-limit-backup.json').read_text())
        assert payload['workspace'] == {key: value for key, value in state.items() if key != 'generation'}
        # A second real file import would exceed the app's own limit. The first
        # native storage write and the failed second transaction are distinct.
        await page.locator('#labs-project-import').set_input_files([])
        await page.locator('#labs-project-import').set_input_files(str(path))
        await wait_workspace(page, 'Speicherlimit')
        assert await workspace_raw(page) == before, 'Over-limit import changed existing native storage bytes'
        check_health(health)
        return {'storedUTF16Units': len(before), 'applicationLimitUTF16Units': 2000000,
                'snapshotsPreserved': 4, 'portableBackupExact': True,
                'overLimitImportPreservedBytes': True, 'nativeStorage': True}
    finally:
        await context.close()


async def native_quota(browser, server, origin, routes, fixtures, exports):
    case = 'storage-native-quota'
    context, page, health = await observed_page(browser, origin, case)
    try:
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-name').fill('Vor Quota erhalten')
        await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
        await wait_workspace(page, 'Projekt angelegt.')
        before = await workspace_raw(page)
        # Real writes to isolated, synthetic filler keys exhaust the native
        # localStorage quota. No Storage method or exception is substituted.
        quota = await page.evaluate("""() => {
          const prefix = 'labs-native-quota-fixture-', block = 'q'.repeat(65536);
          let used = 0, failure = null, count = 0;
          for (; count < 1024; count++) {
            try { localStorage.setItem(prefix + count, block); used += block.length; }
            catch (error) { failure = {name: error.name, message: error.message}; break; }
          }
          if (!failure) throw Error('No native quota failure within the 64-Mi-unit fixture bound');
          const tail = prefix + 'tail'; let low = 0, high = 65536;
          while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            try { localStorage.setItem(tail, 'q'.repeat(middle)); low = middle; }
            catch (error) { high = middle; }
          }
          return {prefix, fullBlocks: count, fillerUTF16Units: used + low, exception: failure};
        }""")
        assert quota['exception']['name'] in {'QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'}, quota
        assert await workspace_raw(page) == before
        await page.locator('#labs-project-name').fill('Darf bei Quota nicht entstehen')
        await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
        await wait_workspace(page, 'Browserspeicher ist voll')
        assert await workspace_raw(page) == before, 'Native quota failure overwrote the previous workspace'
        await download(page, page.get_by_role('button', name='Alles als Sicherung exportieren', exact=True), exports / 'quota-backup.json')
        state = json.loads(before)
        assert json.loads((exports / 'quota-backup.json').read_text())['workspace'] == {key: value for key, value in state.items() if key != 'generation'}
        await page.goto(origin + routes['T049'], wait_until='domcontentloaded')
        await ready(page)
        await page.get_by_text('Mit Projekt arbeiten', exact=True).click()
        rescue = '{"rettung":"Nativer voller Speicher Grüße 🚀"}'
        await page.locator('#field-text').fill(rescue)
        await download(page, page.get_by_role('button', name='Stand als Datei sichern', exact=True), exports / 'quota-direct.json')
        saved = json.loads((exports / 'quota-direct.json').read_text())['project']['snapshots'][0]
        assert saved['values']['text'] == rescue and saved['result'] == ''
        assert await workspace_raw(page) == before
        await page.evaluate('(prefix) => { for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key); }', quota['prefix'])
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-name').fill('Expliziter erneuter Versuch')
        await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
        await wait_workspace(page, 'Projekt angelegt.')
        final = json.loads(await workspace_raw(page))
        assert len(final['projects']) == 2 and final['projects'][0] == state['projects'][0]
        check_health(health)
        return {'nativeQuota': quota, 'previousBytesPreserved': True, 'backupAfterQuotaExact': True,
                'directExportAfterQuotaExact': True, 'retryAfterRemovingOnlyFixtureKeys': 'PASS'}
    finally:
        await context.close()


async def denied_export(browser, server, origin, routes, fixtures, exports):
    case = 'storage-denied-export'
    context, page, health = await observed_page(browser, origin, case)
    try:
        await page.goto(origin + '/__labs_qa__/denied?route=' + routes['T049'], wait_until='domcontentloaded')
        frame = page.frame_locator('iframe')
        await frame.locator('#tool-form').wait_for(state='visible')
        native_frame = next(item for item in page.frames if item.parent_frame is not None)
        await ready(native_frame)
        denial = await native_frame.evaluate("""() => {
          try { localStorage.getItem('digital-labs.workspace.v1'); return {blocked: false}; }
          catch (error) { return {blocked: true, name: error.name, message: error.message}; }
        }""")
        assert denial['blocked'] and denial['name'] == 'SecurityError', 'Expected a native opaque-origin storage denial'
        assert 'nicht verfügbar' in await frame.locator('.workspace-status').inner_text()
        favorite = frame.get_by_role('button', name='☆ Merken', exact=True)
        await favorite.click()
        await native_frame.wait_for_function("() => [...document.querySelectorAll('button')].find(button => button.textContent === '☆ Merken')?.getAttribute('aria-busy') !== 'true'")
        failure_message = await frame.locator('.workspace-status').inner_text()
        assert 'Der Browser blockiert das lokale Speichern.' in failure_message and 'Projektdatei sichern' in failure_message, failure_message
        await frame.get_by_text('Mit Projekt arbeiten', exact=True).click()
        rescue = '{"rettung":"Nativer SecurityError Grüße 🚀"}'
        await frame.locator('#field-text').fill(rescue)
        assert await frame.locator('#download-result').is_disabled()
        await download(page, frame.get_by_role('button', name='Stand als Datei sichern', exact=True), exports / 'denied-direct.json')
        payload = json.loads((exports / 'denied-direct.json').read_text())
        snapshot = payload['project']['snapshots'][0]
        assert snapshot['values']['text'] == rescue and snapshot['result'] == ''
        # A normal, independent origin context must accept the actual downloaded
        # emergency project; opaque-origin denial is not a private-mode claim.
        target = await context.new_page()
        target_health = PageHealth(target, origin)
        await target.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await target.locator('#labs-project-import').set_input_files(str(exports / 'denied-direct.json'))
        await wait_workspace(target, 'Projekt als Kopie importiert.')
        imported = json.loads(await workspace_raw(target))
        assert imported['projects'][0]['snapshots'][0] == snapshot
        check_health(health)
        check_health(target_health)
        return {'denial': denial, 'mechanism': 'Native sandboxed opaque-origin iframe without allow-same-origin',
                'visibleStorageFailureMessage': failure_message,
                'directExportExact': True, 'actualExportReimported': True,
                'scopeLimit': 'Does not represent every browser privacy mode or site-setting policy'}
    finally:
        await context.close()


async def run(root, temporary, record, *, browser_name='chromium', browser_executable=None):
    if not __debug__:
        raise RuntimeError('Lifecycle gate requires assertions; do not use python -O/-OO')
    from playwright.async_api import async_playwright
    release = json.loads((root / 'assets/labs/release.json').read_text())
    catalog = json.loads((root / 'assets/labs/tool-catalog.json').read_text())
    assert release['version'] == catalog['version'] and len(catalog['tools']) == 110
    routes = {tool['id']: tool['path'] for tool in catalog['tools']}
    fixtures, exports = temporary / 'fixtures', temporary / 'exports'
    generate(fixtures)
    exports.mkdir()
    image = large_png(fixtures / 'large-native.png')
    with serve_native(root) as (server, origin):
        async with async_playwright() as runtime:
            options = {'headless': True}
            if browser_executable is not None:
                options['executable_path'] = str(checked_browser_executable(browser_executable))
            if browser_name == 'chromium':
                # Playwright normally disables BFCache. Request the native
                # browser behavior here and report whether it was really used.
                options['ignore_default_args'] = ['--disable-back-forward-cache']
            browser = await getattr(runtime, browser_name).launch(**options)
            environment = {'browserEngine': browser_name, 'browserVersion': browser.version,
                           'releaseVersion': release['version'], 'largeImageFixture': image,
                           'chromiumBFCacheDisableFlagRemoved': browser_name == 'chromium'}
            try:
                cases = [('navigation-completed-result', completed_result),
                         ('navigation-pending-worker', pending_worker),
                         ('navigation-pending-image', pending_image),
                         ('navigation-qr-export', qr_navigation),
                         ('storage-near-limit', near_limit),
                         ('storage-native-quota', native_quota),
                         ('storage-denied-export', denied_export)]
                for identifier, action in cases:
                    try:
                        detail = await action(browser, server, origin, routes, fixtures, exports)
                        record(identifier, 'PASS', detail)
                    except Exception as exc:
                        record(identifier, 'FAIL', {'error': str(exc) or type(exc).__name__,
                            'errorType': type(exc).__name__, 'traceback': traceback.format_exc(),
                            'observedEvents': server.events(identifier)})
            finally:
                await browser.close()
            return environment


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--browser', choices=BROWSERS, default='chromium')
    parser.add_argument('--browser-executable', type=Path)
    args = parser.parse_args(argv)
    results = []
    def record(identifier, status, detail):
        results.append({'id': identifier, 'status': status, **detail})
        print(status + ' ' + identifier + (': ' + detail.get('error', '') if status != 'PASS' else ''), flush=True)
    try:
        playwright_version = package_version('playwright')
    except PackageNotFoundError:
        playwright_version = None
    environment = {'playwrightVersion': playwright_version, 'browserEngine': args.browser,
                   'browserVersion': None, 'releaseVersion': None,
                   'browserExecutable': str(args.browser_executable) if args.browser_executable else None,
                   'browserLauncher': 'explicit-local-executable' if args.browser_executable else 'playwright-default'}
    report_path = None
    try:
        report_path = checked_report_path(args.report, roots=(args.root,))
        with tempfile.TemporaryDirectory(prefix='labs-native-lifecycle-') as temporary:
            environment.update(asyncio.run(run(args.root.resolve(strict=True), Path(temporary), record,
                browser_name=args.browser, browser_executable=args.browser_executable)))
    except Exception as exc:
        record('setup-or-runtime', 'FAIL', {'error': str(exc) or type(exc).__name__,
               'errorType': type(exc).__name__, 'traceback': traceback.format_exc()})
    counts = Counter(row['id'] for row in results)
    coverage = {'missing': sorted(EXPECTED_CASES - set(counts)), 'unexpected': sorted(set(counts) - EXPECTED_CASES),
                'duplicates': sorted(key for key, count in counts.items() if count != 1)}
    passed = sum(row['status'] == 'PASS' for row in results)
    bfcache = [row['id'] for row in results if row.get('bfcacheUsed') is True]
    report = {'schemaVersion': 1, 'status': 'PASS' if passed == len(EXPECTED_CASES) and not any(coverage.values()) else 'FAIL',
              'checkedAt': datetime.now(timezone.utc).isoformat(), 'expectedCases': len(EXPECTED_CASES),
              'cases': len(results), 'passed': passed, 'browser': 'Playwright ' + BROWSERS[args.browser],
              'environment': environment, 'coverage': coverage, 'bfcacheObservedCases': bfcache,
              'scope': 'Seven separate native cases using production UI, trusted history-navigation events, actual image/QR processing, a delayed real worker request, real quota exhaustion and a real opaque-origin SecurityError. No lifecycle/storage/decoder API mocks. Additional to the unchanged 139-case functional gate.',
              'limitations': ['BFCache is claimed only for the cases where persisted pageshow and the same document were observed.',
                  'The QR race records whether export finished before navigation; it does not replace decode/toBlob to force a pending state.',
                  'Playwright WebKit is not physical Safari/iOS, touch-device or screenreader certification.',
                  'Storage fixtures use isolated disposable browser contexts; no user workspace is read or changed.'],
              'results': results}
    if report_path:
        try:
            write_report(report_path, report, roots=(args.root,))
        except (OSError, ValueError) as exc:
            report['status'] = 'FAIL'
            report['reportError'] = str(exc)
    print(json.dumps({key: value for key, value in report.items() if key != 'results'}, ensure_ascii=False))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
