import AppKit
import Combine
import Foundation
import SwiftUI

private struct AppUpdaterKey: EnvironmentKey {
    static let defaultValue: AppUpdater? = nil
}

extension EnvironmentValues {
    var appUpdater: AppUpdater? {
        get { self[AppUpdaterKey.self] }
        set { self[AppUpdaterKey.self] = newValue }
    }
}

/// Discovery/UI only. Root owns signature verification, the private consumed
/// input, replacement and commit. There is intentionally no legacy installer.
@MainActor
final class AppUpdater: ObservableObject {
    enum UpdatePhase: Equatable {
        case idle
        case checking
        case upToDate
        case available(version: String, packageSize: Int64)
        case downloading(version: String, received: Int64, total: Int64)
        case preparing(version: String)
        case installing(version: String)
        case failed(version: String?, message: String, detail: String?, retryable: Bool)
    }

    @MainActor
    struct Operations {
        var pendingUpdate: () async throws -> HelperManager.UpdateStatus? = {
            try await PrivilegedRuntimeCoordinator.shared.pendingNativeUpdate()
        }
        var discover: () async throws -> NativeUpdateDownload.Offer? = {
            try await NativeUpdateDownload.discover()
        }
        var verifyOffer: (Data, Data) async throws -> Bool = { manifest, signature in
            try await PrivilegedRuntimeCoordinator.shared.verifyUpdateOffer(
                manifest: manifest,
                signature: signature
            )
        }
        var downloadPackage: (
            NativeUpdateDownload.Offer,
            @escaping @Sendable (_ received: Int64, _ total: Int64) -> Void
        ) async throws -> URL = { offer, onProgress in
            try await NativeUpdateDownload.package(for: offer, onProgress: onProgress)
        }
        var installUpdate: (AppState, Data, Data, URL) async throws -> Void = { appState, manifest, signature, package in
            try await appState.installNativeUpdate(manifest: manifest, signature: signature, package: package)
        }
        var retireDisconnected: (AppState) async throws -> Void = { appState in
            try await appState.retireDisconnectedNativeUpdate()
        }
        var terminateForUpdate: (AppDelegate?) -> Void = { appDelegate in
            AppDelegate.nativeUpdateTerminationRequested = true
            if let delegate = AppDelegate.resolve(attached: appDelegate) {
                delegate.terminateForNativeUpdate()
            } else {
                NSApp.terminate(nil)
            }
        }

        static let live = Operations()
    }

    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var phase: UpdatePhase = .idle {
        didSet { refreshCanCheckForUpdates() }
    }
    @Published var isPanelPresented = false

    private let enabled: Bool
    private let currentVersionProvider: () -> String
    private let operations: Operations
    private weak var appState: AppState?
    private weak var appDelegate: AppDelegate?
    private var availableOffer: NativeUpdateDownload.Offer?
    private var automaticCheck: Task<Void, Never>?
    private var activeCheckTask: Task<Void, Never>?
    private var activeInstallTask: Task<Void, Never>?
    private var activeDownloadID: UUID?
    private var currentCheckUserInitiated = false

    convenience init(enabled: Bool) {
        self.init(enabled: enabled, operations: .live)
    }

    init(
        enabled: Bool,
        currentVersionProvider: @escaping () -> String = {
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            return (version?.isEmpty == false ? version : nil) ?? "0.0.0"
        },
        operations: Operations = .live
    ) {
        self.enabled = enabled
        self.currentVersionProvider = currentVersionProvider
        self.operations = operations
        self.canCheckForUpdates = enabled
    }

    var showsBanner: Bool {
        guard enabled else { return false }
        switch phase {
        case .available, .downloading, .preparing, .installing, .failed:
            return true
        case .idle, .checking, .upToDate:
            return false
        }
    }

    var currentVersion: String {
        currentVersionProvider()
    }

    var downloadFraction: Double? {
        Self.downloadFraction(for: phase)
    }

    var hasCachedOffer: Bool {
        availableOffer != nil
    }

    var isInstalling: Bool {
        if case .installing = phase { return true }
        return false
    }

    private var isBusyPhase: Bool {
        switch phase {
        case .checking, .downloading, .preparing, .installing:
            return true
        case .idle, .upToDate, .available, .failed:
            return false
        }
    }

    private func refreshCanCheckForUpdates() {
        canCheckForUpdates = enabled && !isBusyPhase
    }

