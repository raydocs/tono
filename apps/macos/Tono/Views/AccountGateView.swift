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
    @State private var appeared = false
    @State private var showEmailForm = false

    /// A live challenge pins the form open regardless of navigation state.
    private var showsEmailForm: Bool {
        showEmailForm || session.emailChallenge != nil
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
        VStack(spacing: 14) {
            // Brand glyph, not the app-icon bitmap: the icon carries its own
            // rounded-rect plate and reads as a foreign object on the card.
            VStack(spacing: 12) {
                TonoMarkFlowing()
                    .frame(width: 56, height: 56)

                VStack(spacing: 5) {
                    Text("Welcome to Tono")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Sign in with a verified email to continue. No password is required.")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.bottom, 12)

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
                    }
                }

                Button("Retry Tono connection") { Task { await session.retryRuntime() } }
                    .buttonStyle(GateProminentButtonStyle())
                Button("Sign Out", role: .destructive) { Task { await session.logout() } }
            } else {
                if let methods {
                    // One decision per screen, Manus-style: the landing shows
                    // only the ways in; the form appears after a choice.
                    if showsEmailForm {
                        VStack(spacing: 10) {
                            gateField("Email", text: $email)
                            gateField("Device name", text: $deviceName)
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
                            .buttonStyle(GateAdaptiveButtonStyle(
                                prominent: error == nil && session.emailChallenge == nil
                            ))
                            .disabled(busy || resendCountdown > 0)
                            if session.emailChallenge != nil {
                                Text("If this address is eligible, the code is valid for 10 minutes.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            if session.emailChallenge == nil {
                                Button("Back") {
                                    withAnimation(stepSpring) { showEmailForm = false }
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(.secondary)
                                .padding(.top, 2)
                            }
                        }
                        .transition(stepTransition)
                    } else {
                        VStack(spacing: 10) {
                            // The two ways in share one row — peers, not a
                            // stack of competing full-width bars.
                            HStack(spacing: 10) {
                                if methods.email.enabled {
                                    Button {
                                        withAnimation(stepSpring) { showEmailForm = true }
                                    } label: {
                                        // Mirrors the Apple button's glyph+label
                                        // anatomy so the pair reads symmetric.
                                        HStack(spacing: 6) {
                                            Image(systemName: "envelope.fill")
                                                .font(.system(size: 13, weight: .semibold))
                                            Text("Continue with email")
                                        }
                                        .frame(maxWidth: .infinity)
                                    }
                                    // While Retry owns the filled treatment the
                                    // sign-in path steps back to the quiet style.
                                    .buttonStyle(GateAdaptiveButtonStyle(prominent: error == nil))
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
        .padding(.horizontal, 20)
        .frame(width: 360)
        // No card. The window itself is the page — content sits directly on
        // the paper ground, Manus-style.
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 12)
        .onAppear {
            if reduceMotion {
                appeared = true
            } else {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.85)) {
                    appeared = true
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
                            ? .white.opacity(0.13)
                            : .black.opacity(0.09),
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
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(colorScheme == .dark ? .black : .white)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                // The logo's own ramp, flat and quiet: no glow, no stroke —
                // the gradient is the only voice of color on the page.
                LinearGradient(
                    colors: [TonoBrand.accent, TonoBrand.accentSoft, TonoBrand.accentWarm],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .shadow(
                color: TonoBrand.accentSoft.opacity(colorScheme == .dark ? 0.35 : 0.25),
                radius: 10, y: 4
            )
            .opacity(isEnabled ? 1 : 0.4)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(TonoMotion.easeOut(0.12, reduceMotion: reduceMotion), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .tint(.white)
    }
}

/// The real product mark (the TO monogram, same transparent asset as the
/// Windows shell — never on a tile) with a soft light band sweeping through
/// the mark's own shape on a loop. Reduce Motion shows the static mark.
private struct TonoMarkFlowing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -0.8

    var body: some View {
        Image("TonoMark")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, .white.opacity(0.75), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.55)
                        .offset(x: phase * geo.size.width)
                        .blendMode(.plusLighter)
                    }
                    // The band only lights the mark itself, never the paper.
                    .mask(
                        Image("TonoMark")
                            .resizable()
                            .scaledToFit()
                    )
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                // The travel range overshoots the mark on both sides, so each
                // sweep is followed by a quiet pause before it repeats.
                withAnimation(.linear(duration: 3.2).repeatForever(autoreverses: false)) {
                    phase = 1.8
                }
            }
            .accessibilityHidden(true)
    }
}

/// Picks filled or quiet per call site so the screen only ever shows one
/// filled primary (e.g. while Retry owns it, the send-code button steps back).
private struct GateAdaptiveButtonStyle: ButtonStyle {
    var prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        Group {
            if prominent {
                GateProminentButtonStyle().makeBody(configuration: configuration)
            } else {
                GateSecondaryButtonStyle().makeBody(configuration: configuration)
            }
        }
    }
}

/// Quiet sibling of the prominent style: glass field, accent type. Used when
/// another action on screen owns the filled treatment — two filled primaries
/// side by side reads as noise, not hierarchy.
private struct GateSecondaryButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                .white.opacity(colorScheme == .dark ? 0.07 : 0.85),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        colorScheme == .dark
                            ? .white.opacity(0.14)
                            : .black.opacity(0.10),
                        lineWidth: 0.5
                    )
            }
            .opacity(isEnabled ? 1 : 0.4)
            .brightness(configuration.isPressed ? -0.03 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(TonoMotion.easeOut(0.12, reduceMotion: reduceMotion), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
            // Sits on the scrimmed (dimmed) dashboard, so it keeps a touch
            // more wash than the login card for text contrast.
            .white.opacity(colorScheme == .dark ? 0.07 : 0.30),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
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
            .regular.tint(.white.opacity(colorScheme == .dark ? 0.03 : 0.05)),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
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
        VStack(alignment: .leading, spacing: 7) {
            // A quiet inline notice, not a colored slab: the red type and dot
            // carry the severity, the surface stays almost part of the card.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TonoStatus.error)
                Text(LoginErrorCopy.headline(from: message))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(TonoStatus.error)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

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
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TonoStatus.error.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(TonoStatus.error.opacity(0.12), lineWidth: 0.5)
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
