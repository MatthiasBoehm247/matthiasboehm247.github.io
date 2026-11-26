#!/usr/bin/env python3
"""Bind successful native/core reports to one commit and one public artifact."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'integration'))
from pages import ValidationError, load_manifest, write_report

ENGINES = ('chromium', 'firefox', 'webkit')
LEARNING = {'W026', 'W028', 'W029', 'W041', 'W044', 'W051', 'W056', 'W060', 'W062', 'W066', 'W070', 'W076'}
AUDIO = {name + '-standard' for name in ('T095', 'T096', 'T097', 'T099', 'T100')} | {
    'T096-stille', 'T097-stille', 'T095-sine-1200Hz', 'T095-triangle-1200Hz',
    'T095-square-1200Hz', 'T095-sawtooth-1200Hz', 'T097-alle-spuren', 'T099-vierklang', 'T100-sustain-null'}
BROWSER = {f'T{i:03}' for i in range(1,111)} | LEARNING | {'directory', 'workspace', 'workspace-projects'} | {'audio:' + key for key in AUDIO}
LIFECYCLE = {'navigation-completed-result', 'navigation-pending-worker', 'navigation-pending-image', 'navigation-qr-export',
             'storage-near-limit', 'storage-native-quota', 'storage-denied-export'}
CORE = {f'{group}-{number:02}' for group,count in {'CSV':2,'GSC':8,'SITEMAP':5,'PRIORITY':3,'CONTRAST':4,'YAML':6,'NUMBER':4,'ENCODING':2,'SEED':5,'RATIO':1,'BUDGET':3}.items() for number in range(1,count+1)}
# Kept independently from report data; update only with a reviewed gate change.
USABILITY = {f'{name}-{viewport}' for name in ('directory-keyboard', 'worker-keyboard', 'gsc-10000', 'sitemap-10000', 'priority-10000') for viewport in ('desktop','narrow')}
IMAGE_VARIANTS = {
    'APPLICATION_PAGEHIDE': ('nativeImageCancelledAtPagehide', 'OBSERVED_AT_PAGEHIDE'),
    'NATIVE_ABORT_BEFORE_PAGEHIDE': ('nativeImageAbortedBeforePagehide', 'OBSERVED_NATIVE_BEFORE_PAGEHIDE'),
    'COMPLETED_BEFORE_PAGEHIDE': ('nativeImageCompletedBeforePagehide', 'NOT_OBSERVED_COMPLETED_BEFORE_PAGEHIDE'),
}
IMAGE_ERROR = 'Die Bilddatei kann nicht gelesen werden. Bitte eine intakte PNG-, JPEG- oder WebP-Datei wählen.'
IMAGE_PREVIEW = {'width': 4096, 'height': 4800, 'pixel': [40, 120, 210, 255]}


def image_navigation(row, environment, label):
    """Require original navigation evidence; completion never counts as an abort."""
    def require(condition, message):
        if not condition:
            raise ValidationError('Invalid image navigation evidence (' + label + '): ' + message)

    variant = row.get('cancellationVariant')
    require(isinstance(variant, str) and variant in IMAGE_VARIANTS, 'unknown or missing variant')
    active_flag, coverage = IMAGE_VARIANTS[variant]
    for flag, _ in IMAGE_VARIANTS.values():
        require(type(row.get(flag)) is bool and row[flag] is (flag == active_flag), 'contradictory variant flags')
    require(row.get('imageAbortCoverage') == coverage, 'contradictory abort coverage')
    require(row.get('nativePagehide') is True and row.get('nativePageshow') is True, 'native navigation missing')
    require(type(row.get('lateDownloads')) is int and row['lateDownloads'] == 0, 'late or unobserved downloads')
    require(type(row.get('lateResults')) is int and row['lateResults'] == 0, 'late or unobserved image results')
    require(row.get('newImageAndDownloadAfterReturn') == 'PASS', 'new image/export after return missing')

    input_hash = row.get('imageInputSHA256')
    require(isinstance(input_hash, str) and re.fullmatch('[a-f0-9]{64}', input_hash), 'input fingerprint missing')
    fixture = environment.get('largeImageFixture')
    require(isinstance(fixture, dict) and fixture.get('width') == 4096 and fixture.get('height') == 4800
            and fixture.get('pixels') == 19660800 and type(fixture.get('bytes')) is int and fixture['bytes'] > 0,
            'large image fixture dimensions/size missing')
    repeated = row.get('identicalLargeImageAfterReturn')
    require(isinstance(repeated, dict) and repeated.get('status') == 'PASS'
            and repeated.get('fixtureSHA256') == input_hash
            and {key: repeated.get(key) for key in IMAGE_PREVIEW} == IMAGE_PREVIEW
            and type(repeated.get('downloadBytes')) is int and repeated['downloadBytes'] > 0,
            'identical image/pixel/download after return missing')

    requested, events = row.get('pendingImmediatelyBeforeNavigation'), row.get('events')
    require(isinstance(requested, dict) and isinstance(events, list) and events
            and all(isinstance(event, dict) for event in events), 'original navigation events missing')
    document, route = requested.get('document'), requested.get('path')
    require(isinstance(document, str) and document and isinstance(route, str)
            and re.fullmatch('/tools/[a-z0-9-]+/[a-z0-9-]+/', route), 'document/route missing')
    require(requested.get('kind') == 'navigation-requested' and requested.get('case') == row['id'], 'navigation marker missing')

    def pending(event):
        return (event.get('statusKind') == '' and event.get('status') == 'Verarbeitung …'
                and event.get('result') == '' and event.get('downloadDisabled') is True
                and 'imagePreview' in event and event['imagePreview'] is None)

    require(pending(requested), 'image was not pending immediately before navigation')
    original = [event for event in events if event.get('document') == document]
    require(all(event.get('case') == row['id'] and event.get('path') == route
                and type(event.get('sequence')) is int and event['sequence'] > 0 for event in original),
            'invalid original sequence')
    hides = [event for event in original if event.get('kind') == 'pagehide']
    require(len(hides) == 1, 'unique original pagehide missing')
    leaving = hides[0]
    last = leaving['sequence']
    require(last <= 4096 and leaving.get('trusted') is True, 'untrusted or invalid pagehide')
    prefix = {}
    for event in original:
        number = event['sequence']
        if number <= last:
            require(number not in prefix or prefix[number] == event, 'conflicting original sequence')
            prefix[number] = event
    require(set(prefix) == set(range(1, last + 1)), 'incomplete original sequence through pagehide')
    marker = requested.get('sequence')
    require(type(marker) is int and 0 < marker < last and prefix.get(marker) == requested,
            'navigation marker does not match original events')
    require(any(event.get('kind') == 'pageshow' and event.get('trusted') is True
                and event.get('case') == row['id'] and event.get('path') == route
                and isinstance(event.get('document'), str) and event['document']
                and (event['document'] != document or (type(event.get('sequence')) is int and event['sequence'] > last))
                for event in events), 'native return observation missing')
    transitions = [prefix[number] for number in range(marker + 1, last) if prefix[number].get('kind') == 'status-change']

    if variant == 'COMPLETED_BEFORE_PAGEHIDE':
        try:
            metadata = json.loads(leaving.get('result', ''))
        except (ValueError, TypeError):
            metadata = None
        require(isinstance(metadata, dict) and metadata.get('Breite') == 4096 and metadata.get('Höhe') == 4800
                and metadata.get('Format') == 'image/png' and metadata.get('OriginalBytes') == fixture['bytes']
                and type(metadata.get('AusgabeBytes')) is int and metadata['AusgabeBytes'] > 0
                and leaving.get('imagePreview') == IMAGE_PREVIEW, 'completed image metadata/pixels missing')

        def outcome(event):
            return (event.get('statusKind') == 'success' and event.get('status') == 'Ergebnis erstellt.'
                    and event.get('result') == leaving['result'] and event.get('downloadDisabled') is False
                    and event.get('imagePreview') == IMAGE_PREVIEW)
    else:
        def outcome(event):
            status = event.get('status')
            expected_status = (event.get('statusKind') == '' and isinstance(status, str) and 'beim Verlassen' in status) \
                if variant == 'APPLICATION_PAGEHIDE' else (event.get('statusKind') == 'error' and status == IMAGE_ERROR)
            return (expected_status and event.get('result') == '' and event.get('downloadDisabled') is True
                    and 'imagePreview' in event and event['imagePreview'] is None)

    require(outcome(leaving), 'pagehide contradicts the reported variant')
    observed_outcome = False
    for event in transitions:
        if not observed_outcome and pending(event):
            continue
        require(outcome(event), 'unexpected status/result/export transition')
        observed_outcome = True
    require(variant == 'APPLICATION_PAGEHIDE' or observed_outcome, 'original pre-pagehide outcome transition missing')
    return {'variant': variant, 'abortObserved': variant != 'COMPLETED_BEFORE_PAGEHIDE', 'inputSHA256': input_hash}


def read_report(directory, name):
    path = directory / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValidationError('Missing or invalid report: ' + name)
    raw = path.read_bytes()
    report = json.loads(raw)
    if not isinstance(report, dict) or report.get('status') != 'PASS':
        raise ValidationError('No successful report: ' + name)
    return report, hashlib.sha256(raw).hexdigest()


def exact_results(rows, ids, label):
    if not isinstance(rows, list) or len(rows) != len(ids):
        raise ValidationError('Incomplete case register: ' + label)
    if any(not isinstance(row, dict) or row.get('status') != 'PASS' or not isinstance(row.get('id'), str) for row in rows):
        raise ValidationError('Failed or malformed case: ' + label)
    observed = [row['id'] for row in rows]
    if len(set(observed)) != len(observed) or set(observed) != ids:
        raise ValidationError('Missing, duplicate or unexpected case: ' + label)


def validate(directory, manifest_path, commit):
    directory = Path(directory).resolve(strict=True)
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValidationError('Expected commit must be a full Git SHA')
    manifest_path = Path(manifest_path)
    manifest = load_manifest(manifest_path)
    reports = {}
    staging, digest = read_report(directory, 'staging.json')
    if staging.get('version') != manifest['version'] or staging.get('origin') != manifest['origin'] or staging.get('staged') is not True:
        raise ValidationError('Staging does not match release')
    hashes = staging.get('file_sha256')
    if not isinstance(hashes, dict) or set(hashes) != set(manifest['files']) | set(manifest['portfolioFiles']):
        raise ValidationError('Incomplete staging hash inventory')
    if any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value) for value in hashes.values()):
        raise ValidationError('Malformed staging hash')
    if any(hashes[name] != value for name,value in manifest['files'].items()):
        raise ValidationError('Staging bytes are from another release')
    reports['staging.json'] = {'sha256': digest, 'publicFiles': len(hashes)}
    native = 0
    environments = {}
    image_evidence = {}
    for engine in ENGINES:
        for kind, ids in (('browser', BROWSER), ('lifecycle', LIFECYCLE), ('usability', USABILITY)):
            name = 'browser.json' if kind == 'browser' and engine == 'chromium' else f'{kind}-{engine}.json'
            report, digest = read_report(directory, name)
            if any(type(report.get(key)) is not int or report[key] != len(ids) for key in ('expectedCases', 'cases', 'passed')):
                raise ValidationError('Case counts differ: ' + name)
            exact_results(report.get('results'), ids, name)
            env = report.get('environment', {})
            if env.get('releaseVersion') != manifest['version'] or env.get('browserEngine') != engine or not env.get('browserVersion') or not env.get('playwrightVersion'):
                raise ValidationError('Browser environment/release missing or mismatched: ' + name)
            if engine in environments and environments[engine] != {key: env[key] for key in ('browserVersion', 'playwrightVersion')}:
                raise ValidationError('Browser versions differ between gates: ' + name)
            environments[engine] = {key: env[key] for key in ('browserVersion', 'playwrightVersion')}
            if kind == 'browser':
                if report.get('expectedSubcases') != {'T009':16, 'T087':2}:
                    raise ValidationError('Browser subcase contract differs')
                by_id = {row['id']:row for row in report['results']}
                for tool,field,count in (('T009','sitemapXml',16), ('T087','tilemapSnapshots',2)):
                    sub = by_id[tool].get(field, {})
                    if any(sub.get(key) != count for key in ('expected','executed','passed')):
                        raise ValidationError('Incomplete browser subcases: ' + tool)
                    cases = sub.get('cases', [])
                    keys = [row.get('key') for row in cases]
                    if len(cases) != count or len(set(keys)) != count or None in keys or any(row.get('status') != 'PASS' for row in cases):
                        raise ValidationError('Failed/duplicate browser subcase: ' + tool)
            if kind == 'lifecycle':
                image_case = next(row for row in report['results'] if row['id'] == 'navigation-pending-image')
                image_evidence[engine] = image_navigation(image_case, env, name)
            reports[name] = {'sha256': digest, 'cases': len(ids)}
            native += len(ids)
    cancelled_engines = [engine for engine in ENGINES if image_evidence[engine]['abortObserved']]
    if not cancelled_engines:
        raise ValidationError('No actual native image abort observed in any of the three browser engines')
    if len({item['inputSHA256'] for item in image_evidence.values()}) != 1:
        raise ValidationError('Native image navigation used different input bytes between browser engines')
    core, digest = read_report(directory, 'regression-core.json')
    # The independently reviewed register is authoritative; neither a report's
    # claimed count nor its expected_ids array may shrink the published suite.
    ids = CORE
    if len(ids) != 43 or any(core.get(key) != 43 for key in ('expected','executed','passed')) or core.get('failed') != 0:
        raise ValidationError('Incomplete core regression suite')
    exact_results(core.get('cases'), ids, 'regression-core.json')
    if set(core.get('expected_ids', [])) != ids or core.get('module_sha256') != manifest['files']['assets/labs/tools.mjs']:
        raise ValidationError('Core tests do not match approved production module')
    reports['regression-core.json'] = {'sha256': digest, 'cases':43}
    monitor, digest = read_report(directory, 'monitor-tests.json')
    ids = set(re.findall(r'^    def (test_\w+)\(', (ROOT / 'integration/qa/monitor_tests.py').read_text(), re.M))
    if len(ids) != 16 or any(monitor.get(key) != 16 for key in ('expectedCases','cases','passed')):
        raise ValidationError('Incomplete monitoring unit suite')
    exact_results(monitor.get('results'), ids, 'monitor-tests.json')
    reports['monitor-tests.json'] = {'sha256':digest, 'cases':16}
    return {'schemaVersion':1, 'status':'PASS', 'commit':commit, 'release':manifest['version'],
            'manifestSha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            'publicFiles':len(hashes), 'nativeCases':native, 'coreCases':43, 'monitorUnitCases':16,
            'environments':environments, 'reports':reports,
            'imageAbortCoverage': {'requiredActualAborts': 1, 'observedActualAborts': len(cancelled_engines),
                                   'cancelledEngines': cancelled_engines, 'engines': image_evidence},
            'scope':'Three browser engines on the same staged artifact; explicit functional, lifecycle, usability, core and monitor-unit registers. No physical-device, human-hearing, field-performance or search-indexing certification.'}


def verify_saved(directory, manifest_path, commit):
    current = validate(directory, manifest_path, commit)
    saved, _ = read_report(Path(directory), 'release-gate.json')
    saved.pop('checkedAt', None)
    if saved != current:
        raise ValidationError('Saved release evidence does not match these reports, artifact and commit')
    return current


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create','verify'))
    parser.add_argument('--reports', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    try:
        report = validate(args.reports,args.manifest,args.commit) if args.action == 'create' else verify_saved(args.reports,args.manifest,args.commit)
        if args.action == 'create':
            write_report(args.reports / 'release-gate.json', {**report, 'checkedAt':datetime.now(timezone.utc).isoformat()}, roots=(ROOT,))
        print(json.dumps(report,indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'status':'FAIL','error':str(exc)}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
