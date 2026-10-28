"""Package only a compiled unsigned Simulator app; never a simulator data container."""
from pathlib import Path, PurePosixPath
import hashlib,json,os,platform,plistlib,stat,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'artifacts/ios-simulator'
LIMIT=512*1024*1024
DENIED={'.db','.sqlite','.sqlite3','.p8','.p12','.pem','.key','.mobileprovision'}
def sha(data):return hashlib.sha256(data).hexdigest()
def inside(path,root):
 if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('Path or link outside allowed build root')
 return path.resolve()
def bundle_manifest(app,root):
 app=inside(app,root)
 if not app.is_dir() or app.name!='App.app':raise ValueError('Expected compiled App.app')
 files={};total=0
 for path in sorted(app.rglob('*')):
  inside(path,app)
  if path.is_dir():continue
  if not path.is_file() or path.suffix.lower() in DENIED:raise ValueError('Unacceptable bundled file: '+path.name)
  name=path.relative_to(app).as_posix()
  if '\\' in name or ':' in name:raise ValueError('Unsafe archive filename')
  data=path.read_bytes();total+=len(data)
  if total>LIMIT:raise ValueError('Simulator app exceeds bounded package size')
  files[name]=sha(data)
 info=plistlib.loads((app/'Info.plist').read_bytes());executable=info.get('CFBundleExecutable','')
 if info.get('CFBundleIdentifier')!='com.jianlibao.app' or info.get('CFBundleSupportedPlatforms')!=['iPhoneSimulator']:raise ValueError('Not the Jianlibao Simulator bundle')
 if not executable or '/' in executable or '\\' in executable or executable in {'.','..'} or ':' in executable:raise ValueError('Invalid executable path')
 if executable not in files or not (app/executable).stat().st_size:raise ValueError('Missing executable')
 return {'simulatorOnly':True,'bundleIdentifier':info['CFBundleIdentifier'],'version':info.get('CFBundleShortVersionString'),'buildVersion':info.get('CFBundleVersion'),'supportedPlatforms':info['CFBundleSupportedPlatforms'],'executable':executable,'uncompressedBytes':total,'sourceFiles':files}
def verify_archive(target,manifest):
 expected={'App.app/'+name:digest for name,digest in manifest['sourceFiles'].items()}
 with zipfile.ZipFile(target) as z:
  entries=z.infolist()
  if len(entries)!=len(expected) or {x.filename for x in entries}!=set(expected):raise ValueError('Archive filenames do not exactly match bundle')
  for item in entries:
   path=PurePosixPath(item.filename)
   if path.is_absolute() or '..' in path.parts or '\\' in item.filename or ':' in item.filename:raise ValueError('Unsafe archive path')
   mode=item.external_attr>>16
   if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):raise ValueError('Not an ordinary bundle file')
   if item.file_size>LIMIT or sha(z.read(item))!=expected[item.filename]:raise ValueError('Bundled file checksum mismatch')
   if item.filename=='App.app/'+manifest['executable'] and (item.create_system!=3 or not mode&stat.S_IXUSR):raise ValueError('Executable Unix permission not preserved')
  if z.testzip() is not None:raise ValueError('Archive CRC failed')
 return {'files':len(expected),'crcPassed':True,'allSourceHashesMatch':True,'executableUnixPermission':True}
def create_archive(app,target,root):
 target=inside(target,root)
 if target.exists():raise FileExistsError('Refusing to overwrite previous simulator package')
 app=inside(app,root)
 if target.is_relative_to(app):raise ValueError('Archive cannot be written into source bundle')
 manifest=bundle_manifest(app,root)
 with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
  for name in manifest['sourceFiles']:z.write(app/name,'App.app/'+name)
 manifest['verification']=verify_archive(target,manifest)
 manifest['archive']={'name':target.name,'bytes':target.stat().st_size,'sha256':sha(target.read_bytes())}
 return manifest
def main():
 if platform.system()!='Darwin':raise RuntimeError('Simulator packaging requires macOS')
 app=OUTPUT/'DerivedData/Build/Products/Debug-iphonesimulator/App.app'
 manifest=bundle_manifest(app,ROOT)
 executable=app/manifest['executable']
 if not os.access(executable,os.X_OK):raise ValueError('Built executable is not executable on macOS')
 result=subprocess.run(['/usr/bin/lipo','-archs',str(executable)],check=True,text=True,capture_output=True,timeout=30)
 architectures=result.stdout.strip().split()
 if 'arm64' not in architectures or not set(architectures)<={'arm64','x86_64'}:raise ValueError('Unexpected Simulator architecture')
 receipt=OUTPUT/'simulator-package.json'
 if receipt.exists():raise FileExistsError('Previous package receipt exists')
 manifest=create_archive(app,OUTPUT/'jianlibao-ios-simulator.zip',ROOT)
 manifest.update(architectures=architectures,codeSigningAllowed=False,intendedUse='Mac iOS Simulator only; not an iPhone IPA; contains no Simulator data container')
 receipt.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'packaged':True,'architectures':architectures,'files':len(manifest['sourceFiles']),'bytes':manifest['archive']['bytes'],'sha256':manifest['archive']['sha256']}))
if __name__=='__main__':main()
