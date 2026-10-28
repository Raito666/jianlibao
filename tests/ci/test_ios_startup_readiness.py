"""Portable lifecycle regressions; never execute Apple tools or user databases."""
from pathlib import Path
import importlib.util,json,subprocess,tempfile,unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
DEVICE='B7B6A794-EFE6-4D0F-8059-2B8976CF2C19'

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts/ci'/f'{name}.py')
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class ColdBootReadiness(unittest.TestCase):
    def setUp(self):
        self.sim=load('ios_simulator');self.directory=tempfile.TemporaryDirectory(prefix='jlb-boot-test-')
        self.addCleanup(self.directory.cleanup);self.out=Path(self.directory.name)

    def test_system_boot_has_240_seconds_and_positive_bootstatus_before_ready(self):
        inventory={'devices':{'iOS':[{'udid':DEVICE,'state':'Booted'}]}}
        with patch.object(self.sim,'OUTPUT',self.out),patch.object(self.sim,'command',side_effect=['','',json.dumps(inventory)]) as run:
            result=self.sim.wait_boot(DEVICE,phase='cold')
        self.assertTrue(result['systemReady']);self.assertFalse(result['appLaunched'])
        calls=run.call_args_list
        self.assertEqual(calls[1].args[0],['xcrun','simctl','bootstatus',DEVICE,'-b'])
        self.assertEqual(calls[1].kwargs['timeout'],240)
        self.assertEqual(calls[1].kwargs['log'],'cold-bootstatus.log')
        self.assertTrue(json.loads((self.out/'cold-readiness.json').read_text())['systemReady'])

    def test_cold_migration_timeout_is_not_reported_as_application_failure_or_success(self):
        def execute(args,**kwargs):
            if 'bootstatus' in args:
                (self.out/kwargs['log']).write_text('Waiting on Data Migration\nRunning plugin LaunchServicesMigrator')
                raise subprocess.TimeoutExpired(args,240)
            return ''
        with patch.object(self.sim,'OUTPUT',self.out),patch.object(self.sim,'command',side_effect=execute) as run:
            with self.assertRaises(subprocess.TimeoutExpired):self.sim.wait_boot(DEVICE,phase='cold')
        report=json.loads((self.out/'cold-readiness.json').read_text())
        self.assertFalse(report['systemReady']);self.assertFalse(report['appLaunched'])
        self.assertEqual(report['failureStage'],'system-data-migration')
        self.assertEqual(run.call_count,2)

    def test_booted_inventory_without_successful_bootstatus_cannot_pass(self):
        with patch.object(self.sim,'OUTPUT',self.out),patch.object(self.sim,'command',side_effect=['',RuntimeError('bootstatus failed')]):
            with self.assertRaises(RuntimeError):self.sim.wait_boot(DEVICE)
        self.assertFalse(json.loads((self.out/'boot-readiness.json').read_text())['systemReady'])

    def test_success_status_with_missing_or_shutdown_device_is_rejected(self):
        for inventory in [{'devices':{}},{'devices':{'iOS':[{'udid':DEVICE,'state':'Shutdown'}]}}]:
            with patch.object(self.sim,'OUTPUT',self.out),patch.object(self.sim,'command',side_effect=['','',json.dumps(inventory)]):
                with self.assertRaises(ValueError):self.sim.wait_boot(DEVICE)

    def test_malformed_device_and_short_cold_boot_budget_do_not_execute_commands(self):
        for device,timeout in [('other',240),(DEVICE,35)]:
            with patch.object(self.sim,'command') as run:
                with self.assertRaises(ValueError):self.sim.wait_boot(device,timeout=timeout)
                run.assert_not_called()

if __name__=='__main__':unittest.main()
