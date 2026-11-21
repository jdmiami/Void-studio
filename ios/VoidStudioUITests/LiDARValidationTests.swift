import XCTest

final class LiDARValidationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSimulatorShowsLiDARUnavailableAndReturnsToStudio() throws {
        #if targetEnvironment(simulator)
        let app = XCUIApplication()
        app.launch()
        openLiDAR(in: app)

        XCTAssertTrue(status(in: app, containing: "LiDAR unavailable").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Use Studio for camera effects on this device."].exists)
        XCTAssertFalse(app.buttons["Record"].exists)

        app.segmentedControls.firstMatch.buttons.element(boundBy: 0).tap()
        let openStudio = app.buttons["Open Studio"]
        XCTAssertTrue(openStudio.waitForExistence(timeout: 5))
        openStudio.tap()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(status(in: app, containing: "LiDAR unavailable").exists)
        #else
        throw XCTSkip("The no-sensor fallback is tested on an iPad Pro simulator.")
        #endif
    }

    @MainActor
    func testPhysicalLiDARMeasuresAndRecords() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("A physical iPad Pro or iPhone with a rear LiDAR scanner is required.")
        #else
        let app = XCUIApplication()
        app.launch()
        openLiDAR(in: app)

        // The device owner can tap Allow on the system prompt while the test waits.
        let live = status(in: app, containing: "LiDAR live")
        XCTAssertTrue(live.waitForExistence(timeout: 45), "Allow Camera and aim the rear camera at a nearby surface.")

        let preview = app.images["lidar-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 8))
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).tap()
        let distance = app.staticTexts["lidar-distance"]
        XCTAssertTrue(distance.waitForExistence(timeout: 15), "No valid depth sample at the selected point.")
        let reading = distance.label
        let number = reading.range(of: #"[0-9]+([.,][0-9]+)?"#, options: .regularExpression)
        let metres = number.flatMap { Double(reading[$0].replacingOccurrences(of: ",", with: ".")) }
        XCTAssertGreaterThan(metres ?? 0, 0, "Expected a positive distance in metres.")

        let record = app.buttons["Record"]
        XCTAssertTrue(record.isEnabled)
        record.tap()
        XCTAssertTrue(status(in: app, containing: "Recording").waitForExistence(timeout: 10))
        let stop = app.buttons["Stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        stop.tap()
        XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 20), "The LiDAR movie did not finish saving.")
        XCTAssertTrue(live.waitForExistence(timeout: 10))
        #endif
    }

    @MainActor
    private func openLiDAR(in app: XCUIApplication) {
        let selector = app.segmentedControls.firstMatch
        XCTAssertTrue(selector.waitForExistence(timeout: 15))
        selector.buttons.element(boundBy: 1).tap()
        let confirm = app.buttons["Open LiDAR"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 8))
        confirm.tap()
    }

    @MainActor
    private func status(in app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(identifier: "lidar-status")
            .matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
}
