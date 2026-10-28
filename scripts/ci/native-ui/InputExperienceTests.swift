// Appended to the existing XCTest helpers in a generated, UI-only test harness.
extension NativeAcceptanceTests {
    @MainActor
    private func inputDismiss(_ app: XCUIApplication) {
        let dismiss = button(app, "收起键盘")
        XCTAssertTrue(dismiss.waitForExistence(timeout: 5) && dismiss.isHittable)
        dismiss.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(dismiss.waitForNonExistence(timeout: 5))
    }

    @MainActor
    private func focusInput(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let field = input(app, label)
        reveal(app, field)
        // Native isHittable can be true with only a clipped slice visible. The
        // review trace had frame y46..146 while the scroller clipped above y83;
        // XCTest's default activation did not focus it. Reveal the complete
        // field through actual drags before tapping, never JS/programmatic focus.
        let usable = app.frame.insetBy(dx: 16, dy: 160)
        for _ in 0..<6 {
            let frame = field.frame
            if usable.contains(frame) { break }
            let distance: CGFloat = frame.minY < usable.minY
                ? min(180, usable.minY - frame.minY + 16)
                : -min(180, frame.maxY - usable.maxY + 16)
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: distance)))
        }
        if !usable.contains(field.frame) { try? record(app, "input-focus-incomplete") }
        XCTAssertTrue(usable.contains(field.frame), "The complete input must be visible before a real tap")
        print("JLB_FOCUS_GEOMETRY field=\(field.frame) web=\(app.webViews.firstMatch.frame) app=\(app.frame)")
        try? record(app, "input-focus-before-tap")
        field.tap()
        let keyboardAppeared = app.keyboards.firstMatch.waitForExistence(timeout: 5)
        if !keyboardAppeared { try? record(app, "input-focus-failure") }
        XCTAssertTrue(keyboardAppeared, "Tapping the visible field must open the real software keyboard")
        // A fresh simulator may show the OS QuickPath introduction on its first text keyboard.
        let introduction = app.otherElements["UIContinuousPathIntroductionView"]
        if introduction.exists {
            let proceed = introduction.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Continue", "继续")).firstMatch
            XCTAssertTrue(proceed.isHittable)
            proceed.tap()
            XCTAssertTrue(introduction.waitForNonExistence(timeout: 5))
        }
        XCTAssertTrue(button(app, "收起键盘").waitForExistence(timeout: 5))
        return field
    }

    @MainActor
    private func typeInput(_ field: XCUIElement, _ value: String) {
        let previous = field.value as? String ?? ""
        if !previous.isEmpty && previous != field.placeholderValue {
            // A tap may put the caret before the initial 0/10. Select the existing
            // number through the actual UI before deleting, rather than assuming an end caret.
            field.doubleTap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: min(previous.count + 2, 128)))
        }
        field.typeText(value)
        XCTAssertEqual(field.value as? String, value)
    }

    @MainActor
    private func visibleInput(_ app: XCUIApplication, _ field: XCUIElement) {
        let next = button(app, "下一项"), dismiss = button(app, "收起键盘")
        let keyboard = app.keyboards.firstMatch
        try? record(app, "input-active-geometry")
        print("JLB_INPUT_GEOMETRY field=\(field.frame) next=\(next.frame) dismiss=\(dismiss.frame) keyboard=\(keyboard.frame)")
        let visible = NSPredicate { _, _ in
            field.frame.minY >= 64 && field.frame.maxY <= next.frame.minY + 1 &&
            dismiss.frame.maxY <= keyboard.frame.minY + 1
        }
        let expected = XCTNSPredicateExpectation(predicate: visible, object: field)
        let result = XCTWaiter.wait(for: [expected], timeout: 8)
        if result != .completed { try? record(app, "input-failure-geometry") }
        XCTAssertEqual(result, .completed, "Complete field and accessory must remain visible above the keyboard")
        // Query native hit points only after the keyboard/window geometry settles.
        // XCTest can throw while WebKit moves an element between snapshots.
        XCTAssertTrue(field.isHittable && next.isHittable && dismiss.isHittable,
                      "Visible field and accessory must also remain hittable")
        XCTAssertGreaterThanOrEqual(dismiss.frame.height, 44)
    }

    @MainActor
    private func numericKeyboard(_ app: XCUIApplication, decimal: Bool) {
        let keyboard = app.keyboards.firstMatch
        for digit in ["1", "5", "9"] {
            XCTAssertTrue(keyboard.keys[digit].exists, "Numeric keyboard digit: " + digit)
        }
        XCTAssertFalse(keyboard.keys["q"].exists, "Expected numeric rather than alphabetic keyboard")
        if decimal { XCTAssertTrue(keyboard.keys["."].exists, "Decimal keyboard separator in en_US simulator") }
    }

    @MainActor
    private func bodyChrome(_ app: XCUIApplication) {
        let title = app.staticTexts.matching(NSPredicate(format: "label == %@", "记录身体数据")).firstMatch
        XCTAssertGreaterThanOrEqual(title.frame.minY, 64, "Portrait iPhone 16 title must clear the status bar")
        let date = app.otherElements.matching(NSPredicate(format: "label == %@", "记录日期")).firstMatch
        XCTAssertTrue(date.exists)
        XCTAssertLessThanOrEqual(date.frame.maxX, button(app, "关闭弹窗").frame.maxX + 1, "Native date must stay inside form content")
    }

    @MainActor
    func testIosInputCreate() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "input-last-observed") }
        app.activate()
        XCTAssertTrue(button(app, "开始今天的训练").waitForExistence(timeout: 45))
        try record(app, "input-home-dark")
        tapVisible(app, "我")
        tapVisible(app, "记录身体数据")
        let weight = focusInput(app, "体重 (kg)")
        bodyChrome(app)
        numericKeyboard(app, decimal: true)
        typeInput(weight, "72.4")
        visibleInput(app, weight)
        XCTAssertFalse(button(app, "上一项").isEnabled, "Native date picker is excluded from text navigation")
        try record(app, "input-body-decimal-dark")
        tap(app, "下一项")
        let fat = input(app, "体脂率 (%)")
        typeInput(fat, "18.5")
        visibleInput(app, fat)
        tap(app, "上一项")
        weight.typeText("1")
        XCTAssertEqual(weight.value as? String, "72.41", "Previous navigated back to weight")
        weight.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(weight.value as? String, "72.4")
        inputDismiss(app)
        XCTAssertTrue(button(app, "保存身体记录").exists, "Dismiss must leave the unsaved form open")
        tapVisible(app, "补充围度 · cm")
        let waist = focusInput(app, "腰围 (cm)")
        typeInput(waist, "80")
        visibleInput(app, waist)
        try record(app, "input-body-waist-dark")
        inputDismiss(app)
        let note = focusInput(app, "备注（可选）")
        typeInput(note, "SIM-INPUT-20261023\n第二行")
        XCTAssertTrue((note.value as? String ?? "").contains("\n"), "Textarea Enter must retain its newline")
        XCTAssertFalse(button(app, "下一项").isEnabled, "Last visible field must not wrap")
        visibleInput(app, note)
        try record(app, "input-body-note-dark")
        inputDismiss(app)
        tapVisible(app, "保存身体记录")
        expectText(app, "72.4")
        try record(app, "input-body-saved")
        tapVisible(app, "切换主题")
        tapVisible(app, "记录身体数据")
        let lightWeight = focusInput(app, "体重 (kg)")
        bodyChrome(app)
        visibleInput(app, lightWeight)
        try record(app, "input-body-decimal-light")
        inputDismiss(app)
        tapVisible(app, "取消")
        tapVisible(app, "切换主题")
        tapVisible(app, "今天")
        tapVisible(app, "开始今天的训练")
        tapVisible(app, "确认开始训练")
        let weightLabel = "杠铃深蹲第1组总重量", repsLabel = "杠铃深蹲第1组次数"
        let setWeight = focusInput(app, weightLabel)
        numericKeyboard(app, decimal: true)
        typeInput(setWeight, "37.5")
        visibleInput(app, setWeight)
        try record(app, "input-training-weight-dark")
        tap(app, "下一项")
        let reps = input(app, repsLabel)
        numericKeyboard(app, decimal: false)
        typeInput(reps, "9")
        XCTAssertEqual(input(app, weightLabel).value as? String, "37.5")
        visibleInput(app, reps)
        try record(app, "input-training-reps-dark")
        tap(app, "上一项")
        visibleInput(app, setWeight)
        setWeight.typeText("1")
        XCTAssertEqual(setWeight.value as? String, "37.51")
        setWeight.typeText(XCUIKeyboardKey.delete.rawValue)
        inputDismiss(app)
        XCTAssertTrue(button(app, "完成杠铃深蹲第1组").exists, "Dismiss must not complete the set")
        tapVisible(app, "增加" + weightLabel)
        tapVisible(app, "减少" + repsLabel)
        XCTAssertEqual(input(app, weightLabel).value as? String, "40")
        XCTAssertEqual(input(app, repsLabel).value as? String, "8")
        tapVisible(app, "完成杠铃深蹲第1组")
        tapVisible(app, "跳过休息")
        tapVisible(app, "提前回顾")
        try record(app, "input-review-before-focus")
        let trainingNote = focusInput(app, "训练感受 / 备注")
        typeInput(trainingNote, "SIM-INPUT-TRAIN-20261023")
        let caption = app.staticTexts.matching(NSPredicate(format: "label == %@", "训练感受 / 备注")).allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(caption.count, 2, "The field and accessory must both use the concise caption")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "训练感受 / 备注SIM-INPUT")).firstMatch.exists,
                       "The accessory caption must not copy the entered note")
        visibleInput(app, trainingNote)
        try record(app, "input-training-note-dark")
        inputDismiss(app)
        tapVisible(app, "保存训练")
        try record(app, "input-training-saved")
    }

    @MainActor
    func testIosInputPersist() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.jianlibao.app")
        defer { try? record(app, "input-persist-last-observed") }
        app.activate()
        XCTAssertTrue(button(app, "开始今天的训练").waitForExistence(timeout: 45))
        tapVisible(app, "我")
        expectText(app, "72.4")
        expectText(app, "18.5")
        expectText(app, "80")
        expectText(app, "SIM-INPUT-20261023")
        try record(app, "input-persist-body")
        tapVisible(app, "进步")
        tapVisible(app, "训练历史")
        replace(app, "搜索训练历史", "SIM-INPUT-TRAIN-20261023")
        tapMatching(app, "查看全身基础", containing: "训练明细")
        expectText(app, "杠铃深蹲")
        expectText(app, "40")
        expectText(app, "8")
        try record(app, "input-persist-training")
        let close = button(app, "关闭弹窗")
        XCTAssertGreaterThanOrEqual(close.frame.minY, 64, "History close must clear the status bar")
        tapVisible(app, "关闭弹窗")
        XCTAssertTrue(close.waitForNonExistence(timeout: 5), "History detail must actually close")
        dismissKeyboard(app)
        tapVisible(app, "今天")
        try record(app, "input-persist-home")
    }
}
