import SwiftUI
import ServiceManagement
import AppKit

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession
    @EnvironmentObject private var updater: AppUpdater
    @Environment(\.colorScheme) private var colorScheme

    @State private var launchAtStartup =
        SMAppService.mainApp.status == .enabled
    @State private var isUpdatingLaunchAtStartup = false
    @State private var launchAtStartupMessage: String?
    @AppStorage(SettingsKey.interfaceLanguage, store: AppProfile.defaults)
    private var selectedLanguage = InterfaceLanguagePreference.auto
    @AppStorage(SettingsKey.logsEnabled) private var logsEnabled = true
    @AppStorage(SettingsKey.localTrafficAuditEnabled)
    private var localTrafficAuditEnabled = true
    @AppStorage(SettingsKey.remoteDiagnosticsEnabled)
    private var remoteDiagnosticsEnabled = false
    @AppStorage(SettingsKey.crashReportingEnabled)
    private var crashReportingEnabled = true
    @AppStorage(SettingsKey.claudeTrafficResearchEnabled)
    private var claudeTrafficResearchEnabled = false
    @AppStorage(
        SettingsKey.aggregatedAppRoutingResearchEnabled,
        store: AppProfile.defaults
    ) private var aggregatedAppRoutingResearchEnabled = false
    @AppStorage(
        SettingsKey.networkLogUploadEnabled,
        store: AppProfile.defaults
    ) private var networkLogUploadEnabled = false
    @AppStorage(
        SettingsKey.periodicTelemetryEnabled,
        store: AppProfile.defaults
    ) private var periodicTelemetryEnabled = false
    @AppStorage(SettingsKey.themeMode) private var themeMode = "Adaptive"

    private let languages = InterfaceLanguagePreference.options
    private let themes = ["Light", "Dark", "Adaptive"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Settings")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.primary)
                .padding(.bottom, 20)

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    AccountSettingsCard(session: accountSession)

                    Grid(horizontalSpacing: 20, verticalSpacing: 20) {
                        GridRow {
                            preferencesCard
                            aboutCard
                        }
                    }

                    privacyCard
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Preferences

    private var preferencesCard: some View {
        SettingsCard(icon: "gearshape", title: "Preferences") {
            SettingToggleRow(
                label: "Open at login",
                isOn: Binding(
                    get: { launchAtStartup },
                    set: setLaunchAtStartup
                )
            )
            .disabled(isUpdatingLaunchAtStartup)

            if let launchAtStartupMessage {
                Text(launchAtStartupMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            settingDivider

            SettingRow(label: "Language") {
                settingsPicker(
                    selection: Binding(
                        get: { selectedLanguage },
                        set: changeLanguage
                    ),
                    options: languages
                )
            }

            settingDivider

            SettingRow(label: "Theme") {
                settingsPicker(selection: $themeMode, options: themes)
            }

            settingDivider

            SettingToggleRow(
                label: "Show Logs page",
                isOn: $logsEnabled
            )
        }
    }

    // MARK: - About

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Tono")
                        .font(.system(size: 14, weight: .semibold))
                    Text(versionLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            settingDivider

            HStack {
                Text("Updates")
                    .font(.system(size: 13, weight: .medium))
                Spacer()
                Button("Check for Updates") {
                    updater.checkForUpdates()
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.tint)
                .disabled(!updater.canCheckForUpdates)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            LinearGradient(
                colors: [
                    TonoBrand.accent.opacity(0.1),
                    Color(hex: "FF6E52").opacity(0.1)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 24)
        )
        .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: RoundedRectangle(cornerRadius: 24))
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.7), lineWidth: 1)
        )
    }

    private var versionLabel: String {
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "0.0.1"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String ?? "0"
        return String(localized: "Version \(version) (\(build))")
    }

    // MARK: - Privacy

    private var privacyCard: some View {
        SettingsCard(icon: "hand.raised", title: "Privacy") {
            SettingToggleRow(
                label: "Crash reporting",
                subtitle: "Tell Tono support when this app crashed",
                isOn: $crashReportingEnabled
            )

            settingDivider

            SettingToggleRow(
                label: "Protection snapshot",
                subtitle: "Off by default. When enabled, about every 20 minutes share protection status, the selected server and recent connection events with Tono support",
                isOn: $periodicTelemetryEnabled
            )
            .onChange(of: periodicTelemetryEnabled) { _, _ in
                accountSession.periodicTelemetrySettingChanged()
            }

            settingDivider

            // The subtitle names the remote actions rather than the protection
            // status: this switch has never governed the periodic snapshot
            // above, and describing it as sharing status told people the
            // snapshot was off when it was uploading regardless.
            SettingToggleRow(
                label: "Remote diagnostics",
                subtitle: "Let Tono support ask this Mac for a snapshot, refresh its server list or retry protection",
                isOn: $remoteDiagnosticsEnabled
            )
            .onChange(of: remoteDiagnosticsEnabled) { _, enabled in
                accountSession.remoteDiagnosticsSettingChanged()
                if !enabled, claudeTrafficResearchEnabled {
                    claudeTrafficResearchEnabled = false
                    appState.setClaudeTrafficResearchEnabled(false)
                }
            }

            settingDivider

            SettingToggleRow(
                label: "Network log upload",
                subtitle: "Automatically upload the full traffic log in the background",
                isOn: $networkLogUploadEnabled
            )
            .onChange(of: networkLogUploadEnabled) { _, _ in
                accountSession.networkLogUploadSettingChanged()
            }

            settingDivider

            SettingToggleRow(
                label: "App routing research",
                subtitle: "Share anonymized app-route counts",
                isOn: $aggregatedAppRoutingResearchEnabled
            )
            .onChange(of: aggregatedAppRoutingResearchEnabled) { _, enabled in
                appState.setAggregatedAppRoutingResearchEnabled(enabled)
                accountSession.appRoutingResearchSettingChanged()
            }

            settingDivider

            SettingToggleRow(
                label: "Claude & WeChat research",
                subtitle: "Requires diagnostics. Route aggregates only.",
                isOn: $claudeTrafficResearchEnabled
            )
            .onChange(of: claudeTrafficResearchEnabled) { _, enabled in
                appState.setClaudeTrafficResearchEnabled(enabled)
            }
            .disabled(!remoteDiagnosticsEnabled)

            settingDivider

            SettingToggleRow(
                label: "Local traffic log",
                subtitle: "Save connections on this Mac",
                isOn: $localTrafficAuditEnabled
            )
            .onChange(of: localTrafficAuditEnabled) { _, enabled in
                appState.setLocalTrafficAuditEnabled(enabled)
            }

            settingDivider

            SettingRow(label: "Audit Log") {
                Button("Show in Finder") {
                    let url = LocalTrafficAudit.shared.prepareForReveal()
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.tint)
            }
        }
    }

    // MARK: - Helpers

    /// Switching language quits and reopens Tono, which takes the tunnel down
    /// and releases Kill Switch on the way out. Ask first while this Mac is
    /// protected; the preference is written only once the user agrees, so a
    /// declined switch leaves the picker on the language still in use.
    ///
    /// An armed Kill Switch counts as protected even with nothing connected:
    /// that is the fail-closed state after a failed connect or a network
    /// change, and the termination cleanup disarms PF on the way out just the
    /// same. Asking only about a live tunnel would open that Mac to direct
    /// traffic with no warning at all.
    private func changeLanguage(_ language: String) {
        guard language != selectedLanguage else { return }
        if appState.isConnected || appState.isConnecting || KillSwitchService.isArmed {
            guard confirmLanguageRestart() else { return }
        }
        InterfaceLanguagePreference.apply(language)
        InterfaceLanguagePreference.relaunch()
    }

    private func confirmLanguageRestart() -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "Change the language and reopen Tono?")
        alert.informativeText = String(
            localized: "Tono has to quit and reopen to change languages. This Mac is protected right now, so the connection is dropped and Kill Switch is released until you connect again."
        )
        alert.addButton(withTitle: String(localized: "Reopen Tono"))
        alert.addButton(withTitle: String(localized: "Cancel"))
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func setLaunchAtStartup(_ enabled: Bool) {
        guard !isUpdatingLaunchAtStartup else { return }
        isUpdatingLaunchAtStartup = true
        launchAtStartupMessage = nil

        Task {
            defer { isUpdatingLaunchAtStartup = false }
            do {
                if enabled {
                    if SMAppService.mainApp.status != .enabled {
                        try SMAppService.mainApp.register()
                    }
                } else if SMAppService.mainApp.status == .enabled
                            || SMAppService.mainApp.status == .requiresApproval {
                    try await SMAppService.mainApp.unregister()
                }

                let status = SMAppService.mainApp.status
                launchAtStartup = status == .enabled
                AppProfile.defaults.set(
                    launchAtStartup,
                    forKey: SettingsKey.launchAtStartup
                )
                if status == .requiresApproval {
                    launchAtStartupMessage =
                        "Allow Tono in System Settings › General › Login Items."
                }
            } catch {
                launchAtStartup =
                    SMAppService.mainApp.status == .enabled
                launchAtStartupMessage =
                    "Could not update Login Items: \(error.localizedDescription)"
            }
        }
    }

    private var settingDivider: some View {
        Divider()
            .opacity(0.3)
            .padding(.vertical, 2)
    }

    private func settingsPicker(selection: Binding<String>, options: [String]) -> some View {
        Menu {
            ForEach(options, id: \.self) { option in
                Button {
                    selection.wrappedValue = option
                } label: {
                    if selection.wrappedValue == option {
                        Label(option, systemImage: "checkmark")
                    } else {
                        Text(option)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(LocalizedStringKey(selection.wrappedValue))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.primary)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), lineWidth: 0.5))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Settings Card Container

private struct SettingsCard<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let icon: String
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(.primary)
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(colorScheme == .dark ? 0.1 : 0.5), in: RoundedRectangle(cornerRadius: 10))

                Text(LocalizedStringKey(title))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
            }

            content
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: RoundedRectangle(cornerRadius: 24))
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.7), lineWidth: 1)
        )
    }
}

private struct SettingRow<Trailing: View>: View {
    let label: String
    var subtitle: String?
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(LocalizedStringKey(label))
                    .font(.system(size: 13, weight: .medium))
                if let subtitle {
                    Text(LocalizedStringKey(subtitle))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(.vertical, 2)
    }
}

private struct SettingToggleRow: View {
    let label: String
    var subtitle: String?
    @Binding var isOn: Bool

    var body: some View {
        SettingRow(label: label, subtitle: subtitle) {
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .tint(TonoBrand.accent)
                .labelsHidden()
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        SettingsView()
    }
    .frame(width: 800, height: 600)
    .environment(AppState())
    .environmentObject(AppUpdater(enabled: false))
}
