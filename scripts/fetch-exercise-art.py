"""Fetch the pinned, attributed CC BY-SA exercise artwork without changing it."""
import concurrent.futures
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'artifacts/expansion-2026-10-16'
COMMIT = 'aac599224bb9780305239607ef98540b7e0ce389'
BASE = f'https://raw.githubusercontent.com/bryllim/workout-guide/{COMMIT}/packages/workout-guide/'
MANIFEST = json.loads((EVIDENCE / 'workout-manifest.json').read_text(encoding='utf-8'))
TREE = {row['path']: row['sha'] for row in json.loads((EVIDENCE/'workout-source-tree.json').read_text(encoding='utf-8'))['tree']}
TARGET = ROOT / 'public/exercise-art' / COMMIT[:8]
TARGET.mkdir(parents=True, exist_ok=True)

def fetch(frame):
    relative = frame['path'].removeprefix('assets/')
    target = TARGET / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        content = target.read_bytes()
    else:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(BASE + frame['path'], timeout=35) as response:
                    content = response.read()
                if b'<svg' not in content[:1000] or b'<script' in content.lower():
                    raise ValueError('Unexpected SVG content')
                target.write_bytes(content)
                break
            except Exception:
                if attempt == 2: raise
                time.sleep(1)
    blob_sha = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
    assert blob_sha == TREE['packages/workout-guide/' + frame['path']], relative
    return {'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'gitBlobVerified': True}

frames = [frame for exercise in MANIFEST for frame in exercise['frames']]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    results = list(pool.map(fetch, frames))
licenses = ROOT / 'public/exercise-art'
for name in ['LICENSE-ASSETS', 'ATTRIBUTION.md', 'LICENSES.md']:
    (licenses/name).write_bytes((EVIDENCE/name).read_bytes())
(licenses/'source-manifest.json').write_text(json.dumps({'repository':'bryllim/workout-guide','commit':COMMIT,'license':'CC BY-SA 4.0','entries':MANIFEST,'files':results}, ensure_ascii=False), encoding='utf-8')
print(f'{len(results)} original SVGs verified, {sum(x["bytes"] for x in results)/1e6:.2f} MB')
