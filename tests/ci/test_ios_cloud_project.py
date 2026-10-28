"""Source/project wiring contracts only. These do not compile Swift or emulate Keychain."""
from pathlib import Path
import json
import re
import unittest
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[2]


class IOSCloudProjectContracts(unittest.TestCase):
    def test_capacitor_bridge_logging_is_disabled_before_keychain_is_used(self):
        # CapacitorBridge.toJs logs resultJson.prefix(256) by default in Debug.
        # A Keychain read must not leak its 48-byte result through framework logs.
        config = (ROOT / 'capacitor.config.ts').read_text(encoding='utf-8-sig')
        self.assertRegex(config, r"loggingBehavior:\s*'none'")
        copied = json.loads((ROOT / 'ios/App/App/capacitor.config.json').read_text(encoding='utf-8-sig'))
        self.assertEqual(copied['loggingBehavior'], 'none')
        self.assertEqual(copied.get('ios', {}).get('loggingBehavior', copied['loggingBehavior']), 'none')

    def test_both_app_entry_paths_register_the_same_bridge_plugin(self):
        source = (ROOT / 'ios/App/App/JianlibaoSyncKeychain.swift').read_text(encoding='utf-8-sig')
        scene = (ROOT / 'ios/App/App/SceneDelegate.swift').read_text(encoding='utf-8-sig')
        self.assertRegex(source, r'class JianlibaoBridgeViewController\s*:\s*CAPBridgeViewController')
        self.assertIn('registerPluginInstance(JianlibaoSyncKeychainPlugin())', source)
        self.assertIn('JianlibaoBridgeViewController()', scene)
        controller = ET.parse(ROOT / 'ios/App/App/Base.lproj/Main.storyboard').find('.//viewController')
        self.assertEqual(controller.attrib['customClass'], 'JianlibaoBridgeViewController')
        self.assertEqual(controller.attrib['customModule'], 'App')
        project = (ROOT / 'ios/App/App.xcodeproj/project.pbxproj').read_text(encoding='utf-8-sig')
        self.assertIn('JianlibaoSyncKeychain.swift in Sources', re.search(r'/\* Begin PBXSourcesBuildPhase section \*/(.*?)/\* End PBXSourcesBuildPhase section \*/', project, re.S).group(1))

    def test_secret_service_is_device_only_and_does_not_log_or_fall_back_to_files(self):
        source = (ROOT / 'ios/App/App/JianlibaoSyncKeychain.swift').read_text(encoding='utf-8-sig')
        self.assertIn('kSecAttrAccessibleWhenUnlockedThisDeviceOnly', source)
        self.assertIn('kSecAttrSynchronizable as String: false', source)
        self.assertIn('com.jianlibao.app.cloud-sync.v1', source)
        self.assertIn('SecItemUpdate', source)
        for forbidden in ('UserDefaults', 'FileManager', 'print(', 'NSUbiquitousKeyValueStore', 'kSecAttrAccessibleAlways'):
            self.assertNotIn(forbidden, source)

    def test_bridge_method_contract_matches_typescript(self):
        source = (ROOT / 'ios/App/App/JianlibaoSyncKeychain.swift').read_text(encoding='utf-8-sig')
        runtime = (ROOT / 'src/platform/native-runtime.ts').read_text(encoding='utf-8-sig')
        self.assertIn("registerPlugin<SyncKeychain>('JianlibaoSyncKeychain')", runtime)
        self.assertIn('jsName = "JianlibaoSyncKeychain"', source)
        for method in ('read', 'write', 'remove'):
            self.assertIn(f'CAPPluginMethod(name: "{method}", returnType: CAPPluginReturnPromise)', source)
            self.assertRegex(source, rf'@objc func {method}\(')


if __name__ == '__main__':
    unittest.main()
