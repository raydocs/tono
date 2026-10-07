import XCTest
@testable import Tono

final class BRICKM1OrdinaryInstallGuardTests: XCTestCase {
    func testPendingAttemptRefusesOrdinaryInstall() throws {
        let helper = try XCTUnwrap(Bundle.main.resourceURL)
            .appendingPathComponent("tono-core-helper")
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: helper.path))

        let process = Process()
        process.executableURL = helper
        process.arguments = ["--update-install-policy-self-test"]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        process.waitUntilExit()

        XCTAssertEqual(process.terminationStatus, 0)
        XCTAssertEqual(
            String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8),
            "PASS update ordinary-install policy\n"
        )
    }
}
