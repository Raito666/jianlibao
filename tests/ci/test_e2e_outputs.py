"""Output safety checks; no app server, user data or cloud build is started."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
NODE = 'node'


class E2EOutputs(unittest.TestCase):
    def run_node(self, body, directory):
        module = (ROOT/'scripts/e2e-output.mjs').as_uri()
        code = f"import {{ getE2ERunDirectory }} from {json.dumps(module)}; const base={json.dumps(directory)};\n" + body
        return subprocess.run([NODE, '--input-type=module', '-e', code], cwd=ROOT, text=True, capture_output=True, check=True)

    def test_two_runs_are_unique_and_preserve_prior_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            # Node realpathSync returns /private/var on macOS; compare the same
            # canonical base while retaining all uniqueness/preservation assertions.
            folder = str(Path(folder).resolve())
            result = self.run_node("""
                import {writeFileSync,readFileSync} from 'node:fs';
                const first=getE2ERunDirectory({},base);
                writeFileSync(first+'/sentinel.txt','original');
                const second=getE2ERunDirectory({},base);
                console.log(JSON.stringify({first,second,sentinel:readFileSync(first+'/sentinel.txt','utf8')}));
            """, folder)
            data=json.loads(result.stdout)
            self.assertNotEqual(data['first'],data['second'])
            self.assertEqual(data['sentinel'],'original')
            self.assertEqual(Path(data['first']).parent,Path(folder))

    def test_worker_reuses_parent_directory_without_resetting_it(self):
        with tempfile.TemporaryDirectory() as folder:
            data=json.loads(self.run_node("""
                import {writeFileSync,readFileSync} from 'node:fs';
                const env={}; const first=getE2ERunDirectory(env,base);
                writeFileSync(first+'/sentinel.txt','original');
                const second=getE2ERunDirectory(env,base);
                console.log(JSON.stringify({first,second,sentinel:readFileSync(second+'/sentinel.txt','utf8')}));
            """,folder).stdout)
            self.assertEqual(data['first'],data['second'])
            self.assertEqual(data['sentinel'],'original')

    def test_inherited_directory_outside_run_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            data=json.loads(self.run_node("""
                import {mkdirSync} from 'node:fs';
                mkdirSync(base+'/foreign');
                let rejected=false;
                try { getE2ERunDirectory({JLB_E2E_RUN_DIR:base+'/foreign'},base+'/allowed'); }
                catch (error) { rejected=error.message.includes('E2E output must stay'); }
                console.log(JSON.stringify({rejected}));
            """,folder).stdout)
            self.assertTrue(data['rejected'])

    def test_no_spec_can_fall_back_to_legacy_artifact_directories(self):
        violations=[]
        for path in (ROOT/'tests/e2e').glob('*.ts'):
            text=path.read_text(encoding='utf-8')
            if re.search(r'artifacts[/\\]|JLB_(?:DESIGN_QA_DIR|TRAINING_QA_DIR|QA_DIR)',text):
                violations.append(path.name)
        self.assertEqual(violations,[])

    def list_config(self):
        result=subprocess.run([NODE,str(ROOT/'node_modules/@playwright/test/cli.js'),'test','--list','--reporter=json'],cwd=ROOT,text=True,encoding='utf-8',capture_output=True,check=True)
        return json.loads(result.stdout)

    def test_default_config_has_isolated_server_and_reports(self):
        config=self.list_config()['config']
        directory=Path(config['projects'][0]['outputDir']).parent
        self.assertEqual(directory.parent,ROOT/'artifacts/e2e-runs')
        # The JSON reporter omits use/webServer; inspect the actual default
        # config export as well, rather than assuming reporter-only fields.
        source="import config from './playwright.config.ts'; console.log(JSON.stringify(config));"
        raw=json.loads(subprocess.run([NODE,'--input-type=module','-e',source],cwd=ROOT,text=True,encoding='utf-8',capture_output=True,check=True).stdout)
        self.assertEqual(raw['use']['baseURL'],'http://127.0.0.1:5426')
        self.assertEqual(raw['webServer']['url'],'http://127.0.0.1:5426')
        self.assertFalse(raw['webServer']['reuseExistingServer'])
        # --reporter=json overrides the CLI's reporters, so verify default
        # report placement against this separate config invocation's own root.
        directory=Path(raw['outputDir']).parent
        self.assertEqual(directory.parent,ROOT/'artifacts/e2e-runs')
        reports=[r[1] for r in raw['reporter'] if len(r)>1]
        self.assertIn(str(directory/'report.json'),[r.get('outputFile') for r in reports])
        self.assertIn(str(directory/'report'),[r.get('outputFolder') for r in reports])

    def test_independent_cli_invocations_do_not_share_outputs(self):
        first=self.list_config()['config']['projects'][0]['outputDir']
        second=self.list_config()['config']['projects'][0]['outputDir']
        self.assertNotEqual(first,second)

    def test_generated_python_caches_are_ignored(self):
        bundled=Path('C:/Users/PC/AppData/Local/GitHubDesktop/app-3.6.7/resources/app/git/cmd/git.exe')
        git=str(bundled) if bundled.is_file() else 'git'
        names=['scripts/ci/__pycache__/example.cpython-312.pyc','tests/ci/__pycache__/example.cpython-312.pyc']
        result=subprocess.run([git,'-c','safe.directory='+ROOT.as_posix(),'check-ignore','--stdin','-z'],input=('\0'.join(names)+'\0').encode(),cwd=ROOT,capture_output=True)
        self.assertEqual(result.stdout.decode().rstrip('\0').split('\0'),names)


if __name__=='__main__':
    unittest.main()
