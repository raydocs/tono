import AppKit

// MARK: - App Delegate for Window Configuration

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    /// Reference to app state for cleanup on termination
    var appState: AppState?
    var accountSession: AccountSession?
    private var runtimeStopped = false
    private var signalTerminationStarted = false
    private var terminationCleanupStarted = false
    private var terminationCompletionSent = false
    private var terminationCleanupTask: Task<Void, Never>?
    private var terminationDeadlineTask: Task<Void, Never>?
    private var terminationSignalSource: DispatchSourceSignal?
    private var networkChangeMonitor: SystemNetworkChangeMonitor?

    static var canStartRuntimeFromCurrentLocation: Bool {
#if DEBUG
        true
#else
        Bundle.main.bundleURL
            .resolvingSymlinksInPath()
            .standardizedFileURL
            .deletingLastPathComponent()
            == URL(fileURLWithPath: "/Applications", isDirectory: true)
                .standardizedFileURL
#endif
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard Self.canStartRuntimeFromCurrentLocation else {
            runtimeStopped = true
            NSApp.activate(ignoringOtherApps: true)

            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = String(localized: "Install Tono in Applications")
            alert.informativeText = String(localized: "To work reliably, Tono must run from the Applications folder. Quit Tono, drag it onto Applications in the installer window, then open the installed copy.")
            alert.addButton(withTitle: String(localized: "Open Applications"))
            alert.addButton(withTitle: String(localized: "Quit"))
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(
                    URL(fileURLWithPath: "/Applications", isDirectory: true)
                )
            }
            NSApp.terminate(nil)
            return
        }

        if !AppProfile.isDev {
            // Register URL schemes with Launch Services (ensures clash:// works immediately)
            let appURL = Bundle.main.bundleURL
            if !appURL.path.isEmpty {
                DispatchQueue.global(qos: .utility).async {
                    LSRegisterURL(appURL as CFURL, true)
                }
            }

            // Register for URL open events (works even when no window is open)
            NSAppleEventManager.shared().setEventHandler(
                self,
                andSelector: #selector(handleGetURLEvent(_:replyEvent:)),
                forEventClass: AEEventClass(kInternetEventClass),
                andEventID: AEEventID(kAEGetURL)
            )
        }

        // Fallback: force-resize window if SwiftUI still created it too small
        enforceDefaultWindowSize()

        // Convert SIGTERM into the normal AppKit termination flow. Raw signal handlers
        // cannot safely call Foundation/AppKit or await sidecar cleanup.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in
            Task { @MainActor [weak self] in
                await self?.terminateAfterSignal()
            }
        }
        source.resume()
        terminationSignalSource = source

        let workspaceNotifications = NSWorkspace.shared.notificationCenter
        workspaceNotifications.addObserver(
            self,
            selector: #selector(systemWillSleep(_:)),
            name: NSWorkspace.willSleepNotification,
            object: nil
        )
        workspaceNotifications.addObserver(
            self,
            selector: #selector(systemDidWake(_:)),
            name: NSWorkspace.didWakeNotification,
            object: nil
        )
        let monitor = SystemNetworkChangeMonitor { [weak self] in
            self?.appState?.handleSystemNetworkChange()
        }
        networkChangeMonitor = monitor
        monitor.start()
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        _ = notification
        // A user may have run the documented root recovery while Tono was in
        // the background. Reconcile only an authenticated, confirmed unarmed
        // helper state; this callback never raises an administrator prompt.
        appState?.reconcileExternalProtectionState()
    }

    @objc private func systemWillSleep(_ notification: Notification) {
        _ = notification
        appState?.prepareForSystemSleep()
        accountSession?.prepareForSystemSleep()
    }

    @objc private func systemDidWake(_ notification: Notification) {
        _ = notification
        appState?.resumeAfterSystemWake()
        accountSession?.resumeAfterSystemWake()
    }

    private func enforceDefaultWindowSize() {
        let defaultSize = NSSize(width: 920, height: 600)
        let minSize = NSSize(width: 860, height: 540)

        for delay in [0.1, 0.5] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard let window = NSApp.windows.first(where: {
                    $0.isVisible && !($0 is NSPanel)
                }) else { return }

                window.minSize = minSize
                window.contentMinSize = minSize

                if window.frame.width < minSize.width || window.frame.height < minSize.height {
                    let screen = window.screen ?? NSScreen.main
                    let visibleFrame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
                    let origin = NSPoint(
                        x: visibleFrame.midX - defaultSize.width / 2,
                        y: visibleFrame.midY - defaultSize.height / 2
                    )
                    window.setFrame(NSRect(origin: origin, size: defaultSize), display: true, animate: false)
                }
            }
        }
    }

    @objc func handleGetURLEvent(_ event: NSAppleEventDescriptor, replyEvent: NSAppleEventDescriptor) {
        let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue ?? "nil"
        writeDebug("handleGetURLEvent: received, appState=\(appState != nil)")

        guard !AppProfile.isDev else {
            writeDebug("handleGetURLEvent: ignored in dev profile")
            return
        }

        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              scheme == "tono" else {
            writeDebug("handleGetURLEvent: scheme mismatch")
            return
        }

        writeDebug("handleGetURLEvent: host=\(url.host ?? "nil")")
        guard url.host == "install-config" else {
            writeDebug("handleGetURLEvent: parse failed")
            return
        }

        // Server credentials are delivered only by the authenticated managed
        // catalog. Never retain or fetch a credential-bearing third-party URL.
        appState?.errorMessage = Self.managedCatalogImportMessage
        writeDebug("handleGetURLEvent: legacy subscription import rejected")
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Computed, so the lookup happens where it is read: this is the one
    /// `errorMessage` value the banner receives through a constant rather than
    /// from a `String(localized:)` at the assignment, and a stored literal here
    /// shipped Chinese users the English sentence.
    static var managedCatalogImportMessage: String {
        String(
            localized: "External subscription links are disabled. Servers are synchronized from the authenticated Tono cloud catalog."
        )
    }

    private func writeDebug(_ msg: String) {
        // Subscription URLs commonly contain bearer tokens. Never persist URL-event
        // diagnostics to a fixed /tmp file or Console.
        _ = msg
    }

    func applicationWillTerminate(_ notification: Notification) {
        networkChangeMonitor?.stop()
        networkChangeMonitor = nil
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        guard !runtimeStopped else { return }
        // AppKit reached termination without completing the ordered async
        // cleanup. Stop local runtime work, but never open PF when DNS/core
        // restoration could not be proven before process exit.
        appState?.disconnect(releaseKillSwitch: false)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !runtimeStopped else { return .terminateNow }
        beginTerminationCleanup {
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    /// Quit for a language change, which reopens Tono afterwards. Termination
    /// cleanup stops the core, restores DNS and disarms PF over helper IPC and
    /// can spend minutes on an administrator prompt, so a runtime that owns no
    /// network state takes the immediate exit instead of that budget.
    ///
    /// The tests below are what decide that, not the launch phase: `didStartCore`
    /// is also cleared by a clean release, so a switch made after a normal
    /// connect-then-disconnect takes the fast path too. That is correct — the
    /// release already stopped the core, restored DNS and disarmed PF — but it
    /// means the fast path is a live one, not only the first-launch chooser's.
    func terminateForRelaunch() {
        let runtimeMayOwnNetwork = (appState?.isConnected ?? false)
            || (appState?.isConnecting ?? false)
            || KillSwitchService.isArmed
            || AppProfile.defaults.object(forKey: SettingsKey.didStartCore) != nil
        if !runtimeMayOwnNetwork {
            runtimeStopped = true
        }
        NSApp.terminate(nil)
    }

    /// A main-queue dispatch source must not synchronously enter AppKit's
    /// `terminateLater` loop: the cleanup Task would be queued behind the
    /// dispatch callback that is waiting for its reply. Complete cleanup first,
    /// then terminate through the already-stopped fast path.
    private func terminateAfterSignal() async {
        guard !signalTerminationStarted else { return }
        signalTerminationStarted = true
        beginTerminationCleanup {
            NSApp.terminate(nil)
        }
    }

    /// AppKit can otherwise wait indefinitely when a helper IPC or sidecar
    /// teardown is stuck. The deadline never performs an emergency disarm: a
    /// timed-out cleanup deliberately leaves the helper's PF policy fail-closed.
    private func beginTerminationCleanup(completion: @escaping @MainActor () -> Void) {
        guard !terminationCleanupStarted else { return }
        terminationCleanupStarted = true

        terminationCleanupTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.finishTerminationCleanup()
            guard !Task.isCancelled else { return }
            self.completeTermination(completion)
        }
        terminationDeadlineTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard let self, !Task.isCancelled else { return }
            self.terminationCleanupTask?.cancel()
            self.completeTermination(completion)
        }
    }

    private func completeTermination(_ completion: @escaping @MainActor () -> Void) {
        guard !terminationCompletionSent else { return }
        terminationCompletionSent = true
        terminationDeadlineTask?.cancel()
        terminationDeadlineTask = nil
        runtimeStopped = true
        completion()
    }

    private func finishTerminationCleanup() async {
        // First stop transports while retaining PF. Noncritical persistence is
        // also completed before the final release transaction, so a timeout in
        // either phase cannot leave an unknown network path open.
        if let accountSession {
            await accountSession.stopRuntime(releaseKillSwitch: false)
        } else {
            appState?.disconnect(releaseKillSwitch: false)
        }
        guard !Task.isCancelled else { return }
        await appState?.finishPendingDisconnect()
        guard !Task.isCancelled else { return }
        await appState?.finishPendingPersistence()
        guard !Task.isCancelled else { return }

        // Release only as the last ordered operation. AppState restores DNS,
        // confirms the core has stopped, and only then disarms PF.
        if let appState {
            await appState.disconnectAndWait(releaseKillSwitch: true)
        } else {
            // Launch-time termination can occur before AppState is attached.
            do {
                _ = try await PrivilegedRuntimeCoordinator.shared
                    .restoreProtectedDNSIfConfigured()
                try await PrivilegedRuntimeCoordinator.shared.disarmKillSwitch()
            } catch {
                // Never open PF when DNS recovery could not be proven.
            }
        }
    }
}
