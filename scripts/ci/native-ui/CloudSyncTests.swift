import XCTest

/// Future real-Simulator checks. The runner never receives or types recovery-key text.
final class NativeCloudSyncTests: XCTestCase {
    @MainActor private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", label, label)
        let normal = app.buttons.matching(predicate).firstMatch
        return normal.exists ? normal : app.switches.matching(predicate).firstMatch
    }

    @MainActor private func tap(_ app: XCUIApplication, _ label: String) {
        let target = button(app, label)
        XCTAssertTrue(target.waitForExistence(timeout: 30), "Missing labelled control")
        for _ in 0..<16 {
            if target.isHittable && target.frame.maxY < app.frame.maxY - 76 && target.frame.minY > 80 { break }
            let distance = max(-200, min(200, app.frame.midY - target.frame.midY))
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)), withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTAssertTrue(target.isHittable && target.isEnabled, "Control must be hittable and enabled")
        target.tap()
    }

    @MainActor private func settings(_ app: XCUIApplication) {
        app.activate()
        let navigation = button(app, "我")
        XCTAssertTrue(navigation.waitForExistence(timeout: 45) && navigation.isHittable)
        navigation.tap()
    }

    @MainActor private func sync(_ app: XCUIApplication) {
        let target = button(app, "立即同步")
        XCTAssertTrue(target.waitForExistence(timeout: 30))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in target.isEnabled }, object: target)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 30), .completed)
        tap(app, "立即同步")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in target.isEnabled }, object: target)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "最近同步")).firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "需要选择版本")).firstMatch.exists)
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) throws {
        XCTAssertFalse(app.secureTextFields["同步密钥"].exists, "Never capture a key-entry dialog")
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("jlb-cloud-ui", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try app.screenshot().pngRepresentation.write(to: directory.appendingPathComponent(name + ".png"))
    }

    @MainActor func testCloudConnectAndModify() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        settings(app); tap(app, "连接已有同步")
        let field = app.secureTextFields["同步密钥"]
        XCTAssertTrue(field.waitForExistence(timeout: 10) && field.isHittable)
        field.tap(); field.press(forDuration: 1.1)
        let predicate = NSPredicate(format: "label == %@ OR label == %@", "粘贴", "Paste")
        let menu = app.menuItems.matching(predicate).firstMatch
        let paste = menu.waitForExistence(timeout: 3) ? menu : app.buttons.matching(predicate).firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5) && paste.isHittable)
        paste.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "允许粘贴", "Allow Paste")).firstMatch
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        let dismiss = button(app, "收起键盘")
        if dismiss.exists && dismiss.isHittable { dismiss.tap() }
        tap(app, "连接并合并")
        XCTAssertTrue(field.waitForNonExistence(timeout: 30))
        sync(app)
        try capture(app, "cloud-connected")
        tap(app, "编辑2026-10-27身体记录")
        let weight = app.textFields["体重 (kg)"]
        XCTAssertTrue(weight.waitForExistence(timeout: 10) && weight.isHittable)
        weight.tap()
        let previous = weight.value as? String ?? ""
        weight.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min(64, previous.count + 2)))
        weight.typeText("74")
        XCTAssertEqual(weight.value as? String, "74")
        let closeKeyboard = button(app, "收起键盘")
        if closeKeyboard.exists && closeKeyboard.isHittable { closeKeyboard.tap() }
        tap(app, "保存身体记录"); sync(app)
        try capture(app, "cloud-native-saved")
    }

    @MainActor func testCloudConnectionRetained() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        settings(app)
        XCTAssertFalse(button(app, "连接已有同步").exists, "Persisted connection must load without entering a key again")
        sync(app)
        try capture(app, "cloud-retained")
    }

    @MainActor func testCloudDisconnectRetainsLocalRecords() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        settings(app); tap(app, "断开本机同步"); tap(app, "确认断开")
        XCTAssertTrue(button(app, "连接已有同步").waitForExistence(timeout: 10))
        try capture(app, "cloud-disconnected")
    }
}
