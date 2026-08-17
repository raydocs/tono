#if DEBUG
import AuthenticationServices
#endif
import SwiftUI
import AppKit

struct AccountGateView<Content: View>: View {
    @Bindable var session: AccountSession
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            if session.state == .ready {
                // ContentView owns its background. Keeping the account-gate
                // visual-effect view underneath it doubled the live desktop
                // blur cost for the entire connected session.
                content()
            } else if session.state == .restoring {
                ZStack {
                    // Paint the real application shell immediately while the
                    // authenticated session is validated. Controls stay inert,
                    // but launch no longer feels like a blank blocking screen.
                    content()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)

                    // Stronger than 0.08 so Dashboard type does not punch
                    // through the restoring copy. No extra blur: the gate
                    // already paid for ContentView's frost underneath.
                    Rectangle()
                        .fill(.black.opacity(0.20))
                        .ignoresSafeArea()

                    RestoringSessionCard()
                }
                // NavigationSplitView (ContentView underneath) installs a
                // system sidebar toggle. The gate has no sidebar.
                .toolbar(removing: .sidebarToggle)
            } else {
                ZStack {
                    // Account states are displayed before ContentView exists,
                    // so they need their own full-window background.
                    MeshGradientBackground(emphasis: true)

                    Group {
                        switch session.state {
                        case .restoring:
                            EmptyView()
                        case .signedOut, .authenticating, .error:
                            LoginView(session: session)
                        case .enrolling:
                            ProgressView("Enrolling this Mac with Tono…")
                        case .suspended:
                            ContentUnavailableView(
                                "Tono account suspended",
                                systemImage: "exclamationmark.shield",
                                description: Text("Contact your administrator to restore access.")
                            )
                        case .ready:
                            EmptyView()
                        }
                    }
                }
                .toolbar(removing: .sidebarToggle)
            }
        }
    }
}

struct LoginView: View {
    @Bindable var session: AccountSession
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var email = ""
    @State private var emailCode = ""
    @State private var deviceName = Host.current().localizedName ?? "Mac"
    @State private var restoredInternetFromGate = false
    /// Guards the six-digit auto-submit against firing twice for the same code
    /// (error state flips, focus loss, re-entrant onChange from filtering).
    @State private var autoSubmittedCode: String?
    @State private var resendCountdown = 0
    @State private var resendTimer: Task<Void, Never>?
    @State private var showErrorDetails = false

    private var busy: Bool { session.state == .authenticating }
    private var error: String? { if case let .error(message) = session.state { message } else { nil } }
    private var methods: TonoAuthMethodsResponse? { session.authMethods }
    private var nativeAppleSignInEnabled: Bool {
        #if DEBUG
        methods?.apple.enabled == true
        #else
        false
        #endif
    }
    private var nativeGoogleSignInEnabled: Bool {
        #if DEBUG
        methods?.google.enabled == true
        #else
        false
        #endif
    }

    var body: some View {
        VStack(spacing: 18) {
            LiquidClashLogo(compact: true)
                .frame(width: 56, height: 56)
            Text("Welcome to Tono").font(.title.bold())
            Text("Sign in with a verified email to continue. No password is required.")
                .foregroundStyle(.secondary).multilineTextAlignment(.center)

            if session.isAtDeviceLimit {
                Label("Your \(session.deviceLimit)-device allowance is full. Sign in and revoke another device if needed.", systemImage: "desktopcomputer.trianglebadge.exclamationmark")
                    .font(.callout).foregroundStyle(TonoStatus.blocked)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(TonoStatus.blocked.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(TonoStatus.blocked.opacity(0.18), lineWidth: 0.7)
                    }
            }
            if let error {
                LoginErrorBlock(
                    message: error,
                    isExpanded: $showErrorDetails,
                    reduceMotion: reduceMotion
                )

                // methods != nil is the signed-in-form branch: the only Retry
                // used to live on the methods == nil path, so a helper launch
                // failure after methods loaded had no recovery button at all.
                if session.user == nil && methods != nil {
                    Button {
                        Task { await session.retryRestore() }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().controlSize(.small) }
                            Text("Retry")
                        }
                    }
                    .buttonStyle(GateProminentButtonStyle())
                    .disabled(busy)
                }
            }

