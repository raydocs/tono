import AppKit
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

    func testNativeUpdateOfferAndFailureRender() throws {
        let offer = AppUpdater.offerAlert(version: "0.0.73")
        XCTAssertEqual(offer.buttons.map(\.title), ["Install and Restart", "Not Now"])
        try capture(offer, name: "native-update-offer")
        let failure = AppUpdater.failureAlert(detail: "Update consumption is uncertain. Network protection and recovery evidence remain in place.")
        XCTAssertEqual(failure.buttons.map(\.title), ["OK"])
        try capture(failure, name: "native-update-incomplete")
    }

    private func capture(_ alert: NSAlert, name: String) throws {
        alert.layout()
        let window = alert.window
        window.appearance = NSAppearance(named: .aqua)
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let view = try XCTUnwrap(window.contentView)
        view.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        window.displayIfNeeded()
        let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
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
