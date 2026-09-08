import SwiftUI

/// First-run intro sits between language setup and the account gate.
enum WelcomeLaunchGate {
    /// Unseen + no session → intro. Seen → gate. Signed-in (or still restoring)
    /// → never, so a returning user does not flash the intro while restore runs.
    @MainActor
    static func showsIntro(
        introSeen: Bool,
        sessionState: AccountSession.State
    ) -> Bool {
        guard !introSeen else { return false }
        switch sessionState {
        case .signedOut, .error:
            return true
        case .restoring, .authenticating, .enrolling, .ready, .suspended:
            return false
        }
    }
}

/// Four-step Welcome v2 intro. Skip or Get started sets `introSeen` and the
/// parent swaps in the account gate.
struct WelcomeIntroView: View {
    @AppStorage(SettingsKey.introSeen, store: AppProfile.defaults) private var introSeen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var step = 0

    private var isLast: Bool { step >= 3 }
    private var isDark: Bool { colorScheme == .dark }
    private var controlIdle: Color {
        isDark ? Color(hex: "8E90A8") : Color(hex: "7A7C90")
    }
    private var controlActive: Color {
        isDark ? Color(hex: "FFB07A") : Color(hex: "2B2FB8")
    }

    var body: some View {
        GeometryReader { geo in
            let narrow = geo.size.width < 800
            ZStack {
                WelcomeGround()
                    .ignoresSafeArea()

                if narrow {
                    narrowLayout(size: geo.size)
                } else {
                    wideLayout(size: geo.size)
                }

                VStack(spacing: 0) {
                    HStack {
                        Spacer()
                        Button("Skip", action: finish)
                            .buttonStyle(.plain)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(controlIdle)
                            .keyboardShortcut(.cancelAction)
                    }
                    .padding(.top, 28)
                    .padding(.horizontal, 32)

                    Spacer(minLength: 0)

                    VStack(alignment: .leading, spacing: 16) {
                        if isLast {
                            getStartedButton
                        }
                        HStack {
                            progressDots
                            Spacer()
                            if !isLast { continueButton }
                        }
                    }
                    .padding(.bottom, 32)
                    .padding(.horizontal, narrow ? 32 : 48)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .background {
            Button(action: advance) { EmptyView() }
                .keyboardShortcut(.rightArrow, modifiers: [])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func wideLayout(size: CGSize) -> some View {
        let tile = min(size.width * 0.34, 320)
        HStack(alignment: .center, spacing: 24) {
            stepCopy
                .offset(y: size.height * -0.12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.leading, 48)

            WelcomeHeroTile()
                .frame(width: tile, height: tile)
                .padding(.trailing, 32)
        }
        .frame(width: size.width, height: size.height)
    }

    @ViewBuilder
    private func narrowLayout(size: CGSize) -> some View {
        let tile = min(size.width * 0.46, 260)
        VStack(spacing: 28) {
            WelcomeHeroTile()
                .frame(width: tile, height: tile)
            stepCopy
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(.top, 72)
        .padding(.horizontal, 32)
        .padding(.bottom, 88)
        .frame(width: size.width, height: size.height)
    }

    @ViewBuilder
    private var stepCopy: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 12) {
                if !isLast {
                    Text(Self.steps[step].headline)
                        .font(.system(size: 34, weight: .semibold))
                        .tracking(-0.6)
                        .foregroundStyle(TonoBrand.welcomeInk)
                    Text(Self.steps[step].body)
                        .font(.system(size: 15))
                        .foregroundStyle(TonoBrand.welcomeMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .id(step)
            .transition(.opacity)
        }
        .animation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion), value: step)
        .frame(maxWidth: 520, alignment: .leading)
    }

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<4, id: \.self) { index in
                Circle()
                    .fill(index == step ? controlActive : controlIdle)
                    .frame(width: index == step ? 8 : 6, height: index == step ? 8 : 6)
            }
        }
        .accessibilityHidden(true)
    }

    private var continueButton: some View {
        Button(action: advance) {
            Text("Continue")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(controlIdle)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)
    }

    private var getStartedButton: some View {
        Button(action: finish) {
            Text("Get started →")
                .font(.system(size: 48, weight: .semibold))
                .tracking(-1.5)
                .foregroundStyle(
                    LinearGradient(
                        stops: [
                            .init(color: Color(hex: "2B2FB8"), location: 0),
                            .init(color: TonoBrand.accentSoft, location: 0.55),
                            .init(color: TonoBrand.accentWarm, location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)
    }

    private func advance() {
        if isLast {
            finish()
        } else {
            withAnimation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion)) {
                step += 1
            }
        }
    }

    private func finish() {
        introSeen = true
    }

    private struct StepCopy {
        var headline: LocalizedStringKey
        var body: LocalizedStringKey
    }

    private static let steps: [StepCopy] = [
        StepCopy(
            headline: "Connected means protected.",
            body: "Open Tono, click once, and all your traffic takes the protected route."
        ),
        StepCopy(
            headline: "Offline, never exposed.",
            body: "If the route fails, Tono cuts off first so nothing leaks out."
        ),
        StepCopy(
            headline: "Routes are Tono's job.",
            body: "Nothing to configure. To change region, pick a node."
        ),
        StepCopy(headline: "Get started →", body: ""),
    ]
}

#Preview("Welcome intro · Light") {
    WelcomeIntroView()
        .frame(width: 920, height: 600)
        .preferredColorScheme(.light)
}

#Preview("Welcome intro · Dark") {
    WelcomeIntroView()
        .frame(width: 920, height: 600)
        .preferredColorScheme(.dark)
}

#Preview("Welcome intro · Narrow") {
    WelcomeIntroView()
        .frame(width: 720, height: 540)
        .preferredColorScheme(.light)
}
