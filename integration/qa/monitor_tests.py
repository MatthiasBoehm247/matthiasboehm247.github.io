#!/usr/bin/env python3
"""Public synthetic tests of monitoring decisions; these are not live HTTP checks."""
from __future__ import annotations
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'integration'))
import monitor
import live_check
from pages import ValidationError, write_report

SHA = 'a' * 40
OTHER = 'b' * 40

def deployment_api(rows, statuses):
    def get(path):
        if path == '/deployments?environment=github-pages&per_page=30':
            return copy.deepcopy(rows)
        key = int(path.split('/')[2])
        return copy.deepcopy(statuses[key])
    return get

def deployed(number=4, sha=SHA):
    return {'id': number, 'environment': 'github-pages', 'sha': sha}

def success():
    return [{'state': 'success', 'environment_url': monitor.ORIGIN + '/'}]

class MonitorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='labs-monitor-unit-')
        cls.checkout = Path(cls.temporary.name) / 'checkout'
        cls.checkout.mkdir()
        (cls.checkout / 'integration').mkdir()
        (cls.checkout / 'source').mkdir()
        shutil.copy2(ROOT / 'install.py', cls.checkout / 'install.py')
        cls.manifest = json.loads((ROOT / 'integration/deployment.json').read_text())
        (cls.checkout / 'integration/deployment.json').write_text(json.dumps(cls.manifest))
        (cls.checkout / 'source/release-config.json').write_text(json.dumps({'version': cls.manifest['version']}))
        for name in cls.manifest['portfolioFiles']:
            path = cls.checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('<!doctype html><html lang="de"><header><nav class="main-nav"></nav></header><main><section class="hero">Synthetisches Portfolio</section></main></html>' if name == 'index.html' else 'synthetic-verification-fixture')
        def git(*args):
            return subprocess.check_output(['git', '-C', str(cls.checkout), *args], text=True, stderr=subprocess.DEVNULL).strip()
        git('init')
        git('add', '.')
        git('-c', 'user.name=Digital Labs synthetic QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Synthetic monitor test')
        cls.git_sha = git('rev-parse', 'HEAD')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def fake_fetch(self, name, digest, timeout):
        self.assertIsInstance(digest, str)
        self.assertRegex(digest, r'^[a-f0-9]{64}$')
        return {'file': name, 'status': 'PASS', 'http': 200, 'bytes': 1, 'release_hash_checked': True}

    def test_latest_success_ignores_newer_failure_and_unpublished_head(self):
        get = deployment_api([deployed(4), deployed(5, OTHER)], {5: [{'state': 'failure'}], 4: success()})
        self.assertEqual(monitor.successful_deployment(get)['sha'], SHA)

    def test_status_url_from_payload_is_never_followed(self):
        row = {**deployed(), 'statuses_url': 'https://example.invalid/untrusted'}
        self.assertEqual(monitor.successful_deployment(deployment_api([row], {4: success()}))['id'], 4)

    def test_no_success_fails_closed(self):
        for states in ([], [{'state': 'inactive'}], [{'state': 'pending'}]):
            with self.subTest(states=states), self.assertRaises(ValidationError):
                monitor.successful_deployment(deployment_api([deployed()], {4: states}))

    def test_wrong_environment_commit_id_or_state_rejected(self):
        rows = [{**deployed(), 'sha': '../main'}, {**deployed(), 'environment': 'production'},
                {**deployed(), 'id': True}, {**deployed(), 'id': 0}]
        for row in rows:
            with self.subTest(row=row), self.assertRaises(ValidationError):
                monitor.successful_deployment(deployment_api([row], {4: success()}))
        with self.assertRaises(ValidationError):
            monitor.successful_deployment(deployment_api([deployed()], {4: [{'state': 'maybe'}]}))

    def test_other_site_or_oversized_response_rejected(self):
        for statuses in ([{'state': 'success', 'environment_url': 'https://example.invalid/'}], success() * 2):
            with self.subTest(statuses=statuses), self.assertRaises(ValidationError):
                monitor.successful_deployment(deployment_api([deployed()], {4: statuses}))
        with self.assertRaises(ValidationError):
            monitor.successful_deployment(lambda _: [deployed()] * 31)

    def test_api_uses_readonly_exact_origin_and_bounded_response(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.get_method(), 'GET')
                self.assertEqual(request.full_url, monitor.API + '/deployments?environment=github-pages&per_page=30')
                self.assertEqual(timeout, 20)
                return Response(b'[]')
        self.assertEqual(monitor.api_get('/deployments?environment=github-pages&per_page=30', token='', opener=Opener()), [])
        class Large:
            def open(inner, request, timeout):
                return Response(b' ' * (monitor.LIMIT + 1))
        with self.assertRaises(ValidationError):
            monitor.api_get('/deployments?environment=github-pages&per_page=30', token='', opener=Large())
        for path in ('/issues', '/deployments/../statuses?per_page=1', 'https://example.invalid/'):
            with self.subTest(path=path), self.assertRaises(ValidationError):
                monitor.api_get(path, token='', opener=Opener())

    def test_portfolio_hashes_use_transformed_checkout_not_live_bytes(self):
        hashes = monitor.portfolio_hashes(self.checkout, self.manifest)
        self.assertEqual(set(hashes), set(self.manifest['portfolioFiles']))
        original = (self.checkout / 'index.html').read_bytes()
        self.assertNotEqual(hashes['index.html'], hashlib.sha256(original).hexdigest())
        self.assertEqual((self.checkout / 'index.html').read_bytes(), original)

    def test_exact_portfolio_digest_coverage_required(self):
        valid = monitor.portfolio_hashes(self.checkout, self.manifest)
        self.assertEqual(set(live_check.expected_digests(self.manifest, portfolio_hashes=valid)), set(self.manifest['files']) | set(valid))
        invalid = [{}, {**valid, 'private.json': 'a' * 64}, {**valid, 'index.html': 'broken'}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                live_check.expected_digests(self.manifest, portfolio_hashes=value)
        with self.assertRaises(ValidationError):
            live_check.expected_digests(self.manifest, root=self.checkout, portfolio_hashes=valid)

    def test_all_public_endpoints_pinned_to_verified_git_checkout(self):
        report = monitor.check_published(self.checkout, self.git_sha, fetcher=self.fake_fetch, retry_delay=0)
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual(report['files'], len(self.manifest['files']) + len(self.manifest['portfolioFiles']) - 1)
        self.assertEqual(report['passed'], report['hash_checked'])
        self.assertTrue(report['portfolio_hash_checked'])
        self.assertEqual(report['expectedCommit'], self.git_sha)

    def test_mismatching_git_checkout_fails_before_http(self):
        with self.assertRaises(ValidationError):
            monitor.check_published(self.checkout, OTHER, fetcher=lambda *a: self.fail('No HTTP allowed'))

    def test_corrupt_live_file_cannot_pass_and_only_failure_retried(self):
        names = []
        def fetch(name, digest, timeout):
            names.append(name)
            if name == 'index.html':
                return {'file': name, 'status': 'FAIL', 'error': 'Synthetic byte mismatch'}
            return self.fake_fetch(name, digest, timeout)
        report = monitor.check_published(self.checkout, self.git_sha, fetcher=fetch, retry_delay=0)
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual(report['passed'], report['files'] - 1)
        self.assertEqual(names.count('index.html'), 2)
        self.assertEqual(report['requests'], report['files'] + 1)

    def test_superseded_before_check_makes_no_requests_or_pass_claim(self):
        get = deployment_api([deployed(5, OTHER)], {5: success()})
        report = monitor.check_published(self.checkout, self.git_sha, 4, get=get,
                                         fetcher=lambda *a: self.fail('No HTTP allowed'))
        self.assertEqual(report['status'], 'SUPERSEDED')
        self.assertEqual(report['requests'], 0)

    def test_superseded_during_check_preserves_observed_result_without_current_pass(self):
        call = 0
        def get(path):
            nonlocal call
            if path.startswith('/deployments?'):
                call += 1
                return [deployed(4, self.git_sha)] if call == 1 else [deployed(5, OTHER)]
            return success()
        report = monitor.check_published(self.checkout, self.git_sha, 4, get=get, fetcher=self.fake_fetch)
        self.assertEqual(report['status'], 'SUPERSEDED')
        self.assertEqual(report['observedStatus'], 'PASS')

    def test_source_allowlist_and_symlinks_rejected(self):
        with self.assertRaises(ValidationError):
            monitor.source_file(self.checkout, '../install.py')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'install.py').symlink_to(self.checkout / 'install.py')
            with self.assertRaises(ValidationError):
                monitor.source_file(root, 'install.py')

    def test_release_version_mismatch_prevents_http(self):
        original = (self.checkout / 'source/release-config.json').read_bytes()
        try:
            (self.checkout / 'source/release-config.json').write_text('{"version":"0.0.0"}')
            with self.assertRaises(ValidationError):
                monitor.check_published(self.checkout, self.git_sha, fetcher=lambda *a: self.fail('No HTTP allowed'))
        finally:
            (self.checkout / 'source/release-config.json').write_bytes(original)

    def test_report_cannot_overwrite_source(self):
        with self.assertRaises(ValidationError):
            write_report(self.checkout / 'source/release-config.json', {'status': 'PASS'}, roots=(self.checkout,))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(MonitorTests)
    ids = sorted(test.id().rsplit('.', 1)[-1] for test in suite)
    run = unittest.TextTestRunner(verbosity=2).run(suite)
    errors = {test.id().rsplit('.', 1)[-1]: detail for test, detail in run.failures + run.errors}
    report = {'status': 'PASS' if run.wasSuccessful() and run.testsRun == len(ids) else 'FAIL',
              'expectedCases': len(ids), 'cases': run.testsRun, 'passed': run.testsRun - len(errors),
              'checkedAt': datetime.now(timezone.utc).isoformat(),
              'scope': 'Synthetic unit tests of monitoring, hash coverage, real local Git checkout identity and failure handling. No real GitHub API or public HTTP execution claimed.',
              'results': [{'id': key, 'status': 'FAIL' if key in errors else 'PASS', **({'error': errors[key]} if key in errors else {})} for key in ids]}
    write_report(args.report, report, roots=(ROOT,))
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}))
    return 0 if report['status'] == 'PASS' else 1

if __name__ == '__main__':
    raise SystemExit(main())
