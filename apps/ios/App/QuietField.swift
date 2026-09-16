import SwiftUI

/// Testable orb geometry. Rendering reads these; the protection machine is untouched.
enum LiquidOrb {
    /// How gathered the field is for a protection state.
    static func target(for state: ProtectionState) -> Double {
        switch state {
        case .protected: 1
        case .connecting: 0.55
        case .recovering: 0.35
        case .ready: 0.15
        case .paused, .actionRequired: 0
        }
    }

    /// Orbiting-mote budget. Low Power halves it; Reduce Transparency draws rings only.
    static func moteCount(lowPower: Bool) -> Int { lowPower ? 24 : 48 }
}

/// Liquid orb hero + orbiting motes. The sphere is a Metal stitchable shader
/// (App/LiquidOrb.metal) mounted via colorEffect; halo and motes stay a cheap
/// Canvas layer. Same lifecycle contract as before: stable identities, frozen
/// clock on pause / Reduce Motion / Low Power / inactive scene, 30fps cap,
/// never rendered in the app switcher.
struct QuietField: View {
    let state: ProtectionState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    @State private var alignment: Double = 0
    @State private var elapsed: TimeInterval = 0
    @State private var started: Date?
    @State private var visible = false

    private var running: Bool { visible && scenePhase == .active && !reduceMotion && !lowPower && state != .paused && state != .actionRequired }
    private var target: Double { LiquidOrb.target(for: state) }

    var body: some View {
        Group {
            if scenePhase == .active {
                TimelineView(.animation(minimumInterval: 1 / 30, paused: !running)) { context in
                    let time = elapsed + (started.map { context.date.timeIntervalSince($0) } ?? 0)
                    GeometryReader { proxy in
                        let width = proxy.size.width
                        let height = proxy.size.height
                        let center = CGPoint(x: width / 2, y: height * 0.46)
                        let diameter = min(width, height) * 0.72
                        OrbSphere(time: time, alignment: alignment, diameter: diameter)
                            .position(center)
                        OrbFieldCanvas(alignment: alignment, time: time,
                                       opaque: reduceTransparency, quiet: lowPower,
                                       center: center, radius: diameter / 2)
                    }
                }
            } else { Color.clear } // no rendering while inactive, including app switcher
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
        .onAppear { visible = true; alignment = target; updateClock() }
        .onDisappear { visible = false; updateClock() }
        .onChange(of: state) {
            withAnimation(reduceMotion || lowPower ? nil : .spring(response: 0.8, dampingFraction: 0.9)) { alignment = target }
        }
        .onChange(of: running) { updateClock() }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }

    private func updateClock() {
        if running {
            if started == nil { started = .now }
        } else if let start = started {
            elapsed += Date.now.timeIntervalSince(start)
            started = nil
        }
    }
}

/// The shader sphere. Animatable so alignment morphs smoothly; time advances
/// with the TimelineView clock and freezes with it.
private struct OrbSphere: View, Animatable {
    let time: TimeInterval
    var alignment: Double
    let diameter: CGFloat
    var animatableData: Double {
        get { alignment }
        set { alignment = newValue }
    }

    var body: some View {
        Circle()
            .fill(.white)
            .frame(width: diameter, height: diameter)
            // position arrives in this circle's local space, so the shader
            // size is the diameter, not the outer field.
            .colorEffect(ShaderLibrary.default.liquidOrb(
                .float(time), .float(Float(alignment)),
                .float2(Float(diameter), Float(diameter))))
    }
}

/// Halo + orbiting motes around the shader sphere. Reduce Transparency shows
/// rings only (motes and halo skipped, sphere stays solid).
private struct OrbFieldCanvas: View, Animatable {
    var alignment: Double
    let time: TimeInterval
    let opaque: Bool
    let quiet: Bool
    let center: CGPoint
    let radius: CGFloat
    var animatableData: Double {
        get { alignment }
        set { alignment = newValue }
    }

    var body: some View {
        Canvas { context, _ in
            let cx = center.x
            let cy = center.y
            if !opaque {
                let haloAlpha = 0.10 + alignment * 0.18
                context.fill(
                    Path(ellipseIn: CGRect(x: cx - radius * 1.8, y: cy - radius * 1.8,
                                           width: radius * 3.6, height: radius * 3.6)),
                    with: .radialGradient(
                        Gradient(colors: [TonoBrand.halo.opacity(haloAlpha), TonoBrand.halo.opacity(0)]),
                        center: center, startRadius: radius * 0.4, endRadius: radius * 1.8))
                let count = LiquidOrb.moteCount(lowPower: quiet)
                for index in 0..<count {
                    let seed = Double(index)
                    let orbit = radius * (1.05 + 0.20 * ((seed * 0.618034).truncatingRemainder(dividingBy: 1)))
                    let speed = (index.isMultiple(of: 2) ? 1.0 : -1.0) * (0.12 + 0.05 * seed.truncatingRemainder(dividingBy: 3))
                    // The clock freezes rather than resetting phase on pause/Reduce Motion.
                    // Alignment changes only geometry, never the accumulated phase.
                    let angle = seed * 2.39996 + time * speed * (0.5 + alignment)
                    let dotR = index.isMultiple(of: 5) ? 2.2 : 1.4
                    let origin = CGPoint(x: cx + cos(angle) * orbit - dotR,
                                         y: cy + sin(angle) * orbit * 0.94 - dotR)
                    context.fill(Path(ellipseIn: CGRect(origin: origin,
                                                        size: CGSize(width: dotR * 2, height: dotR * 2))),
                                 with: .color(TonoBrand.halo.opacity(0.25 + alignment * 0.55)))
                }
            }
        }
    }
}
