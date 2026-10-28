"""Cloud WebKit safety contracts. No cloud account or browser is used here."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, MagicMock

ROOT=Path(__file__).resolve().parents[2]

class MacWebKitContracts(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('webkit_macos',ROOT/'scripts/ci/webkit_macos.py')
        self.module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_non_mac_is_rejected_instead_of_trusting_a_safari_ua(self):
        self.module.require_macos('Darwin')
        for host in ['Windows','Linux','']:
            with self.subTest(host=host),self.assertRaisesRegex(RuntimeError,'macOS'):
                self.module.require_macos(host)

    def test_child_proxy_bypass_preserves_parent_and_other_proxy_settings(self):
        original={'HTTP_PROXY':'http://example.invalid:9999','NO_PROXY':'internal.example','JLB_E2E_RUN_DIR':'foreign'}
        env=self.module.child_environment(original,ROOT)
        self.assertEqual(original,{'HTTP_PROXY':'http://example.invalid:9999','NO_PROXY':'internal.example','JLB_E2E_RUN_DIR':'foreign'})
        self.assertEqual(env['HTTP_PROXY'],original['HTTP_PROXY'])
        self.assertEqual(env['NO_PROXY'].split(','),['internal.example','127.0.0.1','localhost'])
        self.assertIn('127.0.0.1',env['no_proxy'])
        self.assertNotIn('JLB_E2E_RUN_DIR',env)
        self.assertTrue(env['JLB_QA_PYTHON'].endswith('python'))

    def test_report_requires_all_220_with_no_skips_flaky_or_top_errors(self):
        report={'stats':{'expected':220,'unexpected':0,'skipped':0,'flaky':0},'errors':[],'suites':[{'specs':[{'tests':[{'status':'expected'}]} for _ in range(220)]}]}
        self.assertTrue(self.module.report_status(report)['passed'])
        for field in ['unexpected','skipped','flaky']:
            changed={'stats':{**report['stats'],'expected':219,field:1},'errors':[],'suites':[{'specs':[{'tests':[{'status':'expected'}]} for _ in range(219)]+[{'tests':[{'status':field}]}]}]}
            with self.subTest(field=field):self.assertFalse(self.module.report_status(changed)['passed'])
        self.assertFalse(self.module.report_status({**report,'errors':[{'message':'crash'}]})['passed'])
        with self.assertRaisesRegex(ValueError,'220'):
            self.module.report_status({'stats':{**report['stats'],'expected':219},'errors':[]})

    def test_green_statistics_with_an_incomplete_case_list_are_rejected(self):
        report={'stats':{'expected':220,'unexpected':0,'skipped':0,'flaky':0},'errors':[],'suites':[{'specs':[{'tests':[{'status':'expected'}]} for _ in range(219)]}]}
        with self.assertRaisesRegex(ValueError,'220'):self.module.report_status(report)

    def test_case_failures_cannot_be_hidden_by_green_statistics(self):
        report={'stats':{'expected':220,'unexpected':0,'skipped':0,'flaky':0},'errors':[],'suites':[{'specs':[{'tests':[{'status':'expected'}]} for _ in range(219)]+[{'tests':[{'status':'unexpected'}]}]}]}
        with self.assertRaisesRegex(ValueError,'stats'):self.module.report_status(report)

    def test_nonzero_exit_cannot_be_hidden_by_a_green_json_report(self):
        report={'expected':220,'unexpected':0,'skipped':0,'flaky':0,'passed':True}
        self.assertFalse(self.module.acceptance(1,report,True))
        self.assertFalse(self.module.acceptance(0,report,False))
        self.assertTrue(self.module.acceptance(0,report,True))

    def test_timed_out_command_keeps_partial_output_and_kills_only_its_process_group(self):
        with tempfile.TemporaryDirectory() as directory:
            log=Path(directory)/'timeout.log'
            process=MagicMock(pid=87654)
            process.communicate.side_effect=[subprocess.TimeoutExpired(['node'],1,output=b'partial stdout',stderr=b'partial diagnostic'),(b'partial stdout',b'partial diagnostic'),(b'partial stdout',b'partial diagnostic')]
            table={87654:(1,'S','owned start'),87655:(87654,'S','detached start'),99999:(1,'S','foreign')}
            with patch.object(self.module.subprocess,'Popen',return_value=process) as start, patch.object(self.module.os,'killpg',create=True) as kill, patch.object(self.module.signal,'SIGKILL',9,create=True), patch.object(self.module,'process_table',side_effect=[table,{99999:table[99999]},{99999:table[99999]}]), patch.object(self.module.os,'kill') as kill_pid:
                code=self.module.run_logged(['node'],ROOT,{},log,1)
            self.assertEqual(code,124)
            self.assertTrue(start.call_args.kwargs['start_new_session'])
            kill.assert_called_once_with(87654,self.module.signal.SIGINT)
            kill_pid.assert_not_called()
            self.assertEqual(process.communicate.call_count,3)
            self.assertIn('partial stdout',log.read_text(encoding='utf-8'))
            self.assertIn('partial diagnostic',log.read_text(encoding='utf-8'))

    def test_detached_descendants_are_tracked_but_foreign_and_reused_pids_are_not_killed(self):
        table={100:(1,'S','root'),101:(100,'S','detached'),102:(101,'S','child'),900:(1,'S','foreign')}
        self.assertEqual(set(self.module.owned_family(table,100)),{100,101,102})
        owned=self.module.owned_family(table,100)
        current={101:(1,'S','detached'),102:(1,'S','reused new process'),900:table[900]}
        self.assertEqual(self.module.live_owned(owned,current),[101])

    def test_real_mac_timeout_stops_a_detached_descendant(self):
        import os, sys, time
        if os.name != 'posix':
            # The ownership algorithm is checked above on Windows. The cloud runs
            # this actual detached-process regression on Darwin before the suite.
            self.assertEqual(self.module.owned_family({1:(0,'S','a'),2:(1,'S','b')},1),{1:'a',2:'b'})
            return
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();pidfile=root/'detached.pid'
            child="import time; time.sleep(60)"
            parent="import subprocess,sys,time,pathlib; p=subprocess.Popen([sys.executable,'-c',"+repr(child)+"],start_new_session=True); pathlib.Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(60)"
            code=self.module.run_logged([sys.executable,'-c',parent,str(pidfile)],root,os.environ.copy(),root/'run.log',2)
            self.assertEqual(code,124)
            child_pid=int(pidfile.read_text())
            table=self.module.process_table()
            self.assertTrue(child_pid not in table or table[child_pid][1].startswith('Z'))

    def test_timeout_without_report_still_archives_the_owned_trace_directory(self):
        import zipfile
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'artifacts/webkit-macos';output.mkdir(parents=True)
            def interrupted(arguments, cwd, env, log, timeout):
                owned=Path(env['JLB_E2E_RUN_DIR'])
                (owned/'test-results').mkdir()
                (owned/'test-results/trace.zip').write_bytes(b'failed run trace')
                log.write_text('timeout')
                return 124
            with patch.object(self.module,'run_logged',side_effect=interrupted):
                code,report,owned=self.module.execute_e2e(root,output,{'JLB_E2E_RUN_DIR':'foreign'})
            self.assertEqual(code,124)
            self.assertFalse(report['passed'])
            self.assertIn('validationError',report)
            self.assertFalse((owned/'report.json').exists())
            target=output/'evidence.zip'
            self.module.archive_files(root,list(owned.rglob('*')),target)
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.read((owned/'test-results/trace.zip').relative_to(root).as_posix()),b'failed run trace')

    def test_pnpm_isolated_dependency_chain_resolves_without_root_playwright_core(self):
        command="import { playwrightMetadata } from './scripts/ci/webkit_environment.mjs'; console.log(JSON.stringify(await playwrightMetadata()));"
        reply=subprocess.run(['node','--input-type=module','-e',command],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(reply.returncode,0,reply.stderr)
        metadata=json.loads(reply.stdout)
        self.assertEqual(metadata['playwright'],'1.64.0')
        self.assertEqual(metadata['webkitRevision'],'2370')

    def test_archive_preserves_reports_and_rejects_external_paths(self):
        import zipfile
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();inside=root/'artifacts/report.json';inside.parent.mkdir();inside.write_text('{"failed":1}')
            target=root/'result.zip';self.module.archive_files(root,[inside],target)
            with zipfile.ZipFile(target) as archive:self.assertEqual(archive.read('artifacts/report.json'),b'{"failed":1}')
            with self.assertRaisesRegex(ValueError,'outside'):
                self.module.archive_files(root,[Path(directory).parent/'foreign-secret.txt'],target)

    def capture_fixture(self):
        states=['settings','body-editor','today','plans','exercises','workout','history','statistics','guide-brief','guide-detailed']
        return {'screenshots':80,'pageErrors':[],'checks':[{'state':state,'width':width,'theme':theme,'audit':{'smallTargets':[],'horizontalOverflow':{'present':False}}} for state in states for width in [320,390,768,1440] for theme in ['dark','light']]}

    def test_capture_rejects_small_targets_overflow_errors_and_missing_images(self):
        import copy
        self.assertTrue(callable(getattr(self.module,'capture_valid',None)))
        capture=self.capture_fixture();self.assertTrue(self.module.capture_valid(capture,80))
        self.assertFalse(self.module.capture_valid(None,80))
        self.assertFalse(self.module.capture_valid({**capture,'checks':[None]*80},80))
        self.assertFalse(self.module.capture_valid({**capture,'checks':None},80))
        for kind in ['small','overflow','pageerror','count']:
            changed=copy.deepcopy(capture)
            if kind=='small':changed['checks'][0]['audit']['smallTargets']=[{'selector':'select','height':27}]
            if kind=='overflow':changed['checks'][0]['audit']['horizontalOverflow']['present']=True
            if kind=='pageerror':changed['pageErrors']=['runtime failure']
            if kind=='count':changed['screenshots']=79
            with self.subTest(kind=kind):self.assertFalse(self.module.capture_valid(changed,80))
        self.assertFalse(self.module.capture_valid(capture,79))
        self.assertFalse(self.module.capture_valid({},80))

    def test_capture_requires_every_unique_state_width_and_theme(self):
        import copy
        self.assertTrue(callable(getattr(self.module,'capture_valid',None)))
        capture=self.capture_fixture()
        for kind in ['duplicate','missing','wrong-width','missing-audit']:
            changed=copy.deepcopy(capture)
            if kind=='duplicate':changed['checks'][-1]=copy.deepcopy(changed['checks'][0])
            if kind=='missing':changed['checks'].pop()
            if kind=='wrong-width':changed['checks'][0]['width']=375
            if kind=='missing-audit':changed['checks'][0].pop('audit')
            with self.subTest(kind=kind):self.assertFalse(self.module.capture_valid(changed,80))

class MacWorkflowSafety(unittest.TestCase):
    def test_new_workflow_is_manual_free_m2_only_and_does_not_build_ios(self):
        data=json.loads((ROOT/'codemagic.yaml').read_text(encoding='utf-8'))
        workflow=data['workflows']['webkit-macos-free']
        self.assertEqual(workflow['instance_type'],'mac_mini_m2')
        self.assertLessEqual(workflow['max_build_duration'],45)
        self.assertEqual(workflow['environment'],{'xcode':'26.0','node':'24.19.0'})
        for field in ['triggering','publishing','integrations','environment_groups']:
            self.assertNotIn(field,workflow)
        scripts='\n'.join(step['script'] for step in workflow['scripts'])
        for value in ['ios:sync','ios_simulator.py run','cap sync','fastlane','app_store_connect','xcodebuild build','simctl']:
            self.assertNotIn(value,scripts.lower())
        self.assertIn('--frozen-lockfile',scripts)
        self.assertIn('webkit_macos.py run',scripts)
        self.assertIn('Pillow==12.3.0',scripts)
        for step in workflow['scripts']:self.assertTrue(step['script'].startswith('set -euo pipefail\n'))
        self.assertEqual(workflow['artifacts'],['artifacts/webkit-macos/*.json','artifacts/webkit-macos/*.log','artifacts/webkit-macos/*.zip'])

if __name__=='__main__':unittest.main()
