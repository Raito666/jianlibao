import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile


class CloudFunctionPackageTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('cloud_package', Path(__file__).resolve().parents[2] / 'scripts/verify-cloud-function-package.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def archive(self, path, *, sdk=True, notice=True, link=False):
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('sync.mjs', 'export default () => new Response();')
            if sdk:
                z.writestr('node_modules/@netlify/blobs/package.json', '{}')
                z.writestr('node_modules/@netlify/blobs/dist/main.js', 'export const getStore = () => {};')
            if notice:
                z.writestr('netlify/functions/THIRD-PARTY-NOTICES.md', 'MIT License')
            if link:
                entry = zipfile.ZipInfo('node_modules/@netlify/otel')
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(entry, 'F:/project/netlify/functions/node_modules/.pnpm/package')

    def test_accepts_portable_physical_dependencies(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'sync.zip'
            self.archive(target)
            self.assertTrue(self.module.verify_package(target)['portable'])

    def test_rejects_windows_junction_in_linux_deployment(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'sync.zip'
            self.archive(target, link=True)
            with self.assertRaisesRegex(ValueError, 'link'):
                self.module.verify_package(target)

    def test_rejects_missing_sdk_notices_or_private_files(self):
        for options in ({'sdk': False}, {'notice': False}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / 'sync.zip'
                self.archive(target, **options)
                with self.assertRaises(ValueError):
                    self.module.verify_package(target)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'sync.zip'
            self.archive(target)
            with zipfile.ZipFile(target, 'a') as z:
                z.writestr('tools/api-token.txt', 'must not ship')
            with self.assertRaises(ValueError):
                self.module.verify_package(target)


if __name__ == '__main__':
    unittest.main()
