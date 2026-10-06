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

/// An explicit sea-appearance opt-out restores the original one-screen intro.
/// The sea presentation pages through the same promises; finish or Esc still sets
/// `introSeen` and the parent swaps in the account gate.
/// Windows twin: `pages/tono/intro.tsx`.
struct WelcomeIntroView: View {
    @AppStorage(SettingsKey.introSeen, store: AppProfile.defaults) private var introSeen = false
    @AppStorage(SeaAppearance.motionKey, store: AppProfile.defaults) private var seaMotionMode = "Auto"
    @SeaAppearancePreference private var seaAppearance
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var seaStep: SeaIntroStep = .connected

    var body: some View {
        Group {
            if seaAppearance {
                seaIntro
            } else {
                originalIntro
            }
        }
        .background {
            Button(action: finish) { EmptyView() }
                .keyboardShortcut(.cancelAction)
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    private var originalIntro: some View {
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
    }

    private var seaIntro: some View {
        GeometryReader { geo in
            ZStack {
                // These scenes explain Tono's states; they do not read or claim live protection.
                SeaScene(phase: seaStep.scenePhase,
                         motionEnabled: SeaAppearance.animates(seaMotionMode, reduceMotion: reduceMotion))
                    .ignoresSafeArea()
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 26) {
                        HStack(spacing: 10) {
                            Image("TonoMark").resizable().scaledToFit()
                                .frame(width: 30, height: 30).accessibilityHidden(true)
                            Text("Tono").font(.title3.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        Spacer(minLength: 24)

                        VStack(alignment: .leading, spacing: 16) {
                            Text("HOW TONO WORKS")
                                .font(.caption.weight(.semibold)).tracking(1.3)
                                .foregroundStyle(SeaTheme.cool)
                            Text(seaStep.title)
                                .font(.system(size: 36, weight: .light)).tracking(-0.7)
                                .accessibilityAddTraits(.isHeader)
                            Text(seaStep.detail)
                                .font(.body)
                                .foregroundStyle(SeaTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            if seaStep == .routes {
                                Label("Tono picks your route", systemImage: "network")
                                    .font(.callout.weight(.medium))
                                    .padding(.horizontal, 14).padding(.vertical, 9)
                                    .background(.white.opacity(0.10), in: Capsule())
                            }
                            Text("Illustration only · not your current connection status")
                                .font(.callout).foregroundStyle(SeaTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(28)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SeaTheme.panel,
                                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .strokeBorder(.white.opacity(0.16), lineWidth: 1)
                        }

                        HStack(spacing: 10) {
                            ForEach(SeaIntroStep.allCases, id: \.self) { step in
                                Button {
                                    seaStep = step
                                } label: {
                                    Circle()
                                        .fill(step == seaStep ? SeaTheme.warm : SeaTheme.muted.opacity(0.5))
                                        .frame(width: 9, height: 9)
                                        .frame(width: 26, height: 26)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Page \(step.rawValue + 1) of 3")
                                .accessibilityAddTraits(step == seaStep ? .isSelected : [])
                            }
                            Spacer()
                            if seaStep != .routes {
                                Button("Skip") { finish() }
                                    .buttonStyle(.link)
                            }
                            Button {
                                if let next = seaStep.next { seaStep = next } else { finish() }
                            } label: {
                                if seaStep == .routes { Text("Get started") } else { Text("Next") }
                            }
                            .buttonStyle(GateProminentButtonStyle())
                            .frame(width: 150)
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                    .foregroundStyle(SeaTheme.text)
                    .frame(maxWidth: 620, alignment: .leading)
                    .padding(.horizontal, 32).padding(.vertical, 32)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geo.size.height, alignment: .center)
                }
            }
        }
        .background {
            Group {
                Button(action: { if let previous = seaStep.previous { seaStep = previous } }) { EmptyView() }
                    .keyboardShortcut(.leftArrow, modifiers: [])
                    .disabled(seaStep.previous == nil)
                Button(action: { if let next = seaStep.next { seaStep = next } }) { EmptyView() }
                    .keyboardShortcut(.rightArrow, modifiers: [])
                    .disabled(seaStep.next == nil)
            }
            .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
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

enum SeaIntroStep: Int, CaseIterable {
    case connected, offline, routes

    var previous: Self? { Self(rawValue: rawValue - 1) }
    var next: Self? { Self(rawValue: rawValue + 1) }

    var scenePhase: SeaPresentationPhase {
        switch self {
        case .connected: .day
        case .offline: .blocked
        case .routes: .night
        }
    }

    var title: LocalizedStringKey {
        switch self {
        case .connected: "Connected means protected."
        case .offline: "Offline, never exposed."
        case .routes: "Routes are Tono's job."
        }
    }

    var detail: LocalizedStringKey {
        switch self {
        case .connected: "When you connect, Tono carries your traffic on a protected route."
        case .offline: "If that route fails, Tono blocks direct traffic first."
        case .routes: "Choose a region when you want to. Tono handles the route."
        }
    }
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
