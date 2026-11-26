#!/usr/bin/env python3
"""Native keyboard flows and reproducible, informative browser lab measurements.

Ten required cases, each with a fresh browser context. No application functions,
Worker constructors, timers or browser APIs are replaced. Browser timing starts
at a trusted form submit and ends after two animation-frame opportunities. This
is neither a Core Web Vitals measurement nor a physical-device certification.

python integration/qa/usability_gate.py --root /public/staging \
    --browser chromium --report /outside/checkout/usability-chromium.json
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import contextlib
from datetime import datetime, timezone
import hashlib
from importlib.metadata import PackageNotFoundError, version as package_version
import json
from pathlib import Path
import re
import statistics
import tempfile
import time
import traceback
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from browser_gate import BROWSERS, PageHealth, checked_browser_executable, ready, serve
from pages import checked_report_path, write_report


CHECKOUT = Path(__file__).resolve().parents[2]
VIEWPORTS = {'desktop': {'width': 1280, 'height': 900},
             'narrow': {'width': 390, 'height': 844}}
EXPECTED_CASES = {
    'directory-keyboard-desktop', 'directory-keyboard-narrow',
    'worker-keyboard-desktop', 'worker-keyboard-narrow',
    'gsc-10000-desktop', 'gsc-10000-narrow',
    'sitemap-10000-desktop', 'sitemap-10000-narrow',
    'priority-10000-desktop', 'priority-10000-narrow',
}
ACTION_TIMEOUT_MS = 30000
CASE_TIMEOUT_SECONDS = 150
FOCUS_SETTLE_MS = 2000
WARMUP_RUNS = 1
MEASURED_RUNS = 3
WORKLOAD_ROWS = 10000

# Passive instrumentation only. Capturing submit runs before the application's
# bubble listener; the status MutationObserver runs after the actual calculation.
# Two rAF opportunities also include the existing GSC pro-panel DOM updates.
OBSERVER = r"""(() => {
  const probe = {runs: [], pending: null};
  window.__labsUsabilityProbe = probe;
  document.addEventListener('submit', event => {
    if (event.target.id !== 'tool-form') return;
    const start = performance.now();
    const row = {trustedSubmit: event.isTrusted, start, status: null};
    probe.pending = row;
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    const status = document.querySelector('#tool-status');
    if (!status) return;
    new MutationObserver(() => {
      const row = probe.pending;
      if (!row || row.status !== null || !['success', 'error'].includes(status.dataset.kind)) return;
      row.status = status.dataset.kind;
      row.submitToStatusMs = performance.now() - row.start;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        row.submitToTwoFrameOpportunitiesMs = performance.now() - row.start;
        row.statusText = status.textContent;
        row.outputUTF16Units = document.querySelector('#result-output').value.length;
        row.toolDOMElements = document.querySelector('[data-tool]').querySelectorAll('*').length;
        row.renderedTableRows = document.querySelectorAll('.pro-panel tbody tr').length;
        row.renderedBars = document.querySelectorAll('#tool-preview .bar-row').length;
        row.downloadEnabled = !document.querySelector('#download-result').disabled;
        probe.runs.push(row);
        probe.pending = null;
      }));
    }).observe(status, {attributes: true, attributeFilter: ['data-kind']});
  }, {once: true});
})();"""

FOCUS = r"""selector => {
  const element = document.activeElement;
  if (!element || !element.matches(selector)) return {matched: false, active: element?.id || element?.tagName};
  const style = getComputedStyle(element), rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  const hit = right > left && bottom > top ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null;
  return {matched: true, id: element.id, tag: element.tagName,
    name: element.getAttribute('aria-label') || element.labels?.[0]?.textContent || element.textContent.trim().slice(0, 100),
    focusVisible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor,
    display: style.display, visibility: style.visibility, opacity: Number(style.opacity),
    intersectsViewport: right > left && bottom > top,
    unobscured: !!hit && (hit === element || element.contains(hit)),
    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
}"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def checked_base_url(value):
    if value is None:
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname \
            or parsed.username is not None or parsed.password is not None \
            or parsed.path not in {'', '/'} or parsed.query or parsed.fragment:
        raise ValueError('--base-url must be an HTTP(S) origin without credentials, path, query or fragment')
    parsed.port  # Reject malformed/out-of-range ports before opening a browser.
    return value.rstrip('/')


async def tab_to(page, selector, *, limit=80):
    """Reach controls only through real Tab events; never focus() or click()."""
    path = []
    for _ in range(limit + 1):
        current = await page.evaluate("""selector => ({matched: document.activeElement?.matches(selector),
          active: document.activeElement?.id || document.activeElement?.tagName})""", selector)
        if current['matched']:
            return path
        if len(path) == limit:
            break
        await page.keyboard.press('Tab')
        path.append(await page.evaluate("() => document.activeElement?.id || document.activeElement?.tagName"))
    raise AssertionError(f'Keyboard could not reach {selector} in {limit} Tab presses: {path}')


async def visible_focus(page, selector):
    from playwright.async_api import TimeoutError as BrowserTimeout
    initial = await page.evaluate(FOCUS, selector)
    started = time.perf_counter()
    # Native focus scrolling can settle after the Tab event has returned (WebKit).
    # Observe the same visibility requirements without moving focus or scrolling.
    predicate = f"""selector => {{
      const value = ({FOCUS})(selector);
      return value.matched && value.focusVisible && value.outlineWidth >= 1
        && !['none', 'hidden'].includes(value.outlineStyle)
        && !['transparent', 'rgba(0,0,0,0)'].includes(value.outlineColor.replaceAll(' ', ''))
        && value.display !== 'none' && value.visibility === 'visible' && value.opacity > 0
        && value.intersectsViewport && value.unobscured;
    }}"""
    try:
        await page.wait_for_function(predicate, arg=selector, polling='raf', timeout=FOCUS_SETTLE_MS)
    except BrowserTimeout as exc:
        final = await page.evaluate(FOCUS, selector)
        raise AssertionError(f'Native keyboard focus did not become visible within {FOCUS_SETTLE_MS}ms; initial={initial}; final={final}') from exc
    value = await page.evaluate(FOCUS, selector)
    assert value['matched'], f'Unexpected active element: {value}'
    assert value['focusVisible'] and value['outlineStyle'] not in {'none', 'hidden'} \
        and value['outlineWidth'] >= 1 and value['outlineColor'].replace(' ', '') not in {'transparent', 'rgba(0,0,0,0)'}, f'No visible focus outline: {value}'
    assert value['display'] != 'none' and value['visibility'] == 'visible' and value['opacity'] > 0, value
    assert value['intersectsViewport'] and value['unobscured'], f'Focused control is outside or obscured: {value}'
    value.update(nativeFocusSettleMs=round((time.perf_counter() - started) * 1000, 3),
        initialViewportIntersection=initial.get('intersectsViewport'), initialTop=initial.get('top'), initialBottom=initial.get('bottom'))
    return value


async def layout(page):
    value = await page.evaluate("""() => ({viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      outputWidth: document.querySelector('#result-output')?.getBoundingClientRect().width || null})""")
    assert value['documentWidth'] <= value['viewport'] + 1, f'Horizontal page overflow: {value}'
    return value


async def new_page(browser, viewport, origin):
    context = await browser.new_context(viewport=VIEWPORTS[viewport], accept_downloads=True,
        locale='de-DE', reduced_motion='reduce', color_scheme='light')
    context.set_default_timeout(ACTION_TIMEOUT_MS)
    await context.add_init_script(OBSERVER)
    page = await context.new_page()
    workers = []
    page.on('worker', lambda worker: workers.append(worker.url))
    return context, page, PageHealth(page, origin), workers


async def keyboard_export(page, destination):
    assert await page.locator('#download-result').evaluate('(element) => element === document.activeElement')
    async with page.expect_download(timeout=ACTION_TIMEOUT_MS) as pending:
        await page.keyboard.press('Enter')
    result = await pending.value
    failure = await result.failure()
    assert not failure, f'Download failed: {failure}'
    assert result.suggested_filename, 'Export has no filename'
    await result.save_as(destination)
    data = destination.read_bytes()
    assert data, 'Empty native export'
    return {'filename': result.suggested_filename, 'bytes': len(data), 'sha256': sha256(data)}, data


async def wait_measurement(page, count):
    await page.wait_for_function("count => window.__labsUsabilityProbe.runs.length === count && !window.__labsUsabilityProbe.pending",
        arg=count, timeout=ACTION_TIMEOUT_MS)
    row = await page.evaluate('window.__labsUsabilityProbe.runs.at(-1)')
    assert row['trustedSubmit'] is True, 'Expected a browser-generated trusted submit event'
    assert row['status'] == 'success' and row['downloadEnabled'], row
    assert row['outputUTF16Units'] > 0, 'Calculation did not produce an actual DOM output'
    return row


async def directory_keyboard(browser, origin, routes, viewport, _exports):
    context, page, health, _workers = await new_page(browser, viewport, origin)
    try:
        await page.goto(origin + '/tools/', wait_until='domcontentloaded')
        await page.locator('[data-tool-directory-controls]').wait_for(state='visible')
        assert await page.locator('.tool-card[data-search]:visible').count() == 110
        trail = await tab_to(page, '#tool-search')
        focus = [await visible_focus(page, '#tool-search')]
        await page.keyboard.insert_text('Regex-Testlabor')
        await page.wait_for_function("() => document.querySelectorAll('.tool-card[data-search]:not([hidden])').length === 1")
        card = page.locator('.tool-card[data-search]:visible')
        assert await card.get_attribute('href') == routes['T051'], 'Search selected an unexpected tool'
        status = page.locator('#search-count')
        assert await status.get_attribute('role') == 'status'
        assert await status.get_attribute('aria-live') == 'polite'
        assert '1' in await status.inner_text()
        for selector in ['#cluster-filter', '#directory-sort', '#directory-form button[type="submit"]', '.tool-card[data-search]:not([hidden])']:
            trail += await tab_to(page, selector)
            focus.append(await visible_focus(page, selector))
        directory_layout = await layout(page)
        await page.keyboard.press('Enter')
        await page.wait_for_url(origin + routes['T051'])
        await ready(page)
        assert await page.locator('[data-tool]').get_attribute('data-tool') == 'T051'
        health.check()
        return {'flow': 'Tab from document to search, type query, Tab through filters and submit to the unique result, Enter opens the actual tool.',
            'query': 'Regex-Testlabor', 'matchingTools': 1, 'openedTool': 'T051', 'tabTrail': trail,
            'focusObservations': focus, 'layout': directory_layout, **health.details()}
    finally:
        await context.close()


async def worker_keyboard(browser, origin, routes, viewport, exports):
    context, page, health, workers = await new_page(browser, viewport, origin)
    try:
        await page.goto(origin + routes['T051'], wait_until='domcontentloaded')
        await ready(page)
        await page.locator('.pro-import').first.wait_for(state='visible')
        trail, focus = [], []
        for selector, value in [('#field-pattern', 'SEO'), ('#field-flags', 'gi'), ('#field-text', 'SEO und seo; GEO.')]:
            trail += await tab_to(page, selector)
            focus.append(await visible_focus(page, selector))
            await page.keyboard.press('ControlOrMeta+A')
            await page.keyboard.insert_text(value)
        assert await page.locator('#download-result').is_disabled(), 'Old results remained exportable after editing'
        trail += await tab_to(page, '#tool-form button[type="submit"]')
        focus.append(await visible_focus(page, '#tool-form button[type="submit"]'))
        before = len(workers)
        await page.keyboard.press('Enter')
        timing = await wait_measurement(page, 1)
        observed = workers[before:]
        assert observed and all(urlsplit(url).path == '/assets/labs/worker.mjs' for url in observed), 'No actual production Worker observed'
        expected = [{'Treffer': 'SEO', 'Index': 0, 'Gruppen': []}, {'Treffer': 'seo', 'Index': 8, 'Gruppen': []}]
        text = await page.locator('#result-output').input_value()
        assert json.loads(text) == expected, 'Actual worker output differs from the known matches'
        trail += await tab_to(page, 'a.tool-jump')
        focus.append(await visible_focus(page, 'a.tool-jump'))
        await page.keyboard.press('Enter')
        trail += await tab_to(page, '#result-output')
        focus.append(await visible_focus(page, '#result-output'))
        trail += await tab_to(page, '#copy-result')
        focus.append(await visible_focus(page, '#copy-result'))
        trail += await tab_to(page, '#download-result')
        focus.append(await visible_focus(page, '#download-result'))
        exported, data = await keyboard_export(page, exports / f'worker-{viewport}.txt')
        assert data == text.encode(), 'Native download differs from the displayed result'
        health.check()
        return {'tool': 'T051', 'flow': 'Keyboard-only fields, trusted Enter submit, result jump, output/copy/export Tab reachability and Enter download.',
            'executionPath': 'Observed native module Worker', 'observedWorkers': observed, 'referenceMatches': 2,
            'tabTrail': trail, 'focusObservations': focus, 'timing': timing, 'export': exported,
            'layout': await layout(page), **health.details()}
    finally:
        await context.close()


def workloads():
    keys = [f'q{index:05}' for index in range(WORKLOAD_ROWS)]
    return {
        'gsc': {'tool': 'T038', 'fields': {
            'data': 'query,clicks,impressions\n' + '\n'.join(f'{key},10,1000' for key in keys),
            'baseline': 'query,clicks,impressions\n' + '\n'.join(f'{key},20,2000' for key in keys),
        }, 'recordsPerInput': [WORKLOAD_ROWS, WORKLOAD_ROWS]},
        'sitemap': {'tool': 'T005', 'fields': {
            'data': '\n'.join(f'https://example.org/{key} | 2024-02-29' for key in keys),
        }, 'recordsPerInput': [WORKLOAD_ROWS]},
        'priority': {'tool': 'T034', 'fields': {
            'data': 'url,impressions,ctr,target_ctr,age_days\n' + '\n'.join(f'https://example.org/{key},100,0,1,{index}' for index, key in enumerate(keys)),
            'age': '1',
        }, 'recordsPerInput': [WORKLOAD_ROWS]},
    }


def verify_workload(name, text):
    if name == 'sitemap':
        root = ET.fromstring(text)
        ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
        assert root.tag == ns + 'urlset' and len(root) == WORKLOAD_ROWS
        for index, entry in enumerate(root):
            assert entry.tag == ns + 'url' and len(entry) == 2
            assert entry.findtext(ns + 'loc') == f'https://example.org/q{index:05}'
            assert entry.findtext(ns + 'lastmod') == '2024-02-29'
        return
    rows = json.loads(text)
    assert len(rows) == WORKLOAD_ROWS
    for index, row in enumerate(rows):
        if name == 'gsc':
            expected = {'query': f'q{index:05}', 'dimension': 'query', 'clicks': 10, 'impressions': 1000, 'ctr': '1 %',
                'previousClicks': 20, 'previousImpressions': 2000, 'previousCtr': '1 %', 'clickDelta': -10,
                'impressionDelta': -1000, 'ctrDeltaPP': 0, 'presence': 'beide Exporte'}
        else:
            expected = {'url': f'https://example.org/q{WORKLOAD_ROWS - 1 - index:05}', 'potential': 1, 'score': WORKLOAD_ROWS - index}
        assert row == expected, f'Unexpected {name} reference row {index}: {row}'


async def load_workload_field(page, field, value, fixture_path):
    """Use the existing file chooser and UTF-8 importer for bulk text inputs.

    PR5 showed Chromium/WebKit timing out in automation fill() before production
    calculation. The workload remains identical; no value setter, forced action,
    mocked File API or skipped input validation is used here.
    """
    control = page.locator('#field-' + field)
    started = time.perf_counter()
    if await control.evaluate('(element) => element.tagName') == 'TEXTAREA':
        raw = value.encode('utf-8')
        fixture_path.parent.mkdir(exist_ok=True)
        fixture_path.write_bytes(raw)
        import_box = page.locator(f'#field-{field} + .pro-import')
        async with page.expect_file_chooser(timeout=ACTION_TIMEOUT_MS) as pending:
            await import_box.get_by_role('button', name='Textdatei laden', exact=True).click()
        chooser = await pending.value
        await chooser.set_files(str(fixture_path))
        await page.wait_for_function("selector => Boolean(document.querySelector(selector)?.textContent.trim())",
            arg=f'#field-{field} + .pro-import [role="status"]', timeout=ACTION_TIMEOUT_MS)
        message = await import_box.locator('[role="status"]').inner_text()
        assert message == 'Text lokal geladen.', f'Actual local file import failed: {message}'
        method = 'Native file chooser and existing production UTF-8 text import'
    else:
        await control.fill(value)
        raw = value.encode('utf-8')
        method = 'Small numeric control through ordinary browser fill'
    actual = await control.input_value()
    assert actual == value, f'Actual browser input differs from the complete {field} fixture'
    return {'method': method, 'utf8Bytes': len(raw), 'sha256': sha256(actual.encode('utf-8')),
        'exactInputMatch': True, 'preparationHarnessMs': round((time.perf_counter() - started) * 1000, 3)}


async def workload_case(browser, origin, routes, viewport, exports, name, fixture):
    context, page, health, workers = await new_page(browser, viewport, origin)
    try:
        await page.goto(origin + routes[fixture['tool']], wait_until='domcontentloaded')
        await ready(page)
        await page.locator('.pro-import').first.wait_for(state='visible')
        limits, input_loading = {}, {}
        for field, value in fixture['fields'].items():
            control = page.locator('#field-' + field)
            maximum = await control.get_attribute('maxlength')
            if maximum is not None:
                limits[field] = int(maximum)
                assert len(value) <= int(maximum), f'Synthetic fixture exceeds the real {field} input limit'
            input_loading[field] = await load_workload_field(page, field, value,
                exports.parent / 'fixtures' / f'{name}-{viewport}-{field}.txt')
        assert await page.locator('#download-result').is_disabled(), 'Input edit did not invalidate the old result'
        samples = []
        digest = None
        text = ''
        for iteration in range(WARMUP_RUNS + MEASURED_RUNS):
            # Input loading is outside the measured section. The activation itself
            # is a native key event, not execute(), dispatchEvent() or requestSubmit().
            wall_start = time.perf_counter()
            await page.locator('#tool-form button[type="submit"]').press('Enter')
            measurement = await wait_measurement(page, iteration + 1)
            text = await page.locator('#result-output').input_value()
            verify_workload(name, text)
            actual = sha256(text.encode())
            if digest is not None:
                assert actual == digest, 'Repeated workload produced a different output'
            digest = actual
            await page.locator('#result-output').scroll_into_view_if_needed()
            assert await page.locator('#result-output').is_visible()
            await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            measurement['activationToVisibleResultHarnessMs'] = round((time.perf_counter() - wall_start) * 1000, 3)
            if name == 'gsc':
                assert measurement['renderedTableRows'] == 25, 'Expected the real 25-row paginated GSC table'
                assert measurement['renderedBars'] == 12
                pagination = await page.locator('.pro-panel .controls span').inner_text()
                assert pagination == '10000 Zeilen · Seite 1/400', pagination
            if iteration >= WARMUP_RUNS:
                samples.append(measurement)
        assert not workers, 'Unexpected Worker path; update the explicitly reported execution mechanism'
        # Download the entire real result, even though the GSC DOM is paginated.
        await page.locator('#download-result').focus()
        exported, data = await keyboard_export(page, exports / f'{name}-{viewport}.txt')
        assert data == text.encode(), 'Native workload export differs from the complete DOM output'
        verify_workload(name, data.decode())
        health.check()
        values = [row['submitToTwoFrameOpportunitiesMs'] for row in samples]
        return {'tool': fixture['tool'], 'recordsPerInput': fixture['recordsPerInput'],
            'inputUTF16Units': {key: len(value.encode('utf-16-le')) // 2 for key, value in fixture['fields'].items()},
            'inputSHA256': {key: sha256(value.encode()) for key, value in fixture['fields'].items()},
            'actualInputMaxlength': limits, 'inputLoading': input_loading,
            'executionPath': 'Production UI on the browser main thread; no Worker observed',
            'outputRecords': WORKLOAD_ROWS, 'outputUTF8Bytes': len(data), 'outputSHA256': digest,
            'warmupRuns': WARMUP_RUNS, 'measuredRuns': MEASURED_RUNS, 'samples': samples,
            'submitToTwoFrameOpportunitiesMs': {'min': min(values), 'median': statistics.median(values), 'max': max(values)},
            'renderedTableRows': samples[-1]['renderedTableRows'], 'export': exported,
            'presentationLimit': 'GSC: 25 rendered table rows per page, 12 preview bars, complete 10000-row JSON download.' if name == 'gsc'
                else 'The complete output is held in the existing bounded-height textarea; no synthetic replacement renderer.',
            'layout': await layout(page), **health.details()}
    finally:
        await context.close()


async def check_served_inputs(browser, origin, root, routes):
    """Bind optional existing-server measurements to these actual local inputs."""
    context = await browser.new_context()
    hashes = {}
    try:
        paths = ['assets/labs/release.json', 'assets/labs/tool-catalog.json',
            'assets/labs/tools.mjs', 'assets/labs/app.mjs', 'assets/labs/worker.mjs',
            'assets/labs/pro.mjs', 'assets/labs/pro-ui.mjs', 'assets/labs/labs.css',
            'assets/labs/directory.mjs', 'assets/labs/directory-model.mjs', 'tools/index.html']
        paths += [route.lstrip('/') + 'index.html' for route in routes.values()]
        for path in paths:
            response = await context.request.get(origin + '/' + path, timeout=ACTION_TIMEOUT_MS)
            assert response.status == 200, f'HTTP {response.status}: {path}'
            actual = await response.body()
            assert actual == (root / path).read_bytes(), f'Served file differs from the selected local root: {path}'
            hashes[path] = sha256(actual)
    finally:
        await context.close()
    return hashes


async def run(root, temporary, record, environment, *, browser_name='chromium', browser_executable=None, base_url=None):
    if not __debug__:
        raise RuntimeError('Usability gate requires assertions; do not use python -O/-OO')
    from playwright.async_api import async_playwright
    release = json.loads((root / 'assets/labs/release.json').read_text())
    catalog = json.loads((root / 'assets/labs/tool-catalog.json').read_text())
    assert isinstance(release['version'], str) and re.fullmatch(r'\d+\.\d+\.\d+', release['version'])
    assert release['version'] == catalog['version'] and len(catalog['tools']) == 110
    routes = {item['id']: item['path'] for item in catalog['tools'] if item['id'] in {'T005', 'T034', 'T038', 'T051'}}
    assert set(routes) == {'T005', 'T034', 'T038', 'T051'}
    for route in routes.values():
        assert re.fullmatch(r'/tools/[a-z0-9-]+/[a-z0-9-]+/', route), 'Unexpected tool route'
    exports = temporary / 'exports'
    exports.mkdir()
    fixtures = workloads()
    origin_context = contextlib.nullcontext(checked_base_url(base_url)) if base_url else serve(root)
    with origin_context as origin:
        async with async_playwright() as runtime:
            options = {'headless': True}
            if browser_executable is not None:
                options['executable_path'] = str(checked_browser_executable(browser_executable))
            browser = await getattr(runtime, browser_name).launch(**options)
            environment.update(browserVersion=browser.version, releaseVersion=release['version'],
                origin=origin, serverMode='existing-matching-origin' if base_url else 'isolated-local-http',
                deviceScaleFactor=1, colorScheme='light', locale='de-DE', reducedMotion='reduce')
            try:
                environment['servedInputSHA256'] = await check_served_inputs(browser, origin, root, routes)
                definitions = []
                for viewport in VIEWPORTS:
                    definitions.extend([
                        (f'directory-keyboard-{viewport}', directory_keyboard, viewport, {}),
                        (f'worker-keyboard-{viewport}', worker_keyboard, viewport, {}),
                    ])
                for name, fixture in fixtures.items():
                    for viewport in VIEWPORTS:
                        definitions.append((f'{name}-10000-{viewport}', workload_case, viewport, {'name': name, 'fixture': fixture}))
                assert len(definitions) == len(EXPECTED_CASES) and {row[0] for row in definitions} == EXPECTED_CASES
                for identifier, action, viewport, kwargs in definitions:
                    try:
                        detail = await asyncio.wait_for(action(browser, origin, routes, viewport, exports, **kwargs), timeout=CASE_TIMEOUT_SECONDS)
                        record(identifier, 'PASS', {'viewport': VIEWPORTS[viewport], **detail})
                    except Exception as exc:
                        record(identifier, 'FAIL', {'viewport': VIEWPORTS[viewport], 'error': str(exc) or type(exc).__name__,
                            'errorType': type(exc).__name__, 'traceback': traceback.format_exc()})
            finally:
                await browser.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Already validated public website directory')
    parser.add_argument('--report', type=Path, required=True, help='JSON report outside checkout and public root')
    parser.add_argument('--browser', choices=BROWSERS, default='chromium')
    parser.add_argument('--browser-executable', type=Path)
    parser.add_argument('--base-url', help='Optional existing HTTP(S) origin; tested source/page bytes must equal --root')
    args = parser.parse_args(argv)
    results = []
    def record(identifier, status, detail):
        results.append({'id': identifier, 'status': status, **detail})
        # Keep full failure evidence in JSON; large fixture arguments need not be
        # repeated in the console log as well.
        error = detail.get('error', '').splitlines()
        print(status + ' ' + identifier + (': ' + error[0] if status != 'PASS' and error else ''), flush=True)
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
        report_path = checked_report_path(args.report, roots=(args.root, CHECKOUT))
        base_url = checked_base_url(args.base_url)
        with tempfile.TemporaryDirectory(prefix='labs-native-usability-') as temporary:
            asyncio.run(run(args.root.resolve(strict=True), Path(temporary), record, environment,
                browser_name=args.browser, browser_executable=args.browser_executable, base_url=base_url))
    except Exception as exc:
        record('setup-or-runtime', 'FAIL', {'error': str(exc) or type(exc).__name__,
            'errorType': type(exc).__name__, 'traceback': traceback.format_exc()})
    counts = Counter(row['id'] for row in results)
    coverage = {'missing': sorted(EXPECTED_CASES - set(counts)), 'unexpected': sorted(set(counts) - EXPECTED_CASES),
        'duplicates': sorted(key for key, count in counts.items() if count != 1)}
    passed = sum(row['status'] == 'PASS' for row in results)
    report = {'schemaVersion': 1, 'status': 'PASS' if passed == len(EXPECTED_CASES) and not any(coverage.values()) else 'FAIL',
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'expectedCases': len(EXPECTED_CASES),
        'cases': len(results), 'passed': passed, 'browser': 'Playwright ' + BROWSERS[args.browser],
        'environment': environment, 'viewports': VIEWPORTS, 'coverage': coverage,
        'functionalTimeouts': {'actionMilliseconds': ACTION_TIMEOUT_MS, 'caseSeconds': CASE_TIMEOUT_SECONDS,
            'nativeFocusSettleMilliseconds': FOCUS_SETTLE_MS},
        'scope': 'Ten native cases: directory search/link and Worker-tool keyboard/result/export flows at two viewports, plus three 10000-row workload/DOM/full-download checks at both viewports. Browser APIs and application functions are not mocked.',
        'measurement': {'warmupRuns': WARMUP_RUNS, 'measuredRuns': MEASURED_RUNS,
            'browserClock': 'performance.now at trusted submit capture, status MutationObserver, then two requestAnimationFrame opportunities. Includes production computation, result assignment and GSC panel updates. Excludes input fixture loading and oracle assertions.',
            'harnessClock': 'Native activation through completion, full-output read/reference verification, scrolling output into view and two additional frame opportunities; includes automation overhead.',
            'timingThreshold': None},
        'limitations': [
            'Informative headless-browser lab samples with no CPU/network throttling; not Core Web Vitals, INP, field percentiles or a performance service-level objective.',
            'Animation-frame opportunities are not a pixel-paint timestamp. CSS focus, viewport intersection and hit testing do not certify all focus contrast, every widget or screenreader output.',
            '390 CSS pixels is a narrow desktop-engine viewport, not a physical phone, touch or Safari/iOS certification.',
            'Fixtures remain within the actual 500000-character text fields. The GSC renderer intentionally paginates 25 rows while the exported JSON contains all 10000 records.',
            'Bulk workload preparation uses the existing local UTF-8 file chooser/import with exact field-content checks. Bulk keyboard/paste throughput is not measured.',
            'The three data tools currently execute on the main thread; the separate T051 flow proves an actual native production Worker.',
            'Only the selected browser engine actually runs; missing engines, failed startup, omitted cases or functional timeouts are FAIL, never substituted by another engine.',
        ], 'results': results}
    if report_path:
        try:
            write_report(report_path, report, roots=(args.root, CHECKOUT))
        except (OSError, ValueError) as exc:
            report['status'] = 'FAIL'
            report['reportError'] = str(exc)
    print(json.dumps({key: value for key, value in report.items() if key not in {'results', 'environment'}}, ensure_ascii=False))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
