import SwiftUI

/// Solid action fill + white type. System `.borderedProminent` draws white
/// labels without a fill when the control sits on glass / an inactive
/// window — the control then vanishes on a light surface.
///
/// Compact (`.small` / `.mini`) drops the full-width 44pt gate chrome so
/// banner and progress-card actions stay inline.
struct GateProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.controlSize) private var controlSize

    func makeBody(configuration: Configuration) -> some View {
        let compact = controlSize == .mini || controlSize == .small
        configuration.label
            .font(.system(size: compact ? 12 : 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 10 : 0)
            .frame(maxWidth: compact ? nil : .infinity)
            .frame(height: compact ? 22 : 44)
            .background(
                TonoBrand.actionFill,
                in: RoundedRectangle(
                    cornerRadius: compact ? 6 : 10,
                    style: .continuous
                )
            )
            .opacity(isEnabled ? 1 : 0.4)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(
                TonoMotion.easeOut(0.12, reduceMotion: reduceMotion),
                value: configuration.isPressed
            )
            .contentShape(
                RoundedRectangle(
                    cornerRadius: compact ? 6 : 12,
                    style: .continuous
                )
            )
            .tint(.white)
    }
}

enum ProgressPillPhase: Equatable {
    case idle, sending, sent
}

/// Sign-in primary: the same action fill as `GateProminentButtonStyle`, with an
/// indeterminate left-to-right sweep while a code is in flight. Reduce Motion
/// keeps the text and drops the sweep. Never runs unless `phase == .sending`.
struct ProgressPillButtonStyle: ButtonStyle {
    var phase: ProgressPillPhase = .idle
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(TonoBrand.actionFill)
                    .overlay {
                        if phase == .sending && !reduceMotion {
                            ProgressPillSweep()
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .opacity(isEnabled ? 1 : 0.4)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(
                TonoMotion.easeOut(0.12, reduceMotion: reduceMotion),
                value: configuration.isPressed
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// One 1.2 s ease-in-out pass of a white 0.18 band. Mounted only while sending.
private struct ProgressPillSweep: View {
    @State private var travel: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let band = geo.size.width * 0.42
            Rectangle()
                .fill(Color.white.opacity(0.18))
                .frame(width: band, height: geo.size.height)
                .offset(x: -band + travel * (geo.size.width + band))
        }
        .allowsHitTesting(false)
        .onAppear {
            travel = 0
            withAnimation(
                TonoMotion.easeInOut(1.2, reduceMotion: false)?
                    .repeatForever(autoreverses: false)
            ) {
                travel = 1
            }
        }
    }
}
