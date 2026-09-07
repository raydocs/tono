import SwiftUI

/// The primary action: the brand's violet sweep + white type. System
/// `.borderedProminent` draws white labels without a fill when the control
/// sits on glass / an inactive window — the control then vanishes on a light
/// surface.
///
/// Feel (motion contract, docs/ui-design-system.md §7): the press lands in
/// 100 ms and lets go in 220 ms; pressing brightens the surface (light
/// catching it) and pulls the shadow in, it never darkens. Hover lifts it a
/// little. Reduce Motion keeps the brightening and drops the scale.
///
/// Compact (`.small` / `.mini`) drops the full-width 44pt gate chrome and the
/// shadow so banner and progress-card actions stay inline.
struct GateProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.controlSize) private var controlSize

    func makeBody(configuration: Configuration) -> some View {
        GateProminentBody(
            configuration: configuration,
            compact: controlSize == .mini || controlSize == .small,
            isEnabled: isEnabled,
            reduceMotion: reduceMotion
        )
    }
}

private struct GateProminentBody: View {
    let configuration: ButtonStyle.Configuration
    let compact: Bool
    let isEnabled: Bool
    let reduceMotion: Bool
    @State private var isHovered = false

    private var pressed: Bool { configuration.isPressed }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: compact ? 6 : 10, style: .continuous)
    }

    /// The highlight layer: none at rest, a touch on hover, clear on press.
    private var sheen: Double {
        if pressed { return 0.14 }
        if isHovered { return 0.06 }
        return 0
    }

    private var shadowOpacity: Double {
        if compact { return 0 }
        if pressed { return 0.18 }
        if isHovered { return 0.42 }
        return 0.30
    }

    var body: some View {
        configuration.label
            .font(.system(size: compact ? 12 : 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 10 : 0)
            .frame(maxWidth: compact ? nil : .infinity)
            .frame(height: compact ? 22 : 44)
            .background {
                ZStack {
                    shape.fill(TonoBrand.actionGradient)
                    shape.fill(.white.opacity(sheen))
                }
            }
            .shadow(
                color: TonoBrand.actionShadow.opacity(shadowOpacity),
                radius: pressed ? 6 : (isHovered ? 16 : 12),
                y: pressed ? 2 : (isHovered ? 7 : 5)
            )
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(pressed && !reduceMotion ? 0.97 : 1)
            // Press lands fast, release settles slower: asymmetric on purpose.
            .animation(
                pressed
                    ? TonoMotion.press(reduceMotion: reduceMotion)
                    : TonoMotion.stateChange(reduceMotion: reduceMotion),
                value: pressed
            )
            .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: isHovered)
            .onHover { hovering in
                guard isEnabled else { return }
                isHovered = hovering
            }
            .contentShape(shape)
            .tint(.white)
    }
}
