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

    func testRejectMissingFileInAppBundle() {
        let missingPath = "/Applications/Tono.app/Contents/Resources/nonexistent-binary"
        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: missingPath))
        XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(missingPath)) { error in
            guard let confinementError = error as? HelperPathConfinement.Error else {
                return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
            }
            XCTAssertEqual(confinementError, .cannotSafelyOpen(missingPath))
        }
    }

    func testRejectSymlinkInAppBundle() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("Test.app")
            .appendingPathComponent("Contents")
            .appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: tempDir.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent())
        }

        let realFile = tempDir.appendingPathComponent("real-target")
        try "dummy binary content".write(to: realFile, atomically: true, encoding: .utf8)

        let symlinkFile = tempDir.appendingPathComponent("symlink-target")
        try FileManager.default.createSymbolicLink(at: symlinkFile, withDestinationURL: realFile)

        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: symlinkFile.path))
        XCTAssertThrowsError(try HelperPathConfinement.validateUpgradePath(symlinkFile.path)) { error in
            guard let confinementError = error as? HelperPathConfinement.Error else {
                return XCTFail("Expected HelperPathConfinement.Error, got \(error)")
            }
            XCTAssertEqual(confinementError, .cannotSafelyOpen(symlinkFile.path))
        }
    }

    func testAcceptRegularFileInsideAppBundle() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("Test.app")
            .appendingPathComponent("Contents")
            .appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: tempDir.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent())
        }

        let regularFile = tempDir.appendingPathComponent("tono-core-helper")
        try "dummy binary content".write(to: regularFile, atomically: true, encoding: .utf8)

        XCTAssertTrue(HelperPathConfinement.isBundleConfined(path: regularFile.path))
        XCTAssertNoThrow(try HelperPathConfinement.validateUpgradePath(regularFile.path))
    }
}
