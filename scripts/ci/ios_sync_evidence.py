"""Read-only evidence from this CI job's synthetic native workspace, never Keychain secrets."""
from contextlib import closing
from datetime import datetime
from pathlib import Path
import hashlib,importlib.util,json,re,sqlite3

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def shared(data):
    return {key:sorted([row for row in data[key] if key!='sessions' or row.get('status') in {'completed','cancelled'}],
                       key=lambda row:row['date'] if key=='bodyMetrics' else row['id'])
            for key in ['exercises','templates','sessions','bodyMetrics']}

def exposes_sync_key(value):
    pending=[value]
    while pending:
        current=pending.pop()
        if isinstance(current,str):
            if 'JLB1-' in current:return True
            if current.lstrip().startswith(('{','[','"')):
                # Preserve every field pair: normal dict decoding discards earlier duplicate keys.
                try:pending.append(json.loads(current,object_pairs_hook=lambda pairs:[part for pair in pairs for part in pair]))
                except json.JSONDecodeError:pass
        elif isinstance(current,dict):pending.extend(current.keys());pending.extend(current.values())
        elif isinstance(current,list):pending.extend(current)
    return False

def read_sync_state(container,secret):
    if not re.fullmatch(r'JLB1-[A-Za-z0-9_-]{43}',secret):raise ValueError('Invalid isolated fixture key')
    state=module('ios_ui_acceptance').read_state(Path(container))
    if not shared(state['data'])['sessions'] or not state['data']['bodyMetrics']:raise ValueError('Expected nonempty saved training and body records')
    path=Path(container)/'Library/CapacitorDatabase'/state['database']
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as db:
        metadata=db.execute('SELECT key,value FROM storage_meta').fetchall()
    if any(not isinstance(key,str) or not isinstance(value,str) or exposes_sync_key(key) or exposes_sync_key(value)
           for key,value in metadata):raise ValueError('Plaintext sync key or invalid SQLite metadata')
    rows=[(value,) for key,value in metadata if key=='cloud-sync-native-v1']
    if len(rows)!=1:raise ValueError('Missing native sync connection')
    raw=rows[0][0]
    if 'JLB1-' in raw or secret in json.dumps(state['data']):raise ValueError('Plaintext sync key in SQLite evidence')
    meta=json.loads(raw)
    if set(meta)!= {'version','connection'} or type(meta['version']) is not int or meta['version']!=1 or not isinstance(meta['connection'],dict):raise ValueError('Native connection missing or invalid')
    connection=meta['connection']
    if set(connection)!= {'slot','base','lastSuccess'}:raise ValueError('Unexpected native connection fields')
    slot=hashlib.sha256(('jianlibao:keychain:v1:'+secret).encode()).hexdigest()
    if connection['slot']!=slot:raise ValueError('Native Keychain reference differs from this fixture')
    try:datetime.fromisoformat(connection['lastSuccess'].replace('Z','+00:00'))
    except (TypeError,ValueError,AttributeError):raise ValueError('No successful native sync timestamp') from None
    base=connection['base']
    if (not isinstance(base,dict) or set(base)!={'version','tombstones','exercises','templates','sessions','bodyMetrics'}
            or type(base['version']) is not int or base['version']!=1 or not isinstance(base['tombstones'],list) or shared(base)!=shared(state['data'])):
        raise ValueError('Unsynced or changed shared records in native common base')
    # A successful sync may refresh lastSuccess on activation; compare content/reference separately.
    state['connection']={'slot':slot,'base':{**shared(base),'version':1,'tombstones':sorted(base['tombstones'])}}
    state['lastSuccess']=connection['lastSuccess']
    return state

def assert_retained(before,after):
    for key in ['container','database','payloadSha256','data','connection']:
        if before.get(key)!=after.get(key):raise ValueError('Native persistence differs: '+key)
