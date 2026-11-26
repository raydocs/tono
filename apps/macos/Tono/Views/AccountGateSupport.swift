import SwiftUI
import AppKit

/// Authenticated, but the account may not connect — an expired plan, an
/// exhausted data allowance, or an account an operator disabled. Reachable now
/// that the client keeps the control plane's reason instead of reporting every
/// refusal as an expired session and signing the user out.
struct AccountBlockedView: View {
    @Bindable var session: AccountSession
    @Environment(\.colorScheme) private var colorScheme
    /// The recheck keeps this screen on screen while it runs, so the button
    /// carries its own progress rather than reading a session state that this
    /// screen can never be shown in.
    @State private var rechecking = false

    private var explanation: String {
        // A nil detail means the control plane refused this session without
        // naming a reason, and today a revoked session and an unusable plan
        // answer identically — so the fallback covers both.
        session.entitlementDetail
            ?? String(localized: "Check this plan's expiry date and data allowance, or sign out and sign in again. Contact Tono support if this continues.")
    }

    var body: some View {
        VStack(spacing: 14) {
            VStack(spacing: 10) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(TonoStatus.blocked)
                Text("This Tono account cannot connect")
                    .font(.system(size: 17, weight: .semibold))
                    .multilineTextAlignment(.center)
                Text(explanation)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 6)

            // The three values that decide this, so the reason is checkable on
            // screen rather than only from a support reply.
            if let user = session.user {
                VStack(spacing: 6) {
                    accountRow(String(localized: "Plan"), user.plan ?? "Tono")
                    accountRow(
                        String(localized: "Expires"),
                        TonoAccountRules.expiryText(user.expiresAt)
                    )
                    if let quota = user.quotaBytes, let usage = user.usageBytes {
                        accountRow(
                            String(localized: "Usage"),
                            "\(ByteCountFormatter.string(fromByteCount: usage, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: quota, countStyle: .file))"
                        )
                    }
                }
            }

            Button {
                Task {
                    rechecking = true
                    await session.retryRestore()
                    rechecking = false
                }
            } label: {
                HStack(spacing: 8) {
                    if rechecking { ProgressView().controlSize(.small) }
                    Text("Check again")
                }
            }
            .buttonStyle(GateProminentButtonStyle())
            .disabled(rechecking)

            Button("Sign Out", role: .destructive) { Task { await session.logout() } }
                .modifier(SeaActionStyle(variant: .danger, legacy: .automatic))

            // Renewing a plan needs a browser, and this screen is reachable
            // with protection armed and no exit running.
            GateProtectionSection(session: session, disabled: rechecking)
        }
        .padding(.horizontal, 20)
        .frame(width: 360)
    }

    @ViewBuilder
    private func accountRow(_ title: String, _ value: String) -> some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 12, weight: .medium)).monospacedDigit()
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.10 : 0.5), lineWidth: 0.6)
        }
    }
}

