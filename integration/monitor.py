#!/usr/bin/env python3
"""Read-only monitoring of the last successful github-pages deployment.

Expected hashes come from the checked-out deployed commit, never from the live
server. No build, publication, token logging, redirects, or remote mutation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from http.client import HTTPException
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pages import ORIGIN, REPOSITORY, ValidationError, checked_file, load_manifest, write_report
import live_check

API = 'https://api.github.com/repos/' + REPOSITORY
SHA = re.compile(r'[0-9a-f]{40}\Z')
LIMIT = 1024 * 1024


def source_file(checkout, relative):
    """Only these three trusted Git inputs may bypass the public-file allowlist."""
    if relative not in {'install.py', 'integration/deployment.json', 'source/release-config.json'}:
        raise ValidationError('Nicht freigegebene Quelldatei')
    path = checkout
    for part in relative.split('/'):
        path = path / part
        if path.is_symlink():
            raise ValidationError('Symlink in den veröffentlichten Quellen')
    if not path.is_file() or not path.resolve().is_relative_to(checkout) or path.stat().st_size > 16 * 1024 * 1024:
        raise ValidationError('Erwartete Quelldatei fehlt oder ist ungültig')
    return path


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_get(path, token=None, opener=None):
    if not re.fullmatch(r'/deployments(?:\?environment=github-pages&per_page=30|/[1-9][0-9]*/statuses\?per_page=1)', path):
        raise ValidationError('Nicht freigegebener API-Pfad')
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
               'User-Agent': 'DigitalLabs-ReadOnlyMonitor', 'Cache-Control': 'no-cache'}
    token = os.environ.get('GH_TOKEN', '') if token is None else token
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = Request(API + path, headers=headers, method='GET')
    with (opener or build_opener(NoRedirect())).open(request, timeout=20) as response:
        if response.status != 200:
            raise ValidationError('GitHub-API antwortet nicht mit HTTP 200')
        raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValidationError('GitHub-Antwort überschreitet die Größenbegrenzung')
        return json.loads(raw)


def successful_deployment(get=api_get):
    deployments = get('/deployments?environment=github-pages&per_page=30')
    if not isinstance(deployments, list) or len(deployments) > 30:
        raise ValidationError('Unerwartete Deploymentliste')
    for item in deployments:
        if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] <= 0:
            raise ValidationError('Ungültige Deploymentkennung')
    for item in sorted(deployments, key=lambda row: row['id'], reverse=True):
        if item.get('environment') != 'github-pages':
            raise ValidationError('Deployment gehört nicht zur erwarteten Umgebung')
        sha = item.get('sha')
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValidationError('Ungültiger Deploymentcommit')
        statuses = get('/deployments/' + str(item['id']) + '/statuses?per_page=1')
        if not isinstance(statuses, list) or len(statuses) > 1:
            raise ValidationError('Unerwartete Deploymentstatusliste')
        if not statuses:
            continue
        state = statuses[0]
        if not isinstance(state, dict) or state.get('state') not in {
            'error', 'failure', 'inactive', 'in_progress', 'queued', 'pending', 'success'
        }:
            raise ValidationError('Unbekannter Deploymentstatus')
        if state['state'] != 'success':
            continue
        location = state.get('environment_url')
        if location and (not isinstance(location, str) or location.rstrip('/') != ORIGIN):
            raise ValidationError('Erfolgreiches Deployment verweist auf eine andere Website')
        return {'id': item['id'], 'sha': sha, 'environment': 'github-pages',
                'state': 'success', 'createdAt': item.get('created_at'),
                'statusUpdatedAt': state.get('updated_at')}
    raise ValidationError('Kein aktuelles erfolgreiches Pages-Deployment unter den letzten 30 Einträgen')


def portfolio_hashes(checkout, manifest):
    """Recreate only the deterministic portfolio addition from deployed sources."""
    checkout = Path(checkout).resolve(strict=True)
    installer = source_file(checkout, 'install.py')
    spec = importlib.util.spec_from_file_location('digital_labs_deployed_installer', installer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    hashes = {}
    for name in manifest['portfolioFiles']:
        raw = checked_file(checkout, name).read_bytes()
        if name == 'index.html':
            raw = module.integrate_homepage(raw)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    return hashes


def check_published(checkout, expected_commit, deployment_id=None, *, get=api_get,
                    fetcher=live_check.fetch_file, verify_git=True, retry_delay=15):
    checkout = Path(checkout).resolve(strict=True)
    if not isinstance(expected_commit, str) or not SHA.fullmatch(expected_commit):
        raise ValidationError('Ungültiger erwarteter Commit')
    if deployment_id is not None and (type(deployment_id) is not int or deployment_id <= 0):
        raise ValidationError('Ungültige erwartete Deploymentkennung')
    if verify_git:
        actual = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', '--verify', 'HEAD'],
                                         text=True, timeout=10).strip()
        if actual != expected_commit:
            raise ValidationError('Checkout entspricht nicht dem veröffentlichten Commit')
    if deployment_id is not None:
        current = successful_deployment(get)
        if current['id'] != deployment_id or current['sha'] != expected_commit:
            return {'status': 'SUPERSEDED', 'requests': 0, 'expectedCommit': expected_commit,
                    'scope': 'Das erfolgreiche Deployment hat sich vor der Prüfung geändert. Keine Freigabe behauptet.'}
    manifest = load_manifest(source_file(checkout, 'integration/deployment.json'))
    declared = json.loads(source_file(checkout, 'source/release-config.json').read_text())
    if declared.get('version') != manifest['version']:
        raise ValidationError('Releasekonfiguration und Manifest stimmen nicht überein')
    hashes = portfolio_hashes(checkout, manifest)
    report = live_check.run_checks(manifest, all_files=True, portfolio_hashes=hashes,
                                  attempts=2, retry_delay=retry_delay, budget_seconds=300, fetcher=fetcher)
    report.update({'expectedCommit': expected_commit, 'deploymentId': deployment_id,
                   'checkedAt': datetime.now(timezone.utc).isoformat(),
                   'expectedSource': 'Release manifest and reconstructed portfolio from the deployed Git commit'})
    if deployment_id is not None:
        current = successful_deployment(get)
        if current['id'] != deployment_id or current['sha'] != expected_commit:
            report['observedStatus'] = report['status']
            report['status'] = 'SUPERSEDED'
            report['scope'] = 'Während der Prüfung wurde ein anderer Commit veröffentlicht. Keine Freigabe des neuen Stands behauptet.'
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    resolve = actions.add_parser('resolve', help='Letztes erfolgreiches Pages-Deployment lesend ermitteln')
    resolve.add_argument('--report', type=Path, required=True)
    check = actions.add_parser('check', help='Veröffentlichte Bytes gegen den passenden Checkout prüfen')
    check.add_argument('--checkout', type=Path, required=True)
    check.add_argument('--expected-commit', required=True)
    check.add_argument('--deployment-id', type=int)
    check.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == 'resolve':
            deployment = successful_deployment()
            report = {'status': 'PASS', 'repository': REPOSITORY, 'deployment': deployment,
                      'checkedAt': datetime.now(timezone.utc).isoformat()}
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
                    stream.write('sha=' + deployment['sha'] + '\ndeployment_id=' + str(deployment['id']) + '\n')
        else:
            report = check_published(args.checkout, args.expected_commit, args.deployment_id)
    except (OSError, ValueError, KeyError, TypeError, URLError, HTTPError, HTTPException,
            subprocess.SubprocessError) as error:
        # Do not expose authorization headers, response bodies or signed URLs.
        detail = ('HTTP ' + str(error.code)) if isinstance(error, HTTPError) else type(error).__name__
        report = {'status': 'FAIL', 'error': detail, 'scope': 'Öffentliche Überwachung nicht erfolgreich abgeschlossen.'}
        if isinstance(error, ValidationError):
            report['error'] = str(error)
    try:
        roots = (args.checkout,) if args.action == 'check' else ()
        write_report(args.report, report, roots=roots)
    except (OSError, ValueError) as error:
        print(json.dumps({'status': 'FAIL', 'error': 'Prüfbericht konnte nicht sicher geschrieben werden.'}))
        return 1
    print(json.dumps({key: value for key, value in report.items() if key != 'results'}, ensure_ascii=False, indent=2))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
            stream.write('## Öffentliche Kontrolle: ' + report['status'] + '\n\n')
            stream.write('Repository: `' + REPOSITORY + '`\n\n')
            if report.get('expectedCommit'):
                stream.write('Geprüfter Commit: `' + report['expectedCommit'] + '`\n\n')
            if 'files' in report:
                stream.write('Dateien bestanden: ' + str(report['passed']) + ' / ' + str(report['files']) +
                             '; Hashes: ' + str(report['hash_checked']) + '\n\n')
            stream.write(report.get('scope', report.get('error', 'Deploymentzustand lesend ermittelt.')) + '\n')
    return 0 if report['status'] in {'PASS', 'SUPERSEDED'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
