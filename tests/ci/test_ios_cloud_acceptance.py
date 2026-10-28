from pathlib import Path
from unittest.mock import patch
import importlib.util,json,subprocess,sys,tempfile,unittest

ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class CloudAcceptancePreparation(unittest.TestCase):
    def setUp(self):self.m=load('cloud_acceptance','scripts/ci/ios_cloud_acceptance.py')
    def test_windows_refuses_before_any_apple_command_or_fixture_creation(self):
        with patch.object(self.m.platform,'system',return_value='Windows'),patch.object(self.m.tempfile,'mkdtemp') as create,patch.object(self.m.subprocess,'Popen') as command:
            with self.assertRaisesRegex(RuntimeError,'macOS'):self.m.run()
            create.assert_not_called();command.assert_not_called()
    def test_real_child_output_and_stdin_are_redacted_without_key_arguments(self):
        secret='JLB1-'+'A'*43
        with tempfile.TemporaryDirectory(prefix='jlb-redact-') as directory:
            runner=self.m.Runner(Path(directory),Path(directory));runner.redactions=['other-authentication-token']
            text=runner.command([sys.executable,'-c','import sys; print(sys.stdin.read()); print("other-authentication-token")'],input=secret.encode(),log='output.log')
            saved=(Path(directory)/'output.log').read_text()
            self.assertNotIn(secret,text+saved);self.assertNotIn('other-authentication-token',text+saved)
            self.assertIn('[REDACTED]',saved)
    def test_sync_wait_requires_two_matching_saved_states_and_skips_unready_state(self):
        class Evidence:
            def read_sync_state(self,container,secret):
                if not self.values:raise AssertionError('Unexpected extra read')
                value=self.values.pop(0)
                if isinstance(value,Exception):raise value
                return value
        evidence=Evidence();evidence.values=[ValueError('not synced'),{'payloadSha256':'a','connection':{'slot':'old'}},
            {'payloadSha256':'b','connection':{'slot':'new'}},{'payloadSha256':'b','connection':{'slot':'new'}}]
        with patch.object(self.m.time,'sleep'):result=self.m.stable_sync(evidence,Path('isolated'),'temporary')
        self.assertEqual(result['payloadSha256'],'b');self.assertEqual(evidence.values,[])
    def test_free_gate_requires_full_budget_reserve_and_explicit_spending_flags(self):
        prepare=load('acceptance_prepare','scripts/ci/ios_acceptance_workflow.py')
        gate={'remainingM2Minutes':25.5,'personal':True,'repositoryPrivate':True,'billingEnabled':False,'hasPaymentInfo':False,'customPlan':False}
        self.assertTrue(prepare.eligible(gate))
        for minutes in [2,25.49,None,True,float('nan'),float('inf')]:
            self.assertFalse(prepare.eligible({**gate,'remainingM2Minutes':minutes}))
        for key in gate:
            bad=dict(gate);del bad[key];self.assertFalse(prepare.eligible(bad))
        workflow=next(iter(prepare.workflow()['workflows'].values()))
        self.assertEqual(workflow['max_build_duration'],25)
        for field in ['triggering','publishing','integrations','environment_groups']:self.assertNotIn(field,workflow)
        self.assertFalse(any('tools/' in pattern or 'xcresult' in pattern for pattern in workflow['artifacts']))
    def test_old_success_timestamp_cannot_prove_a_new_sync_after_relaunch(self):
        before='2026-10-27T02:00:00.000Z'
        self.assertFalse(self.m.new_success(before,{'lastSuccess':before}))
        self.assertFalse(self.m.new_success(before,{'lastSuccess':'2026-10-27T01:59:59.000Z'}))
        self.assertTrue(self.m.new_success(before,{'lastSuccess':'2026-10-27T02:00:01.000Z'}))
        for invalid in [None,True,'bad']:
            self.assertFalse(self.m.new_success(before,{'lastSuccess':invalid}))
    def test_blank_capture_never_becomes_accepted_screenshot_evidence(self):
        sim=load('real_png_checker','scripts/ci/ios_simulator.py')
        png=load('png_fixture','tests/ci/test_simulator_frames.py')
        with tempfile.TemporaryDirectory(prefix='jlb-capture-regression-') as directory:
            source,target=Path(directory)/'source.png',Path(directory)/'accepted.png'
            source.write_bytes(png.png())
            with self.assertRaises(ValueError):self.m.copy_capture(sim,source,target)
            self.assertFalse(target.exists())
            source.write_bytes(png.png(home=True));self.m.copy_capture(sim,source,target)
            self.assertEqual(source.read_bytes(),target.read_bytes())
    def test_timeout_still_preserves_redacted_partial_log_when_group_kill_is_denied(self):
        secret='JLB1-'+'A'*43
        class Process:
            pid=12345;returncode=None
            killed=False
            def communicate(self,**kwargs):raise subprocess.TimeoutExpired(['fake-native-tool'],kwargs['timeout'])
            def kill(self):self.killed=True
        process=Process()
        def popen(*args,**kwargs):
            kwargs['stdout'].write(('Partial native progress '+secret).encode());kwargs['stdout'].flush()
            return process
        with tempfile.TemporaryDirectory(prefix='jlb-denied-kill-') as directory:
            runner=self.m.Runner(Path(directory),Path(directory))
            with patch.object(self.m.subprocess,'Popen',side_effect=popen),patch.object(self.m.os,'killpg',create=True,side_effect=PermissionError('denied')),patch.object(self.m.signal,'SIGKILL',9,create=True):
                with self.assertRaises(subprocess.TimeoutExpired):runner.command(['fake-native-tool'],timeout=1,log='timeout.log')
            saved=(Path(directory)/'timeout.log').read_text()
            self.assertIn('Partial native progress',saved);self.assertNotIn(secret,saved)
            self.assertIn('PermissionError',saved);self.assertTrue(process.killed)
    def test_timeout_keeps_logs_when_reaping_does_not_finish(self):
        class Process:
            pid=12345;returncode=None
            def communicate(self,**kwargs):raise subprocess.TimeoutExpired(['fake-native-tool'],kwargs['timeout'])
        def popen(*args,**kwargs):
            kwargs['stderr'].write(b'Partial migration diagnostics');kwargs['stderr'].flush();return Process()
        with tempfile.TemporaryDirectory(prefix='jlb-reap-timeout-') as directory:
            runner=self.m.Runner(Path(directory),Path(directory))
            with patch.object(self.m.subprocess,'Popen',side_effect=popen),patch.object(self.m.os,'killpg',create=True),patch.object(self.m.signal,'SIGKILL',9,create=True):
                with self.assertRaises(subprocess.TimeoutExpired):runner.command(['fake-native-tool'],timeout=1,log='timeout.log')
            self.assertIn('Partial migration diagnostics',(Path(directory)/'timeout.log').read_text())

if __name__=='__main__':unittest.main()
