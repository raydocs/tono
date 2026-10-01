import SwiftUI

/// First-run intro sits between language setup and the account gate.
enum WelcomeLaunchGate {
    /// Unseen + no session → intro. Seen → gate. Signed-in (or still restoring)
    /// → never, so a returning user does not flash the intro while restore runs.
    /// Kill switch still holding → gate: only it says why the Mac is offline
    /// and offers Restore internet (a launch whose session was refused).
    @MainActor
    static func showsIntro(
        introSeen: Bool,
        sessionState: AccountSession.State,
        protectionHeld: Bool = false
    ) -> Bool {
        guard !introSeen, !protectionHeld else { return false }
        switch sessionState {
        case .signedOut, .error:
            return true
        case .restoring, .authenticating, .enrolling, .ready, .suspended:
            return false
        }
    }
}

/// One-screen intro: three promises and one primary action. Get started (or
/// Esc) sets `introSeen` and the parent swaps in the account gate.
/// Windows twin: `pages/tono/intro.tsx`.
struct WelcomeIntroView: View {
    @AppStorage(SettingsKey.introSeen, store: AppProfile.defaults) private var introSeen = false

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
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .background {
            Button(action: finish) { EmptyView() }
                .keyboardShortcut(.cancelAction)
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func wideLayout(size: CGSize) -> some View {
        let tile = min(size.width * 0.34, 320)
        HStack(alignment: .center, spacing: 48) {
            copy
                .frame(maxWidth: .infinity, alignment: .leading)

            WelcomeHeroTile()
                .frame(width: tile, height: tile)
        }
        .padding(.horizontal, 56)
        .padding(.vertical, 48)
        .frame(width: size.width, height: size.height)
    }

    @ViewBuilder
    private func narrowLayout(size: CGSize) -> some View {
        let tile = min(size.width * 0.32, 180)
        VStack(alignment: .leading, spacing: 28) {
            WelcomeHeroTile()
                .frame(width: tile, height: tile)
                .frame(maxWidth: .infinity)
            copy
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
        .frame(width: size.width, height: size.height)
    }

    private var copy: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text("Welcome to Tono")
                .font(.system(size: 34, weight: .semibold))
                .tracking(-0.6)
                .foregroundStyle(TonoBrand.welcomeInk)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 18) {
                ForEach(Self.points.indices, id: \.self) { index in
                    pointRow(Self.points[index])
                }
            }

            Button(action: finish) {
                Text("Get started →")
            }
            .buttonStyle(GateProminentButtonStyle())
            .keyboardShortcut(.defaultAction)
            .frame(maxWidth: 320)
        }
        .frame(maxWidth: 460, alignment: .leading)
    }

    private func pointRow(_ point: Point) -> some View {
        HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(TonoBrand.accentSoft.opacity(0.35))
                .frame(width: 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(point.headline)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(TonoBrand.welcomeInk)
                Text(point.body)
                    .font(.system(size: 14))
                    .foregroundStyle(TonoBrand.welcomeMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    private func finish() {
        introSeen = true
    }

    private struct Point {
        var headline: LocalizedStringKey
        var body: LocalizedStringKey
    }

    private static let points: [Point] = [
        Point(
            headline: "Connected means protected.",
            body: "Open Tono, click once, and all your traffic takes the protected route."
        ),
        Point(
            headline: "Offline, never exposed.",
            body: "If the route fails, Tono cuts off first so nothing leaks out."
        ),
        Point(
            headline: "Routes are Tono's job.",
            body: "Nothing to configure. To change region, pick a node."
        ),
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
