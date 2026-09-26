import AppKit
import Darwin
import ScreenCaptureKit
import XCTest
@testable import Tono

@MainActor
final class NativeUpdateCallerTests: XCTestCase {
    private enum Failure: Error { case preparation, lostAcknowledgement }

    private func status(_ phase: UpdateContractV1.Phase, execution: String) -> HelperManager.UpdateStatus {
        let receipt = UpdateContractV1.Receipt(attemptId: String(repeating: "a", count: 64), blockedReason: nil,
            createdAtUnix: 100, expiresAtUnix: 200, initiatingGeneration: 1,
            installedLocationSha256: String(repeating: "b", count: 64), kind: "tonoUpdateReceipt",
            manifestSha256: String(repeating: "c", count: 64), owner: "fixture", phase: phase,
            protocolVersion: 1, requiredRecovery: .protectedOffline, successorGeneration: nil,
            targetId: .macosArm64, updatedAtUnix: 100)
        return .init(pending: true, receipt: receipt, execution: execution, disconnectVerified: false, diagnostic: nil)
    }

    func testNativeCallerNeverExecutesAfterPreparationFailure() async throws {
        var calls = [String]()
        do {
            _ = try await NativeUpdatePreparation.run(
                stage: { calls.append("private-stage"); return self.status(.preparing, execution: "staged") },
                suspend: { calls.append("suspend") },
                prepare: { calls.append("prepare"); throw Failure.preparation },
                execute: { calls.append("execute"); return self.status(.installationAuthorized, execution: "consumed") },
                query: { calls.append("query"); return self.status(.preparing, execution: "staged") }
            )
            XCTFail("Preparation failure must abort the caller")
        } catch Failure.preparation {}
        XCTAssertEqual(calls, ["private-stage", "suspend", "prepare"])
    }

    func testFailedPreparationWithArmedBarrierReadsAsBlocked() async {
        // H16-O-F4: after suspension the session reads offline while PF stays armed.
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.isConnected = false
        app.isProtectionBlocked = false
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("tono-missing-" + UUID().uuidString)
        do {
            try await app.installNativeUpdate(manifest: Data(), signature: Data(), package: missing)
            XCTFail("A missing package must fail before installation")
        } catch {}
        XCTAssertTrue(app.isProtectionBlocked, "an armed barrier must not read as Standby")
    }

    func testLostConsumptionAcknowledgementQueriesWithoutSecondExecution() async throws {
        var executions = 0
        var queries = 0
        let result = try await NativeUpdatePreparation.run(
            stage: { self.status(.preparing, execution: "staged") }, suspend: {},
            prepare: { self.status(.installationAuthorized, execution: "staged") },
            execute: { executions += 1; throw Failure.lostAcknowledgement },
            query: { queries += 1; return self.status(.installationAuthorized, execution: "consumed") }
        )
        XCTAssertEqual(executions, 1)
        XCTAssertEqual(queries, 1)
        XCTAssertEqual(result.execution, "consumed")
    }

    func testDownloadedTemporaryPathContainsNoLinkedAncestors() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tono-update-path-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let package = directory.appendingPathComponent("package.zip")
        let bytes = Data("downloaded-package".utf8)
        try bytes.write(to: package)
        let physical = try HelperManager.updatePackagePath(package)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: physical)), bytes)
        var ancestor = ""
        for part in physical.split(separator: "/") {
            ancestor += "/" + part
            var metadata = stat()
            XCTAssertEqual(lstat(ancestor, &metadata), 0)
            XCTAssertNotEqual(metadata.st_mode & mode_t(S_IFMT), mode_t(S_IFLNK),
                              "App sent a linked path that the no-follow Helper must refuse")
        }
        XCTAssertThrowsError(try HelperManager.updatePackagePath(package.appendingPathExtension("missing")))
    }

    func testNativeUpdateOfferAndFailureRender() async throws {
        let offer = AppUpdater.offerAlert(version: "0.0.73")
        XCTAssertEqual(offer.buttons.map(\.title), ["Install and Restart", "Not Now"])
        try await capture(offer, name: "native-update-offer")
        let failure = AppUpdater.failureAlert(detail: "Update consumption is uncertain. Network protection and recovery evidence remain in place.")
        XCTAssertEqual(failure.buttons.map(\.title), ["OK"])
        try await capture(failure, name: "native-update-incomplete")
        let retry = AppUpdater.failureAlert(detail: "Private package bytes do not match the signed target.", retryable: true)
        XCTAssertEqual(retry.buttons.map(\.title), ["Keep Protection", "Disconnect and Retry"])
        try await capture(retry, name: "native-update-retry")
    }

    private func capture(_ alert: NSAlert, name: String) async throws {
        alert.layout()
        let window = alert.window
        window.appearance = NSAppearance(named: .aqua)
        window.center()
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        let view = try XCTUnwrap(window.contentView)
        view.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        // cacheDisplay produced only the icon: macOS 26 alerts use compositor
        // layers. Capture this process's actual window, never the desktop or
        // another application's content, and do not request capture privileges.
        let content = try await SCShareableContent.currentProcess
        let target = try XCTUnwrap(content.windows.first { $0.windowID == CGWindowID(window.windowNumber) })
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(window.frame.width * 2)
        configuration.height = Int(window.frame.height * 2)
        configuration.scalesToFit = true
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let bitmap = NSBitmapImageRep(cgImage: image)
        let center = try XCTUnwrap(bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2))
        XCTAssertGreaterThan(center.alphaComponent, 0, "Icon-only capture is not visual evidence")
        let bytes = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(bytes.count, 5_000)
        let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-results/renders")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try bytes.write(to: directory.appendingPathComponent(name + ".png"))
        let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
