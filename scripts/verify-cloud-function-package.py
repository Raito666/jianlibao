"""Reject Windows junctions, missing runtime dependencies and accidental private files.

Run against the actual Netlify functions:build sync.zip before deployment.
This reads archive metadata only and never extracts or executes package code.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile


def verify_package(path):
    path = Path(path)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = {entry.filename for entry in entries}
        required = {'sync.mjs', 'node_modules/@netlify/blobs/package.json', 'node_modules/@netlify/blobs/dist/main.js'}
        if not required <= names:
            raise ValueError('Cloud package is missing physical SDK files')
        if not any(PurePosixPath(name).name == 'THIRD-PARTY-NOTICES.md' for name in names):
            raise ValueError('Cloud package is missing third-party notices')
        for entry in entries:
            name = entry.filename
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Cloud package contains a platform-dependent link: ' + name)
            if '\\' in name or name.startswith('/') or '..' in PurePosixPath(name).parts or re.match(r'^[A-Za-z]:', name):
                raise ValueError('Cloud package contains a nonportable path')
            if name.startswith(('tools/', '.git/')) or PurePosixPath(name).name in {'.env', 'api-token.txt'}:
                raise ValueError('Cloud package contains private development files')
        return {'portable': True, 'entries': len(entries), 'sdkPhysical': True, 'noticesIncluded': True,
                'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == '__main__':
    print(json.dumps(verify_package(sys.argv[1]), ensure_ascii=False))
