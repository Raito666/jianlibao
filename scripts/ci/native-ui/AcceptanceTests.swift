import XCTest

final class NativeAcceptanceTests: XCTestCase {
    @MainActor
    private func record(_ app: XCUIApplication, _ name: String) throws {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("jlb-ui", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try app.screenshot().pngRepresentation.write(to: directory.appendingPathComponent(name + ".png"))
        try app.debugDescription.write(to: directory.appendingPathComponent(name + ".txt"), atomically: true, encoding: .utf8)
        print("JLB_UI_STATE " + name + "\n" + app.debugDescription)
    }

    @MainActor
    private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", label, label)
        // WKWebView maps aria-pressed buttons to native Switch elements.
        for query in [app.buttons, app.switches] {
            let candidate = query.matching(predicate).firstMatch
            if candidate.exists { return candidate }
        }
        return app.descendants(matching: .any).matching(predicate).firstMatch
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ label: String) {
        let element = button(app, label)
        if !element.waitForExistence(timeout: 30) {
            try? record(app, "failure-missing-button")
        }
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing native button: " + label)
        XCTAssertTrue(element.isHittable, "Native button is not hittable: " + label)
        element.tap()
    }

    @MainActor
    func testProbe() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        app.activate()
        try record(app, "00-before-ready")
        XCTAssertTrue(button(app, "开始今天的训练").waitForExistence(timeout: 45))
        try record(app, "01-home")
        tap(app, "开始今天的训练")
        XCTAssertTrue(button(app, "确认开始训练").waitForExistence(timeout: 10))
        try record(app, "02-start-preview")
        tap(app, "暂不开始")
        tap(app, "动作")
        try record(app, "03-exercises")
        tap(app, "进步")
        try record(app, "04-progress")
        tap(app, "我")
        try record(app, "05-settings")
        let body = button(app, "记录身体数据")
        for _ in 0..<5 {
            if body.isHittable { break }
            app.webViews.firstMatch.swipeUp()
        }
        tap(app, "记录身体数据")
        try record(app, "06-body-form")
        let field = app.textFields.matching(NSPredicate(format: "label CONTAINS %@ OR identifier CONTAINS %@", "体重", "体重")).firstMatch
        XCTAssertTrue(field.exists, "Body weight field must have a native accessibility label")
        field.tap()
        field.typeText("72.4")
        try record(app, "07-body-keyboard")
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        if !element.waitForExistence(timeout: 10) {
            try? record(app, "failure-missing-element")
            XCTFail("Missing native element: " + element.debugDescription)
            return
        }
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            app.webViews.firstMatch.swipeUp()
        }
        for _ in 0..<18 {
            if element.exists && element.isHittable { return }
            app.webViews.firstMatch.swipeDown()
        }
        try? record(app, "failure-reveal")
        XCTFail("Cannot reveal actual native element: " + element.debugDescription)
    }

    @MainActor
    private func visibleTargetBounds(_ app: XCUIApplication, _ element: XCUIElement) -> (top: CGFloat, bottom: CGFloat) {
        let close = button(app, "关闭弹窗")
        if close.exists {
            let train = button(app, "从这个动作开练")
            let isGuideFooter = element.label == "从这个动作开练" || element.label == "收藏动作"
            return (close.frame.maxY + 12,
                    train.exists && !isGuideFooter ? train.frame.minY - 12 : app.frame.maxY - 52)
        }
        let navigation = app.otherElements.matching(NSPredicate(format: "label == %@", "移动端导航, navigation")).firstMatch
        let navigationLabels = ["今天", "计划", "动作", "进步", "我"]
        if navigation.exists && navigationLabels.contains(element.label) {
            // The fixed navigation itself occupies the screen's safe-area
            // container; content-inset limits do not apply to its buttons.
            return (max(80, navigation.frame.minY), min(app.frame.maxY, navigation.frame.maxY))
        }
        var bottom = app.frame.maxY - 52
        let rest = app.otherElements.matching(NSPredicate(format: "label == %@", "组间休息, region")).firstMatch
        if rest.exists {
            let insideRest = rest.descendants(matching: .any).matching(NSPredicate(format: "label == %@", element.label)).firstMatch.exists
            let fixedAction = ["上一动作", "下一动作", "完成并回顾"].contains(element.label)
            if fixedAction { bottom = app.frame.maxY }
            else if !insideRest { bottom = min(bottom, rest.frame.minY - 32) }
        } else {
            if navigation.exists { bottom = min(bottom, navigation.frame.minY - 16) }
        }
        return (80, bottom)
    }

    @MainActor
    private func revealTapTarget(_ app: XCUIApplication, _ element: XCUIElement) {
        reveal(app, element)
        let close = button(app, "关闭弹窗")
        if close.exists && element.label == close.label { return }
        // Native hittability permits partial controls behind both modal and
        // page docks. Require the complete target in its actual scroll area.
        for _ in 0..<18 {
            let area = visibleTargetBounds(app, element)
            if element.frame.minY >= area.top && element.frame.maxY <= area.bottom { break }
            // Center the target and hold at the end of a slow drag. A short
            // 500pt/s flick overshoots both edges through scroll inertia.
            let distance = max(-180, min(180, (area.top + area.bottom) / 2 - element.frame.midY))
            print("JLB_TARGET_GEOMETRY target=\(element.frame) top=\(area.top) bottom=\(area.bottom) drag=\(distance)")
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            origin.press(forDuration: 0.1,
                         thenDragTo: origin.withOffset(CGVector(dx: 0, dy: distance)),
                         withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        let area = visibleTargetBounds(app, element)
        if element.frame.minY < area.top || element.frame.maxY > area.bottom {
            try? record(app, "failure-target-bounds")
        }
        XCTAssertGreaterThanOrEqual(element.frame.minY, area.top,
                                    "Tap target must completely clear the actual header")
        XCTAssertLessThanOrEqual(element.frame.maxY, area.bottom,
                                 "Complete target must clear the actual fixed dock")
    }

    @MainActor
    private func tapVisible(_ app: XCUIApplication, _ label: String) {
        let element = button(app, label)
        revealTapTarget(app, element)
        if label == "关闭弹窗" {
            XCTAssertGreaterThanOrEqual(element.frame.minY, 64, "Dialog close must clear the status bar")
        }
        tap(app, label)
        if label == "关闭弹窗" {
            XCTAssertTrue(element.waitForNonExistence(timeout: 5), "The dialog must actually close")
            dismissKeyboard(app)
        }
    }

    @MainActor
    private func matchingButton(_ app: XCUIApplication, _ prefix: String, containing: String = "") -> XCUIElement {
        // Foundation's CONTAINS empty-string predicate is not a no-op.
        // Keep the optional extra condition only when a real substring exists.
        let predicate = containing.isEmpty
            ? NSPredicate(format: "label BEGINSWITH %@", prefix)
            : NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", prefix, containing)
        return app.buttons.matching(predicate).firstMatch
    }

    @MainActor
    private func tapMatching(_ app: XCUIApplication, _ prefix: String, containing: String = "") {
        let element = matchingButton(app, prefix, containing: containing)
        revealTapTarget(app, element)
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    @MainActor
    private func input(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", label, label)
        for query in [app.textFields, app.searchFields, app.textViews] {
            let element = query.matching(predicate).firstMatch
            if element.exists { return element }
        }
        return app.textFields.matching(predicate).firstMatch
    }

    @MainActor
    private func dismissKeyboard(_ app: XCUIApplication) {
        if !app.keyboards.firstMatch.exists { return }
        let accessory = button(app, "收起键盘")
        if accessory.exists && accessory.isHittable {
            accessory.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
            XCTAssertTrue(accessory.waitForNonExistence(timeout: 5))
            return
        }
        // iOS 26's observed checkmark in the input accessory is labelled "selected".
        for label in ["Done", "完成", "selected", "已选择"] {
            let done = app.toolbars.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if done.exists && done.isHittable {
                done.tap()
                XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
                return
            }
        }
        try? record(app, "failure-keyboard")
        XCTFail("Expected native keyboard dismissal control")
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ label: String, _ value: String) {
        let element = input(app, label)
        reveal(app, element)
        XCTAssertTrue(element.exists, "Missing labelled editable field: " + label)
        // Keep search controls at their natural header position; center other
        // editable fields through real gestures before XCTest chooses its hit point.
        let usable = app.frame.insetBy(dx: 16, dy: label.hasPrefix("搜索") ? 80 : 160)
        for _ in 0..<6 {
            if usable.contains(element.frame) { break }
            let distance: CGFloat = element.frame.minY < usable.minY
                ? min(180, usable.minY - element.frame.minY + 16)
                : -min(180, element.frame.maxY - usable.maxY + 16)
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: distance)))
        }
        XCTAssertTrue(usable.contains(element.frame), "Complete editable field must be visible before tapping: " + label)
        element.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Real software keyboard required")
        let introduction = app.otherElements["UIContinuousPathIntroductionView"]
        if introduction.exists {
            let proceed = introduction.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Continue", "继续")).firstMatch
            XCTAssertTrue(proceed.isHittable)
            proceed.tap()
            XCTAssertTrue(introduction.waitForNonExistence(timeout: 5))
        }
        let previous = element.value as? String ?? ""
        if !previous.isEmpty && previous != element.placeholderValue {
            // Double-tapping a decimal may select only its integer component.
            // Put the caret at the current single-line field's trailing edge
            // after the keyboard/layout has settled, then verify a true clear.
            if element.elementType == .textView {
                element.doubleTap()
            } else {
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            }
            element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min(previous.count + 2, 128)))
            let cleared = element.value as? String ?? ""
            if !cleared.isEmpty && cleared != element.placeholderValue { try? record(app, "failure-input-clear") }
            XCTAssertTrue(cleared.isEmpty || cleared == element.placeholderValue,
                          "Existing native value must be completely cleared before replacement: " + label)
        }
        element.typeText(value)
        if !value.isEmpty {
            // Native typing may return before WKWebView's final accessibility
            // value snapshot catches up. Observe the complete exact value;
            // do not type again, accept a prefix, or dismiss the keyboard early.
            let exactValue = NSPredicate { _, _ in (element.value as? String ?? "") == value }
            let typedResult = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: exactValue, object: element)], timeout: 5)
            if typedResult != .completed { try? record(app, "failure-input-settle") }
            XCTAssertEqual(typedResult, .completed, "Complete native typed value must settle before dismissal: " + label)
        }
        let typed = element.value as? String ?? ""
        if !value.isEmpty && typed != value { try? record(app, "failure-input-typed") }
        if !value.isEmpty { XCTAssertEqual(typed, value, "Exact value before dismissing keyboard: " + label) }
        dismissKeyboard(app)
        let actual = element.value as? String ?? ""
        if value.isEmpty {
            XCTAssertTrue(actual.isEmpty || actual == element.placeholderValue, "Expected cleared native field: " + label)
        } else {
            if actual != value { try? record(app, "failure-input-blur") }
            XCTAssertEqual(actual, value, "Actual native typed value: " + label)
        }
    }

    @MainActor
    private func containsText(_ app: XCUIApplication, _ value: String) -> XCUIElement {
        return app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    @MainActor
    private func expectText(_ app: XCUIApplication, _ value: String) {
        let element = containsText(app, value)
        reveal(app, element)
        XCTAssertTrue(element.exists && element.isHittable, "Expected visible rendered text: " + value)
    }

    @MainActor
    private func verifyRecords(_ app: XCUIApplication, _ phase: String) throws {
        tapVisible(app, "进步")
        tapVisible(app, "训练历史")
        replace(app, "搜索训练历史", "SIM-TRAIN-20261022")
        tapMatching(app, "查看全身基础", containing: "训练明细")
        expectText(app, "杠铃深蹲")
        for value in ["40", "8", "完成", "跳过"] {
            let cell = app.staticTexts.matching(NSPredicate(format: "label == %@", value)).firstMatch
            reveal(app, cell)
            XCTAssertTrue(cell.isHittable, "Visible historical set result: " + value)
        }
        try record(app, phase + "-history-sets")
        let note = input(app, "训练备注")
        reveal(app, note)
        XCTAssertEqual(note.value as? String, "SIM-TRAIN-20261022")
        try record(app, phase + "-history-detail")
        tapVisible(app, "关闭弹窗")
        replace(app, "搜索训练历史", "")
        tapVisible(app, "统计总览")
        expectText(app, "完成训练")
        expectText(app, "正式组重量容量")
        expectText(app, "320")
        expectText(app, "kg·次")
        try record(app, phase + "-statistics")
        tapVisible(app, "动作追踪")
        // WKWebView exposes the selected <option> as the native control's
        // value, not as a StaticText child. Assert that exact visible value.
        let trendExercise = app.otherElements.matching(NSPredicate(format: "label == %@", "趋势动作")).firstMatch
        reveal(app, trendExercise)
        XCTAssertTrue(trendExercise.exists && trendExercise.isHittable)
        XCTAssertEqual(trendExercise.value as? String, "杠铃深蹲")
        expectText(app, "40 kg")
        try record(app, phase + "-exercise-tracking")
        tapVisible(app, "我")
        expectText(app, "72.6")
        expectText(app, "18.5")
        expectText(app, "80")
        expectText(app, "SIM-BODY-20261022")
        try record(app, phase + "-body-record")
        tapMatching(app, "编辑", containing: "身体记录")
        XCTAssertEqual(input(app, "体重 (kg)").value as? String, "72.6")
        XCTAssertEqual(input(app, "体脂率 (%)").value as? String, "18.5")
        tapVisible(app, "取消")
        tapVisible(app, "今天")
        try record(app, phase + "-home")
    }

    @MainActor
    func testCreateRecords() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "created-last-observed") }
        app.activate()
        XCTAssertTrue(button(app, "开始今天的训练").waitForExistence(timeout: 45))
        tapVisible(app, "动作")
        replace(app, "搜索动作", "bench")
        tapVisible(app, "查看杠铃卧推讲解")
        expectText(app, "三个要点，开始练习")
        for frame in 1...3 {
            tapVisible(app, "查看第\(frame)幅图解")
            let image = app.images.matching(NSPredicate(format: "label == %@", "杠铃卧推第\(frame)幅动作图解")).firstMatch
            XCTAssertTrue(image.waitForExistence(timeout: 15))
            reveal(app, image)
            XCTAssertTrue(image.isHittable)
            try record(app, "guide-frame-\(frame)")
        }
        tapVisible(app, "播放分步图解")
        XCTAssertTrue(button(app, "暂停图解播放").waitForExistence(timeout: 5))
        tapVisible(app, "暂停图解播放")
        tapVisible(app, "详细讲解")
        expectText(app, "动作步骤")
        expectText(app, "发力与呼吸")
        expectText(app, "常见错误")
        expectText(app, "如何记录")
        try record(app, "guide-detailed")
        tapVisible(app, "我的表现")
        expectText(app, "还没有这个动作的训练记录")
        try record(app, "guide-performance")
        tapVisible(app, "关闭弹窗")
        tapVisible(app, "我")
        tapVisible(app, "记录身体数据")
        replace(app, "体重 (kg)", "72.4")
        replace(app, "体脂率 (%)", "18.5")
        tapVisible(app, "补充围度 · cm")
        for (label, value) in [("胸围 (cm)", "98"), ("腰围 (cm)", "80"), ("臀围 (cm)", "96"), ("臂围 (cm)", "34"), ("腿围 (cm)", "55")] {
            replace(app, label, value)
        }
        replace(app, "备注（可选）", "SIM-BODY-20261022")
        try record(app, "body-create-form")
        tapVisible(app, "保存身体记录")
        expectText(app, "SIM-BODY-20261022")
        tapMatching(app, "编辑", containing: "身体记录")
        replace(app, "体重 (kg)", "72.6")
        tapVisible(app, "保存身体记录")
        expectText(app, "72.6")
        tapMatching(app, "删除", containing: "身体记录")
        XCTAssertTrue(button(app, "确认删除身体记录").waitForExistence(timeout: 5))
        tapVisible(app, "保留身体记录")
        expectText(app, "SIM-BODY-20261022")
        try record(app, "body-edited-delete-cancelled")
        tapVisible(app, "今天")
        tapVisible(app, "开始今天的训练")
        tapVisible(app, "确认开始训练")
        let weight = "杠铃深蹲第1组总重量", reps = "杠铃深蹲第1组次数"
        replace(app, weight, "37.5")
        tapVisible(app, "增加" + weight)
        XCTAssertEqual(input(app, weight).value as? String, "40")
        replace(app, reps, "9")
        tapVisible(app, "减少" + reps)
        XCTAssertEqual(input(app, reps).value as? String, "8")
        tapVisible(app, "完成杠铃深蹲第1组")
        tapVisible(app, "跳过休息")
        tapVisible(app, "撤销杠铃深蹲第1组")
        tapVisible(app, "完成杠铃深蹲第1组")
        tapVisible(app, "跳过休息")
        let copy = button(app, "复制杠铃深蹲第1组到第2组")
        reveal(app, copy)
        let restBar = app.otherElements.matching(NSPredicate(format: "label == %@", "组间休息, region")).firstMatch
        XCTAssertTrue(restBar.exists, "Actual fixed rest region must identify the training scroll boundary")
        XCTAssertGreaterThan(restBar.frame.minY, 160)
        XCTAssertLessThan(restBar.frame.maxY, app.frame.maxY)
        print("JLB_COPY_GEOMETRY target=\(copy.frame) rest=\(restBar.frame)")
        // Native isHittable can include a slice behind the persistent training
        // footer. Reveal the whole copy control before its single real tap.
        for _ in 0..<6 {
            // The review action is in the offscreen document flow, not the
            // fixed footer. The actual rest region bounds the scroll viewport;
            // its preceding gap must also remain clear of the whole target.
            let bottom = restBar.frame.minY - 32
            if copy.frame.minY >= 80 && copy.frame.maxY <= bottom { break }
            let distance: CGFloat = copy.frame.minY < 80
                ? min(180, 96 - copy.frame.minY)
                : -min(180, copy.frame.maxY - bottom + 16)
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: distance)))
        }
        try record(app, "training-copy-ready")
        XCTAssertTrue(copy.isEnabled && copy.isHittable)
        XCTAssertGreaterThanOrEqual(copy.frame.minY, 80)
        XCTAssertLessThanOrEqual(copy.frame.maxY, restBar.frame.minY - 32)
        copy.tap()
        let copied = NSPredicate { _, _ in
            (self.input(app, "杠铃深蹲第2组总重量").value as? String) == "40" &&
            (self.input(app, "杠铃深蹲第2组次数").value as? String) == "8"
        }
        let copyResult = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: copied, object: app)], timeout: 8)
        try record(app, "training-copy-result")
        XCTAssertEqual(copyResult, .completed, "One visible native copy tap must update both fields")
        XCTAssertEqual(input(app, "杠铃深蹲第2组总重量").value as? String, "40")
        XCTAssertEqual(input(app, "杠铃深蹲第2组次数").value as? String, "8")
        try record(app, "training-copied")
        tapVisible(app, "跳过杠铃深蹲第2组")
        replace(app, "动作备注", "SIM-EX-20261022")
        try record(app, "training-entered")
        tapVisible(app, "下一动作")
        expectText(app, "杠铃卧推")
        try record(app, "training-action-navigation")
        tapVisible(app, "上一动作")
        expectText(app, "杠铃深蹲")
        tapVisible(app, "暂停训练")
        tapVisible(app, "继续训练")
        tapVisible(app, "提前回顾")
        try record(app, "training-review-ready")
        XCTAssertTrue(button(app, "保存训练").waitForExistence(timeout: 5), "Review must actually open before entering its note")
        replace(app, "训练感受 / 备注", "SIM-TRAIN-20261022")
        try record(app, "training-review")
        tapVisible(app, "保存训练")
        try verifyRecords(app, "saved")
    }

    @MainActor
    func testAfterAppRelaunch() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "reopened-last-observed") }
        app.activate()
        try verifyRecords(app, "reopened")
    }

    @MainActor
    func testAfterSimulatorRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "rebooted-last-observed") }
        app.activate()
        try verifyRecords(app, "rebooted")
    }

    @MainActor
    private func choose(_ app: XCUIApplication, _ label: String, _ value: String) throws {
        let control = app.otherElements.matching(NSPredicate(format: "label == %@", label)).firstMatch
        revealTapTarget(app, control)
        control.tap()
        try record(app, "native-select-" + label)
        let wheel = app.pickerWheels.firstMatch
        if wheel.waitForExistence(timeout: 2) {
            wheel.adjust(toPickerWheelValue: value)
            let done = app.toolbars.buttons.matching(NSPredicate(format: "label == %@ OR label == %@ OR label == %@", "Done", "selected", "已选择")).firstMatch
            XCTAssertTrue(done.isHittable)
            done.tap()
        } else {
            let option = app.buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", value, value + ",")).firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            option.tap()
        }
        XCTAssertEqual(control.value as? String, value)
    }

    @MainActor
    private func expectMediaCredit(_ app: XCUIApplication, _ container: XCUIElement,
                                   author: String, license: String) {
        // WKWebView exposes these as separate text nodes. Scope exact values
        // and both links to the actual media, never another image on the page.
        revealTapTarget(app, container)
        let authorText = container.staticTexts.matching(NSPredicate(format: "label == %@", author))
        let licenseText = container.staticTexts.matching(NSPredicate(format: "label == %@", license))
        XCTAssertEqual(authorText.count, 1)
        XCTAssertEqual(licenseText.count, 1)
        let authorNode = authorText.firstMatch, licenseNode = licenseText.firstMatch
        XCTAssertTrue(authorNode.isHittable && licenseNode.isHittable)
        XCTAssertTrue(container.frame.contains(authorNode.frame))
        XCTAssertTrue(container.frame.contains(licenseNode.frame))
        XCTAssertEqual(authorNode.frame.minY, licenseNode.frame.minY, accuracy: 1)
        for label in ["原始素材", "许可"] {
            let link = container.links.matching(NSPredicate(format: "label == %@", label))
            XCTAssertEqual(link.count, 1)
            XCTAssertTrue(link.firstMatch.isHittable)
            XCTAssertTrue(container.frame.contains(link.firstMatch.frame))
        }
    }

    @MainActor
    private func imageCreditContainer(_ app: XCUIApplication, _ imageLabel: String) throws -> XCUIElement {
        let candidates = app.otherElements.allElementsBoundByIndex.filter { container in
            container.images.count == 1 &&
            container.images.matching(NSPredicate(format: "label == %@", imageLabel)).count == 1 &&
            container.staticTexts.matching(NSPredicate(format: "label == %@", "Everkinetic")).count == 1 &&
            container.staticTexts.matching(NSPredicate(format: "label == %@", "CC BY-SA 3.0")).count == 1
        }
        return try XCTUnwrap(candidates.min { $0.frame.height < $1.frame.height },
                             "Exact image and complete credit must share one native container")
    }

    @MainActor
    func testSupplementalInteractions() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "supplement-last-observed") }
        app.activate()
        tapVisible(app, "动作")
        replace(app, "搜索动作", "bench")
        tapVisible(app, "查看杠铃卧推讲解")
        tapVisible(app, "详细讲解")
        let mediaDisclosure = matchingButton(app, "图片与视频示范")
        revealTapTarget(app, mediaDisclosure)
        print("JLB_MEDIA_GEOMETRY target=\(mediaDisclosure.frame) close=\(button(app, "关闭弹窗").frame) footer=\(button(app, "从这个动作开练").frame)")
        try record(app, "media-disclosure-ready")
        XCTAssertTrue(mediaDisclosure.isHittable)
        mediaDisclosure.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        try record(app, "media-disclosure-result")
        XCTAssertTrue(button(app, "关闭弹窗").exists, "Opening media must keep the guide dialog open")
        for (index, label) in ["推起位置", "下放位置"].enumerated() {
            let imageLabel = "杠铃卧推" + label + "参考图"
            let image = app.images.matching(NSPredicate(format: "label == %@", imageLabel)).firstMatch
            revealTapTarget(app, image)
            XCTAssertTrue(image.isHittable)
            let figure = try imageCreditContainer(app, imageLabel)
            expectMediaCredit(app, figure, author: "Everkinetic", license: "CC BY-SA 3.0")
            XCTAssertTrue(figure.frame.contains(image.frame))
            XCTAssertTrue(image.isHittable)
            try record(app, "reference-image-\(index + 1)")
        }
        tapVisible(app, "加载卧推视频 · 1.4 MB")
        let video = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "杠铃卧推实拍示范")).firstMatch
        revealTapTarget(app, video)
        try record(app, "reference-video-before")
        let play = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Play", "播放")).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 10), "Native video must expose its Play control")
        play.tap()
        let pause = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Pause", "暂停")).firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        let timeline = app.sliders.firstMatch
        XCTAssertTrue(timeline.waitForExistence(timeout: 5), "Native timeline must expose playback position")
        let before = timeline.value as? String ?? ""
        XCTAssertFalse(before.isEmpty)
        let advanced = NSPredicate { _, _ in (timeline.value as? String ?? "") != before }
        expectation(for: advanced, evaluatedWith: timeline)
        waitForExpectations(timeout: 10)
        try record(app, "reference-video-playing")
        XCTAssertTrue(pause.isHittable)
        pause.tap()
        let videoRegion = app.otherElements.matching(NSPredicate(format: "label == %@", "杠铃卧推视频示范, region")).firstMatch
        XCTAssertTrue(videoRegion.exists)
        expectMediaCredit(app, videoRegion, author: "Goulart", license: "CC BY-SA 4.0")
        tapVisible(app, "关闭弹窗")
        tapVisible(app, "我")
        try choose(app, "身体趋势指标", "腰围")
        try choose(app, "身体趋势范围", "全部记录")
        expectText(app, "腰围趋势")
        try record(app, "body-trend-waist")
        tapMatching(app, "删除", containing: "身体记录")
        tapVisible(app, "确认删除身体记录")
        expectText(app, "体重、体脂或围度任选一项即可")
        XCTAssertFalse(matchingButton(app, "编辑", containing: "身体记录").exists)
        try record(app, "body-deleted-after-durability")
        tapVisible(app, "今天")
    }
}
