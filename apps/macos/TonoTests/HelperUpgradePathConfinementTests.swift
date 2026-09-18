import XCTest
@testable import Tono

final class HelperUpgradePathConfinementTests: XCTestCase {
    func testRejectPathOutsideAppBundle() {
        let externalPaths = [
            "/tmp/tono-core-helper",
            "/Users/shared/sing-box",
            "/var/run/tono-core/service.sock",
            "/Applications/Tono/tono-core-helper"
        ]

        for path in externalPaths {
            XCTAssertFalse(
                HelperPathConfinement.isBundleConfined(path: path),
                "Path \(path) should not be considered bundle confined"
            )
            XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(path)) { error in
                guard let confinementError = error as? HelperPathConfinement.Error else {
                    return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
                }
                XCTAssertEqual(confinementError, .notInAppBundle(path))
            }
        }
    }

    func testRejectPathTraversal() {
        let fakeBundle = "/Applications/Tono.app"
        let traversalPath = "/Applications/Tono.app/Contents/Resources/../../MacOS/Tono"
        XCTAssertFalse(HelperPathConfinement.isBundleConfined(path: traversalPath, bundlePath: fakeBundle))
        XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(traversalPath, bundlePath: fakeBundle)) { error in
            guard let confinementError = error as? HelperPathConfinement.Error else {
                return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
            }
            XCTAssertEqual(confinementError, .pathTraversal(traversalPath))
        }
    }

    func testRejectMissingFileInAppBundle() {
        let fakeBundle = "/Applications/Tono.app"
        let missingPath = "/Applications/Tono.app/Contents/Resources/nonexistent-binary"
        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: missingPath, bundlePath: fakeBundle))
        XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(missingPath, bundlePath: fakeBundle)) { error in
            guard let confinementError = error as? HelperPathConfinement.Error else {
                return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
            }
            XCTAssertEqual(confinementError, .cannotSafelyOpen(missingPath))
        }
    }

    func testRejectSymlinkEscapingAppBundle() throws {
        let tempRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let tempApp = tempRoot.appendingPathComponent("Test.app")
        let tempContents = tempApp.appendingPathComponent("Contents").appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: tempContents, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let externalTarget = tempRoot.appendingPathComponent("external-binary")
        try "external content".write(to: externalTarget, atomically: true, encoding: .utf8)

        let symlinkFile = tempContents.appendingPathComponent("symlink-target")
        try FileManager.default.createSymbolicLink(at: symlinkFile, withDestinationURL: externalTarget)

        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: symlinkFile.path, bundlePath: tempApp.path))
        XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(symlinkFile.path, bundlePath: tempApp.path)) { error in
            guard let confinementError = error as? HelperPathConfinement.Error else {
                return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
            }
            XCTAssertEqual(confinementError, .escapesBundle(symlinkFile.path))
        }
    }

    func testAcceptRegularFileInsideAppBundle() throws {
        let tempRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let tempApp = tempRoot.appendingPathComponent("Test.app")
        let tempContents = tempApp.appendingPathComponent("Contents").appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: tempContents, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let regularFile = tempContents.appendingPathComponent("tono-core-helper")
        try "dummy binary content".write(to: regularFile, atomically: true, encoding: .utf8)

        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: regularFile.path, bundlePath: tempApp.path))
        XCTAssertNoThrow(try HelperPathConfinement.validateUpgradePath(regularFile.path, bundlePath: tempApp.path))
    }
}
