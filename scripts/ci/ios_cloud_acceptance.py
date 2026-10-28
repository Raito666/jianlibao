"""Future real-Mac acceptance: existing four modules, nonempty persistence, actual native/Web sync."""
from pathlib import Path
import importlib.util,json,os,platform,re,shutil,signal,sqlite3,subprocess,tempfile,time,uuid
from contextlib import closing
from datetime import datetime

ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'artifacts/ios-cloud-ui'

def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts/ci'/f'{name}.py')
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class Runner:
    def __init__(self,output,private):self.output,self.private,self.redactions=Path(output),Path(private),[]
    def command(self,args,*,timeout=120,log=None,input=None):
        # No credential-bearing arguments or pipes whose descendants can stall exit.
        def redact(text):
            for secret in self.redactions:text=text.replace(secret,'[REDACTED]')
            return re.sub(r'JLB1-[A-Za-z0-9_-]{43}|Bearer [A-Za-z0-9_-]{43}','[REDACTED]',text)
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            process=subprocess.Popen(args,cwd=ROOT,stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                     stdout=out,stderr=err,start_new_session=True)
            expired=False;cleanup=[]
            try:
                try:process.communicate(input=input,timeout=timeout)
                except subprocess.TimeoutExpired:
                    expired=True
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    except Exception as error:
                        cleanup.append('Process group cleanup: '+type(error).__name__)
                        try:process.kill() # Only the Popen child owned by this call, never an executable name.
                        except Exception as error:cleanup.append('Owned child cleanup: '+type(error).__name__)
                    try:process.communicate(timeout=5)
                    except Exception as error:cleanup.append('Process reap: '+type(error).__name__)
            finally:
                out.seek(0);err.seek(0)
                stdout=out.read().decode('utf-8',errors='replace');stderr=err.read().decode('utf-8',errors='replace')
                if log:(self.output/log).write_text(redact(stdout+stderr+'\n'.join(cleanup)),encoding='utf-8')
        if expired:raise subprocess.TimeoutExpired([str(args[0])],timeout)
        if process.returncode:raise RuntimeError('Native acceptance command failed; see sanitized log')
        return redact(stdout)
    def save(self,name,data):(self.output/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def peer(self,phase):
        return self.command(['node','scripts/ci/ios_cloud_peer.mjs',phase,str(self.private),str(self.output)],timeout=210 if phase=='cleanup' else 180,log='peer-'+phase+'.log')

ANY_SUCCESS=object()

def new_success(before,state):
    try:
        after=datetime.fromisoformat(state['lastSuccess'].replace('Z','+00:00'))
        if after.tzinfo is None:return False
        return before is None or after>datetime.fromisoformat(before.replace('Z','+00:00'))
    except (ValueError,TypeError,AttributeError,KeyError):return False

def copy_capture(sim,source,target):
    if sim.frame_evidence(source,require_home=False)['nonBlank'] is not True:raise ValueError('Blank native cloud capture')
    shutil.copyfile(source,target)

def previous_success(container):
    paths=list((container/'Library/CapacitorDatabase').glob('jianlibao*.db'))
    if len(paths)!=1:raise ValueError('Exactly one fresh native database required')
    with closing(sqlite3.connect(paths[0].resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as db:
        row=db.execute('SELECT value FROM storage_meta WHERE key=?',('cloud-sync-native-v1',)).fetchall()
    if not row:return None
    if len(row)!=1:raise ValueError('Duplicate native sync metadata')
    meta=json.loads(row[0][0]);connection=meta.get('connection')
    return connection.get('lastSuccess') if isinstance(connection,dict) else None

def stable_sync(evidence,container,secret,timeout=60,after_success=ANY_SUCCESS):
    deadline=time.monotonic()+timeout;last=None
    while time.monotonic()<deadline:
        try:current=evidence.read_sync_state(container,secret)
        except (ValueError,sqlite3.Error,FileNotFoundError,KeyError,TypeError):last=None;time.sleep(0.5);continue
        if after_success is not ANY_SUCCESS and not new_success(after_success,current):last=None;time.sleep(0.5);continue
        if last and current['payloadSha256']==last['payloadSha256'] and current['connection']==last['connection']:return current
        last=current;time.sleep(0.5)
    raise RuntimeError('Native saved records/common base did not stabilize')

def run():
    if platform.system()!='Darwin':raise RuntimeError('Real macOS required; no Apple or cloud commands executed')
    OUTPUT.mkdir(parents=True,exist_ok=False)
    private=Path(tempfile.mkdtemp(prefix='ios-cloud-acceptance-',dir=ROOT/'tools'))
    runner=Runner(OUTPUT,private);ui=module('ios_ui_acceptance');sim=module('ios_simulator');evidence=module('ios_sync_evidence')
    result={'nativeCloudAccepted':False,'visualReviewPassed':False,'physicalDeviceAccepted':False,'appStoreConnectUsed':False,
            'sourceCommit':os.environ.get('CM_COMMIT'),'cloudPeerMocked':False,'phase':'four-module-ui'}
    device=None;copied=False;fixture_created=False
    try:
        # Retain all existing UI, geometry, saved-value and persistence assertions.
        ui.run('full')
        accepted=json.loads((ui.OUTPUT/'ui-result.json').read_text())
        if accepted.get('status')!='passed' or accepted.get('nativeInteractionsAccepted') is not True or accepted.get('corePersistenceAccepted') is not True:
            raise ValueError('Existing four-module UI acceptance did not pass')
        owned=json.loads((sim.OUTPUT/'simulator-result.json').read_text())
        device=accepted['simulatorId'];uuid.UUID(device)
        if owned['simulatorId']!=device:raise ValueError('Only the simulator created by this job may be controlled')
        result['simulatorId']=device;result['phase']='cloud-system-boot'
        result['systemBoot']=sim.wait_boot(device,phase='cloud-start',execute=runner.command,output=OUTPUT)
        container=Path(runner.command(['xcrun','simctl','get_app_container',device,ui.BUNDLE,'data']).strip())
        project=module('ios_ui_project').generate_project(private/'Harness',ROOT/'scripts/ci/native-ui/CloudSyncTests.swift')
        derived=private/'DerivedData'
        runner.command(['xcodebuild','-project',project['project'],'-scheme',project['name'],'-configuration','Debug',
                        '-destination','id='+device,'-derivedDataPath',str(derived),'CODE_SIGNING_ALLOWED=NO',
                        'CODE_SIGNING_REQUIRED=NO','CODE_SIGN_IDENTITY=','build-for-testing'],timeout=600,log='cloud-ui-build.log')
        def native(method,phase,captures,require_sync=True):
            result['phase']=phase
            before_time=previous_success(container) if require_sync else None
            xcresult=private/(phase+'.xcresult') # Raw XCTest attachments never go into published artifacts.
            runner.command(['xcodebuild','-project',project['project'],'-scheme',project['name'],'-configuration','Debug',
                            '-destination','id='+device,'-derivedDataPath',str(derived),'CODE_SIGNING_ALLOWED=NO',
                            'CODE_SIGNING_REQUIRED=NO','CODE_SIGN_IDENTITY=','-parallel-testing-enabled','NO',
                            '-maximum-concurrent-test-simulator-destinations','1',
                            '-only-testing:'+project['name']+'/NativeCloudSyncTests/'+method,
                            '-resultBundlePath',str(xcresult),'test-without-building'],timeout=360,log=phase+'.log')
            summary=json.loads(runner.command(['xcrun','xcresulttool','get','test-results','summary','--path',str(xcresult)],timeout=30))
            if not ui.summary_valid(summary,device):raise ValueError('Missing, failed or skipped native cloud test')
            runner.save(phase+'-summary.json',summary)
            if require_sync:
                fresh=stable_sync(evidence,container,secret,after_success=before_time)
                runner.save(phase+'-fresh-sync.json',{'previousSuccess':before_time,'newSuccess':fresh['lastSuccess'],
                                                     'freshTimestampRequired':True,'commonBaseMatchesAllSharedRecords':True})
            runner_container=Path(runner.command(['xcrun','simctl','get_app_container',device,'com.jianlibao.acceptance.xctrunner','data']).strip())
            for capture in captures:
                source=runner_container/'Documents/jlb-cloud-ui'/(capture+'.png')
                copy_capture(sim,source,OUTPUT/(phase+'-'+capture+'.png'))
        result['phase']='web-fixture-setup'
        try:runner.peer('setup')
        finally:fixture_created=(private/'fixture.json').is_file()
        fixture=json.loads((private/'fixture.json').read_text());secret=fixture['secret']
        import hashlib,base64
        bearer=base64.urlsafe_b64encode(hashlib.sha256(('jianlibao:auth:v1:'+secret).encode()).digest()).decode().rstrip('=')
        runner.redactions=[secret,bearer]
        copied=True # Attempt cleanup even if pbcopy writes partially before returning an error.
        runner.command(['xcrun','simctl','pbcopy',device],input=secret.encode())
        native('testCloudConnectAndModify','connected',['cloud-connected','cloud-native-saved'])
        runner.command(['xcrun','simctl','pbcopy',device],input=b'');copied=False
        saved=stable_sync(evidence,container,secret)
        if next((r['weightKg'] for r in saved['data']['bodyMetrics'] if r['date']=='2026-10-27'),None)!=74:raise ValueError('Actual native body edit did not persist')
        runner.save('native-saved.json',saved);runner.peer('pull')
        result['nativeToWebAccepted']=True
        for phase,reboot in [('reopened',False),('rebooted',True)]:
            result['phase']=phase
            if reboot:
                runner.command(['xcrun','simctl','shutdown',device])
                result['systemReboot']=sim.wait_boot(device,phase='cloud-reboot',execute=runner.command,output=OUTPUT)
            else:
                before=sim.launch_pid(runner.command(['xcrun','simctl','launch',device,ui.BUNDLE]))
                runner.command(['xcrun','simctl','terminate',device,ui.BUNDLE])
            pid=sim.launch_pid(runner.command(['xcrun','simctl','launch',device,ui.BUNDLE]))
            if not reboot and before==pid:raise ValueError('Application must have a new PID after termination')
            current_container=Path(runner.command(['xcrun','simctl','get_app_container',device,ui.BUNDLE,'data']).strip())
            current=stable_sync(evidence,current_container,secret);evidence.assert_retained(saved,current)
            native('testCloudConnectionRetained',phase,['cloud-retained'])
            evidence.assert_retained(saved,stable_sync(evidence,current_container,secret))
            runner.save('native-'+phase+'.json',current)
        result.update(completeNonemptyDataRetained=True,sameSimulatorRestarted=True)
        runner.peer('edit')
        native('testCloudConnectionRetained','web-to-native',['cloud-retained'])
        updated=stable_sync(evidence,container,secret)
        peer=json.loads((OUTPUT/'web-edit.json').read_text())
        if evidence.shared(updated['data'])!=evidence.shared(peer['data']):raise ValueError('Actual Web to native shared records differ')
        if next((r['weightKg'] for r in updated['data']['bodyMetrics'] if r['date']=='2026-10-27'),None)!=76:raise ValueError('Web change did not reach native SQLite')
        result['webToNativeAccepted']=True;runner.save('native-updated.json',updated)
        native('testCloudDisconnectRetainsLocalRecords','disconnected',['cloud-disconnected'],require_sync=False)
        disconnected=ui.read_state(container);ui.assert_same_state(updated,disconnected)
        with closing(sqlite3.connect((container/'Library/CapacitorDatabase'/disconnected['database']).resolve().as_uri()+'?mode=ro',uri=True)) as db:
            meta=json.loads(db.execute('SELECT value FROM storage_meta WHERE key=?',('cloud-sync-native-v1',)).fetchone()[0])
        if meta!={'version':1,'connection':None}:raise ValueError('Native disconnect reference was not cleared')
        result.update(nativeCloudAccepted=True,disconnectRetainsLocalRecords=True,phase='completed')
    except Exception as error:
        result.update(nativeCloudAccepted=False,errorType=type(error).__name__)
        raise
    finally:
        for label,work in [('clipboard',lambda:runner.command(['xcrun','simctl','pbcopy',device],input=b'') if copied else None),
                           ('cloud-fixture',lambda:runner.peer('cleanup') if fixture_created else None),
                           ('simulator',lambda:runner.command(['xcrun','simctl','shutdown',device],timeout=30) if device else None)]:
            try:work()
            except Exception as error:result.update(nativeCloudAccepted=False);result[label+'CleanupError']=type(error).__name__
        runner.save('cloud-result.json',result)
        if not result['nativeCloudAccepted'] and result.get('phase')=='completed':raise RuntimeError('Cloud acceptance cleanup failed')

if __name__=='__main__':run()