    nonisolated static func downloadFraction(for phase: UpdatePhase) -> Double? {
        guard case let .downloading(_, received, total) = phase, total > 0 else {
            return nil
        }
        return min(1.0, max(0.0, Double(received) / Double(total)))
    }

    func attach(appState: AppState, appDelegate: AppDelegate? = nil) {
        self.appState = appState
        if let appDelegate {
            self.appDelegate = appDelegate
        }
        guard enabled, automaticCheck == nil else { return }
        automaticCheck = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            while !Task.isCancelled {
                await self?.runBackgroundCheckIfIdle()
                try? await Task.sleep(for: .seconds(21_600))
            }
        }
    }

    func cancelAutomaticCheck() {
        automaticCheck?.cancel()
        automaticCheck = nil
    }

    func presentPanel() {
        guard enabled else { return }
        isPanelPresented = true
    }

    func dismissPanel() {
        guard !isInstalling else { return }
        isPanelPresented = false
    }

    func openOrCheckForUpdates() {
        guard enabled else { return }
        isPanelPresented = true
        switch phase {
        case .available, .downloading, .preparing, .installing:
            return
        case .checking:
            currentCheckUserInitiated = true
            return
        case let .failed(_, _, _, retryable):
            if availableOffer != nil || retryable {
                return
            }
            startCheck(userInitiated: true)
        case .idle, .upToDate:
            startCheck(userInitiated: true)
        }
    }

    func checkForUpdates() {
        openOrCheckForUpdates()
    }

    func recheckForUpdates() {
        guard enabled, !isBusyPhase else { return }
        isPanelPresented = true
        startCheck(userInitiated: true)
    }

    func installAvailableUpdate() {
        guard enabled, !isBusyPhase, let appState, let offer = availableOffer else { return }
        let version = offer.manifest.appVersion
        let expectedSize = Self.packageSize(for: offer)
        let attemptID = UUID()
        activeDownloadID = attemptID
        phase = .downloading(version: version, received: 0, total: expectedSize)

        activeInstallTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.activeDownloadID == attemptID {
                    self.activeDownloadID = nil
                    self.activeInstallTask = nil
                }
            }
            var downloadedPackage: URL?
            defer {
                if let downloadedPackage {
                    try? FileManager.default.removeItem(at: downloadedPackage.deletingLastPathComponent())
                }
            }
            do {
                let package = try await self.operations.downloadPackage(offer) { [weak self] received, total in
                    Task { @MainActor [weak self] in
                        guard let self,
                              self.activeDownloadID == attemptID,
                              case .downloading = self.phase else { return }
                        self.phase = .downloading(version: version, received: received, total: total)
                    }
                }
                downloadedPackage = package
                try Task.checkCancellation()
                guard self.activeDownloadID == attemptID else { return }

                self.phase = .preparing(version: version)
                await Task.yield()
                try Task.checkCancellation()
                guard self.activeDownloadID == attemptID else { return }

                self.phase = .installing(version: version)
                try await self.operations.installUpdate(appState, offer.bytes, offer.signature, package)
                self.operations.terminateForUpdate(self.appDelegate)
            } catch {
                if Task.isCancelled || self.activeDownloadID != attemptID || Self.isCancellation(error) {
                    if let offer = self.availableOffer {
                        self.phase = .available(version: offer.manifest.appVersion, packageSize: Self.packageSize(for: offer))
                    } else {
                        self.phase = .idle
                    }
                    return
                }
                appState.errorMessage = error.localizedDescription
                let pending = try? await self.operations.pendingUpdate()
                appState.updateIncomplete = pending?.pending ?? appState.nativeUpdatePending
                let retryable = Self.disconnectRetriable(pending)
                let (message, detail) = Self.splitFailure(error)
                self.phase = .failed(
                    version: version,
                    message: message,
                    detail: detail ?? pending?.diagnostic,
                    retryable: retryable
                )
            }
        }
    }

    func cancelDownload() {
        switch phase {
        case .downloading, .preparing:
            break
        default:
            return
        }
        activeDownloadID = nil
        activeInstallTask?.cancel()
        activeInstallTask = nil
        if let offer = availableOffer {
            phase = .available(version: offer.manifest.appVersion, packageSize: Self.packageSize(for: offer))
        } else if case let .downloading(version, _, total) = phase {
            phase = .available(version: version, packageSize: max(0, total))
        } else {
            phase = .idle
        }
    }

    func retryAfterDisconnect() {
        guard enabled, !isBusyPhase, let appState else { return }
        let previousVersion: String?
        if case let .failed(version, _, _, _) = phase {
            previousVersion = version
        } else {
            previousVersion = availableOffer?.manifest.appVersion
        }
        phase = .checking
        activeCheckTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.activeCheckTask = nil }
            do {
                try await self.operations.retireDisconnected(appState)
                await self.performCheck(userInitiated: true)
            } catch {
                appState.errorMessage = error.localizedDescription
                let pending = try? await self.operations.pendingUpdate()
                appState.updateIncomplete = pending?.pending ?? appState.nativeUpdatePending
                let retryable = Self.disconnectRetriable(pending)
                let (message, detail) = Self.splitFailure(error)
                self.phase = .failed(
                    version: previousVersion,
                    message: message,
                    detail: detail ?? pending?.diagnostic,
                    retryable: retryable
                )
            }
        }
    }

    private func runBackgroundCheckIfIdle() async {
        guard enabled, !isBusyPhase else { return }
        await performCheck(userInitiated: false)
    }

    private func startCheck(userInitiated: Bool) {
        guard activeCheckTask == nil else {
            if userInitiated {
                currentCheckUserInitiated = true
            }
            return
        }
        activeCheckTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.activeCheckTask = nil }
            await self.performCheck(userInitiated: userInitiated)
        }
    }

    private func performCheck(userInitiated: Bool) async {
        guard enabled, let appState else { return }
        currentCheckUserInitiated = userInitiated
        let previousCachedOffer = availableOffer
        if userInitiated || previousCachedOffer == nil {
            phase = .checking
        }
        do {
            if let pending = try await operations.pendingUpdate(), pending.pending {
                appState.nativeUpdatePending = true
                appState.updateIncomplete = true
                let sentence = NativeUpdateDownload.Copy.pendingUnfinished
                let retryable = Self.disconnectRetriable(pending)
                if Self.reportsFailure(
                    userInitiated: currentCheckUserInitiated,
                    offerAccepted: false,
                    updatePending: appState.nativeUpdatePending
                ) {
                    appState.errorMessage = sentence
                    phase = .failed(
                        version: previousCachedOffer?.manifest.appVersion,
                        message: sentence,
                        detail: pending.diagnostic,
                        retryable: retryable
                    )
                } else {
                    restoreSilentCheckPhase(cachedOffer: previousCachedOffer)
                }
                return
            }

            guard let offer = try await operations.discover() else {
                // Nothing is published on the update channel (the release
                // host's 404): no update, not a failure. Background checks
                // stay silent and keep their six-hour cadence.
                availableOffer = nil
                phase = currentCheckUserInitiated ? .upToDate : .idle
                return
            }

            let available = try await operations.verifyOffer(offer.bytes, offer.signature)
            guard available else {
                availableOffer = nil
                phase = currentCheckUserInitiated ? .upToDate : .idle
                return
            }

            availableOffer = offer
            phase = .available(version: offer.manifest.appVersion, packageSize: Self.packageSize(for: offer))
        } catch {
            if Task.isCancelled {
                restoreSilentCheckPhase(cachedOffer: previousCachedOffer)
                return
            }
            // Missing metadata (other than an unpublished channel, above) is
            // an error, never "up to date". Background discovery does not raise
            // a failure UI when nothing is pending.
            if Self.reportsFailure(
                userInitiated: currentCheckUserInitiated,
                offerAccepted: false,
                updatePending: appState.nativeUpdatePending
            ) {
                appState.errorMessage = error.localizedDescription
                let pending = try? await operations.pendingUpdate()
                appState.updateIncomplete = pending?.pending ?? appState.nativeUpdatePending
                let retryable = Self.disconnectRetriable(pending)
                let (message, detail) = Self.splitFailure(error)
                phase = .failed(
                    version: previousCachedOffer?.manifest.appVersion,
                    message: message,
                    detail: detail ?? pending?.diagnostic,
                    retryable: retryable
                )
            } else {
                restoreSilentCheckPhase(cachedOffer: previousCachedOffer)
            }
        }
    }

    private func restoreSilentCheckPhase(cachedOffer: NativeUpdateDownload.Offer?) {
        if let cachedOffer {
            phase = .available(
                version: cachedOffer.manifest.appVersion,
                packageSize: Self.packageSize(for: cachedOffer)
            )
        } else {
            phase = .idle
        }
    }

    private nonisolated static func packageSize(for offer: NativeUpdateDownload.Offer) -> Int64 {
        guard let target = try? offer.manifest.target(.macosArm64) else { return 0 }
        return Int64(target.artifactSizeBytes)
    }

    private nonisolated static func isCancellation(_ error: any Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    nonisolated static func splitFailure(_ error: any Error) -> (message: String, detail: String?) {
        let description = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = description
            .split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true)
            .map(String.init)
        if lines.count == 2 {
            let detail = lines[1].trimmingCharacters(in: .whitespacesAndNewlines)
            return (lines[0], detail.isEmpty ? nil : detail)
        }
        if error is NativeUpdateDownload.Failure {
            let msg = description.isEmpty ? String(localized: "Update not completed") : description
            return (msg, nil)
        }
        let nsError = error as NSError
        let codeInfo = "\(nsError.domain) (\(nsError.code))"
        if description.isEmpty {
            return (String(localized: "Update not completed"), codeInfo)
        }
        return (description, "\(codeInfo): \(description)")
    }

    /// Whether a failed check tells the user. A background check stays quiet
    /// until it has asked the user something: once they chose Install and
    /// Restart, a package that could not be downloaded (every path down, as
    /// on a network that blocks the release host) must say so instead of
    /// leaving the click unanswered.
    nonisolated static func reportsFailure(userInitiated: Bool, offerAccepted: Bool, updatePending: Bool) -> Bool {
        userInitiated || offerAccepted || updatePending
    }

    /// An attempt is disconnect-retriable only when the privileged retire can
    /// actually archive it: unconsumed reservations, and consumed-side
    /// attempts that are no longer executable forward — blocked, rolled back,
    /// expired, already explicitly disconnected, or an abandoned replacement.
    /// A healthy in-flight or successor-recoverable attempt stays protected.
    nonisolated static func disconnectRetriable(
        _ pending: HelperManager.UpdateStatus?, now: UInt64 = UInt64(Date().timeIntervalSince1970)
    ) -> Bool {
        guard let pending, pending.pending else { return false }
        switch pending.execution ?? "" {
        case "reserved", "staged":
            return true
        case "consumed", "rolledBack", "replaced":
            return pending.receipt?.blockedReason != nil
                || (pending.execution == "consumed" && executorSilent(pending.receipt, now: now))
                || pending.disconnectRequested == true
                || pending.disconnectVerified == true
                || pending.diagnostic != nil
        default:
            return false
        }
    }

    /// How long a consumed attempt may go without a receipt update before the
    /// executor is taken as gone. Replacement takes seconds to minutes; an
    /// attempt idle this long was abandoned (a crashed executor, a power loss),
    /// and without this the customer waited out the 48 h expiry with protection
    /// armed and no way to sign in. Retiring still needs the owner's verified
    /// Disconnect and the installed components to match the captured original,
    /// so a half-replaced install keeps its evidence and stays pending.
    nonisolated static let executorSilence: UInt64 = 1800

    nonisolated static func executorSilent(_ receipt: UpdateContractV1.Receipt?, now: UInt64) -> Bool {
        guard let receipt else { return false }
        return now >= receipt.expiresAtUnix || now >= receipt.updatedAtUnix + executorSilence
    }

    static func offerAlert(version: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = String(localized: "A Tono update is available")
        alert.informativeText = String(localized: "Install Tono \(version)? Tono will verify the full package, retain network protection during replacement, and restart. Recovery must be verified before the update is complete.")
        alert.addButton(withTitle: String(localized: "Update now"))
        alert.addButton(withTitle: String(localized: "Later"))
        return alert
    }

    static func failureAlert(detail: String, retryable: Bool = false) -> NSAlert {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "Update not completed")
        alert.informativeText = detail
        if retryable {
            alert.informativeText += "\n\n" + String(localized: "Disconnect and Retry restores Internet access before retiring this attempt. Failed update evidence will be retained.")
            alert.addButton(withTitle: String(localized: "Keep Protection"))
            alert.addButton(withTitle: String(localized: "Disconnect and Retry"))
        } else {
            alert.addButton(withTitle: String(localized: "OK"))
        }
        return alert
    }
}

struct CheckForUpdatesView: View {
    @ObservedObject var updater: AppUpdater

    var body: some View {
        Button("Check for Updates") {
            updater.checkForUpdates()
        }
        .disabled(!updater.canCheckForUpdates)
    }
}
