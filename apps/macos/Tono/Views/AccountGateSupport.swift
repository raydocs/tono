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
    @State private var restoredInternetFromGate = false

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
                Image(systemName: "exclamationmark.shield")
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

            if KillSwitchService.isArmed, !restoredInternetFromGate {
                // Renewing a plan needs a browser, and this screen is reachable
                // with protection armed and no exit running. Signing out is the
                // only other way off a fail-closed host, and it should not be
                // the price of reading the renewal page. isArmed is a plain
                // static (not observable), so the local flag forces the section
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
                .disabled(rechecking)
            }
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
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }
}

/// Picks filled or quiet per call site so the screen only ever shows one
/// filled primary (e.g. while Retry owns it, the send-code button steps back).
struct GateAdaptiveButtonStyle: ButtonStyle {
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
struct GateSecondaryButtonStyle: ButtonStyle {
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
struct RestoringSessionCard: View {
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

struct LoginErrorBlock: View {
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
