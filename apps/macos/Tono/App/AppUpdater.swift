import SwiftUI
import Combine
import AppKit

/// Discovery/UI only. Root owns signature verification, the private consumed
/// input, replacement and commit. There is intentionally no legacy installer.
@MainActor
final class AppUpdater: ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    private weak var appState: AppState?
    private var automaticCheck: Task<Void, Never>?

    init(enabled: Bool) {
        canCheckForUpdates = enabled
    }

    func attach(appState: AppState) {
        self.appState = appState
        guard canCheckForUpdates, automaticCheck == nil else { return }
        automaticCheck = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            while !Task.isCancelled {
                await self?.check(userInitiated: false)
                try? await Task.sleep(for: .seconds(21_600))
            }
        }
    }

    func checkForUpdates() {
        Task { await check(userInitiated: true) }
    }

    private func check(userInitiated: Bool) async {
        guard canCheckForUpdates, let appState else { return }
        canCheckForUpdates = false
        var retryRequested = false
        defer {
            canCheckForUpdates = true
            if retryRequested { Task { await check(userInitiated: true) } }
        }
        do {
            if let pending = try await PrivilegedRuntimeCoordinator.shared.pendingNativeUpdate(), pending.pending {
                throw NativeUpdateDownload.failure(pending.diagnostic ?? "A previous update is pending. Installation and recovery evidence are retained.")
            }
            let offer = try await NativeUpdateDownload.discover()
            let available = try await PrivilegedRuntimeCoordinator.shared.verifyUpdateOffer(
                manifest: offer.bytes, signature: offer.signature
            )
            guard available else {
                if userInitiated {
                    let alert = NSAlert()
                    alert.messageText = String(localized: "You're up to date")
                    alert.informativeText = String(localized: "The signed release is not newer than this installation.")
                    alert.runModal()
                }
                return
            }
            guard Self.offerAlert(version: offer.manifest.appVersion).runModal() == .alertFirstButtonReturn else { return }
            let package = try await NativeUpdateDownload.package(for: offer)
            defer { try? FileManager.default.removeItem(at: package.deletingLastPathComponent()) }
            try await appState.installNativeUpdate(manifest: offer.bytes, signature: offer.signature, package: package)
            // The result is a helper-owned consumed receipt, not an App-owned
            // InstallStarted stamp. The executor waits for this process to exit.
            (NSApp.delegate as? AppDelegate)?.terminateForNativeUpdate()
        } catch {
            // Missing metadata is an error, never "up to date". Background
            // discovery does not raise a modal or perform a fallback install.
            if userInitiated || appState.nativeUpdatePending {
                appState.errorMessage = error.localizedDescription
                let pending = try? await PrivilegedRuntimeCoordinator.shared.pendingNativeUpdate()
                appState.updateIncomplete = pending?.pending ?? appState.nativeUpdatePending
                let retryable = Self.disconnectRetriable(pending)
                let alert = Self.failureAlert(detail: error.localizedDescription, retryable: retryable)
                if alert.runModal() == .alertSecondButtonReturn && retryable {
                    do {
                        try await appState.retireDisconnectedNativeUpdate()
                        retryRequested = true
                    } catch {
                        appState.errorMessage = error.localizedDescription
                        Self.failureAlert(detail: error.localizedDescription).runModal()
                    }
                }
            }
        }
    }

    /// An attempt is disconnect-retriable only when the privileged retire can
    /// actually archive it: unconsumed reservations, and consumed-side
    /// attempts that are no longer executable forward — blocked, rolled back,
    /// expired, already explicitly disconnected, or an abandoned replacement.
    /// A healthy in-flight or successor-recoverable attempt stays protected.
    nonisolated static func disconnectRetriable(_ pending: HelperManager.UpdateStatus?) -> Bool {
        guard let pending, pending.pending else { return false }
        switch pending.execution ?? "" {
        case "reserved", "staged":
            return true
        case "consumed", "rolledBack", "replaced":
            return pending.receipt?.blockedReason != nil
                || pending.disconnectVerified == true
                || pending.diagnostic != nil
        default:
            return false
        }
    }

    static func offerAlert(version: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = String(localized: "A Tono update is available")
        alert.informativeText = String(localized: "Install Tono \(version)? Tono will verify the full package, retain network protection during replacement, and restart. Recovery must be verified before the update is complete.")
        alert.addButton(withTitle: String(localized: "Install and Restart"))
        alert.addButton(withTitle: String(localized: "Not Now"))
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
