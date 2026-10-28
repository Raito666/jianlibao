"""Simulator artifact contracts; no Apple toolchain or cloud account is accessed."""
from pathlib import Path
import hashlib,importlib.util,json,plistlib,stat,tempfile,unittest,zipfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
class SimulatorPackage(unittest.TestCase):
 def setUp(self):
  spec=importlib.util.spec_from_file_location('ios_package',ROOT/'scripts/ci/package_ios_simulator.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
 def fixture(self,root,platform='iPhoneSimulator',bundle='com.jianlibao.app'):
  app=root/'App.app';app.mkdir();(app/'App').write_bytes(b'\xcf\xfa\xed\xfeexample executable');(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':bundle,'CFBundleExecutable':'App','CFBundleSupportedPlatforms':[platform]}));return app
 def zipped(self,target,manifest,*,executable=True,extra=None):
  with zipfile.ZipFile(target,'w') as z:
   for name,data in manifest['contents'].items():
    info=zipfile.ZipInfo('App.app/'+name);info.create_system=3;info.external_attr=((stat.S_IFREG|0o644|(0o111 if name=='App' and executable else 0))<<16);z.writestr(info,data)
   if extra:z.writestr(extra,b'foreign')
 def test_only_correct_bundle_and_simulator_platform_are_accepted(self):
  for platform,bundle,valid in [('iPhoneSimulator','com.jianlibao.app',True),('iPhoneOS','com.jianlibao.app',False),('iPhoneSimulator','other.bundle',False)]:
   with self.subTest(platform=platform,bundle=bundle),tempfile.TemporaryDirectory() as folder:
    root=Path(folder).resolve();app=self.fixture(root,platform,bundle)
    if valid:self.assertTrue(self.module.bundle_manifest(app,root)['simulatorOnly'])
    else:
     with self.assertRaises(ValueError):self.module.bundle_manifest(app,root)
 def test_app_outside_root_and_executable_path_traversal_are_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder).resolve();app=self.fixture(root)
   with self.assertRaises(ValueError):self.module.bundle_manifest(app,root/'elsewhere')
   info=plistlib.loads((app/'Info.plist').read_bytes());info['CFBundleExecutable']='../secret';(app/'Info.plist').write_bytes(plistlib.dumps(info))
   with self.assertRaises(ValueError):self.module.bundle_manifest(app,root)
 def test_database_or_signing_material_inside_app_is_rejected(self):
  for name in ['personal.sqlite','signing.p12','credential.key','embedded.mobileprovision']:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
    root=Path(folder).resolve();app=self.fixture(root);(app/name).write_bytes(b'sensitive')
    with self.assertRaises(ValueError):self.module.bundle_manifest(app,root)
 def test_archive_checks_every_hash_and_executable_permission(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder).resolve();app=self.fixture(root);manifest=self.module.bundle_manifest(app,root);contents={p.name:p.read_bytes() for p in app.iterdir()};self.zipped(root/'valid.zip',{'contents':contents})
   self.assertEqual(self.module.verify_archive(root/'valid.zip',manifest)['files'],2)
   self.zipped(root/'nonexec.zip',{'contents':contents},executable=False)
   with self.assertRaises(ValueError):self.module.verify_archive(root/'nonexec.zip',manifest)
   self.zipped(root/'bad.zip',{'contents':{**contents,'App':b'wrong bytes'}})
   with self.assertRaises(ValueError):self.module.verify_archive(root/'bad.zip',manifest)
 def test_archive_rejects_extra_paths_and_existing_target_is_not_overwritten(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder).resolve();app=self.fixture(root);manifest=self.module.bundle_manifest(app,root);contents={p.name:p.read_bytes() for p in app.iterdir()};self.zipped(root/'outside.zip',{'contents':contents},extra='../secret.txt')
   with self.assertRaises(ValueError):self.module.verify_archive(root/'outside.zip',manifest)
   target=root/'kept.zip';target.write_bytes(b'original')
   with self.assertRaises(FileExistsError):self.module.create_archive(app,target,root)
   self.assertEqual(target.read_bytes(),b'original')
 def test_symlink_marker_is_rejected_before_reading_its_contents(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder).resolve();app=self.fixture(root);(app/'outside-link').write_bytes(b'private')
   with patch.object(Path,'is_symlink',lambda path:path.name=='outside-link'):
    with self.assertRaises(ValueError):self.module.bundle_manifest(app,root)
 def test_windows_entry_stops_before_packaging_or_apple_commands(self):
  with patch.object(self.module.platform,'system',return_value='Windows'),patch.object(self.module.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'macOS'):self.module.main()
  run.assert_not_called()
 def test_workflow_packages_only_after_successful_startup_and_exports_zip(self):
  flow=json.loads((ROOT/'codemagic.yaml').read_text(encoding='utf-8'))['workflows']['ios-simulator-free'];scripts='\n'.join(x['script'] for x in flow['scripts'])
  self.assertLess(scripts.index('ios_simulator.py run'),scripts.index('package_ios_simulator.py'))
  self.assertIn('artifacts/ios-simulator/*.zip',flow['artifacts'])
  self.assertNotIn('publishing',flow);self.assertNotIn('integrations',flow)
if __name__=='__main__':unittest.main()
