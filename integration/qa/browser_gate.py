#!/usr/bin/env python3
"""Native browser gate for the staged website, intended for GitHub Actions.

Missing dependencies, browser startup failures and any failed case fail the gate.
This is shipped test code, not a claim that the workflow has already run.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import contextlib
import copy
import csv
from datetime import datetime, timezone
import functools
from html.parser import HTMLParser
import http.server
import io
from importlib.metadata import PackageNotFoundError, version as package_version
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import traceback
from urllib.parse import urlsplit

from fixtures import generate, read_png

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pages import checked_report_path, write_report


MEDIA = {'T073', 'T074', 'T075', 'T076', 'T077', 'T080', 'T081', 'T083', 'T084'}
REQUIRED_FILES = MEDIA - {'T077'}
AUDIO = {'T095', 'T096', 'T097', 'T099', 'T100'}
WIDTHS = (320, 390, 768)
BROWSERS = {'chromium': 'Chromium', 'firefox': 'Firefox', 'webkit': 'WebKit'}
LEARNING = {'W026', 'W028', 'W029', 'W041', 'W044', 'W051', 'W056', 'W060', 'W062', 'W066', 'W070', 'W076'}
AUDIO_CASES = {identifier + '-standard' for identifier in AUDIO} | {
    'T096-stille', 'T097-stille', 'T095-sine-1200Hz', 'T095-triangle-1200Hz',
    'T095-square-1200Hz', 'T095-sawtooth-1200Hz', 'T097-alle-spuren',
    'T099-vierklang', 'T100-sustain-null',
}
EXPECTED_CASES = {f'T{number:03}' for number in range(1, 111)} | LEARNING | {'directory', 'workspace', 'workspace-projects'} | {'audio:' + name for name in AUDIO_CASES}
TILEMAP_SNAPSHOT_CASES = (
    ('edited-grid-restore', 'Bearbeitete Zellen speichern, nach anderen Eingaben laden und exakt exportieren'),
    ('missing-seed-default', 'Projektstand ohne Seed-Feld mit Standardwert und erhaltenem Raster laden'),
)

# Copied byte-equivalent as parsed data from tests/tools-v110-native-fixtures.json.
# Keeping these inputs inline makes the installed gate self-contained.
SITEMAP_XML_CASES = [{'key': 'image-extension',
  'name': 'Sitemap: Bild- und fremde loc-Felder nicht als Seiten zählen',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
         'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" '
         'xmlns:x="urn:qa:extension"><url><loc>https://example.org/ratgeber/</loc><image:image><image:loc>https://cdn.example.org/bild.jpg</image:loc></image:image><x:loc>https://example.org/keine-seite/</x:loc></url></urlset>',
  'expected': {'Typ': 'URL-Sitemap', 'URLs': 1, 'Duplikate': 0, 'Tiefen': {'1': 1}, 'Verzeichnisse': {'ratgeber': 1}}},
 {'key': 'prefixed-core',
  'name': 'Sitemap: Präfix des Sitemaps-Namensraums korrekt auswerten',
  'xml': '<s:urlset '
         'xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url><s:loc>https://example.org/a/b/</s:loc></s:url></s:urlset>',
  'expected': {'Typ': 'URL-Sitemap', 'URLs': 1, 'Duplikate': 0, 'Tiefen': {'2': 1}, 'Verzeichnisse': {'a': 1}}},
 {'key': 'index',
  'name': 'Sitemap-Index: Dateien getrennt von Seiten-URLs ausweisen',
  'xml': '<sitemapindex '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.org/a.xml</loc></sitemap><sitemap><loc>https://example.org/b.xml</loc></sitemap></sitemapindex>',
  'expected': {'Typ': 'Sitemap-Index',
               'Sitemapdateien': 2,
               'Duplikate': 0,
               'Tiefen': {'1': 2},
               'Verzeichnisse': {'a.xml': 1, 'b.xml': 1}}},
 {'key': 'wrong-root',
  'name': 'Sitemap: beliebiges XML mit loc-Feldern abweisen',
  'xml': '<catalog '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/ratgeber/</loc></url></catalog>',
  'error': 'Sitemaps-Namensraum'},
 {'key': 'wrong-namespace',
  'name': 'Sitemap: falschen Namensraum abweisen',
  'xml': '<urlset xmlns="urn:wrong"><url><loc>https://example.org/ratgeber/</loc></url></urlset>',
  'error': 'Sitemaps-Namensraum'},
 {'key': 'no-namespace',
  'name': 'Sitemap: fehlenden Namensraum abweisen',
  'xml': '<urlset><url><loc>https://example.org/ratgeber/</loc></url></urlset>',
  'error': 'Sitemaps-Namensraum'},
 {'key': 'extension-only',
  'name': 'Sitemap: Bildadresse ersetzt kein direktes Seiten-loc',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
         'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><image:image><image:loc>https://example.org/bild.jpg</image:loc></image:image></url></urlset>',
  'error': 'genau ein direktes loc'},
 {'key': 'duplicate-loc',
  'name': 'Sitemap: zwei loc-Felder im selben Eintrag abweisen',
  'xml': '<urlset '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/ratgeber/</loc><loc>https://example.org/zweite/</loc></url></urlset>',
  'error': 'genau ein direktes loc'},
 {'key': 'nested-loc',
  'name': 'Sitemap: verschachteltes loc ersetzt kein direktes loc',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
         'xmlns:x="urn:qa:extension"><url><x:wrapper><loc>https://example.org/ratgeber/</loc></x:wrapper></url></urlset>',
  'error': 'genau ein direktes loc'},
 {'key': 'unexpected-core-entry',
  'name': 'Sitemap: URL- und Indexeinträge nicht vermischen',
  'xml': '<urlset '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/ratgeber/</loc></url><sitemap><loc>https://example.org/sitemap.xml</loc></sitemap></urlset>',
  'error': 'Unerwarteter Eintrag'},
 {'key': 'element-inside-loc',
  'name': 'Sitemap: loc mit untergeordneten Elementen abweisen',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
         'xmlns:x="urn:qa:extension"><url><loc>https://example.org/<x:fragment>a</x:fragment></loc></url></urlset>',
  'error': 'genau ein direktes loc'},
 {'key': 'escaped-query',
  'name': 'Sitemap: XML-Entities im loc nativ dekodieren',
  'xml': '<urlset '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/a/?x=1&amp;y=2</loc></url></urlset>',
  'expected': {'Typ': 'URL-Sitemap', 'URLs': 1, 'Duplikate': 0, 'Tiefen': {'1': 1}, 'Verzeichnisse': {'a': 1}}},
 {'key': 'empty-fragment',
  'name': 'Sitemap: leeres Fragment in loc abweisen',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/a/#</loc></url></urlset>',
  'error': 'Fragmente'},
 {'key': 'invalid-xml',
  'name': 'Sitemap: fehlerhaftes XML nativ abweisen',
  'xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/ratgeber/</loc></urlset>',
  'error': 'Ungültiges XML'},
 {'key': 'doctype',
  'name': 'Sitemap: DTD vor der DOM-Verarbeitung abweisen',
  'xml': '<!DOCTYPE urlset [<!ENTITY demo "https://example.org/ratgeber/">]><urlset '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>&demo;</loc></url></urlset>',
  'error': 'DOCTYPE'},
 {'key': 'duplicate-urls',
  'name': 'Sitemap: doppelte Seitenadressen getrennt ausweisen',
  'xml': '<urlset '
         'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.org/ratgeber/</loc></url><url><loc>https://example.org/ratgeber/</loc></url></urlset>',
  'expected': {'Typ': 'URL-Sitemap', 'URLs': 2, 'Duplikate': 1, 'Tiefen': {'1': 2}, 'Verzeichnisse': {'ratgeber': 2}}}]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


@contextlib.contextmanager
def serve(root):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class PageHealth:
    """Fail a functional case on uncaught JS or failed HTTP dependencies too.

    Intentionally malformed media fixtures use blob/data URLs, so their decode
    failures are checked by the media cases, not treated as failed HTTP assets.
    """
    def __init__(self, page, origin):
        self.errors, self.external, self.http_errors, self.failed_requests = [], [], [], []
        self.origin = urlsplit(origin)
        page.on('pageerror', lambda exc: self.errors.append(str(exc)))
        page.on('request', self.request)
        page.on('response', self.response)
        page.on('requestfailed', self.failed)

    def request(self, request):
        parsed = urlsplit(request.url)
        if parsed.scheme not in {'data', 'blob', 'about'} and (parsed.scheme, parsed.netloc) != (self.origin.scheme, self.origin.netloc):
            self.external.append(request.url)

    def response(self, response):
        if response.status >= 400:
            self.http_errors.append({'url': response.url, 'status': response.status})

    def failed(self, request):
        if urlsplit(request.url).scheme in {'http', 'https'}:
            self.failed_requests.append({'url': request.url, 'failure': request.failure})

    def details(self):
        return {'pageErrors': self.errors, 'externalRequests': self.external,
                'httpErrors': self.http_errors, 'failedRequests': self.failed_requests}

    def check(self):
        failures = {key: value for key, value in self.details().items() if value}
        if failures:
            raise AssertionError('Browser page/dependency failures: ' + json.dumps(failures, ensure_ascii=False))


def learning_routes(root):
    class Models(HTMLParser):
        def __init__(self):
            super().__init__()
            self.ids = []
        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if 'data-learning-model' in values:
                self.ids.append(values['data-learning-model'])
    routes = {}
    for path in sorted((root / 'wissen').rglob('index.html')):
        parser = Models()
        parser.feed(path.read_text(encoding='utf-8'))
        for identifier in parser.ids:
            if identifier in routes:
                raise ValueError('Duplicate learning model: ' + identifier)
            routes[identifier] = '/' + path.relative_to(root).as_posix()[:-10]
    return routes


async def ready(page, expected='success'):
    await page.wait_for_function("() => ['success','error'].includes(document.querySelector('#tool-status')?.dataset.kind)")
    kind = await page.locator('#tool-status').get_attribute('data-kind')
    if kind != expected:
        raise AssertionError(await page.locator('#tool-status').inner_text())


async def submit(page, expected='success'):
    await page.locator('#tool-form button[type="submit"]').click()
    await ready(page, expected)


async def download(page, button, destination):
    async with page.expect_download() as pending:
        await button.click()
    result = await pending.value
    failure = await result.failure()
    if failure:
        raise AssertionError('Download failed: ' + failure)
    if not result.suggested_filename:
        raise AssertionError('Missing download filename')
    await result.save_as(destination)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise AssertionError('Empty download')
    return result.suggested_filename


async def responsive(page, widths=WIDTHS):
    for width in widths:
        await page.set_viewport_size({'width': width, 'height': 844})
        for theme in ('light', 'dark'):
            current = await page.locator('html').get_attribute('data-theme') or 'light'
            if current != theme:
                await page.get_by_role('button', name='Farbschema wechseln', exact=True).click()
            await page.wait_for_function('(theme) => document.documentElement.dataset.theme === theme', arg=theme)
            await measure_responsive(page, width, theme)


async def measure_responsive(page, width, theme):
    metrics = await page.evaluate("""() => {
      const html=document.documentElement;
      const visible=el=>!!(el.getClientRects().length && getComputedStyle(el).visibility!=='hidden');
      return {
        width:innerWidth, scrollWidth:html.scrollWidth,
        fields:[...document.querySelectorAll('#tool-form input:not([type=hidden]),#tool-form select,#tool-form textarea,#labs-workspace input:not([type=hidden]),#labs-workspace select')]
          .filter(visible).map(el=>({id:el.id,label:!!(el.labels?.length||el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')),
          left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})),
        buttons:[...document.querySelectorAll('#tool-form button,.learning-actions button,[data-tool-directory-controls] button,#labs-workspace button')]
          .filter(visible).map(el=>({name:el.getAttribute('aria-label')||el.textContent.trim(),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
      };
    }""")
    if metrics['scrollWidth'] > metrics['width'] + 1:
        raise AssertionError(f'Horizontal page overflow at {width}px/{theme}: {metrics["scrollWidth"]}')
    for field in metrics['fields']:
        if not field['label'] or field['left'] < -1 or field['right'] > width + 1:
            raise AssertionError(f'Field inaccessible/outside viewport at {width}px/{theme}: {field}')
    for button in metrics['buttons']:
        if not button['name'] or button['width'] < 24 or button['height'] < 24:
            raise AssertionError(f'Unnamed/tiny action at {width}px/{theme}: {button}')


async def file_example(page, identifier, fixtures):
    files = [fixtures / 'sprite-red.png', fixtures / 'sprite-blue.png'] if identifier == 'T083' else [fixtures / ('tone-silence.wav' if identifier == 'T084' else 'alpha-grid.png' if identifier == 'T074' else 'color-grid.png')]
    await page.locator('#field-file').set_input_files([str(path) for path in files])
    if identifier in {'T073', 'T074'}:
        await page.locator('#field-format').select_option('image/png')
    if identifier in {'T073', 'T075'}:
        await page.locator('#field-width').fill('320')
    if identifier == 'T076':
        await page.locator('#field-size').select_option('32')
    if identifier == 'T083':
        await page.locator('#field-cols').fill('2')
        await page.locator('#field-padding').fill('2')
    await submit(page)


def check_image(identifier, path, metadata):
    image = read_png(path)
    expected = {'T073': (320, 240), 'T074': (320, 240), 'T075': (320, 240), 'T076': (32, 32),
                'T077': (1200, 630), 'T080': (400, 300), 'T081': (640, 480), 'T083': (72, 36), 'T084': (1000, 300)}[identifier]
    actual = (image['width'], image['height'])
    assert actual == expected, (identifier, actual, expected)
    assert actual == (metadata['Breite'], metadata['Höhe'])
    assert metadata['AusgabeBytes'] == image['bytes']
    assert metadata['Format'] == 'image/png'
    pixel = image['pixel']
    if identifier in {'T073', 'T075', 'T080'}:
        assert pixel(8, 8) == (255, 32, 48, 255), (identifier, pixel(8, 8))
    if identifier == 'T074':
        assert pixel(20, 80)[3] == 0, 'PNG transparency was lost'
        assert pixel(100, 80)[3] == 128, 'PNG partial alpha was lost'
        assert pixel(200, 80) == (32, 180, 96, 255)
    if identifier == 'T076':
        assert pixel(16, 0)[3] == 0, 'Favicon aspect fit must preserve transparent padding'
    if identifier == 'T081':
        assert all(pixel(x, y) == (0, 0, 0, 255) for y in range(20, 70) for x in range(20, 170)), 'Every pixel in the annotation rectangle must be opaque black'
        assert pixel(10, 10) == (255, 32, 48, 255), 'Annotation changed an outside pixel'
        assert all(pixel(x, y) == (255, 32, 48, 255) for x, y in [(19, 20), (170, 20), (20, 19), (20, 70)]), 'Annotation changed an adjacent outside pixel'
        assert pixel(600, 400) == (240, 196, 32, 255), 'Annotation changed the outside image'
    if identifier == 'T083':
        assert pixel(0, 0)[3] == 0, 'Sprite padding must stay transparent'
        assert pixel(18, 18) == (255, 32, 48, 255)
        assert pixel(54, 18) == (32, 96, 220, 255)
        assert len(metadata['frames']) == 2
        assert [(f['x'], f['y']) for f in metadata['frames']] == [(2, 2), (38, 2)]
    if identifier == 'T084':
        assert abs(metadata['DauerSekunden'] - 1) < .001
        assert metadata['Kanäle'] == 1
        assert pixel(100, 100) == (246, 244, 239, 255), 'Silence should have no peak at this pixel'
        assert pixel(500, 100) != pixel(100, 100), 'Tone peak should be drawn'
    return {'width': actual[0], 'height': actual[1], 'bytes': image['bytes']}


async def negative_media(page, identifier, fixtures):
    await page.locator('#reset-tool').click()
    assert await page.locator('#download-result').is_disabled()
    assert await page.locator('#result-output').input_value() == ''
    if identifier in REQUIRED_FILES:
        await submit(page, 'error')
        assert await page.locator('#download-result').is_disabled()
    wrong = fixtures / ('invalid-audio.wav' if identifier == 'T084' else 'invalid-image.png')
    await page.locator('#field-file').set_input_files(str(wrong))
    await submit(page, 'error')
    assert await page.locator('#download-result').is_disabled()
    assert await page.locator('#result-output').input_value() == ''
    if identifier in {'T080', 'T081'}:
        await page.locator('#field-file').set_input_files(str(fixtures / 'color-grid.png'))
        await page.locator('#field-x').fill('639')
        await submit(page, 'error')
        assert await page.locator('#download-result').is_disabled()
    if identifier == 'T083':
        await page.locator('#field-file').set_input_files([str(fixtures / 'sprite-red.png')] * 33)
        await submit(page, 'error')
        assert await page.locator('#download-result').is_disabled()


async def sitemap_xml_cases(page, result):
    """Use real form input and browser DOMParser; no substitute XML parser."""
    for fixture, row in zip(SITEMAP_XML_CASES, result['cases']):
        result['executed'] += 1
        try:
            await page.locator('#field-xml').fill(fixture['xml'])
            await submit(page, 'error' if 'error' in fixture else 'success')
            output = await page.locator('#result-output').input_value()
            if 'error' in fixture:
                message = await page.locator('#tool-status').inner_text()
                assert fixture['error'] in message, message
                assert output == '', 'Rejected XML retained an exportable result'
                assert await page.locator('#download-result').is_disabled()
                assert await page.locator('#copy-result').is_disabled()
                row['observedError'] = message
            else:
                actual = json.loads(output)
                assert actual == fixture['expected'], {'actual': actual, 'expected': fixture['expected']}
                assert await page.locator('#download-result').is_enabled()
                assert await page.locator('#copy-result').is_enabled()
                assert await page.locator('#tool-preview').is_visible()
                assert await page.locator('#tool-preview > *').count() > 0, 'Missing directory preview'
                row['observedResult'] = actual
            row['status'] = 'PASS'
            result['passed'] += 1
        except Exception as exc:
            row.update(status='FAIL', error=str(exc))
            raise AssertionError(f"XML subcase {fixture['key']}: {exc}") from exc
    assert result['executed'] == result['passed'] == len(SITEMAP_XML_CASES)


async def tilemap_snapshot_cases(page, origin, route, fixtures, exports, result):
    """Use real project UI/imports; never inject DOM state or localStorage values."""
    async def set_fields(values):
        for key, value in values.items():
            await page.locator('#field-' + key).fill(value)

    async def open_project(name):
        await page.goto(origin + route, wait_until='domcontentloaded')
        await ready(page)
        await page.get_by_text('Mit Projekt arbeiten', exact=True).click()
        await page.locator('#labs-project-select').select_option(label=name)

    async def toggle(x, y):
        await page.get_by_role('spinbutton', name='Spalte (ab 0)', exact=True).fill(str(x))
        await page.get_by_role('spinbutton', name='Zeile (ab 0)', exact=True).fill(str(y))
        await page.get_by_role('button', name='Kachel umschalten', exact=True).click()

    async def assert_restored(values, text):
        actual = {key: await page.locator('#field-' + key).input_value() for key in values}
        assert actual == values, f'Restored tilemap fields differ: {actual!r} != {values!r}'
        assert await page.locator('#result-output').input_value() == text, 'Restored tilemap must preserve the exact hand-edited JSON'
        assert await page.locator('#tool-status').get_attribute('data-kind') == 'success', 'Restored tilemap must be a current successful result'
        assert 'Bearbeitetes Raster wiederhergestellt.' in await page.locator('#tool-status').inner_text(), 'Tilemap load must confirm restoration instead of requesting regeneration'
        assert await page.locator('#download-result').is_enabled(), 'Restored tilemap download must be enabled'
        assert await page.locator('#copy-result').is_enabled(), 'Restored tilemap copy must be enabled'
        assert await page.locator('#tool-preview canvas').is_visible(), 'Restored tilemap must render its editable preview'

    first, second = result['cases']
    first['status'] = 'RUNNING'
    result['executed'] += 1
    try:
        default_seed = await page.locator('#field-seed').get_attribute('value')
        assert isinstance(default_seed, str), 'Tilemap seed must expose its HTML reset default'
        project_name = 'CI Tilemap bearbeitet'
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-name').fill(project_name)
        await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
        await page.wait_for_function("(name) => [...document.querySelectorAll('.workspace-project h3')].some(el=>el.textContent.startsWith(name))", arg=project_name)
        await open_project(project_name)
        saved_fields = {'width': '10', 'height': '6', 'seed': 'ci-tilemap-saved'}
        await set_fields(saved_fields)
        await submit(page)
        expected = json.loads(await page.locator('#result-output').input_value())
        assert (expected['width'], expected['height']) == (10, 6), 'Tilemap must use the selected nondefault dimensions'
        cells = [(0, 0), (9, 5)]
        for x, y in cells:
            await toggle(x, y)
            expected['tiles'][y][x] = 1 - expected['tiles'][y][x]
            assert json.loads(await page.locator('#result-output').input_value()) == expected, f'Tile edit at ({x}, {y}) must change exactly that cell'
        saved_text = await page.locator('#result-output').input_value()
        await page.get_by_role('button', name='Stand speichern', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent === 'Stand gespeichert.'")

        await set_fields({'width': '7', 'height': '5', 'seed': 'ci-tilemap-other'})
        assert await page.locator('#download-result').is_disabled(), 'Changing tilemap inputs must invalidate the previous export'
        assert await page.locator('#result-output').input_value() == '', 'Changing tilemap inputs must clear the previous result'
        await submit(page)
        assert json.loads(await page.locator('#result-output').input_value()) != expected, 'Replacement inputs must produce a different map before restoration'
        await page.get_by_role('button', name='Stand laden', exact=True).click()
        await assert_restored(saved_fields, saved_text)
        restored_path = exports / 'T087-restored.json'
        await download(page, page.locator('#download-result'), restored_path)
        assert restored_path.read_text(encoding='utf-8') == saved_text, 'Real restored tilemap download must equal the saved hand-edited JSON'

        # The recreated preview must retain its own live editing handlers.
        await toggle(0, 0)
        edited_again = copy.deepcopy(expected)
        edited_again['tiles'][0][0] = 1 - edited_again['tiles'][0][0]
        assert json.loads(await page.locator('#result-output').input_value()) == edited_again, 'Restored tilemap preview must remain editable'
        await page.get_by_role('button', name='Stand laden', exact=True).click()
        await assert_restored(saved_fields, saved_text)

        project_path = exports / 'T087-project.json'
        await download(page, page.get_by_role('button', name='Stand als Datei sichern', exact=True), project_path)
        project_payload = json.loads(project_path.read_text(encoding='utf-8'))
        assert project_payload['format'] == 'digital-labs-project' and project_payload['version'] == 1, 'Tilemap project export must use the supported project format'
        assert len(project_payload['project']['snapshots']) == 1, 'Tilemap project export must contain one snapshot'
        snapshot = project_payload['project']['snapshots'][0]
        assert snapshot['tool'] == 'T087' and snapshot['values'] == saved_fields and snapshot['result'] == saved_text, 'Tilemap project export must retain all saved fields and edited cells'
        first.update(status='PASS', editedCells=cells, dimensions=[10, 6], exportBytes=restored_path.stat().st_size)
        result['passed'] += 1
    except Exception as exc:
        first.update(status='FAIL', error=str(exc) or type(exc).__name__, errorType=type(exc).__name__, traceback=traceback.format_exc())
        raise AssertionError(f"T087 snapshot subcase {first['key']}: {exc}") from exc

    second['status'] = 'RUNNING'
    result['executed'] += 1
    try:
        # Simulate a supported older project via a real exported file, not a
        # storage edit. Only the omitted input and synthetic project name change.
        legacy = copy.deepcopy(project_payload)
        legacy_name = 'CI Tilemap ohne Seed'
        legacy['project']['name'] = legacy_name
        del legacy['project']['snapshots'][0]['values']['seed']
        legacy_path = fixtures / 'T087-project-without-seed.json'
        legacy_path.write_text(json.dumps(legacy, ensure_ascii=False), encoding='utf-8')
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-import').set_input_files(str(legacy_path))
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Projekt als Kopie importiert.')")
        assert await page.locator('.workspace-project').count() == 2, 'Importing the older tilemap file must create one separate project copy'
        await open_project(legacy_name)
        foreign_seed = 'ci-seed-must-not-survive-loading'
        assert foreign_seed != default_seed, 'Missing-seed check must start from a nondefault seed'
        await set_fields({'width': '7', 'height': '5', 'seed': foreign_seed})
        await submit(page)
        await page.get_by_role('button', name='Stand laden', exact=True).click()
        await assert_restored({**saved_fields, 'seed': default_seed}, saved_text)
        legacy_export = exports / 'T087-restored-without-seed.json'
        await download(page, page.locator('#download-result'), legacy_export)
        assert legacy_export.read_text(encoding='utf-8') == saved_text, 'Loading an omitted seed must preserve every hand-edited tile in the real download'
        second.update(status='PASS', restoredDefaultSeed=default_seed, exportBytes=legacy_export.stat().st_size)
        result['passed'] += 1
    except Exception as exc:
        second.update(status='FAIL', error=str(exc) or type(exc).__name__, errorType=type(exc).__name__, traceback=traceback.format_exc())
        raise AssertionError(f"T087 snapshot subcase {second['key']}: {exc}") from exc


async def tools_gate(browser, catalog, origin, fixtures, exports, record):
    semaphore = asyncio.Semaphore(3)
    async def one(tool):
        async with semaphore:
            # Independent origin storage per case prevents parallel theme/favorite
            # changes from influencing other tabs, including storage-event sync.
            context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, locale='de-DE', reduced_motion='reduce')
            context.set_default_timeout(15000)
            page = await context.new_page()
            identifier = tool['id']
            detail = {}
            if identifier == 'T009':
                detail['sitemapXml'] = {
                    'expected': len(SITEMAP_XML_CASES), 'executed': 0, 'passed': 0,
                    'cases': [{'key': case['key'], 'name': case['name'], 'status': 'NOT_RUN'} for case in SITEMAP_XML_CASES],
                }
            if identifier == 'T087':
                detail['tilemapSnapshots'] = {
                    'expected': len(TILEMAP_SNAPSHOT_CASES), 'executed': 0, 'passed': 0,
                    'cases': [{'key': key, 'name': name, 'status': 'NOT_RUN'} for key, name in TILEMAP_SNAPSHOT_CASES],
                }
            health = PageHealth(page, origin)
            try:
                response = await page.goto(origin + tool['path'], wait_until='domcontentloaded')
                assert response and response.status == 200
                if identifier in MEDIA:
                    await file_example(page, identifier, fixtures)
                else:
                    await ready(page)
                output = await page.locator('#result-output').input_value()
                assert output.strip(), 'Empty result'
                assert await page.locator('#download-result').is_enabled()
                path = exports / (identifier + '-result.txt')
                filename = await download(page, page.locator('#download-result'), path)
                assert path.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n') == output.replace('\r\n', '\n').replace('\r', '\n'), 'Export differs from visible result'
                detail['filename'] = filename
                if identifier in MEDIA:
                    image = exports / (identifier + '.png')
                    await download(page, page.get_by_role('button', name='Bild herunterladen', exact=True), image)
                    detail['image'] = check_image(identifier, image, json.loads(output))
                if identifier in AUDIO:
                    await page.get_by_role('button', name='Abspielen', exact=True).click()
                    await page.wait_for_function("() => document.querySelector('#tool-preview')?.textContent.includes('Wiedergabe läuft.')")
                    await page.get_by_role('button', name='Stopp', exact=True).click()
                    assert 'Gestoppt.' in await page.locator('#tool-preview').inner_text()
                    detail['audioScope'] = 'Real Web Audio start/stop status; no human hearing judgement'
                if identifier == 'T009':
                    await sitemap_xml_cases(page, detail['sitemapXml'])
                if identifier == 'T087':
                    snapshots = detail['tilemapSnapshots']
                    await tilemap_snapshot_cases(page, origin, tool['path'], fixtures, exports, snapshots)
                    assert snapshots['executed'] == snapshots['passed'] == len(TILEMAP_SNAPSHOT_CASES) and all(case['status'] == 'PASS' for case in snapshots['cases']), 'Both native tilemap snapshot subcases must execute and pass'
                await responsive(page)
                if identifier in MEDIA:
                    await negative_media(page, identifier, fixtures)
                    detail['invalidFilesRejected'] = True
                health.check()
                record(identifier, 'PASS', detail)
            except Exception as exc:
                record(identifier, 'FAIL', {**detail, 'error': str(exc), **health.details()})
            finally:
                await context.close()
    await asyncio.gather(*(one(tool) for tool in catalog['tools']))


async def directory_gate(context, origin, record):
    page = await context.new_page()
    health = PageHealth(page, origin)
    try:
        await page.goto(origin + '/tools/', wait_until='domcontentloaded')
        await page.locator('[data-tool-directory-controls]').wait_for(state='visible')
        assert await page.locator('.tool-card[data-search]:visible').count() == 110
        await page.locator('#tool-search').fill('JSON')
        await page.locator('#cluster-filter').select_option('entwicklung')
        await page.locator('#directory-sort').select_option('az')
        assert await page.locator('.tool-card[data-search]:visible').count() == 5
        before = await page.locator('.tool-card[data-search]:visible h3').all_text_contents()
        assert '#tools?' in page.url
        await page.locator('#directory-share').click()
        await page.wait_for_function("() => Boolean(document.querySelector('#directory-share-status')?.textContent.trim())")
        assert (await page.locator('#directory-share-status').inner_text()).strip()
        await page.reload(wait_until='domcontentloaded')
        await page.locator('[data-tool-directory-controls]').wait_for(state='visible')
        assert await page.locator('.tool-card[data-search]:visible h3').all_text_contents() == before
        await page.locator('#tool-search').fill('zzzz-kein-werkzeug-7777')
        assert await page.locator('.tool-card[data-search]:visible').count() == 0
        assert await page.locator('#directory-empty').is_visible()
        await page.locator('#directory-empty-reset').click()
        assert await page.locator('.tool-card[data-search]:visible').count() == 110
        await page.locator('#tool-search').focus()
        await page.keyboard.press('Tab')
        assert await page.locator('#cluster-filter').evaluate('(el)=>el===document.activeElement')
        await responsive(page)
        health.check()
        record('directory', 'PASS', {'checks': ['search', 'category', 'sort', 'share status', 'reload', 'empty state', 'reset', 'keyboard', 'mobile widths']})
    except Exception as exc:
        record('directory', 'FAIL', {'error': str(exc), **health.details()})
    finally:
        await page.close()


async def workspace_gate(browser, origin, route, fixtures, exports, record):
    """Exercise production UI and real files in an isolated, initially empty origin."""
    context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, locale='de-DE', reduced_motion='reduce')
    context.set_default_timeout(15000)
    page = await context.new_page()
    health = PageHealth(page, origin)
    async def raw_state():
        return await page.evaluate("() => localStorage.getItem('digital-labs.workspace.v1')")
    async def open_preview(path):
        await page.locator('#labs-backup-import').set_input_files(str(path))
        await page.locator('.backup-preview').wait_for(state='visible')
        assert await page.get_by_role('heading', name='Sicherung prüfen', exact=True).is_visible(), 'Backup preview must show its review heading'
    async def apply_selection():
        await page.get_by_role('button', name='Auswahl importieren', exact=True).click()
        await page.locator('.backup-preview').wait_for(state='hidden')
    try:
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-name').wait_for(state='visible')
        for name in ['CI Projekt A', 'CI Projekt B']:
            await page.locator('#labs-project-name').fill(name)
            await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
            await page.wait_for_function("(name) => [...document.querySelectorAll('.workspace-project h3')].some(el=>el.textContent.startsWith(name))", arg=name)
        await page.goto(origin + route, wait_until='domcontentloaded')
        await ready(page)
        await page.get_by_text('Mit Projekt arbeiten', exact=True).click()
        await page.locator('#labs-project-select').select_option(label='CI Projekt A')
        tool_input = '{"notiz":"Sicherung mit Umlauten: Größe und Übersicht","zahl":7}'
        await page.locator('#field-text').fill(tool_input)
        await submit(page)
        await page.get_by_role('button', name='Stand speichern', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent === 'Stand gespeichert.'")
        await page.get_by_role('button', name='☆ Merken', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent === 'In Favoriten gespeichert.'")
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-backup-import').wait_for(state='visible')
        await page.get_by_role('button', name='Farbschema wechseln', exact=True).click()
        await page.wait_for_function("() => document.documentElement.dataset.theme === 'dark'")
        before = await raw_state()
        original = json.loads(before)
        assert len(original['projects']) == 2 and original['theme'] == 'dark', 'Workspace setup must preserve both projects and the chosen dark theme'
        assert original['favorites'] == [route] and original['track'] is False, 'Workspace setup must preserve the favorite without enabling history'
        assert isinstance(original.get('generation'), str) and original['generation'], 'Fresh local workspace must have a lifecycle generation'
        project_a = next(project for project in original['projects'] if project['name'] == 'CI Projekt A')
        assert len(project_a['snapshots']) == 1, 'Saving the form must create exactly one project snapshot'
        assert project_a['snapshots'][0]['tool'] == 'T049' and project_a['snapshots'][0]['values']['text'] == tool_input, 'Saved snapshot must preserve the tool and exact Unicode input'

        backup_path = exports / 'workspace-backup.json'
        await download(page, page.get_by_role('button', name='Alles als Sicherung exportieren', exact=True), backup_path)
        payload = json.loads(backup_path.read_text(encoding='utf-8'))
        assert payload['format'] == 'digital-labs-workspace' and payload['version'] == 1, 'Full backup must use the supported workspace envelope'
        assert 'generation' not in payload['workspace'], 'Full backup must not export the local workspace generation'
        # The local lifecycle marker is intentionally not portable. Every other
        # field, including all nested project/snapshot data, must match exactly.
        portable_original = {key: value for key, value in original.items() if key != 'generation'}
        assert payload['workspace'] == portable_original, 'Full backup must preserve all portable workspace data exactly'
        assert payload.get('exportedAt'), 'Full backup must include an export timestamp'
        await open_preview(backup_path)
        assert await page.locator('.backup-preview fieldset input[type=checkbox]').count() == 2, 'Backup preview must list both exported projects'
        assert not await page.locator('#labs-backup-settings').is_checked(), 'Backup preview must not opt into preference replacement'
        assert await raw_state() == before, 'Preview must not write local data'
        await apply_selection()
        assert await raw_state() == before, 'Identical reimport must not duplicate projects or overwrite preferences'

        incoming = copy.deepcopy(payload)
        selected = copy.deepcopy(project_a)
        selected.update(id='incoming-selected', name='CI Ausgewählte Kopie')
        unselected = copy.deepcopy(project_a)
        unselected.update(id='incoming-unselected', name='CI Nicht ausgewählt')
        incoming['workspace'].update(projects=[copy.deepcopy(project_a), selected, unselected], active='', theme='light', track=True, favorites=[], recent=[route])
        incoming_path = fixtures / 'workspace-selection.json'
        incoming_path.write_text(json.dumps(incoming, ensure_ascii=False), encoding='utf-8')
        await open_preview(incoming_path)
        await page.locator('#labs-backup-project-2').uncheck()
        assert not await page.locator('#labs-backup-settings').is_checked(), 'Selected-copy preview must not opt into preference replacement'
        assert await raw_state() == before, 'Selecting incoming projects must not write before confirmation'
        await apply_selection()
        merged_raw = await raw_state()
        merged = json.loads(merged_raw)
        assert len(merged['projects']) == 3, 'Selected import must add exactly one new project'
        assert merged['projects'][:2] == original['projects'], 'Existing projects must be preserved exactly'
        added = merged['projects'][2]
        assert added['name'] == selected['name'] and added['id'] != selected['id'], 'Imported copy must retain its name and receive a fresh ID'
        assert added['id'] not in {project['id'] for project in original['projects']}, 'Imported copy ID must not collide with existing projects'
        assert added['snapshots'] == selected['snapshots'], 'Imported copy must preserve all snapshot data exactly'
        for key in ['theme', 'track', 'favorites', 'recent', 'active']:
            assert merged[key] == original[key], ('Unexpected preference replacement', key)
        await open_preview(incoming_path)
        await page.locator('#labs-backup-project-2').uncheck()
        await apply_selection()
        assert await raw_state() == merged_raw, 'Repeated selected import must remain idempotent'

        legacy_path = fixtures / 'workspace-legacy.json'
        legacy_path.write_text(json.dumps(original, ensure_ascii=False), encoding='utf-8')
        await open_preview(legacy_path)
        assert 'Bisherige Speicherdatei erkannt' in await page.locator('.backup-preview').inner_text(), 'Raw legacy workspace must be identified in preview'
        await page.get_by_role('button', name='Import abbrechen', exact=True).click()
        await page.locator('.backup-preview').wait_for(state='hidden')
        assert await raw_state() == merged_raw, 'Cancelling a legacy import must preserve the workspace'
        invalid_path = fixtures / 'workspace-invalid.json'
        invalid_path.write_text('{invalid', encoding='utf-8')
        await page.locator('#labs-backup-import').set_input_files(str(invalid_path))
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.includes('kein gültiges JSON')")
        assert await raw_state() == merged_raw, 'Invalid backup input must preserve the workspace'
        assert not await page.locator('.backup-preview').is_visible(), 'Invalid backup input must not leave an actionable preview'
        await responsive(page)

        await page.goto(origin + route, wait_until='domcontentloaded')
        await ready(page)
        await page.get_by_text('Mit Projekt arbeiten', exact=True).click()
        await page.locator('#labs-project-select').select_option('')
        emergency_text = '{"rettung":"Ohne aktives Projekt, noch nicht neu berechnet"}'
        await page.locator('#field-text').fill(emergency_text)
        assert await page.locator('#download-result').is_disabled(), 'Editing the form must disable download of the previous tool result'
        rescue_before = await raw_state()
        rescue_path = exports / 'workspace-direct-project.json'
        await download(page, page.get_by_role('button', name='Stand als Datei sichern', exact=True), rescue_path)
        rescue = json.loads(rescue_path.read_text(encoding='utf-8'))
        assert rescue['format'] == 'digital-labs-project' and rescue['version'] == 1, 'Direct form backup must use the supported project envelope'
        assert len(rescue['project']['snapshots']) == 1, 'Direct form backup must contain exactly one snapshot'
        snapshot = rescue['project']['snapshots'][0]
        assert snapshot['tool'] == 'T049' and snapshot['values']['text'] == emergency_text and snapshot['result'] == '', 'Direct form backup must preserve the unsaved input without a stale result'
        assert await raw_state() == rescue_before, 'Direct form export must not write local storage'
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-import').set_input_files(str(rescue_path))
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Projekt als Kopie importiert.')")
        restored = json.loads(await raw_state())
        assert len(restored['projects']) == 4, 'Reimporting the direct form backup must add one project copy'
        assert restored['projects'][-1]['snapshots'][0]['values']['text'] == emergency_text, 'Reimported direct form backup must preserve the exact unsaved input'
        health.check()
        record('workspace', 'PASS', {'checks':['UI project creation and snapshot', 'real full-backup download', 'preview without writes', 'idempotent reimport', 'selected new copies', 'new IDs', 'preserved original projects and preferences', 'legacy preview/cancel', 'invalid file preservation', 'responsive widths', 'direct unsaved form export', 'real project reimport'], 'exportBytes':backup_path.stat().st_size})
    except Exception as exc:
        record('workspace', 'FAIL', {'error':str(exc) or type(exc).__name__, 'errorType':type(exc).__name__, 'traceback':traceback.format_exc(), **health.details()})
    finally:
        await context.close()


async def workspace_projects_gate(browser, origin, route, record):
    """Rename, copy, find and restore real project data through the production UI."""
    context = await browser.new_context(viewport={'width':1440, 'height':1000}, locale='de-DE', reduced_motion='reduce')
    context.set_default_timeout(15000)
    page = await context.new_page()
    health = PageHealth(page, origin)
    other_health = None
    async def state():
        return await page.evaluate("() => JSON.parse(localStorage.getItem('digital-labs.workspace.v1'))")
    def project_row(identifier):
        return page.locator(f'.workspace-project:has([data-workspace-group="project:{identifier}"])')
    async def confirmed(button):
        dialogs = []
        async def accept(dialog):
            dialogs.append(dialog.type)
            await dialog.accept()
        page.once('dialog', accept)
        await button.click()
        assert dialogs == ['confirm'], 'Destructive action must request confirmation'
    async def undo():
        await page.get_by_role('button', name='Entfernen rückgängig machen', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Entfernung rückgängig gemacht.')")
    try:
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        for name in ['Zeta Projekt', 'Alpha Projekt']:
            await page.locator('#labs-project-name').fill(name)
            await page.get_by_role('button', name='Projekt anlegen', exact=True).click()
            await page.wait_for_function("(name) => [...document.querySelectorAll('.workspace-project h3')].some(el=>el.textContent.startsWith(name))", arg=name)
        initial = await state()
        zeta = next(project for project in initial['projects'] if project['name'] == 'Zeta Projekt')
        alpha = next(project for project in initial['projects'] if project['name'] == 'Alpha Projekt')
        await page.goto(origin + route, wait_until='domcontentloaded')
        await ready(page)
        await page.get_by_text('Mit Projekt arbeiten', exact=True).click()
        await page.locator('#labs-project-select').select_option(zeta['id'])
        await page.locator('#field-text').fill('{"projekt":"Original bleibt erhalten","zahl":10}')
        await submit(page)
        await page.get_by_role('button', name='Stand speichern', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent === 'Stand gespeichert.'")
        await page.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await page.locator('#labs-project-search').wait_for(state='visible')
        original = await state()
        original_zeta = next(project for project in original['projects'] if project['id'] == zeta['id'])

        await project_row(zeta['id']).get_by_role('button', name='Umbenennen', exact=True).click()
        await page.locator('#labs-project-rename').fill('Nicht speichern')
        await page.locator('#labs-project-rename').press('Escape')
        assert not await page.locator('.workspace-editor').is_visible()
        assert await state() == original
        await project_row(zeta['id']).get_by_role('button', name='Umbenennen', exact=True).click()
        await page.locator('#labs-project-rename').fill('Beta Projekt')
        await page.get_by_role('button', name='Namen speichern', exact=True).click()
        await page.locator('.workspace-editor').wait_for(state='hidden')
        renamed = await state()
        beta = next(project for project in renamed['projects'] if project['id'] == zeta['id'])
        assert beta == {**original_zeta, 'name':'Beta Projekt'}

        await page.locator('#labs-project-sort').select_option('name')
        headings = await page.locator('.workspace-project h3').all_text_contents()
        assert [value.removesuffix(' · aktiv') for value in headings] == ['Alpha Projekt', 'Beta Projekt']
        await page.locator('#labs-project-search').fill('beta JSON')
        assert await page.locator('.workspace-project').count() == 1
        assert await page.locator('#labs-project-count').inner_text() == '1 von 2 Projekten'
        await page.locator('#labs-project-search').fill('kein passendes Projekt 777')
        assert await page.locator('.workspace-project').count() == 0
        assert await page.locator('#labs-project-count').inner_text() == '0 von 2 Projekten'
        await page.get_by_role('button', name='Suchauswahl zurücksetzen', exact=True).click()
        assert await page.locator('#labs-project-search').input_value() == ''
        assert await page.locator('#labs-project-sort').input_value() == 'created'
        assert await state() == renamed, 'Search and sorting must not rewrite project data'

        await project_row(zeta['id']).get_by_role('button', name='Duplizieren', exact=True).click()
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Projektkopie')")
        duplicated = await state()
        assert len(duplicated['projects']) == 3
        copied = next(project for project in duplicated['projects'] if project['id'] not in {zeta['id'], alpha['id']})
        assert copied['name'] == 'Beta Projekt · Kopie' and copied['snapshots'] == beta['snapshots']
        assert next(project for project in duplicated['projects'] if project['id'] == zeta['id']) == beta
        await page.locator('#labs-project-sort').select_option('updated')
        headings = await page.locator('.workspace-project h3').all_text_contents()
        assert headings[-1].removesuffix(' · aktiv') == 'Alpha Projekt'
        await page.locator('#labs-project-search').fill('kopie')
        assert await page.locator('.workspace-project').count() == 1

        await confirmed(project_row(copied['id']).get_by_role('button', name='Entfernen', exact=True))
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Projekt entfernt.')")
        assert len((await state())['projects']) == 2
        assert await page.locator('.workspace-undo').is_visible()
        await undo()
        recovered = await state()
        assert next(project for project in recovered['projects'] if project['id'] == copied['id']) == copied
        assert len(recovered['projects']) == 3

        await confirmed(project_row(copied['id']).get_by_role('button', name='Stand löschen', exact=True))
        await page.wait_for_function("() => document.querySelector('.workspace-status')?.textContent.startsWith('Werkzeugstand entfernt.')")
        removed_snapshot = await state()
        assert next(project for project in removed_snapshot['projects'] if project['id'] == copied['id'])['snapshots'] == []
        other = await context.new_page()
        other_health = PageHealth(other, origin)
        await other.goto(origin + '/arbeitsbereich/', wait_until='domcontentloaded')
        await other.locator('#labs-project-name').fill('Zwischenprojekt aus anderem Tab')
        await other.get_by_role('button', name='Projekt anlegen', exact=True).click()
        await other.wait_for_function("() => [...document.querySelectorAll('.workspace-project h3')].some(el=>el.textContent.startsWith('Zwischenprojekt aus anderem Tab'))")
        await page.wait_for_function("() => document.querySelector('#labs-project-count')?.textContent.endsWith('von 4 Projekten')")
        await undo()
        recovered = await state()
        assert len(recovered['projects']) == 4
        assert next(project for project in recovered['projects'] if project['id'] == copied['id']) == copied
        assert next(project for project in recovered['projects'] if project['id'] == zeta['id']) == beta
        assert any(project['name'] == 'Zwischenprojekt aus anderem Tab' for project in recovered['projects'])
        await other.close()
        await page.get_by_role('button', name='Suchauswahl zurücksetzen', exact=True).click()
        await responsive(page)
        await confirmed(project_row(copied['id']).get_by_role('button', name='Entfernen', exact=True))
        await page.locator('.workspace-undo').wait_for(state='visible')
        before_reload = await state()
        await page.reload(wait_until='domcontentloaded')
        await page.locator('#labs-project-search').wait_for(state='visible')
        assert not await page.locator('.workspace-undo').is_visible()
        assert await state() == before_reload, 'Reload must preserve data and discard only the tab-local undo history'
        health.check()
        if other_health is not None:
            other_health.check()
        record('workspace-projects', 'PASS', {'checks':['rename and Escape cancellation', 'unchanged snapshots', 'independent copy ID', 'name/tool search', 'empty state', 'three sort modes', 'project remove/undo', 'snapshot remove/undo', 'preserved changes from a second tab', 'tab-local undo expires on reload', 'responsive fields and actions'], **health.details()})
    except Exception as exc:
        record('workspace-projects', 'FAIL', {'error':str(exc), **health.details(), 'secondTab': other_health.details() if other_health is not None else {}})
    finally:
        await context.close()


def validate_scenario_exports(json_path, csv_path, identifier, expected_version):
    payload = json.loads(json_path.read_text(encoding='utf-8'))
    assert payload['model'] == identifier
    assert payload['version'] == expected_version, 'JSON export carries an old or different release version'
    assert payload['inputs'] and payload['formula'] and payload['limits'] and payload['result']['metrics']
    rows = list(csv.reader(io.StringIO(csv_path.read_text(encoding='utf-8-sig')), delimiter=';'))
    assert rows[0][0] == 'Digital Labs' and rows[0][2] == identifier
    assert rows[0][1] == expected_version, 'CSV export carries an old or different release version'
    assert len(rows) >= len(payload['result']['table']['rows'])


async def learning_gate(context, origin, routes, exports, expected_version, record):
    for identifier, route in routes.items():
        page = await context.new_page()
        health = PageHealth(page, origin)
        try:
            await page.goto(origin + route, wait_until='domcontentloaded')
            widget = page.locator(f'[data-learning-model="{identifier}"]')
            await widget.locator('[data-learning-status][data-kind="success"]').wait_for()
            output = widget.locator('[data-learning-result]')
            initial = await output.inner_text()
            assert await widget.locator('svg[role="img"]').count() == 1
            json_button = widget.locator('[data-learning-export][data-format="json"]')
            csv_button = widget.locator('[data-learning-export][data-format="csv"]')
            assert await json_button.is_enabled() and await csv_button.is_enabled()
            numeric = widget.locator('form input[type="number"]')
            if await numeric.count():
                field = numeric.first
                values = await field.evaluate('(el)=>({value:Number(el.value),min:Number(el.min),max:Number(el.max),step:Number(el.step)||1})')
                value = values['value'] + values['step'] if values['value'] + values['step'] <= values['max'] else values['value'] - values['step']
                await field.fill(str(value))
                assert await json_button.is_disabled() and await csv_button.is_disabled()
                assert await output.get_attribute('data-stale') == 'true'
                await widget.locator('button[type="submit"]').focus()
                await page.keyboard.press('Enter')
                assert await json_button.is_enabled()
                assert await output.get_attribute('data-stale') is None
                await field.fill('')
                await widget.locator('button[type="submit"]').click()
                assert await widget.locator('[data-learning-status]').get_attribute('data-kind') == 'error'
                assert await json_button.is_disabled() and await csv_button.is_disabled()
            await widget.locator('[data-learning-reset]').click()
            assert await output.inner_text() == initial
            json_path, csv_path = exports / (identifier + '.json'), exports / (identifier + '.csv')
            await download(page, json_button, json_path)
            await download(page, csv_button, csv_path)
            validate_scenario_exports(json_path, csv_path, identifier, expected_version)
            await responsive(page)
            health.check()
            record(identifier, 'PASS', {'exports': ['JSON', 'CSV'], 'exportVersion': expected_version, 'widths': list(WIDTHS), 'numericValidation': bool(await numeric.count())})
        except Exception as exc:
            record(identifier, 'FAIL', {'error': str(exc), **health.details()})
        finally:
            await page.close()


async def native_audio_gate(context, origin, route, record):
    page = await context.new_page()
    health = PageHealth(page, origin)
    try:
        await page.goto(origin + route, wait_until='domcontentloaded')
        results = await page.evaluate("""async () => {
          const {audioDuration,scheduleAudio}=await import('/assets/labs/audio.mjs');
          const {tools,execute}=await import('/assets/labs/tools.mjs');
          const cases=[];
          for(const id of ['T095','T096','T097','T099','T100']) {
            const values=Object.fromEntries(Object.entries(tools[id].fields).map(([key,field])=>[key,String(field.value)]));
            cases.push({id,name:id+'-standard',values});
          }
          cases.push(
            {id:'T096',name:'T096-stille',values:{...cases[1].values,pattern:Array(16).fill('-').join(' ')}},
            {id:'T097',name:'T097-stille',values:{...cases[2].values,kick:'0'.repeat(16),hat:'0'.repeat(16),snare:'0'.repeat(16)}}
          );
          for(const wave of ['sine','triangle','square','sawtooth'])
            cases.push({id:'T095',name:'T095-'+wave+'-1200Hz',values:{...cases[0].values,wave,freq:'1200',cutoff:'6000',attack:'.005',release:'.02'}});
          cases.push(
            {id:'T097',name:'T097-alle-spuren',values:{tempo:'200',kick:'1'.repeat(16),hat:'1'.repeat(16),snare:'1'.repeat(16)}},
            {id:'T099',name:'T099-vierklang',values:{root:'B',quality:'Dur7'}},
            {id:'T100',name:'T100-sustain-null',values:{attack:'.005',decay:'.005',sustain:'0',hold:'.05',release:'.02'}}
          );
          const results=[];
          for(const item of cases) {
            try {
              const params=execute(item.id,item.values).visual.params;
              const duration=audioDuration(item.id,params), rate=48000;
              const context=new OfflineAudioContext(1,Math.ceil((duration+.4)*rate),rate);
              let seed=123456;
              const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
              scheduleAudio(context,item.id,params,{startTime:.06,random});
              const buffer=await context.startRendering(), samples=buffer.getChannelData(0);
              let peak=0,sum=0,nonfinite=0,tail=0,head=0,jump=0;
              for(let i=0;i<samples.length;i++) {
                const value=samples[i];if(!Number.isFinite(value))nonfinite++;
                peak=Math.max(peak,Math.abs(value));sum+=value*value;
                if(i<2000)head=Math.max(head,Math.abs(value));
                if(i>samples.length-4800)tail=Math.max(tail,Math.abs(value));
                if(i)jump=Math.max(jump,Math.abs(value-samples[i-1]));
              }
              let frequencyHz=null,frequencyPass=true;
              if(item.id==='T095'&&params.wave==='sine') {
                const begin=Math.floor(.15*rate),end=Math.floor(.40*rate);let crossings=0;
                for(let i=begin+1;i<end;i++)if(samples[i-1]<=0&&samples[i]>0)crossings++;
                frequencyHz=crossings/((end-begin)/rate);
                frequencyPass=Math.abs(frequencyHz-Number(params.freq))<=Math.max(5,Number(params.freq)*.01);
              }
              const silent=item.name.includes('stille');
              const pass=!nonfinite&&peak<.99&&head<1e-7&&tail<1e-6&&(silent?peak===0:peak>.001)&&frequencyPass;
              results.push({name:item.name,tool:item.id,status:pass?'PASS':'FAIL',duration,frames:samples.length,sampleRate:rate,peak,
                rms:Math.sqrt(sum/samples.length),head,tail,maxSampleJump:jump,nonfinite,frequencyHz,frequencyPass,
                method:'Native OfflineAudioContext, production scheduleAudio graph'});
            } catch(error) {results.push({name:item.name,tool:item.id,status:'FAIL',error:error.message});}
          }
          return results;
        }""")
        if len(results) != 14:
            raise AssertionError('Expected fourteen native audio renders')
        health.check()
        for result in results:
            record('audio:' + result['name'], result['status'], result)
    except Exception as exc:
        record('audio:setup', 'FAIL', {'error': str(exc), **health.details()})
    finally:
        await page.close()


def checked_browser_executable(path):
    """Accept an explicitly selected local executable; default CI stays pinned."""
    if path is None:
        return None
    candidate = Path(path).expanduser().resolve(strict=True)
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise ValueError('Browser executable must be an executable regular file')
    return candidate


async def run(root, temporary, record, *, browser_executable=None, browser_name='chromium'):
    if not __debug__:
        raise RuntimeError('Browser gate requires assertions; do not use python -O/-OO or PYTHONOPTIMIZE')
    if browser_name not in BROWSERS:
        raise ValueError('Unsupported browser engine: ' + str(browser_name))
    # Import at runtime so --help and fixture/unit checks need no browser dependency.
    from playwright.async_api import async_playwright
    release = json.loads((root / 'assets/labs/release.json').read_text(encoding='utf-8'))
    expected_version = release['version']
    if not isinstance(expected_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', expected_version):
        raise ValueError('Invalid published release version')
    catalog = json.loads((root / 'assets/labs/tool-catalog.json').read_text(encoding='utf-8'))
    if catalog['version'] != expected_version:
        raise ValueError('Tool catalog and release version differ')
    if catalog['count'] != 110 or len(catalog['tools']) != 110 or {t['id'] for t in catalog['tools']} != {f'T{number:03}' for number in range(1, 111)}:
        raise ValueError('Expected 110 unique tools in this release')
    for tool in catalog['tools']:
        parsed = urlsplit(tool['path'])
        if not tool['path'].startswith('/tools/') or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or '..' in tool['path'].split('/'):
            raise ValueError('Unexpected tool path')
    routes = learning_routes(root)
    if set(routes) != LEARNING:
        raise ValueError('Expected twelve learning models')
    fixtures, exports = temporary / 'fixtures', temporary / 'exports'
    generate(fixtures)
    exports.mkdir()
    with serve(root) as origin:
        async with async_playwright() as runtime:
            options = {'headless': True}
            if browser_executable is not None:
                options['executable_path'] = str(checked_browser_executable(browser_executable))
            browser = await getattr(runtime, browser_name).launch(**options)
            environment = {'browserEngine': browser_name, 'browserVersion': browser.version, 'releaseVersion': expected_version}
            context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, locale='de-DE', reduced_motion='reduce')
            context.set_default_timeout(15000)
            try:
                await tools_gate(browser, catalog, origin, fixtures, exports, record)
                await directory_gate(context, origin, record)
                await workspace_gate(browser, origin, next(tool['path'] for tool in catalog['tools'] if tool['id'] == 'T049'), fixtures, exports, record)
                await workspace_projects_gate(browser, origin, next(tool['path'] for tool in catalog['tools'] if tool['id'] == 'T049'), record)
                await learning_gate(context, origin, routes, exports, expected_version, record)
                await native_audio_gate(context, origin, next(tool['path'] for tool in catalog['tools'] if tool['id'] == 'T095'), record)
            finally:
                await context.close()
                await browser.close()
            return environment


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Already validated public staging directory')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--browser', choices=BROWSERS, default='chromium',
                        help='Native engine; defaults to Chromium for the existing 139-case gate')
    parser.add_argument('--browser-executable', type=Path,
                        help='Optional executable for the selected engine; omitted uses the Playwright-pinned browser')
    args = parser.parse_args(argv)
    results = []
    def record(identifier, status, detail):
        results.append({'id': identifier, 'status': status, **detail})
        print(status + ' ' + identifier + (': ' + detail.get('error', '') if status != 'PASS' else ''), flush=True)
    report_path = None
    try:
        playwright_version = package_version('playwright')
    except PackageNotFoundError:
        playwright_version = None
    environment = {'playwrightVersion': playwright_version, 'browserEngine': args.browser, 'browserVersion': None,
                   'browserExecutable': None, 'browserLauncher': 'playwright-default', 'releaseVersion': None}
    if args.browser_executable is not None:
        environment.update(browserExecutable=str(args.browser_executable.expanduser().absolute()),
                           browserLauncher='explicit-local-executable')
    try:
        report_path = checked_report_path(args.report, roots=(args.root,))
        if not __debug__:
            raise RuntimeError('Browser gate requires assertions; do not use python -O/-OO or PYTHONOPTIMIZE')
        root = args.root.resolve(strict=True)
        executable = checked_browser_executable(args.browser_executable)
        if executable is not None:
            environment.update(browserExecutable=str(executable), browserLauncher='explicit-local-executable')
        release_path = root / 'assets/labs/release.json'
        if release_path.is_file():
            environment['releaseVersion'] = json.loads(release_path.read_text(encoding='utf-8')).get('version')
        with tempfile.TemporaryDirectory(prefix='digital-labs-browser-') as temporary:
            options = {'browser_executable': executable} if executable is not None else {}
            if args.browser != 'chromium':
                options['browser_name'] = args.browser
            observed = asyncio.run(run(root, Path(temporary), record, **options))
            if isinstance(observed, dict):
                environment.update(observed)
    except Exception as exc:
        record('setup-or-runtime', 'FAIL', {'error': str(exc) or type(exc).__name__,
                                          'errorType': type(exc).__name__, 'traceback': traceback.format_exc()})
    counts = Counter(row['id'] for row in results)
    coverage = {'missing': sorted(EXPECTED_CASES - set(counts)),
                'unexpected': sorted(set(counts) - EXPECTED_CASES),
                'duplicates': sorted(identifier for identifier, count in counts.items() if count > 1)}
    coverage_ok = not any(coverage.values())
    passed = sum(row['status'] == 'PASS' for row in results)
    report = {
        'schemaVersion': 1, 'status': 'PASS' if coverage_ok and len(results) == len(EXPECTED_CASES) and passed == len(EXPECTED_CASES) else 'FAIL',
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'expectedCases': len(EXPECTED_CASES), 'cases': len(results), 'passed': passed,
        'browser': 'Playwright ' + BROWSERS[args.browser], 'widths': list(WIDTHS), 'themes': ['light', 'dark'],
        'environment': environment,
        'expectedSubcases': {'T009': len(SITEMAP_XML_CASES), 'T087': len(TILEMAP_SNAPSHOT_CASES)},
        'scope': '110 real tool examples/exports including 16 named native DOMParser XML subcases within T009 and two native saved-tilemap restore/default-field/export subcases within T087, nine file/media tools, invalid media, 12 learning models with CSV/JSON exports, directory, workspace backup/download/selected merge/restore, project rename/copy/search/remove/undo across tabs and responsive widths in light/dark; fourteen native OfflineAudioContext renders using the production graph (signal, silence, peak, tail and a sine-frequency check). No human hearing, physical-device or search-indexing certification.',
        'results': results,
        'coverage': coverage,
    }
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
