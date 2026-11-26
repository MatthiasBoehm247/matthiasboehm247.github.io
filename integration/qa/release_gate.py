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
            reports[name] = {'sha256': digest, 'cases': len(ids)}
            native += len(ids)
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
