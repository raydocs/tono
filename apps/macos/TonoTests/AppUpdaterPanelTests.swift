import CryptoKit
import Foundation
import XCTest
@testable import Tono

@MainActor
final class AppUpdaterPanelTests: XCTestCase {
    private enum TestFailure: LocalizedError {
        case networkDown
        case retireRejected

        var errorDescription: String? {
            switch self {
            case .networkDown: "The update could not be downloaded.\nPaths: direct:timeout"
            case .retireRejected: "Ordinary internet could not be confirmed."
            }
        }
    }

    private func sampleOffer(version: String = "0.0.89", size: UInt64 = 1_048_576) throws -> NativeUpdateDownload.Offer {
        let components = UpdateContractV1.Components(
            appSha256: String(repeating: "1", count: 64),
            coreSha256: String(repeating: "2", count: 64),
            privilegedSha256: String(repeating: "3", count: 64)
        )
        let manifest = UpdateContractV1.ReleaseManifest(
            appVersion: version,
            buildCommit: String(repeating: "a", count: 40),
            kind: "tonoUpdateManifest",
            protocolVersion: 1,
            releaseId: "macos-\(version)",
            releaseSequence: 90,
            targets: [
                UpdateContractV1.Target(
                    artifactSha256: String(repeating: "4", count: 64),
                    artifactSizeBytes: size,
                    components: components,
                    id: .macosArm64
                ),
                UpdateContractV1.Target(
                    artifactSha256: String(repeating: "5", count: 64),
                    artifactSizeBytes: size,
                    components: components,
                    id: .windowsX86_64
                ),
            ]
        )
        let bytes = try UpdateContractV1.canonical(manifest)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        return NativeUpdateDownload.Offer(
            bytes: bytes,
            signature: Data("sig".utf8),
            manifest: manifest,
            directory: URL(string: "https://releases.afk.ccwu.cc/desktop/v1/\(hash)/")!
        )
    }

    func testIdleAndDisabledStatesKeepBannerHidden() {
        let disabled = AppUpdater(enabled: false)
        XCTAssertEqual(disabled.phase, .idle)
        XCTAssertFalse(disabled.canCheckForUpdates)
        XCTAssertFalse(disabled.isPanelPresented)
        XCTAssertFalse(disabled.showsBanner)
        XCTAssertNil(disabled.downloadFraction)

        disabled.presentPanel()
        disabled.openOrCheckForUpdates()
        XCTAssertFalse(disabled.isPanelPresented)
        XCTAssertFalse(disabled.showsBanner)

        let enabled = AppUpdater(enabled: true)
        XCTAssertEqual(enabled.phase, .idle)
        XCTAssertTrue(enabled.canCheckForUpdates)
        XCTAssertFalse(enabled.isPanelPresented)
        XCTAssertFalse(enabled.showsBanner)
        XCTAssertNil(enabled.downloadFraction)
    }

    func testDismissingPanelAfterOfferKeepsShowsBannerTrueAndCachesOffer() async throws {
        let offer = try sampleOffer(version: "0.0.89", size: 2_097_152)
        var discoverCalls = 0
        var ops = AppUpdater.Operations.live
        ops.pendingUpdate = { nil }
        ops.discover = {
            discoverCalls += 1
            return offer
        }
        ops.verifyOffer = { _, _ in true }

        let updater = AppUpdater(enabled: true, currentVersionProvider: { "0.0.88" }, operations: ops)
        let app = AppState()
        updater.attach(appState: app)
        defer { updater.cancelAutomaticCheck() }

        updater.openOrCheckForUpdates()
        XCTAssertTrue(updater.isPanelPresented)

        let deadline = Date().addingTimeInterval(2.0)
        while updater.phase == .checking && Date() < deadline {
            await Task.yield()
        }

        XCTAssertEqual(discoverCalls, 1)
        XCTAssertEqual(updater.phase, .available(version: "0.0.89", packageSize: 2_097_152))
        XCTAssertTrue(updater.showsBanner)

        updater.dismissPanel()
        XCTAssertFalse(updater.isPanelPresented)
        XCTAssertTrue(updater.showsBanner)
        XCTAssertEqual(updater.phase, .available(version: "0.0.89", packageSize: 2_097_152))

        // Re-opening displays the cached offer without hitting discovery again.
        updater.openOrCheckForUpdates()
        XCTAssertTrue(updater.isPanelPresented)
        XCTAssertEqual(discoverCalls, 1)
    }

