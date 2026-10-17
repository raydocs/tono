import SwiftUI
import UIKit

/// The one primary control: a recessed track whose thumb is the sun. Tap anywhere to toggle, or
/// drag the sun across (a detent tick at the threshold, a toggle haptic on commit). The trail
/// glows when on and breathes while busy. VoiceOver sees a plain switch.
struct SunSwitch: View {
    let isOn: Bool
    let busy: Bool
    let hint: String
    let a11yLabel: String
    let stateLabel: String
    let onToggle: (Bool) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position: CGFloat = 0
    @State private var dragging = false
    @State private var dragStart: CGFloat = 0
    @State private var crossed = false
    @State private var pulse = false
    /// Latest `isOn`, readable from delayed closures (a captured `isOn` would be stale).
    @State private var latestOn = false

    private let thumb: CGFloat = 60
    private let inset: CGFloat = 6
    private let threshold: CGFloat = 0.55

    var body: some View {
        GeometryReader { geo in
            let travel = max(geo.size.width - thumb - inset * 2, 1)
            ZStack(alignment: .leading) {
                track(width: geo.size.width, travel: travel)
                Text(hint)
                    .font(.system(size: 15))
                    .foregroundStyle(TonoColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.leading, position > 0.5 ? 0 : thumb + inset * 2)
                    .padding(.trailing, position > 0.5 ? thumb + inset * 2 : 0)
                    .animation(TonoMotion.state, value: position > 0.5)
                sun.offset(x: inset + position * travel)
            }
            .contentShape(Capsule())
            .gesture(drag(travel: travel))
            .simultaneousGesture(TapGesture().onEnded { commit(!isOn) })
        }
        .frame(height: 72)
        .onAppear { position = isOn ? 1 : 0; latestOn = isOn; pulse = busy }
        .onChange(of: isOn) { on in
            latestOn = on
            guard !dragging else { return }
            withAnimation(reduceMotion ? nil : (on ? TonoMotion.arrival : TonoMotion.surface)) { position = on ? 1 : 0 }
        }
        .onChange(of: busy) { pulse = $0 }
        .accessibilityRepresentation {
            Toggle(a11yLabel, isOn: Binding(get: { isOn }, set: { onToggle($0) }))
                .accessibilityValue(stateLabel)
        }
    }

    private func track(width: CGFloat, travel: CGFloat) -> some View {
        let cx = inset + thumb / 2 + position * travel
        return ZStack(alignment: .leading) {
            Capsule().fill(LinearGradient(colors: [Color(hex: 0x07060B), Color(hex: 0x1A1722)], startPoint: .top, endPoint: .bottom))
            Capsule().fill(LinearGradient(colors: [.black.opacity(0.4), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.35)))
            Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            if position > 0.01 {
                Capsule()
                    .fill(LinearGradient(colors: [TonoColor.sunEdge.opacity(0), TonoColor.sunMid.opacity(0.32 * position * glow)],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: cx + thumb / 2)
            }
            Canvas { ctx, size in
                // Engraved detent ticks along the lower half.
                let ticks = 28
                let r = size.height / 2
                for i in 0...ticks {
                    let x = inset + thumb / 2 + travel * CGFloat(i) / CGFloat(ticks)
                    let major = i == 0 || i == ticks || i == Int(Double(ticks) * 0.55)
                    var p = Path()
                    p.move(to: CGPoint(x: x, y: r + (major ? 7 : 9) + r * 0.35))
                    p.addLine(to: CGPoint(x: x, y: r + r * 0.62))
                    ctx.stroke(p, with: .color(.white.opacity(major ? 0.16 : 0.06)), lineWidth: 1)
                }
            }
        }
        .frame(width: width)
    }

    private var glow: Double { busy && !reduceMotion ? (pulse ? 1 : 0.55) : 1 }

    /// Cool moon disc when off, sun when on.
    private var sun: some View {
        let warm = Double(position)
        return ZStack {
            Circle()
                .fill(RadialGradient(colors: [TonoColor.sunMid.opacity(0.55 * warm * glow), .clear], center: .center, startRadius: 0, endRadius: thumb * 1.05))
                .frame(width: thumb * 2.1, height: thumb * 2.1)
                .animation(busy && !reduceMotion ? .easeInOut(duration: 1.2).repeatForever(autoreverses: true) : .default, value: pulse)
            Circle().fill(Color.black.opacity(0.6)).frame(width: thumb + 3, height: thumb + 3).offset(y: 3)
            Circle()
                .fill(LinearGradient(colors: [Color.mix(Color(hex: 0xE9E4D8), TonoColor.sunCore, warm),
                                              Color.mix(Color(hex: 0x8E897F), TonoColor.sunEdge, warm)],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: thumb, height: thumb)
            Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1).frame(width: thumb - 2, height: thumb - 2)
            Circle()
                .fill(RadialGradient(colors: [.white.opacity(0.5), .clear], center: .center, startRadius: 0, endRadius: thumb * 0.35))
                .frame(width: thumb * 0.7, height: thumb * 0.7)
                .offset(x: -thumb * 0.175, y: -thumb * 0.225)
        }
        .frame(width: thumb, height: thumb)
        .frame(height: 72)
        .allowsHitTesting(false)
    }

    private func drag(travel: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                if !dragging {
                    dragging = true
                    dragStart = position
                    crossed = isOn
                }
                position = min(max(dragStart + value.translation.width / travel, 0), 1)
                let nowOn = position > threshold
                if nowOn != crossed {
                    crossed = nowOn
                    UISelectionFeedbackGenerator().selectionChanged()
                }
            }
            .onEnded { _ in
                dragging = false
                let on = position > threshold
                withAnimation(TonoMotion.surface) { position = on ? 1 : 0 }
                if on != isOn { commit(on) } else { haptic(on) }
                // The tunnel owns the state: if it did not follow (e.g. the VPN prompt was declined), settle back.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    guard !dragging else { return }
                    withAnimation(TonoMotion.surface) { position = latestOn ? 1 : 0 }
                }
            }
    }

    private func commit(_ on: Bool) {
        haptic(on)
        onToggle(on)
    }

    private func haptic(_ on: Bool) {
        UIImpactFeedbackGenerator(style: on ? .medium : .light).impactOccurred()
    }
}
