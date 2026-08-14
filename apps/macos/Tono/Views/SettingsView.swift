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
    @AppStorage(SettingsKey.claudeTrafficResearchEnabled)
    private var claudeTrafficResearchEnabled = false
    @AppStorage(
        SettingsKey.aggregatedAppRoutingResearchEnabled,
        store: AppProfile.defaults
    ) private var aggregatedAppRoutingResearchEnabled = false
    @AppStorage(
        SettingsKey.networkLogUploadEnabled,
        store: AppProfile.defaults
    ) private var networkLogUploadEnabled = true
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
                settingsPicker(selection: $selectedLanguage, options: languages)
                    .onChange(of: selectedLanguage) { _, language in
                        InterfaceLanguagePreference.apply(language)
                        InterfaceLanguagePreference.relaunch()
                    }
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
                    Color(hex: "4B6EFF").opacity(0.1),
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
                label: "Remote diagnostics",
                subtitle: "Share protection status with Tono support",
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
                .tint(.accentColor)
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
