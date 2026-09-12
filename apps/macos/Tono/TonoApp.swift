import SwiftUI
import AppKit

@main
struct TonoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @AppStorage(SettingsKey.themeMode, store: AppProfile.defaults) private var themeMode = "Adaptive"
    @AppStorage(SettingsKey.interfaceLanguage, store: AppProfile.defaults) private var interfaceLanguage = "Auto"
    @AppStorage(SettingsKey.introSeen, store: AppProfile.defaults) private var introSeen = false
    @StateObject private var updater: AppUpdater
    @State private var appState: AppState
    @State private var sidecar: TonoSidecarService
    @State private var accountSession: AccountSession

    init() {
        InterfaceLanguagePreference.syncAppleLanguagesFromStore()
        // Before any service exists: a fault while constructing AppState or the
        // account session would otherwise leave no local trace at all.
        CrashReporter.shared.install()
        let appState = AppState()
        let sidecar = TonoSidecarService()
#if DEBUG
        let updaterEnabled = false
#else
        let updaterEnabled = AppDelegate.canStartRuntimeFromCurrentLocation
#endif
        _updater = StateObject(
            wrappedValue: AppUpdater(enabled: updaterEnabled)
        )
        _appState = State(initialValue: appState)
        _sidecar = State(initialValue: sidecar)
        _accountSession = State(initialValue: AccountSession(
            sidecar: sidecar,
            descriptorConsumer: { descriptor in
                await appState.acceptTonoTransport(descriptor)
                if descriptor == nil {
                    // acceptTonoTransport already stopped Mihomo while retaining PF.
                } else {
                    // The authenticated managed catalog was pulled before this
                    // descriptor was exposed; acceptTonoTransport auto-starts TUN.
                }
            },
            catalogConsumer: { catalog in
                try await appState.acceptManagedExitCatalog(catalog)
            },
            trafficPolicyConsumer: { policy in
                try await appState.acceptManagedTrafficPolicy(policy)
                return appState.managedTrafficPolicyRevision
            },
            cloudFallbackPreferred: {
                appState.prefersManagedCloudExit
            },
            cloudFallbackConsumer: { resumeProtection in
                try appState.acceptCloudOnlyTransport(
                    resumeProtection: resumeProtection
                )
            },
            killSwitchDisarmConsumer: {
                await appState.disconnectAndWait(releaseKillSwitch: true)
            },
            diagnosticSnapshotConsumer: {
                CrashReporter.shared.annotatedRemoteDiagnosticSnapshot(
                    appState.compactRemoteDiagnosticSnapshot()
                )
            },
            claudeTrafficResearchConsumer: {
                await appState.claudeTrafficResearchSnapshot()
            },
            protectionBlockedConsumer: { appState.isProtectionBlocked },
            protectedRetryConsumer: { appState.retryProtectedConnectionNow() },
            appRoutingResearchActivationConsumer: {
                appState.appRoutingResearchActivationChanged()
            },
            pathLatencyConsumer: {
                let selected = appState.proxyService.activeNodeName
                    ?? appState.activeNode?.name
                guard let selected,
                      let sample = appState.proxyService.lastExitSample,
                      sample.node == selected,
                      sample.ms > 0
                else { return TonoPathLatency() }
                return TonoPathLatency(
                    exitDelayMs: Int64(sample.ms),
                    exitDelayAtMs: Int64(sample.at.timeIntervalSince1970 * 1_000)
                )
            },
            routeSplitConsumer: { appState.appTrafficLedger.cumulative }
        ))
        // CRITICAL: Purge saved window frames BEFORE SwiftUI's scene management
        // reads them. SwiftUI reads NSWindow Frame / NSSplitView Subview Frames
        // during scene initialization (before applicationDidFinishLaunching),
        // so we must clear them here in init() to prevent stale sizes.
        let defaults = AppProfile.defaults
        if defaults.integer(forKey: SettingsKey.windowGeometryPolicyVersion) < 1 {
            for key in defaults.dictionaryRepresentation().keys
                where key.hasPrefix("NSWindow Frame ")
                    || key.hasPrefix("NSSplitView Subview Frames ")
            {
                defaults.removeObject(forKey: key)
            }
            defaults.set(1, forKey: SettingsKey.windowGeometryPolicyVersion)
        }
    }

    private var preferredScheme: ColorScheme? {
        switch themeMode {
        case "Light": return .light
        case "Dark": return .dark
        default: return nil
        }
    }

    private var appLocale: Locale {
        switch interfaceLanguage {
        case "简体中文": return Locale(identifier: "zh-Hans")
        case "English": return Locale(identifier: "en")
        default: return Locale.current  // "Auto" — follow system
        }
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            ZStack {
                // Size anchor: forces the ZStack to report 860×540 minimum
                // and 920×600 ideal to SwiftUI's window-sizing engine.
                // Without this, NavigationSplitView reports ~200px minimum
                // which causes the window to open at sidebar-only width.
                Color.clear
                    .frame(minWidth: 860, idealWidth: 920,
                           minHeight: 540, idealHeight: 600)

                if InterfaceLanguagePreference.hasChosen {
                    if WelcomeLaunchGate.showsIntro(
                        introSeen: introSeen,
                        sessionState: accountSession.state
                    ) {
                        WelcomeIntroView()
                    } else {
                        AccountGateView(session: accountSession) {
                            ContentView()
                                .environment(appState)
                                .environment(accountSession)
                                .environmentObject(updater)
                        }
                    }
                } else {
                    LanguageSetupView()
                }
            }
            .background(WindowConfigurator { visible in
                appState.setMainWindowVisible(visible)
            })
            .defaultAppStorage(AppProfile.defaults)
            .task {
                guard AppDelegate.canStartRuntimeFromCurrentLocation else {
                    return
                }
                appDelegate.appState = appState
                appDelegate.accountSession = accountSession
                updater.attach(appState: appState)
                // Disk only — network remains gated on account + transport ready.
                await appState.loadInitialData()
                // Load the verified local catalog before account restoration so
                // the cloud-only session can become usable from cache without
                // waiting for a second control-plane round trip.
                // Do not restore (or arm) behind the first-launch language
                // chooser. Choosing a language relaunches the app; a restore
                // in flight can leave Kill Switch armed with AccountGateView
                // not mounted, so Restore Internet is unreachable.
                if InterfaceLanguagePreference.hasChosen,
                   accountSession.state == .restoring {
                    await accountSession.restore()
                }
            }
            .preferredColorScheme(preferredScheme)
            .environment(\.locale, appLocale)
            .tonoToastHost()
            .onOpenURL { url in
                handleIncomingURL(url)
            }
        }
        .defaultSize(width: 920, height: 600)
        .windowResizability(.contentMinSize)
        .restorationBehavior(.disabled)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesView(updater: updater)
            }
        }

        // Menu Bar Extra
        MenuBarExtra {
            MenuBarView()
                .environment(appState)
                .environment(accountSession)
                .environmentObject(updater)
                .defaultAppStorage(AppProfile.defaults)
                .preferredColorScheme(preferredScheme)
                .environment(\.locale, appLocale)
        } label: {
            // Status items must be template images so AppKit can tint them
            // for light/dark menu bars and the open-highlight state. Color
            // via palette/foregroundStyle is flattened; the symbol shape
            // carries protection state. An SF Symbol is inherently a template.
            MenuBarStatusItemLabel(appState: appState)
                .environment(\.locale, appLocale)
        }
        .menuBarExtraStyle(.window)
    }

    /// Legacy install links are deliberately rejected: cloud catalog state is
    /// the only production source for credential-bearing server definitions.
    private func handleIncomingURL(_ url: URL) {
        guard !AppProfile.isDev else { return }
        guard let scheme = url.scheme?.lowercased(),
              scheme == "tono" else { return }

        guard url.host == "install-config" else { return }
        appState.errorMessage = AppDelegate.managedCatalogImportMessage
        NSApp.activate(ignoringOtherApps: true)
    }
}