    func testDownloadFractionClamping() {
        XCTAssertNil(AppUpdater.downloadFraction(for: .idle))
        XCTAssertNil(AppUpdater.downloadFraction(for: .checking))
        XCTAssertNil(AppUpdater.downloadFraction(for: .upToDate))
        XCTAssertNil(AppUpdater.downloadFraction(for: .available(version: "0.0.89", packageSize: 100)))
        XCTAssertNil(AppUpdater.downloadFraction(for: .preparing(version: "0.0.89")))
        XCTAssertNil(AppUpdater.downloadFraction(for: .installing(version: "0.0.89")))
        XCTAssertNil(AppUpdater.downloadFraction(for: .failed(version: nil, message: "err", detail: nil, retryable: false)))
        XCTAssertNil(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: 50, total: 0)))
        XCTAssertNil(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: 50, total: -10)))

        XCTAssertEqual(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: -25, total: 100)), 0.0)
        XCTAssertEqual(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: 50, total: 100)), 0.5)
        XCTAssertEqual(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: 100, total: 100)), 1.0)
        XCTAssertEqual(AppUpdater.downloadFraction(for: .downloading(version: "0.0.89", received: 250, total: 100)), 1.0)
    }

    func testCancelDownloadReturnsToAvailableAndCleansTempFiles() async throws {
        let offer = try sampleOffer(version: "0.0.89", size: 1_048_576)
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-updater-cancel-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let packageFile = tempDir.appendingPathComponent("package.zip")
        try Data("partial".utf8).write(to: packageFile)

        var installCalled = false
        var downloadStarted = false
        var ops = AppUpdater.Operations.live
        ops.pendingUpdate = { nil }
        ops.discover = { offer }
        ops.verifyOffer = { _, _ in true }
        ops.downloadPackage = { _, onProgress in
            downloadStarted = true
            onProgress(262_144, 1_048_576)
            while !Task.isCancelled {
                try await Task.sleep(for: .milliseconds(20))
            }
            throw CancellationError()
        }
        ops.installUpdate = { _, _, _, _ in
            installCalled = true
        }

        let updater = AppUpdater(enabled: true, operations: ops)
        let app = AppState()
        updater.attach(appState: app)
        defer { updater.cancelAutomaticCheck() }

        updater.openOrCheckForUpdates()
        let offerDeadline = Date().addingTimeInterval(2.0)
        while updater.phase == .checking && Date() < offerDeadline {
            await Task.yield()
        }

        updater.installAvailableUpdate()
        let downloadDeadline = Date().addingTimeInterval(2.0)
        while (!downloadStarted || updater.downloadFraction == nil || updater.downloadFraction == 0)
            && Date() < downloadDeadline {
            await Task.yield()
        }
        XCTAssertEqual(updater.downloadFraction, 0.25)

        updater.cancelDownload()
        XCTAssertEqual(updater.phase, .available(version: "0.0.89", packageSize: 1_048_576))
        XCTAssertTrue(updater.showsBanner)
        XCTAssertFalse(installCalled)

        // Also verify a late-completing download cleaned up on cancellation.
        try? await Task.sleep(for: .milliseconds(40))
        XCTAssertEqual(updater.phase, .available(version: "0.0.89", packageSize: 1_048_576))
    }

    func testRetryablePendingFailureAndDisconnectRetryFlow() async throws {
        let staged = HelperManager.UpdateStatus(
            pending: true,
            receipt: UpdateContractV1.Receipt(
                attemptId: String(repeating: "a", count: 64),
                blockedReason: nil,
                createdAtUnix: 100,
                expiresAtUnix: 200,
                initiatingGeneration: 1,
                installedLocationSha256: String(repeating: "b", count: 64),
                kind: "tonoUpdateReceipt",
                manifestSha256: String(repeating: "c", count: 64),
                owner: "fixture",
                phase: .preparing,
                protocolVersion: 1,
                requiredRecovery: .protectedOffline,
                successorGeneration: nil,
                targetId: .macosArm64,
                updatedAtUnix: 100
            ),
            execution: "staged",
            disconnectVerified: false,
            diagnostic: "helper-pending-diagnostic"
        )
        var isPending = true
        var retireCalls = 0

        var ops = AppUpdater.Operations.live
        ops.pendingUpdate = { isPending ? staged : nil }
        ops.discover = { nil }
        ops.retireDisconnected = { _ in
            retireCalls += 1
            isPending = false
        }

        let updater = AppUpdater(enabled: true, operations: ops)
        let app = AppState()
        updater.attach(appState: app)
        defer { updater.cancelAutomaticCheck() }

        updater.openOrCheckForUpdates()
        let deadline = Date().addingTimeInterval(2.0)
        while updater.phase == .checking && Date() < deadline {
            await Task.yield()
        }

        XCTAssertEqual(
            updater.phase,
            .failed(
                version: nil,
                message: NativeUpdateDownload.Copy.pendingUnfinished,
                detail: "helper-pending-diagnostic",
                retryable: true
            )
        )
        XCTAssertTrue(updater.showsBanner)

        updater.retryAfterDisconnect()
        let retryDeadline = Date().addingTimeInterval(2.0)
        while updater.phase == .checking && Date() < retryDeadline {
            await Task.yield()
        }

        XCTAssertEqual(retireCalls, 1)
        XCTAssertEqual(updater.phase, .upToDate)
        XCTAssertFalse(updater.showsBanner)
    }

    func testDownloadFailureIsNonRetryableAndInstallHandoffTerminates() async throws {
        let offer = try sampleOffer(version: "0.0.89", size: 512)
        var shouldFailDownload = true
        var terminated = false
        var installedVersionBytes: Data?

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-updater-install-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let packageFile = tempDir.appendingPathComponent("package.zip")
        try Data("zip-bytes".utf8).write(to: packageFile)

        var ops = AppUpdater.Operations.live
        ops.pendingUpdate = { nil }
        ops.discover = { offer }
        ops.verifyOffer = { _, _ in true }
        ops.downloadPackage = { _, onProgress in
            if shouldFailDownload {
                throw TestFailure.networkDown
            }
            onProgress(512, 512)
            return packageFile
        }
        ops.installUpdate = { _, manifest, _, _ in
            installedVersionBytes = manifest
        }
        ops.terminateForUpdate = { _ in
            terminated = true
        }

        let updater = AppUpdater(enabled: true, operations: ops)
        let app = AppState()
        updater.attach(appState: app)
        defer { updater.cancelAutomaticCheck() }

        updater.openOrCheckForUpdates()
        let offerDeadline = Date().addingTimeInterval(2.0)
        while updater.phase == .checking && Date() < offerDeadline {
            await Task.yield()
        }

        updater.installAvailableUpdate()
        let failDeadline = Date().addingTimeInterval(2.0)
        while !isFailedPhase(updater.phase) && Date() < failDeadline {
            await Task.yield()
        }

        XCTAssertEqual(
            updater.phase,
            .failed(
                version: "0.0.89",
                message: "The update could not be downloaded.",
                detail: "Paths: direct:timeout",
                retryable: false
            )
        )
        XCTAssertTrue(updater.hasCachedOffer)

        shouldFailDownload = false
        updater.installAvailableUpdate()
        let installDeadline = Date().addingTimeInterval(2.0)
        while !terminated && Date() < installDeadline {
            await Task.yield()
        }

        XCTAssertTrue(terminated)
        XCTAssertEqual(installedVersionBytes, offer.bytes)
        XCTAssertEqual(updater.phase, .installing(version: "0.0.89"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: tempDir.path))
    }

    private func isFailedPhase(_ phase: AppUpdater.UpdatePhase) -> Bool {
        if case .failed = phase { return true }
        return false
    }

    func testPackageResponseSinkThrottlesProgressTo64KBAndFinalByte() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-sink-progress-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("package.zip")
        XCTAssertTrue(FileManager.default.createFile(atPath: fileURL.path, contents: nil))
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }

        let totalSize: Int64 = 150_000
        let lock = NSLock()
        var updates: [(Int64, Int64)] = []
        let sink = PackageResponseSink(size: totalSize, file: handle, destination: fileURL) { received, total in
            lock.lock()
            updates.append((received, total))
            lock.unlock()
        }

        let head = Data("HTTP/1.1 200 OK\r\nContent-Length: \(totalSize)\r\n\r\n".utf8)
        XCTAssertFalse(try sink.receive(head))
        XCTAssertFalse(try sink.receive(Data(repeating: 1, count: 32_768)))
        XCTAssertTrue(updates.isEmpty, "sub-64KB increment must be throttled")

        XCTAssertFalse(try sink.receive(Data(repeating: 2, count: 32_768)))
        XCTAssertEqual(updates.count, 1)
        XCTAssertEqual(updates.last?.0, 65_536)
        XCTAssertEqual(updates.last?.1, totalSize)

        XCTAssertFalse(try sink.receive(Data(repeating: 3, count: 40_000)))
        XCTAssertEqual(updates.count, 1, "increment below 64KB must stay throttled")

        XCTAssertTrue(try sink.receive(Data(repeating: 4, count: Int(totalSize - 105_536))))
        XCTAssertEqual(updates.count, 2)
        XCTAssertEqual(updates.last?.0, totalSize)
        XCTAssertEqual(updates.last?.1, totalSize)
    }
}
