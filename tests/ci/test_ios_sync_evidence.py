from contextlib import closing
from copy import deepcopy
from pathlib import Path
import hashlib,importlib.util,json,sqlite3,tempfile,unittest

ROOT=Path(__file__).resolve().parents[2]
SECRET='JLB1-'+'A'*43

def load():
    spec=importlib.util.spec_from_file_location('sync_evidence',ROOT/'scripts/ci/ios_sync_evidence.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class NativeSyncEvidence(unittest.TestCase):
    def setUp(self):self.m=load()
    def fixture(self):
        directory=tempfile.TemporaryDirectory(prefix='jlb-sync-evidence-');self.addCleanup(directory.cleanup)
        root=Path(directory.name);p=root/'Library/CapacitorDatabase/jianlibaoSQLite.db';p.parent.mkdir(parents=True)
        data={'schemaVersion':2,'revision':3,'exercises':[{'id':'ex'}],'templates':[{'id':'t'}],
              'sessions':[{'id':'s','status':'completed','note':'synthetic UI training'}],
              'bodyMetrics':[{'id':'b','date':'2026-10-27','weightKg':74}],'settings':{'showRpe':False}}
        base={'version':1,'tombstones':[],**{k:deepcopy(data[k]) for k in ['exercises','templates','sessions','bodyMetrics']}}
        meta={'version':1,'connection':{'slot':hashlib.sha256(('jianlibao:keychain:v1:'+SECRET).encode()).hexdigest(),
                                      'base':base,'lastSuccess':'2026-10-27T02:00:00.000Z'}}
        with closing(sqlite3.connect(p)) as db,db:
            db.executescript('PRAGMA user_version=1; CREATE TABLE workspace(id TEXT,revision INTEGER,payload TEXT); CREATE TABLE storage_meta(key TEXT,value TEXT);')
            db.execute('INSERT INTO workspace VALUES(?,?,?)',('main',3,json.dumps(data)))
            db.execute('INSERT INTO storage_meta VALUES(?,?)',('legacy-indexeddb-v1',json.dumps({'version':1,'complete':True,'source':'new'})))
            db.execute('INSERT INTO storage_meta VALUES(?,?)',('cloud-sync-native-v1',json.dumps(meta)))
        return root,p,data,meta
    def set_meta(self,path,meta):
        with closing(sqlite3.connect(path)) as db,db:db.execute('UPDATE storage_meta SET value=? WHERE key=?',(json.dumps(meta),'cloud-sync-native-v1'))
    def test_reads_real_sqlite_read_only_and_checks_all_shared_records(self):
        root,path,data,meta=self.fixture();before=path.read_bytes();proof=self.m.read_sync_state(root,SECRET)
        self.assertEqual(path.read_bytes(),before);self.assertEqual(proof['data'],data)
        self.assertEqual(proof['connection']['slot'],meta['connection']['slot'])
        self.assertNotIn(SECRET,json.dumps(proof));self.m.assert_retained(proof,deepcopy(proof))
    def test_same_counts_with_changed_archived_training_or_body_does_not_pass(self):
        for collection in ['exercises','templates','sessions','bodyMetrics']:
            root,path,data,meta=self.fixture();meta['connection']['base'][collection][0]['id']='lost-record'
            self.set_meta(path,meta)
            with self.subTest(collection=collection),self.assertRaises(ValueError):self.m.read_sync_state(root,SECRET)
    def test_empty_collections_do_not_substitute_for_saved_nonempty_records(self):
        root,path,data,meta=self.fixture();data['sessions']=[];meta['connection']['base']['sessions']=[]
        with closing(sqlite3.connect(path)) as db,db:db.execute('UPDATE workspace SET payload=?',(json.dumps(data),))
        self.set_meta(path,meta)
        with self.assertRaisesRegex(ValueError,'nonempty'):self.m.read_sync_state(root,SECRET)
    def test_missing_or_wrong_key_reference_and_plaintext_key_are_rejected(self):
        for mutation in ['slot','secret','missing']:
            root,path,data,meta=self.fixture()
            if mutation=='slot':meta['connection']['slot']='0'*64
            if mutation=='secret':meta['connection']['secret']=SECRET
            if mutation=='missing':meta['connection']=None
            self.set_meta(path,meta)
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):self.m.read_sync_state(root,SECRET)
    def test_relaunch_or_reboot_requires_same_container_and_complete_payload(self):
        root,path,data,meta=self.fixture();before=self.m.read_sync_state(root,SECRET)
        for field,value in [('container','different'),('payloadSha256','0'*64),('data',{})]:
            changed={**deepcopy(before),field:value}
            with self.subTest(field=field),self.assertRaises(ValueError):self.m.assert_retained(before,changed)
        after=deepcopy(before);after['connection']['slot']='0'*64
        with self.assertRaises(ValueError):self.m.assert_retained(before,after)
    def test_unsynced_base_and_failed_success_timestamp_cannot_pass(self):
        for key,value in [('base',None),('lastSuccess',None),('lastSuccess','not-a-date')]:
            root,path,data,meta=self.fixture();meta['connection'][key]=value;self.set_meta(path,meta)
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):self.m.read_sync_state(root,SECRET)
    def test_only_active_draft_does_not_count_as_archived_training_persistence(self):
        root,path,data,meta=self.fixture();data['sessions'][0]['status']='active';meta['connection']['base']['sessions']=[]
        with closing(sqlite3.connect(path)) as db,db:db.execute('UPDATE workspace SET payload=?',(json.dumps(data),))
        self.set_meta(path,meta)
        with self.assertRaisesRegex(ValueError,'nonempty'):self.m.read_sync_state(root,SECRET)
    def test_boolean_metadata_or_snapshot_versions_do_not_count_as_version_one(self):
        for section in ['metadata','base']:
            root,path,data,meta=self.fixture()
            if section=='metadata':meta['version']=True
            else:meta['connection']['base']['version']=True
            self.set_meta(path,meta)
            with self.subTest(section=section),self.assertRaises(ValueError):self.m.read_sync_state(root,SECRET)
    def test_plaintext_secret_in_another_metadata_row_is_also_rejected(self):
        root,path,data,meta=self.fixture()
        with closing(sqlite3.connect(path)) as db,db:db.execute('INSERT INTO storage_meta VALUES(?,?)',('unexpected-debug-cache',SECRET))
        with self.assertRaisesRegex(ValueError,'Plaintext'):self.m.read_sync_state(root,SECRET)
    def test_plaintext_secret_in_metadata_key_is_also_rejected(self):
        root,path,data,meta=self.fixture()
        with closing(sqlite3.connect(path)) as db,db:db.execute('INSERT INTO storage_meta VALUES(?,?)',(SECRET,'synthetic metadata'))
        with self.assertRaisesRegex(ValueError,'Plaintext'):self.m.read_sync_state(root,SECRET)
    def test_json_escaped_secret_in_metadata_keys_or_values_is_rejected(self):
        for value in [{'nested':{'value':SECRET}},{SECRET:'synthetic value'}]:
            root,path,data,meta=self.fixture()
            encoded=json.dumps(value).replace('JLB1-',chr(92)+'u004aLB1-')
            self.assertNotIn(SECRET,encoded)
            with closing(sqlite3.connect(path)) as db,db:db.execute('INSERT INTO storage_meta VALUES(?,?)',('encoded-debug-metadata',encoded))
            with self.subTest(value_type=type(value).__name__),self.assertRaisesRegex(ValueError,'Plaintext'):self.m.read_sync_state(root,SECRET)
    def test_duplicate_json_fields_do_not_hide_an_earlier_escaped_secret(self):
        root,path,data,meta=self.fixture()
        escaped=SECRET.replace('JLB1-',chr(92)+'u004aLB1-')
        encoded='{"debug":"'+escaped+'","debug":"safe"}'
        self.assertEqual(json.loads(encoded),{'debug':'safe'})
        with closing(sqlite3.connect(path)) as db,db:db.execute('INSERT INTO storage_meta VALUES(?,?)',('duplicate-debug-fields',encoded))
        with self.assertRaisesRegex(ValueError,'Plaintext'):self.m.read_sync_state(root,SECRET)

if __name__=='__main__':unittest.main()
