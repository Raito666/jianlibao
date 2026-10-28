"""Exercise the real CLI boundary; a hung teardown must never be a green run."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / 'artifacts/e2e-runs'


class WebKitCleanup(unittest.TestCase):
    def test_standard_lane_collects_the_windows_resize_media_regressions(self):
        env = dict(os.environ)
        env.pop('JLB_E2E_RUN_DIR', None)
        result = subprocess.run(['node', 'scripts/run-webkit.mjs', '--list', '--reporter=json'],
                                cwd=ROOT, env=env, capture_output=True, text=True,
                                encoding='utf-8', timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        collected = []
        def visit(suite):
            collected.extend(suite.get('specs', []))
            for child in suite.get('suites', []):
                visit(child)
        for suite in report['suites']:
            visit(suite)
        targets = [spec for spec in collected if spec['file'].endswith('webkit-resize-media.spec.ts')]
        self.assertEqual(len(targets), 10 if os.name == 'nt' else 0)
        native = [spec for spec in collected if spec['file'].endswith('webkit-native-transition.spec.ts')]
        self.assertEqual(len(native), 4 if os.name == 'nt' else 0)
        self.assertEqual(len([spec for spec in collected if spec['file'].endswith('cloud-sync.spec.ts') and not spec['file'].endswith('ios-cloud-sync.spec.ts')]), 12)
        self.assertEqual(len([spec for spec in collected if spec['file'].endswith('ios-cloud-sync.spec.ts')]), 14)
        self.assertEqual(len(collected), 292 if os.name == 'nt' else 278)

    def run_case(self, mode, extra=(), additional_env=None):
        RUNS.mkdir(exist_ok=True, parents=True)
        directory = Path(tempfile.mkdtemp(prefix='cleanup-regression-', dir=RUNS))
        env = dict(os.environ, JLB_CLEANUP_FIXTURE=mode,
                   JLB_WEBKIT_CLEANUP_TIMEOUT_MS='700',
                   JLB_E2E_RUN_DIR=str(directory))
        env.update(additional_env or {})
        command = ['node', 'scripts/run-webkit.mjs', '--config',
                   'tests/fixtures/webkit-cleanup/playwright.config.ts', *extra]
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, encoding='utf-8')
        try:
            output, _ = child.communicate(timeout=85 if mode == 'extended-body' else 12)
        except subprocess.TimeoutExpired:
            # A failure in this regression is still bounded, and only stops its
            # own live CLI tree. It must not count as a successful acceptance.
            if os.name == 'nt':
                cleanup_pid = child.pid
                saved = directory / 'webkit-lifecycle.json'
                if child.poll() is not None and saved.exists():
                    cleanup_pid = json.loads(saved.read_text(encoding='utf-8'))['pid']
                pids = [cleanup_pid]
                holder = directory / 'pipe-holder.json'
                if holder.exists():
                    pids.append(json.loads(holder.read_text(encoding='utf-8'))['pid'])
                for pid in pids:
                    subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'],
                                   capture_output=True, timeout=5)
            else:
                child.kill()
            output, _ = child.communicate(timeout=5)
            (directory / 'regression.log').write_text(output, encoding='utf-8')
            self.fail('Runner hung after the fixture assertion; external cleanup was necessary')
        (directory / 'regression.log').write_text(output, encoding='utf-8')
        receipt = json.loads((directory / 'webkit-lifecycle.json').read_text(encoding='utf-8'))
        return child.returncode, receipt, directory, output

    def test_stalled_worker_is_bounded_and_fails_despite_passing_assertion(self):
        code, receipt, directory, output = self.run_case('stalled-worker')
        self.assertEqual(code, 124, output)
        self.assertTrue(receipt['timedOut'])
        self.assertFalse(receipt['cleanupComplete'])
        self.assertEqual(receipt['completedAssertions'], 1)
        self.assertEqual(receipt['passedAssertions'], 1)
        self.assertEqual(receipt['phase'], 'between-tests-or-worker-cleanup')
        self.assertNotIn('1 passed (', output)

    def test_stalled_test_fixture_is_bounded_before_test_end(self):
        code, receipt, directory, output = self.run_case('stalled-test-fixture')
        self.assertEqual(code, 124, output)
        self.assertEqual(receipt['phase'], 'test-fixture-cleanup')
        self.assertTrue(receipt['timedOut'])
        self.assertFalse(receipt['cleanupComplete'])
        self.assertEqual(receipt['completedAssertions'], 0)

    def test_success_waits_for_clean_exit_and_keeps_original_report(self):
        code, receipt, directory, output = self.run_case('success')
        self.assertEqual(code, 0, output)
        self.assertFalse(receipt['timedOut'])
        self.assertTrue(receipt['cleanupComplete'])
        self.assertFalse(receipt['stopRequested'])
        report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['stats']['expected'], 1)
        self.assertEqual(report['stats']['unexpected'], 0)

    def test_assertion_failure_keeps_nonzero_exit_and_failure_artifact(self):
        code, receipt, directory, output = self.run_case('failed-assertion')
        self.assertEqual(code, 1, output)
        self.assertEqual(receipt['exitCode'], 1)
        self.assertFalse(receipt['timedOut'])
        self.assertTrue(receipt['cleanupComplete'])
        report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['stats']['unexpected'], 1)
        self.assertIn('not.toBe', output)

    def test_active_test_is_not_subject_to_the_short_cleanup_deadline(self):
        code, receipt, directory, output = self.run_case('slow-body')
        self.assertEqual(code, 0, output)
        self.assertFalse(receipt['timedOut'])
        self.assertGreater(receipt['elapsedMs'], 1400)

    def test_extended_test_uses_its_live_playwright_timeout(self):
        code, receipt, directory, output = self.run_case('extended-body')
        self.assertEqual(code, 0, output)
        self.assertFalse(receipt['timedOut'])
        self.assertGreater(receipt['elapsedMs'], 64000)

    def test_reporter_override_still_reports_lifecycle_progress(self):
        for arguments in (['--reporter=line'], ['--reporter', 'line']):
            with self.subTest(arguments=arguments):
                code, receipt, directory, output = self.run_case('success', arguments)
                self.assertEqual(code, 0, output)
                self.assertEqual(receipt['completedAssertions'], 1)
                self.assertEqual(receipt['passedAssertions'], 1)

    @unittest.skipUnless(os.name == 'nt', 'Replays Windows taskkill access denied')
    def test_denied_tree_stop_does_not_hold_the_callers_output_pipe(self):
        receipt = None
        try:
            code, receipt, directory, output = self.run_case('stalled-worker', additional_env={
                'JLB_INHERIT_PIPE': '1',
                'NODE_OPTIONS': (os.environ.get('NODE_OPTIONS', '') +
                    ' --import=./tests/fixtures/webkit-cleanup/deny-tree-stop.mjs').strip()})
            self.assertEqual(code, 124, output)
            self.assertEqual(receipt['treeStopExitCode'], 5)
            self.assertFalse(receipt['cleanupComplete'])
            self.assertIn('access denied', receipt['treeStopMessage'])
        finally:
            # The injected failure intentionally prevents the runner from
            # stopping its CLI. The test host alone cleans that owned fixture.
            if receipt is not None:
                subprocess.run(['taskkill', '/PID', str(receipt['pid']), '/T', '/F'],
                               capture_output=True, timeout=5)
                holder = json.loads((directory / 'pipe-holder.json').read_text(encoding='utf-8'))['pid']
                subprocess.run(['taskkill', '/PID', str(holder), '/T', '/F'],
                               capture_output=True, timeout=5)

    def test_timeout_stops_the_owned_descendant_and_records_forced_failure(self):
        code, receipt, directory, output = self.run_case('stalled-worker')
        self.assertEqual(code, 124, output)
        pid = json.loads((directory / 'owned-child.json').read_text(encoding='utf-8'))['pid']
        probe = subprocess.run(['node', '-e',
            'try { process.kill(Number(process.argv[1]), 0); process.exitCode = 1; } '
            'catch (error) { process.exitCode = error.code === "ESRCH" ? 0 : 2; }', str(pid)],
            capture_output=True, timeout=5)
        self.assertEqual(probe.returncode, 0, 'The owned descendant survived timeout cleanup')
        self.assertEqual(receipt.get('treeStopExitCode', 0), 0)
        self.assertFalse(receipt['cleanupComplete'])

    def test_cleanup_does_not_stop_an_unrelated_node_process(self):
        unrelated = subprocess.Popen(['node', '-e', 'setTimeout(() => {}, 20000)'],
                                     cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            code, receipt, directory, output = self.run_case('stalled-worker')
            self.assertEqual(code, 124, output)
            self.assertIsNone(unrelated.poll(), 'An unrelated Node process was stopped')
        finally:
            if unrelated.poll() is None:
                unrelated.terminate()
            unrelated.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
