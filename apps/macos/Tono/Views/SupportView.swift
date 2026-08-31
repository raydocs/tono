import AppKit
import SwiftUI

struct SupportView: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession: AccountSession?
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(SettingsKey.remoteDiagnosticsEnabled)
    private var remoteDiagnosticsEnabled = false
    @AppStorage(
        SettingsKey.networkLogUploadEnabled,
        store: AppProfile.defaults
    ) private var networkLogUploadEnabled = true

    @State private var probe: RuntimeProbe?
    @State private var isProbing = false
    @State private var isUploadingLog = false
    /// What the last manual sweep did, once one has run on this page. The three
    /// outcomes are not interchangeable to the person waiting on them, so the
    /// button reports the one that happened rather than that a run finished.
    @State private var logUploadOutcome: DiagnosticsLogUploader.SweepOutcome?
    @State private var copiedTarget: CopyTarget?

    private static let recoveryCommand =
        "sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset"

    private enum CopyTarget: Hashable {
        case auditLogPath
        case logsFolderPath
        case report
        case recoveryCommand
        case timing
        case appVersion
    }

    private struct RuntimeProbe {
        let helperInstalled: Bool
        let helperReady: Bool
        let helperRejectsApp: Bool
        /// Whether an authenticated helper actually answered the status query.
        /// `coreRunning` is conservative when it did not — safe for the release
        /// sequence, and a lie on a diagnostics page that would otherwise read
        /// "helper not installed" and "core running" in the same panel.
        let coreStatusVerified: Bool
        let coreRunning: Bool
        let corePID: Int?
        let coreLastError: String?
    }

    var body: some View {
        let snapshot = appState.compactRemoteDiagnosticSnapshot()

        VStack(alignment: .leading, spacing: 0) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    summaryCard(snapshot)
                    webrtcCard
                    if !appState.lastConnectionStageDurations.isEmpty {
                        connectTimingCard
                    }
                    logsCard
                    diagnosticsCard(report: report(for: snapshot))
                    recoveryCard
                }
                .frame(maxWidth: 760, alignment: .leading)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task { await refreshProbe() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "Support & Diagnostics"))
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.primary)

                Text(String(localized: "State, logs and recovery steps support may ask you for."))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Button {
                Task { await refreshProbe() }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                    Text(String(localized: "Refresh"))
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        .white.opacity(colorScheme == .dark ? 0.12 : 0.5),
                        lineWidth: 0.5
                    )
                )
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .fixedSize()
            .disabled(isProbing)
        }
        .padding(.bottom, 20)
    }

    // MARK: - System Summary

    private func summaryCard(_ snapshot: TonoDiagnosticSnapshot) -> some View {
        SupportCard(icon: "info.circle", title: String(localized: "System Summary")) {
            SupportRow(
                label: String(localized: "App"),
                value: "\(AppProfile.displayName) \(snapshot.appVersion) (\(snapshot.build))"
            )
            copyButton(
                title: String(localized: "Copy version for support"),
                target: .appVersion,
                value: "Tono \(snapshot.appVersion) (\(snapshot.build)) · macOS \(osVersionText)"
            )
            supportDivider
            SupportRow(label: String(localized: "macOS"), value: osVersionText)
            supportDivider
            SupportRow(label: String(localized: "Network helper"), value: helperText)
            supportDivider
            SupportRow(label: String(localized: "Core engine"), value: coreText)
            supportDivider
            SupportRow(
                label: String(localized: "Protection"),
                value: protectionText(snapshot)
            )
            supportDivider
            SupportRow(
                label: String(localized: "Protected DNS"),
                value: snapshot.protectedDNSConfigured
                    ? "\(String(localized: "Configured")) · \(ProtectedDNSContract.listener)"
                    : String(localized: "Not configured")
            )
            supportDivider
            SupportRow(
                label: String(localized: "Active server"),
                value: snapshot.selectedExit
            )
            supportDivider
            SupportRow(
                label: String(localized: "Server catalog"),
                value: catalogText(snapshot)
            )
            supportDivider
            SupportRow(
                label: String(localized: "Traffic policy"),
                value: trafficPolicyText
            )
            supportDivider
            SupportRow(
                label: String(localized: "Support reference"),
                value: accountSession?.device?.id ?? String(localized: "Not signed in"),
                monospaced: true
            )
            supportDivider
            SupportRow(
                label: String(localized: "Last error"),
                value: lastErrorText,
                monospaced: true
            )
        }
    }

    private var webrtcCard: some View {
        SupportCard(
            icon: "dot.radiowaves.left.and.right",
            title: String(localized: "WebRTC leak check")
        ) {
            Text(String(localized: "Opens a page that shows whether your browser is leaking a local or tunnel address. Compare it with the protected IP on the dashboard."))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                if let url = URL(string: "https://ip.cx/webrtc") {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Text(String(localized: "Open WebRTC check"))
                    .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    // MARK: - Connect timing

    private var connectTimingCard: some View {
        let steps = appState.lastConnectionStageDurations
        let total = steps.reduce(0) { $0 + $1.milliseconds }
        let slowest = steps.max { $0.milliseconds < $1.milliseconds }?.id
        let timingReport = (["Tono connect timing"]
            + steps.map { "\($0.stage.localizedTitle): \(durationText($0.milliseconds))" }
            + ["Total: \(durationText(total))"]).joined(separator: "\n")
        return SupportCard(
            icon: "timer",
            title: String(localized: "Last Connect Timing")
        ) {
            Text(String(localized: "How long each step of the most recent connection took. The slowest step is highlighted — quote it when reporting a slow connect."))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)

            ForEach(steps) { step in
                SupportRow(
                    label: step.id == slowest
                        ? "\(step.stage.localizedTitle)  ●"
                        : step.stage.localizedTitle,
                    value: durationText(step.milliseconds),
                    monospaced: true
                )
                supportDivider
            }
            SupportRow(
                label: String(localized: "Total"),
                value: durationText(total),
                monospaced: true
            )

            copyButton(
                title: String(localized: "Copy timing"),
                target: .timing,
                value: timingReport
            )
            .padding(.top, 8)
        }
    }

    private func durationText(_ milliseconds: Int) -> String {
        milliseconds < 1_000
            ? "\(milliseconds) ms"
            : String(format: "%.2f s", Double(milliseconds) / 1_000)
    }

    // MARK: - Logs

    private var logsCard: some View {
        SupportCard(icon: "doc.text.magnifyingglass", title: String(localized: "Local Logs")) {
            Text(String(localized: "Tono keeps one redacted log file. Support may call it the audit log or the diagnostics log — it is the same file. Credentials and URL queries are removed before anything is written, and TLS bodies are never observed. In this test build the file is also uploaded to Tono support so routing bugs can be diagnosed without asking you for it; it carries the hostnames you connected to, the process that opened each connection, and which rule and route it matched. Settings › Privacy turns the upload off."))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            pathRow(
                label: String(localized: "Audit & diagnostics log"),
                path: LocalTrafficAudit.shared.logFileURL.path,
                copyTarget: .auditLogPath,
                reveal: {
                    let url = LocalTrafficAudit.shared.prepareForReveal()
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
            )

            supportDivider

            pathRow(
                label: String(localized: "Logs folder"),
                path: logsFolderURL.path,
                copyTarget: .logsFolderPath,
                reveal: {
                    _ = LocalTrafficAudit.shared.prepareForReveal()
                    NSWorkspace.shared.activateFileViewerSelecting([logsFolderURL])
                }
            )

            supportDivider

            // The upload already runs on a timer; this exists for the support
            // conversation, where waiting two minutes for the tick is the
            // difference between diagnosing a live symptom and losing it.
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(String(localized: "Send the newest log segment to support now"))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button(isUploadingLog
                        ? String(localized: "Sending…")
                        : String(localized: "Upload now")) {
                        guard !isUploadingLog, logUploadBlockedReason == nil,
                              let accountSession else { return }
                        isUploadingLog = true
                        logUploadOutcome = nil
                        Task {
                            let outcome = await accountSession
                                .uploadDiagnosticsLogNow()
                            isUploadingLog = false
                            logUploadOutcome = outcome
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tint)
                    .disabled(isUploadingLog || logUploadBlockedReason != nil)
                }

                // Each of these preconditions makes the sweep return without
                // sending anything, and the button cannot tell that apart from a
                // send once it has finished. Naming the missing one beats
                // spending the wait on "Sending…" and then reporting nothing.
                if let blocked = logUploadBlockedReason {
                    HStack(spacing: 8) {
                        Text(blocked)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if !networkLogUploadEnabled {
                            Button(String(localized: "Open Settings")) {
                                appState.selectedPage = .settings
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.tint)
                        }
                    }
                } else if let outcome = logUploadOutcome {
                    Text(Self.logUploadOutcomeText(outcome))
                        .font(.system(size: 11))
                        .foregroundStyle(
                            Self.logUploadOutcomeFailed(outcome)
                                ? Color.orange
                                : Color.secondary
                        )
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private static func logUploadOutcomeText(
        _ outcome: DiagnosticsLogUploader.SweepOutcome
    ) -> String {
        switch outcome {
        case .uploaded:
            String(localized: "Sent. The newest log segment is with Tono support.")
        case .idle:
            String(localized: "Nothing to send — the log has not advanced since the last upload.")
        case .disabled:
            String(localized: "Nothing was sent: log upload is off in Settings › Privacy.")
        case let .failed(reason):
            String(localized: "Upload failed. \(reason)")
        }
    }

    private static func logUploadOutcomeFailed(
        _ outcome: DiagnosticsLogUploader.SweepOutcome
    ) -> Bool {
        switch outcome {
        case .uploaded, .idle: false
        case .disabled, .failed: true
        }
    }

    /// Why the manual upload would send nothing right now, or nil when it can
    /// run. These mirror the preconditions the session's own upload loop checks:
    /// with any of them missing the sweep returns without touching the network.
    private var logUploadBlockedReason: String? {
        guard let accountSession, accountSession.user != nil, accountSession.isReady else {
            return String(localized: "Sign in to send the log to support.")
        }
        guard networkLogUploadEnabled else {
            return String(localized: "Log upload is off. Turn it on in Settings › Privacy.")
        }
        return nil
    }

    // MARK: - Diagnostics Report

    private func diagnosticsCard(report: String) -> some View {
        SupportCard(icon: "shield.lefthalf.filled", title: String(localized: "Redacted Diagnostics Report")) {
            Text(String(localized: "This is what Tono reports when support requests a diagnostic snapshot, followed by the catalog and traffic-policy state the uploaded snapshot has no field for. It carries no hostnames, IP addresses, process names or account tokens. It is a separate, smaller report than the audit log above, which in this test build is uploaded in full."))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            ScrollView {
                Text(report)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .scrollIndicators(.visible)
            .frame(maxHeight: 220)
            .background(
                .white.opacity(colorScheme == .dark ? 0.06 : 0.35),
                in: RoundedRectangle(cornerRadius: 12)
            )

            copyButton(
                title: String(localized: "Copy report"),
                target: .report,
                value: report
            )

            supportDivider

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(localized: "Remote diagnostics"))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                    Text(String(localized: "Turn this on in Settings › Privacy."))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(remoteDiagnosticsEnabled
                        ? String(localized: "On")
                        : String(localized: "Off"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(remoteDiagnosticsEnabled ? .green : .secondary)
                    Button(String(localized: "Open Settings")) {
                        appState.selectedPage = .settings
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tint)
                }
            }
        }
    }

    // MARK: - Recovery

    private var recoveryCard: some View {
        SupportCard(icon: "wrench.and.screwdriver", title: String(localized: "Recovery")) {
            Text(String(localized: "Use this only when Tono cannot repair its network helper and the internet stays blocked after you quit Tono: it clears the helper's leftover network rules so the Mac connects normally again."))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Text(Self.recoveryCommand)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    .white.opacity(colorScheme == .dark ? 0.06 : 0.35),
                    in: RoundedRectangle(cornerRadius: 10)
                )

            copyButton(
                title: String(localized: "Copy recovery command"),
                target: .recoveryCommand,
                value: Self.recoveryCommand
            )
        }
    }

    // MARK: - Rows & Buttons

    private func pathRow(
        label: String,
        path: String,
        copyTarget: CopyTarget,
        reveal: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)

            Text(path)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 14) {
                Button(String(localized: "Show in Finder"), action: reveal)
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tint)

                Button(
                    copiedTarget == copyTarget
                        ? String(localized: "Copied")
                        : String(localized: "Copy path")
                ) {
                    copy(path, target: copyTarget)
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.tint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func copyButton(
        title: String,
        target: CopyTarget,
        value: String
    ) -> some View {
        Button {
            copy(value, target: target)
        } label: {
            HStack(spacing: 5) {
                Image(systemName: copiedTarget == target ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11))
                Text(copiedTarget == target ? String(localized: "Copied") : title)
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    .white.opacity(colorScheme == .dark ? 0.12 : 0.5),
                    lineWidth: 0.5
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
    }

    private var supportDivider: some View {
        Divider()
            .opacity(0.3)
            .padding(.vertical, 2)
    }

    // MARK: - Derived Text

    private var osVersionText: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    private var helperText: String {
        guard let probe else { return String(localized: "Checking…") }
        if probe.helperReady {
            return "\(String(localized: "Ready")) · \(HelperProtocolVersion.current)"
        }
        if probe.helperRejectsApp {
            return String(localized: "Installed · rejecting this app")
        }
        if probe.helperInstalled {
            return String(localized: "Installed · not responding")
        }
        return String(localized: "Not installed")
    }

    private var coreText: String {
        guard let probe else { return String(localized: "Checking…") }
        guard probe.coreStatusVerified else {
            return String(localized: "Unknown · the helper did not answer")
        }
        if probe.coreRunning {
            guard let pid = probe.corePID else { return String(localized: "Running") }
            return "\(String(localized: "Running")) · PID \(pid)"
        }
        guard let error = probe.coreLastError, !error.isEmpty else {
            return String(localized: "Stopped")
        }
        return "\(String(localized: "Stopped")) · \(error)"
    }

    private func protectionText(_ snapshot: TonoDiagnosticSnapshot) -> String {
        let state: String
        if snapshot.disconnecting {
            state = String(localized: "Disconnecting…")
        } else if snapshot.connecting {
            state = String(localized: "Connecting…")
        } else if snapshot.protectionBlocked {
            state = String(localized: "Protected Offline")
        } else if snapshot.connected {
            state = String(localized: "Active")
        } else {
            state = String(localized: "Inactive")
        }
        let killSwitch = snapshot.killSwitchArmed
            ? String(localized: "Kill Switch armed")
            : String(localized: "Kill Switch off")
        let tunnel = snapshot.utunPresent
            ? String(localized: "TUN active")
            : String(localized: "TUN missing")
        return "\(state) · \(killSwitch) · \(tunnel)"
    }

    private var lastErrorText: String {
        if let message = appState.errorMessage { return message }
        if let failure = appState.lastConnectionFailure {
            return "\(failure.stage.localizedTitle): \(failure.message)"
        }
        return String(localized: "None")
    }

    private var logsFolderURL: URL {
        LocalTrafficAudit.shared.logFileURL.deletingLastPathComponent()
    }

    private func catalogText(_ snapshot: TonoDiagnosticSnapshot) -> String {
        let revision = snapshot.catalogRevision.map { "v\($0)" }
            ?? String(localized: "No verified catalog installed")
        guard let failure = accountSession?.catalogFailureMessage else {
            return revision
        }
        return "\(revision) · \(failure)"
    }

    /// The managed traffic policy pins the WeChat direct route. A stale one
    /// degrades that route quietly, and until now neither its revision nor the
    /// reason its refresh failed appeared on any support surface.
    private var trafficPolicyText: String {
        guard let accountSession else { return String(localized: "Not signed in") }
        let revision = accountSession.trafficPolicyRevision.map { "v\($0)" }
            ?? String(localized: "Not refreshed since launch")
        guard let failure = accountSession.trafficPolicyFailureMessage else {
            return revision
        }
        return "\(revision) · \(failure)"
    }

    /// The preview is the encoded payload of the same snapshot builder the
    /// remote diagnostic action uploads, so the two can never disagree, plus
    /// the supplemental lines below that the snapshot has no field for.
    private func report(for snapshot: TonoDiagnosticSnapshot) -> String {
        let encoder = TonoCoding.encoder()
        encoder.outputFormatting = [
            .prettyPrinted, .sortedKeys, .withoutEscapingSlashes,
        ]
        guard let data = try? encoder.encode(snapshot),
              let text = String(data: data, encoding: .utf8) else {
            return String(localized: "Diagnostics report unavailable")
        }
        return ([text] + supplementalReportLines).joined(separator: "\n")
    }

    /// Catalog and traffic-policy state the uploaded snapshot has no field for.
    /// Support asks for both whenever a route misbehaves, and the only copy of
    /// either was a stored value nothing rendered or copied.
    private var supplementalReportLines: [String] {
        guard let accountSession else { return [] }
        var lines = [
            "trafficPolicyRevision: "
                + (accountSession.trafficPolicyRevision.map { "\($0)" } ?? "none"),
        ]
        if let failure = accountSession.catalogFailureMessage {
            lines.append("catalogFailure: \(failure)")
        }
        if let failure = accountSession.trafficPolicyFailureMessage {
            lines.append("trafficPolicyFailure: \(failure)")
        }
        return lines
    }

    // MARK: - Actions

    private func copy(_ value: String, target: CopyTarget) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        copiedTarget = target
        Task {
            try? await Task.sleep(for: .seconds(2))
            if copiedTarget == target { copiedTarget = nil }
        }
    }

    private func refreshProbe() async {
        guard !isProbing else { return }
        isProbing = true
        defer { isProbing = false }
        let core = await PrivilegedRuntimeCoordinator.shared.coreStatus()
        // Helper probes talk to the privileged socket with blocking timeouts;
        // never resolve them on the UI actor.
        let helper = await Task.detached {
            let installed = HelperManager.hasInstalledHelperArtifact
            let ready = HelperManager.isHelperRunning()
            let rejects = ready ? false : HelperManager.daemonRejectsClient()
            return (installed: installed, ready: ready, rejects: rejects)
        }.value
        probe = RuntimeProbe(
            helperInstalled: helper.installed,
            helperReady: helper.ready,
            helperRejectsApp: helper.rejects,
            coreStatusVerified: core.verified,
            coreRunning: core.running,
            corePID: core.pid,
            coreLastError: core.lastError
        )
    }
}

// MARK: - Card Container

private struct SupportCard<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let icon: String
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(.primary)
                    .frame(width: 36, height: 36)
                    .background(
                        .white.opacity(colorScheme == .dark ? 0.1 : 0.5),
                        in: RoundedRectangle(cornerRadius: 10)
                    )

                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
            }
            .padding(.bottom, 2)

            content
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            .white.opacity(colorScheme == .dark ? 0.08 : 0.4),
            in: RoundedRectangle(cornerRadius: 24)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .strokeBorder(
                    .white.opacity(colorScheme == .dark ? 0.12 : 0.7),
                    lineWidth: 1
                )
        )
    }
}

// MARK: - Summary Row

private struct SupportRow: View {
    let label: String
    let value: String
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .frame(width: 150, alignment: .leading)

            Text(value)
                .font(.system(size: 12, weight: .medium, design: monospaced ? .monospaced : .default))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        SupportView()
    }
    .frame(width: 900, height: 700)
    .environment(AppState())
}