            if session.user != nil {
                Button("Retry Tono connection") { Task { await session.retryRuntime() } }
                    .buttonStyle(GateProminentButtonStyle())
                Button("Sign Out", role: .destructive) { Task { await session.logout() } }
            } else {
                gateField("Device name", text: $deviceName)

                if let methods {
                    if methods.email.enabled {
                        VStack(spacing: 10) {
                            gateField("Email", text: $email)
                            if session.emailChallenge != nil {
                                gateField("Six-digit email code", text: $emailCode)
                                    .textContentType(.oneTimeCode)
                                    .onChange(of: emailCode) { _, newValue in
                                        handleCodeChange(newValue)
                                    }
                                Button {
                                    Task { await session.verifyEmailCode(emailCode) }
                                } label: {
                                    busyLabel("Verify email code")
                                }
                                .buttonStyle(GateProminentButtonStyle())
                                .disabled(busy)
                            }
                            Button {
                                Task {
                                    await session.requestEmailCode(
                                        email: email,
                                        deviceName: deviceName
                                    )
                                    // A fresh challenge means the send went
                                    // through; the resend cooldown starts now.
                                    if session.emailChallenge != nil {
                                        startResendCountdown()
                                    }
                                }
                            } label: {
                                busyLabel(resendButtonTitle)
                            }
                            .buttonStyle(GateProminentButtonStyle())
                            .disabled(busy || resendCountdown > 0)
                            if session.emailChallenge != nil {
                                Text("If this address is eligible, the code is valid for 10 minutes.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if nativeAppleSignInEnabled || nativeGoogleSignInEnabled {
                        HStack {
                            Divider()
                            Text("or").font(.caption).foregroundStyle(.secondary)
                            Divider()
                        }
                        .frame(height: 18)
                    }

                    #if DEBUG
                    if nativeAppleSignInEnabled {
                        TonoAppleSignInButton {
                            Task {
                                await session.signInWithApple(
                                    deviceName: deviceName
                                )
                            }
                        }
                        .frame(height: 42)
                        .disabled(busy)
                    }

                    if nativeGoogleSignInEnabled {
                        Button {
                            Task {
                                await session.signInWithGoogle(
                                    deviceName: deviceName
                                )
                            }
                        } label: {
                            HStack {
                                Image(systemName: "globe")
                                busyLabel("Sign in with Google")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(busy)
                    }
                    #endif

                    if !methods.email.enabled && !nativeAppleSignInEnabled && !nativeGoogleSignInEnabled {
                        ContentUnavailableView(
                            "No sign-in method configured",
                            systemImage: "person.crop.circle.badge.exclamationmark",
                            description: Text("Configure email sign-in in the Tono control plane.")
                        )
                    }
                } else {
                    if error == nil {
                        ProgressView("Loading secure sign-in options…")
                    } else {
                        Label("Secure sign-in service is unavailable", systemImage: "network.slash")
                            .font(.callout.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                    Button("Retry") { Task { await session.retryRestore() } }
                        .disabled(busy || error == nil)
                    if error != nil {
                        // A launch failure at the gate is exactly when runtime
                        // logs don't exist yet; the local audit log is the only
                        // record of what went wrong and needs no network or
                        // signed-in session to share with support.
                        Button("Show Diagnostics Log in Finder") {
                            let url = LocalTrafficAudit.shared.prepareForReveal()
                            NSWorkspace.shared.activateFileViewerSelecting([url])
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                }
                if KillSwitchService.isArmed, !restoredInternetFromGate {
                    // A fail-closed host whose session cannot reach .ready
                    // (crash recovery + unreachable control plane) previously
                    // had NO restore-internet control anywhere: the dashboard
                    // needs .ready and the menu-bar toggle is disabled. This
                    // is the explicit escape hatch. isArmed is a plain static
                    // (not observable), so the local flag forces the section
                    // to update once the restore completes.
                    Divider().padding(.vertical, 4)
                    Label(
                        "Kill Switch is blocking direct Internet from an earlier session.",
                        systemImage: "shield.slash"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Button("Restore internet (turn off protection)") {
                        Task {
                            await session.restoreDirectInternet()
                            restoredInternetFromGate = !KillSwitchService.isArmed
                        }
                    }
                    .disabled(busy)
                }
            }
        }
        .padding(28)
        .frame(width: 470)
        .background(
            .white.opacity(colorScheme == .dark ? 0.08 : 0.42),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(
                    colorScheme == .dark
                        ? .white.opacity(0.12)
                        : .black.opacity(0.14),
                    lineWidth: colorScheme == .dark ? 0.5 : 1
                )
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.1), radius: 24, y: 10)
        .task {
            if session.authMethods == nil && session.user == nil {
                await session.loadAuthMethods()
            }
        }
        .onChange(of: error) { _, _ in
            showErrorDetails = false
        }
        .onDisappear {
            resendTimer?.cancel()
        }
    }

    private var resendButtonTitle: String {
        if session.emailChallenge == nil {
            return String(localized: "Email me a sign-in code")
        }
        if resendCountdown > 0 {
            return String(localized: "Send a new code (\(resendCountdown)s)")
        }
        return String(localized: "Send a new code")
    }

    /// Digits-only, capped at six; a complete code submits itself once.
    private func handleCodeChange(_ newValue: String) {
        let digits = String(newValue.filter(\.isNumber).prefix(6))
        if digits != newValue {
            emailCode = digits
            return
        }
        if digits.count < 6 {
            autoSubmittedCode = nil
            return
        }
        guard !busy, autoSubmittedCode != digits else { return }
        autoSubmittedCode = digits
        Task { await session.verifyEmailCode(digits) }
    }

    private func startResendCountdown() {
        resendTimer?.cancel()
        resendCountdown = 60
        resendTimer = Task { @MainActor in
            while !Task.isCancelled && resendCountdown > 0 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                resendCountdown -= 1
            }
        }
    }

    /// Rounded glass input matching the Proxies/Logs search fields.
    @ViewBuilder
    private func gateField(_ title: LocalizedStringKey, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                .white.opacity(colorScheme == .dark ? 0.07 : 0.38),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        .white.opacity(colorScheme == .dark ? 0.12 : 0.6),
                        lineWidth: 0.5
                    )
            }
    }

    @ViewBuilder
    private func busyLabel(_ title: String) -> some View {
        HStack {
            if busy { ProgressView().controlSize(.small) }
            Text(title)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Solid accent fill + white type. System `.borderedProminent` draws white
/// labels without a fill when the login card sits on glass / an inactive
/// window — the control then vanishes on a light surface.
private struct GateProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(
                TonoBrand.accent.opacity(isEnabled ? 1 : 0.45),
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(TonoMotion.easeOut(0.1, reduceMotion: reduceMotion), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .tint(.white)
    }
}

/// Restoring overlay copy lives on its own glass card so Dashboard type
/// behind the scrim cannot interleave with the caption.
private struct RestoringSessionCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showSlowHint = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                Text("Restoring your Tono session…")
                    .font(.system(size: 13, weight: .medium))
            }

            Text(LoginErrorCopy.helperAdminExplanation)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)

            if showSlowHint {
                Text(String(localized: "Taking longer than usual — still checking your session and network helper."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
        .background(
            .white.opacity(colorScheme == .dark ? 0.08 : 0.42),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(
                    colorScheme == .dark
                        ? .white.opacity(0.12)
                        : .black.opacity(0.14),
                    lineWidth: colorScheme == .dark ? 0.5 : 1
                )
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.12), radius: 18, y: 8)
        .task {
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled else { return }
            withAnimation(TonoMotion.easeOut(0.25, reduceMotion: reduceMotion)) {
                showSlowHint = true
            }
        }
    }
}

/// UI-only headline / helper copy. The service-layer message string is never
/// rewritten — we only decide what to show first and what stays behind details.
enum LoginErrorCopy {
    static let helperAdminExplanation = String(localized: "Tono may ask for administrator access to install its signed network helper — this is what routes and protects your traffic.")

    /// First sentence (through the first "."), or the span before " Click".
    /// If neither cut exists, the first 80 characters plus an ellipsis.
    static func headline(from message: String) -> String {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return text }

        // Chinese error copy ends sentences with a fullwidth stop and has no
        // " Click" marker; treat both sentence terminators the same way.
        let period = [text.firstIndex(of: "."), text.firstIndex(of: "。")]
            .compactMap { $0 }
            .min()
        let click = text.range(of: " Click")?.lowerBound

        let cut: String.Index?
        let includePeriod: Bool
        switch (period, click) {
        case let (periodIndex?, clickIndex?):
            if periodIndex < clickIndex {
                cut = periodIndex
                includePeriod = true
            } else {
                cut = clickIndex
                includePeriod = false
            }
        case let (periodIndex?, nil):
            cut = periodIndex
            includePeriod = true
        case let (nil, clickIndex?):
            cut = clickIndex
            includePeriod = false
        case (nil, nil):
            cut = nil
            includePeriod = false
        }

        if let cut, cut > text.startIndex {
            var title = String(text[..<cut])
            if includePeriod {
                // Keep whichever sentence terminator was actually cut on
                // (fullwidth 。 for Chinese copy, ASCII period otherwise).
                title.append(text[cut])
            }
            title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty {
                return title
            }
        }

        if text.count > 80 {
            return String(text.prefix(80)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
        }
        return text
    }

    static func mentionsHelper(_ message: String) -> Bool {
        message.range(of: "helper", options: .caseInsensitive) != nil
            || message.contains("网络组件")
    }
}

private struct LoginErrorBlock: View {
    let message: String
    @Binding var isExpanded: Bool
    var reduceMotion: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(LoginErrorCopy.headline(from: message))
                .font(.callout.weight(.semibold))
                .foregroundStyle(TonoStatus.error)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                withAnimation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Text(isExpanded ? "Hide details" : "Show details")
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if LoginErrorCopy.mentionsHelper(message) {
                    Text(LoginErrorCopy.helperAdminExplanation)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TonoStatus.error.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(TonoStatus.error.opacity(0.18), lineWidth: 0.7)
        }
    }
}

#if DEBUG
@MainActor
private struct TonoAppleSignInButton: NSViewRepresentable {
    typealias Action = @MainActor @Sendable () -> Void
    let action: Action

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        button.target = context.coordinator
        button.action = #selector(Coordinator.performAction)
        return button
    }

    func updateNSView(_ nsView: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    @MainActor
    final class Coordinator: NSObject {
        var action: Action

        init(action: @escaping Action) {
            self.action = action
        }

        @objc func performAction() {
            action()
        }
    }
}

private let previewHelperFailureMessage = """
Core failed to start: The installed network helper no longer accepts this copy of Tono. Click Retry and approve the administrator prompt to repair it, or run the documented sudo emergency-disarm command and reopen Tono. Helper installation failed: The authenticated helper did not start.
"""

/// Mirrors LoginView chrome so light/dark error recovery can be inspected
/// without mutating AccountSession (state is service-owned).
private struct LoginErrorPreviewCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showErrorDetails = true
    let message: String

    var body: some View {
        VStack(spacing: 18) {
            LiquidClashLogo(compact: true)
                .frame(width: 56, height: 56)
            Text("Welcome to Tono").font(.title.bold())
            Text("Sign in with a verified email to continue. No password is required.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            LoginErrorBlock(
                message: message,
                isExpanded: $showErrorDetails,
                reduceMotion: reduceMotion
            )

            Button {} label: {
                Text("Retry")
            }
            .buttonStyle(GateProminentButtonStyle())
        }
        .padding(28)
        .frame(width: 470)
        .background(
            .white.opacity(colorScheme == .dark ? 0.08 : 0.42),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(
                    colorScheme == .dark
                        ? .white.opacity(0.12)
                        : .black.opacity(0.14),
                    lineWidth: colorScheme == .dark ? 0.5 : 1
                )
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.1), radius: 24, y: 10)
    }
}

#Preview("LoginView · Light · helper error") {
    ZStack {
        MeshGradientBackground(emphasis: true)
        LoginErrorPreviewCard(message: previewHelperFailureMessage)
    }
    .frame(width: 720, height: 700)
    .preferredColorScheme(.light)
}

#Preview("LoginView · Dark · helper error") {
    ZStack {
        MeshGradientBackground(emphasis: true)
        LoginErrorPreviewCard(message: previewHelperFailureMessage)
    }
    .frame(width: 720, height: 700)
    .preferredColorScheme(.dark)
}

#Preview("LoginView · Light") {
    ZStack {
        MeshGradientBackground(emphasis: true)
        LoginView(
            session: AccountSession(
                sidecar: TonoSidecarService(),
                descriptorConsumer: { _ in }
            )
        )
    }
    .frame(width: 720, height: 640)
    .preferredColorScheme(.light)
}

#Preview("LoginView · Dark") {
    ZStack {
        MeshGradientBackground(emphasis: true)
        LoginView(
            session: AccountSession(
                sidecar: TonoSidecarService(),
                descriptorConsumer: { _ in }
            )
        )
    }
    .frame(width: 720, height: 640)
    .preferredColorScheme(.dark)
}
#endif
