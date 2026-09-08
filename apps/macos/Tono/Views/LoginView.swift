#if DEBUG
import AuthenticationServices
#endif
import SwiftUI
import AppKit

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
    @State private var showEmailForm = false
    /// After a successful send, hold the "sent" pill for 1.5 s before the code step.
    @State private var revealCodeStep = false
    @State private var sentHoldTask: Task<Void, Never>?
    @FocusState private var focusedField: Field?
    private enum Field { case email, code }

    /// Email is the first screen. A live challenge keeps the code field open.
    private var showsEmailForm: Bool {
        (methods?.email.enabled == true)
            || showEmailForm
            || session.emailChallenge != nil
    }

    /// Code step is deferred 1.5 s after a successful send so the pill can say
    /// "sent". A view that appears already holding a challenge skips the hold.
    private var showsCodeStep: Bool {
        session.emailChallenge != nil && revealCodeStep
    }

    private var sendPillPhase: ProgressPillPhase {
        if session.emailChallenge != nil && !revealCodeStep { return .sent }
        if busy && session.emailChallenge == nil { return .sending }
        return .idle
    }

    private var stepSpring: Animation? {
        reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.86)
    }

    private var stepTransition: AnyTransition {
        reduceMotion
            ? .opacity
            : .asymmetric(
                insertion: .opacity.combined(with: .move(edge: .trailing)),
                removal: .opacity.combined(with: .move(edge: .leading))
            )
    }

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
        ScrollView {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 40) {
                    welcomeStory(compact: false)
                        .frame(width: 320, height: 480)
                    signInForm.frame(width: 380)
                }
                VStack(alignment: .leading, spacing: 24) {
                    welcomeStory(compact: true)
                        .frame(maxWidth: 420, minHeight: 240)
                    signInForm.frame(maxWidth: 420)
                }
            }
            .padding(40)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center)
    }

    private func welcomeStory(compact: Bool) -> some View {
        GeometryReader { geo in
            let tileSide = min(geo.size.width * 0.22, 180)
            ZStack(alignment: .topLeading) {
                WelcomeGround()
                VStack(alignment: .leading, spacing: 14) {
                    if compact {
                        WelcomeHeroTile()
                            .frame(width: tileSide, height: tileSide)
                    }
                    HStack(spacing: 12) {
                        Image("TonoMark").resizable().scaledToFit()
                            .frame(width: 32, height: 32).accessibilityHidden(true)
                        Text("Tono").font(.title2.weight(.semibold))
                    }
                    if !compact {
                        Spacer(minLength: 8)
                    }
                    Text("YOUR EVERYDAY CONNECTION")
                        .font(.caption.weight(.semibold)).tracking(1)
                        .foregroundStyle(.secondary)
                    Text("A little closer.\nA world more open.")
                        .font(.system(size: 34, weight: .semibold))
                        .tracking(-1)
                }
                .padding(32)
                .frame(
                    width: geo.size.width,
                    height: compact ? geo.size.height : geo.size.height * 0.55,
                    alignment: .topLeading
                )
                if !compact {
                    WelcomeHeroTile()
                        .frame(width: tileSide, height: tileSide)
                        .padding(32)
                        .frame(
                            width: geo.size.width,
                            height: geo.size.height,
                            alignment: .bottomLeading
                        )
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var signInForm: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(LocalizedStringKey(showsCodeStep ? "02 / CHECK YOUR EMAIL" : "01 / SIGN IN"))
                .font(.caption.weight(.semibold)).tracking(1)
                .foregroundStyle(.secondary)
            Text(LocalizedStringKey(showsCodeStep ? "Open your inbox" : "Sign in to Tono"))
                .font(.system(size: 28, weight: .semibold))
                .accessibilityAddTraits(.isHeader)
            Text(LocalizedStringKey(showsCodeStep
                 ? "Find the latest email from Tono, then return here and paste the six-digit code. Tono verifies it automatically."
                 : "Start with your email. We’ll send a sign-in code — no password to remember."))
                .font(.body).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

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
                Group {
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
                .transition(
                    reduceMotion
                        ? .opacity
                        : .opacity.combined(with: .move(edge: .top))
                )
            }

            if session.user != nil {
                // At the device limit the gate itself must offer removal —
                // Settings is unreachable from here, so telling the user to
                // "sign in and revoke" would lock them out of their own fix.
                if session.isAtDeviceLimit && !session.devices.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(session.devices) { device in
                            HStack(spacing: 10) {
                                Image(systemName: "desktopcomputer")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(device.name)
                                        .font(.system(size: 12, weight: .semibold))
                                        .lineLimit(1)
                                    if let seen = device.lastSeenAt {
                                        Text(seen.formatted(.relative(presentation: .named)))
                                            .font(.system(size: 10))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 8)
                                if device.current == true {
                                    Text("This device")
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundStyle(.secondary)
                                } else {
                                    Button("Remove") {
                                        Task {
                                            await session.revoke(device)
                                            // A freed slot lets enrollment
                                            // finish without another launch.
                                            if !session.isAtDeviceLimit {
                                                await session.retryRuntime()
                                            }
                                        }
                                    }
                                    .buttonStyle(GateSecondaryButtonStyle())
                                    .frame(width: 74)
                                    .disabled(busy)
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                            )
                        }
                        if let deviceActionError = session.deviceActionError {
                            // A failed removal is reported in place; it is not
                            // an account failure and must not restart the gate.
                            Label(deviceActionError, systemImage: "exclamationmark.circle")
                                .font(.caption)
                                .foregroundStyle(TonoStatus.error)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                Button("Retry Tono connection") { Task { await session.retryRuntime() } }
                    .buttonStyle(GateProminentButtonStyle())
                Button("Sign Out", role: .destructive) { Task { await session.logout() } }
            } else {
                if let methods {
                    // Email is the primary task. Alternate providers remain
                    // debug-only and do not add a decision to the shipping flow.
                    if showsEmailForm {
                        VStack(spacing: 10) {
                            gateField("Email", text: $email)
                                .focused($focusedField, equals: .email)
                                .disabled(busy || session.emailChallenge != nil)
                            if !showsCodeStep {
                                DisclosureGroup("Device name") {
                                    gateField("Device name", text: $deviceName)
                                }
                                .font(.caption)
                                .disabled(busy)
                                Label {
                                    Text("Your email is only used to sign in. Traffic logs are never uploaded unless you turn that on in Settings.")
                                } icon: {
                                    Image(systemName: "lock.fill")
                                }
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            }
                            if showsCodeStep {
                                gateField("Six-digit email code", text: $emailCode)
                                    .focused($focusedField, equals: .code)
                                    .disabled(busy)
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
                                .disabled(busy || emailCode.count != 6)
                            }
                            sendCodeButton
                            if showsCodeStep {
                                Text("Code sent to \(email). Sender is Tono <login@lecvia.com>. If this address is eligible, the code is valid for 10 minutes.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                    .textSelection(.enabled)
                                Button("Use another email") {
                                    session.resetEmailSignIn()
                                    emailCode = ""
                                    autoSubmittedCode = nil
                                    resendTimer?.cancel()
                                    resendCountdown = 0
                                    focusedField = .email
                                }
                                .buttonStyle(.link)
                                .disabled(busy)
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
                                .frame(height: 44)
                                .frame(maxWidth: .infinity)
                                .disabled(busy)
                            }
                            #endif
                        }
                        .transition(stepTransition)
                    } else {
                        VStack(spacing: 10) {
                            HStack(spacing: 10) {
                                #if DEBUG
                                if nativeAppleSignInEnabled {
                                    TonoAppleSignInButton {
                                        Task {
                                            await session.signInWithApple(
                                                deviceName: deviceName
                                            )
                                        }
                                    }
                                    .frame(height: 44)
                                    .frame(maxWidth: .infinity)
                                    .disabled(busy)
                                }
                                #endif
                            }

                            #if DEBUG
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
                                .buttonStyle(GateSecondaryButtonStyle())
                                .disabled(busy)
                            }
                            #endif
                        }
                        .transition(stepTransition)
                    }

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
        .background(colorScheme == .dark ? Color(hex: "1B1C36") : .white,
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(.secondary.opacity(0.3), lineWidth: 1)
        }
        .onAppear {
            if session.emailChallenge != nil {
                revealCodeStep = true
                focusedField = .code
            } else {
                focusedField = .email
            }
        }
        .onChange(of: session.emailChallenge != nil) { _, hasCode in
            sentHoldTask?.cancel()
            if hasCode {
                sentHoldTask = Task { @MainActor in
                    try? await Task.sleep(for: .seconds(1.5))
                    guard !Task.isCancelled, session.emailChallenge != nil else { return }
                    withAnimation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion)) {
                        revealCodeStep = true
                    }
                    focusedField = .code
                }
            } else {
                revealCodeStep = false
                focusedField = .email
            }
        }
        .onChange(of: busy) { _, isBusy in
            if !isBusy && showsCodeStep { focusedField = .code }
        }
        .onSubmit {
            guard !busy else { return }
            Task {
                if !showsCodeStep && session.emailChallenge == nil {
                    await sendEmailCode()
                } else if showsCodeStep && emailCode.count == 6 {
                    await session.verifyEmailCode(emailCode)
                }
            }
        }
        .task {
            if session.authMethods == nil && session.user == nil {
                await session.loadAuthMethods()
            }
        }
        .animation(
            reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85),
            value: error
        )
        .onChange(of: error) { _, _ in
            showErrorDetails = false
        }
        .onDisappear {
            resendTimer?.cancel()
            sentHoldTask?.cancel()
        }
    }

    @ViewBuilder
    private var sendCodeButton: some View {
        if showsCodeStep {
            Button {
                Task { await sendEmailCode() }
            } label: {
                busyLabel(resendButtonTitle)
            }
            .buttonStyle(GateAdaptiveButtonStyle(
                prominent: error == nil && session.emailChallenge == nil
            ))
            .disabled(busy || resendCountdown > 0)
        } else {
            Button {
                Task { await sendEmailCode() }
            } label: {
                Group {
                    if sendPillPhase == .sent {
                        Text("Sent to your email")
                    } else {
                        Text("Send a sign-in code")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(ProgressPillButtonStyle(phase: sendPillPhase))
            .disabled(busy || sendPillPhase == .sent)
        }
    }

    private var resendButtonTitle: String {
        if resendCountdown > 0 {
            return String(localized: "Send a new code (\(resendCountdown)s)")
        }
        return String(localized: "Send a new code")
    }

    private func sendEmailCode() async {
        await session.requestEmailCode(email: email, deviceName: deviceName)
        if session.emailChallenge != nil {
            startResendCountdown()
        }
    }

    /// Digits-only, capped at six; a complete code submits itself once.
    private func handleCodeChange(_ newValue: String) {
        let digits = String(newValue.filter { $0.isASCII && $0.isNumber }.prefix(6))
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

    /// A visible boundary even without vibrancy or a focused window.
    @ViewBuilder
    private func gateField(_ title: LocalizedStringKey, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                .white.opacity(colorScheme == .dark ? 0.07 : 0.85),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        colorScheme == .dark
                            ? .white.opacity(0.45)
                            : .black.opacity(0.45),
                        lineWidth: 1
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

#if DEBUG
@MainActor
struct TonoAppleSignInButton: NSViewRepresentable {
    typealias Action = @MainActor @Sendable () -> Void
    let action: Action

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        // Match the gate's 12pt continuous corners so the paired email button
        // and this one read as one row of equals.
        button.cornerRadius = 12
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

let previewHelperFailureMessage = """
Core failed to start: The installed network helper no longer accepts this copy of Tono. Click Retry and approve the administrator prompt to repair it, or run the documented sudo emergency-disarm command and reopen Tono. Helper installation failed: The authenticated helper did not start.
"""

/// Mirrors LoginView chrome so light/dark error recovery can be inspected
/// without mutating AccountSession (state is service-owned).
struct LoginErrorPreviewCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showErrorDetails = true
    let message: String

    var body: some View {
        VStack(spacing: 18) {
            TonoLogo(compact: true)
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
            .white.opacity(colorScheme == .dark ? 0.05 : 0.07),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [
                            .white.opacity(colorScheme == .dark ? 0.22 : 0.85),
                            .white.opacity(colorScheme == .dark ? 0.06 : 0.25),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        }
        .glassEffect(
            .regular.tint(.white.opacity(colorScheme == .dark ? 0.03 : 0.04)),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.35 : 0.14), radius: 28, y: 12)
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
