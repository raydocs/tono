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
