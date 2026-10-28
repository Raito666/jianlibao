import Capacitor
import Security
import Foundation

/// This service stores only 48-byte recovery secrets. The common base remains in
/// the app's SQLite metadata; neither is part of the ordinary JSON backup.
@objc(JianlibaoSyncKeychainPlugin)
public final class JianlibaoSyncKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JianlibaoSyncKeychainPlugin"
    public let jsName = "JianlibaoSyncKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let slot = call.getString("slot"),
              slot.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            call.reject("同步密钥引用无效")
            return nil
        }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.jianlibao.app.cloud-sync.v1",
            kSecAttrAccount as String: slot,
            kSecAttrSynchronizable as String: false
        ]
    }

    @objc func read(_ call: CAPPluginCall) {
        guard var request = query(call) else { return }
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
        } else if status == errSecSuccess, let data = result as? Data,
                  let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.reject("无法读取同步密钥，请解锁设备后重试（\(status)）")
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let request = query(call) else { return }
        guard let value = call.getString("value"),
              value.range(of: "^JLB1-[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            call.reject("同步密钥格式无效")
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var item = request
        for (key, attribute) in attributes { item[key] = attribute }
        var status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(request as CFDictionary, attributes as CFDictionary)
        }
        guard status == errSecSuccess else {
            call.reject("同步密钥未保存，原连接仍保留，请解锁设备后重试（\(status)）")
            return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let request = query(call) else { return }
        let status = SecItemDelete(request as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("同步密钥未移除，请解锁设备后重试（\(status)）")
            return
        }
        call.resolve()
    }
}

@objc(JianlibaoBridgeViewController)
class JianlibaoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(JianlibaoSyncKeychainPlugin())
    }
}