/// Picks filled or quiet per call site so the screen only ever shows one
/// filled primary (e.g. while Retry owns it, the send-code button steps back).
struct GateAdaptiveButtonStyle: ButtonStyle {
    @SeaAppearancePreference private var seaAppearance
    var prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        Group {
            if seaAppearance {
                SeaButtonStyle(variant: prominent ? .primary : .quiet).makeBody(configuration: configuration)
            } else if prominent {
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
struct GateSecondaryButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    @State private var isHovered = false

    func makeBody(configuration: Configuration) -> some View {
        let baseOpacity = colorScheme == .dark
            ? (isHovered && isEnabled ? 0.11 : 0.075)
            : (isHovered && isEnabled ? 0.94 : 0.85)
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                displayPreferences.reduceTransparency
                    ? AnyShapeStyle(colorScheme == .dark ? (isHovered && isEnabled ? Color(hex: "343139") : SeaTheme.opaqueQuiet) : Color(nsColor: .controlBackgroundColor))
                    : AnyShapeStyle(.white.opacity(baseOpacity)),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        colorScheme == .dark
                            ? .white.opacity(displayPreferences.contrast == .increased ? 0.45 : (isHovered && isEnabled ? 0.22 : 0.14))
                            : .black.opacity(displayPreferences.contrast == .increased ? 0.35 : 0.10),
                        lineWidth: displayPreferences.contrast == .increased ? 1 : 0.65
                    )
            }
            .opacity(isEnabled ? 1 : 0.4)
            .brightness(configuration.isPressed ? -0.02 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(TonoMotion.tactileSpring(reduceMotion: reduceMotion), value: configuration.isPressed)
            .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: isHovered)
            .onHover { isHovered = isEnabled ? $0 : false }
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A minute without email offers self-service, not an assertion that automatic
/// recovery has been exhausted. Only decision093's request outcome permits support.
struct SignInCodeNotReceivedHint: View {
    static let delay: Duration = .seconds(60)
    /// The control plane reports a recent mail-provider failure; global, so
    /// it says nothing about this address.
    var deliveryDegraded = false

    var body: some View {
        VStack(spacing: 6) {
            // if/else, not a ternary: a ternary of literals is a String,
            // which `Text` shows verbatim instead of localizing.
            if deliveryDegraded {
                Text("Email may be delayed")
                    .font(.caption.weight(.semibold))
                Text("Tono's email service is having trouble right now, so the code may be late or may not arrive. Try again in a few minutes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No email yet?")
                    .font(.caption.weight(.semibold))
                Text("Check spam and the address above, or send a new code.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// Login's clipboard payload has a closed allowlist. In particular, the error
/// String is never copied: it can contain addresses, account data or secrets.
@MainActor @Observable
final class SignInDiagnosticCopy {
    var copied: Bool?
    var manualText = ""

    func copy(cause: SignInRecovery.Cause? = nil, report: [String] = ConnectionFailureReport.shared.currentLines(),
              write: (String) -> Bool = { text in
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.setString(text, forType: .string)
    }) {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = info?["CFBundleVersion"] as? String ?? "unknown"
        var text = """
        Tono sign-in diagnostics
        Version: \(version) (\(build))
        Auth stage: sign-in
        """
        if let cause { text += "\nRecovery cause: \(cause.rawValue)" }
        // Closed vocabulary only (`ConnectionFailureReport`): labels and classes.
        for line in report { text += "\n" + line }
        copied = write(text)
        manualText = copied == true ? "" : text
    }
}

@MainActor
struct SignInDiagnosticCopyButton: View {
    @State private var copy: SignInDiagnosticCopy
    let cause: SignInRecovery.Cause?
    let contact: Bool

    init(copy: SignInDiagnosticCopy? = nil, cause: SignInRecovery.Cause? = nil, contact: Bool = false) {
        _copy = State(initialValue: copy ?? SignInDiagnosticCopy())
        self.cause = cause
        self.contact = contact
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                copy.copy(cause: cause)
            } label: {
                Label(LocalizedStringKey(contact ? "Contact support (copy diagnostics)" : "Copy diagnostics"), systemImage: "doc.on.doc")
            }
            .buttonStyle(.link)
            if copy.copied == true {
                Text("Copied").accessibilityAddTraits(.updatesFrequently)
            } else if copy.copied == false {
                Text("Could not copy. You can copy the safe text manually.")
                DisclosureGroup("Copy manually") {
                    Text(copy.manualText).monospacedDigit().textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .font(.caption)
    }
}

/// Restoring overlay copy lives on its own glass card so Dashboard type
/// behind the scrim cannot interleave with the caption.
struct RestoringSessionCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    @State private var showSlowHint = false

    var body: some View {
        let opaque = displayPreferences.reduceTransparency || displayPreferences.contrast == .increased
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
        .background {
            if opaque {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(colorScheme == .dark ? SeaTheme.opaquePanel : Color(nsColor: .windowBackgroundColor))
            } else {
                // Sits on the scrimmed (dimmed) dashboard, so it keeps a touch
                // more wash than the login card for text contrast.
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.white.opacity(colorScheme == .dark ? 0.07 : 0.30))
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [
                            .white.opacity(displayPreferences.contrast == .increased ? 0.55 : (colorScheme == .dark ? 0.22 : 0.85)),
                            .white.opacity(displayPreferences.contrast == .increased ? 0.28 : (colorScheme == .dark ? 0.06 : 0.25)),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        }
        .modifier(RestoringCardGlassEffect(enabled: !opaque, colorScheme: colorScheme))
        .shadow(color: opaque ? .clear : .black.opacity(colorScheme == .dark ? 0.3 : 0.12), radius: 18, y: 8)
        .task {
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled else { return }
            withAnimation(TonoMotion.easeOut(0.25, reduceMotion: reduceMotion)) {
                showSlowHint = true
            }
        }
    }
}

private struct RestoringCardGlassEffect: ViewModifier {
    let enabled: Bool
    let colorScheme: ColorScheme

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.glassEffect(
                .regular.tint(.white.opacity(colorScheme == .dark ? 0.03 : 0.05)),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
        } else {
            content
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

struct LoginErrorBlock: View {
    @SeaAppearancePreference private var seaAppearance
    @SeaDisplayPreferences private var displayPreferences
    @Environment(\.colorScheme) private var colorScheme
    let message: String
    @Binding var isExpanded: Bool
    var reduceMotion: Bool
    var recovery: SignInRecovery? = nil
    @State private var isDetailsHovered = false

    private var headlineColor: Color {
        seaAppearance || colorScheme == .dark ? SeaTheme.danger : TonoStatus.error
    }

    private var blockFill: Color {
        if displayPreferences.reduceTransparency {
            return colorScheme == .dark ? Color(hex: "26181C") : Color(hex: "FCECEE")
        }
        return TonoStatus.error.opacity(colorScheme == .dark ? 0.09 : 0.06)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // A quiet inline notice, not a colored slab: clear danger type,
            // crisp hairline border, and progressive technical details.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(headlineColor)
                Text(LoginErrorCopy.headline(from: message))
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(headlineColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                withAnimation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Text(LocalizedStringKey(isExpanded ? "Hide details" : "Show details"))
                    if seaAppearance { SeaChevron(expanded: isExpanded) }
                    else {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(isDetailsHovered ? .primary : .secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3.5)
                .background(.white.opacity(isDetailsHovered ? (colorScheme == .dark ? 0.07 : 0.45) : 0), in: Capsule())
                .padding(.leading, -7)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { isDetailsHovered = $0 }
            .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: isDetailsHovered)

            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    Rectangle()
                        .fill(.white.opacity(displayPreferences.contrast == .increased ? 0.24 : (colorScheme == .dark ? 0.08 : 0.14)))
                        .frame(height: 0.75)

                    Text(message)
                        .font(.caption)
                        .foregroundStyle(colorScheme == .dark ? SeaTheme.text.opacity(0.86) : .primary.opacity(0.85))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if LoginErrorCopy.mentionsHelper(message) {
                        Text(LoginErrorCopy.helperAdminExplanation)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineSpacing(1.5)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if recovery?.phase != .userAction {
                        SignInDiagnosticCopyButton().id(message)
                    }
                }
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
            if recovery?.phase == .userAction {
                SignInDiagnosticCopyButton(cause: recovery?.cause, contact: true).id(message)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(blockFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(
                    TonoStatus.error.opacity(displayPreferences.contrast == .increased ? 0.55 : (colorScheme == .dark ? 0.24 : 0.18)),
                    lineWidth: displayPreferences.contrast == .increased ? 1 : 0.75
                )
        }
    }
}
