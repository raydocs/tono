import SwiftUI

/// Stable particle identities + spring-interpolated alignment. No random regeneration
/// on state changes. Protected means aligned flow; paused means a settled open field.
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
    private var target: Double {
        switch state {
        case .protected: 1
        case .connecting: 0.55
        case .recovering: 0.35
        case .ready: 0.15
        case .paused, .actionRequired: 0
        }
    }

    var body: some View {
        Group {
            if scenePhase == .active {
                TimelineView(.animation(minimumInterval: 1 / 30, paused: !running)) { context in
                    let time = elapsed + (started.map { context.date.timeIntervalSince($0) } ?? 0)
                    FieldCanvas(alignment: alignment, time: time, opaque: reduceTransparency, quiet: lowPower)
                }
            } else { Color.clear } // no Canvas rendering while inactive, including app switcher
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
        .onAppear { visible = true; alignment = target; updateClock() }
        .onDisappear { visible = false; updateClock() }
        .onChange(of: state) {
            withAnimation(reduceMotion || lowPower ? nil : .spring(response: 1.2, dampingFraction: 0.88)) { alignment = target }
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

private struct FieldCanvas: View, Animatable {
    var alignment: Double
    let time: TimeInterval
    let opaque: Bool
    let quiet: Bool
    var animatableData: Double {
        get { alignment }
        set { alignment = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let count = quiet ? 32 : 96
            for index in 0..<count {
                let seed = Double(index)
                let lane = sin(seed * 2.39996)
                let base = (seed * 0.618034).truncatingRemainder(dividingBy: 1)
                // The clock freezes rather than resetting phase on pause/Reduce Motion.
                // Alignment changes only geometry, never the accumulated phase.
                let drift = time * 0.01
                let x = (base + drift).truncatingRemainder(dividingBy: 1)
                let spread = (1 - alignment) * 0.34 + 0.045
                let wave = sin(x * .pi * 2 + seed * 0.05) * 0.03 * alignment
                let y = 0.5 + lane * spread + wave
                let radius = index.isMultiple(of: 5) ? 1.5 : 0.9
                let edge = min(1, min(x, 1 - x) * 8)
                let color = Color.teal.opacity(opaque ? 1 : (0.3 + alignment * 0.4) * edge)
                let rect = CGRect(x: x * size.width, y: y * size.height, width: radius * 2, height: radius * 2)
                context.fill(Path(ellipseIn: rect), with: .color(color))
            }
        }
    }
}
