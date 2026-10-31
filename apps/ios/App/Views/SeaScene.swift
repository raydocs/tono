import SwiftUI
import TonoKit

/// Portrait sea scene shared with Android and the desktop: sky, sun or moon, horizon and a
/// glittering reflection. Night while off, dawn while connecting, day when connected, dusk when a
/// route is down, ember on failure. A network change keeps the sun near the day height and sends a
/// light down the reflection (reacquiring), so it never looks like a first start. Purely decorative; the state text lives above it. Reduced
/// motion renders each destination statically.
struct SeaScene: View {
    let sky: SkyState
    var horizon: CGFloat = 0.44
    /// Off where text scrolls over the moon's place in the sky (sign-in at accessibility sizes).
    var moon = true
    /// A sheet hides the scene (Home's Settings and VPN primer): it holds a still frame.
    var covered = false
    @Environment(\.tonoReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var energy = SceneEnergy.shared

    /// Seconds between redraws, or nil to hold the still frame Reduce Motion draws
    /// (`SceneAnimationPolicy`): nothing can see it, or the phone is at critical thermal pressure.
    private var interval: Double? {
        reduceMotion ? nil : SceneAnimationPolicy.frameInterval(appActive: scenePhase == .active, sheetCovering: covered,
                                                                 lowPowerMode: energy.lowPowerMode, thermal: energy.thermalPolicy)
    }

    var body: some View {
        let still = interval == nil
        TimelineView(.animation(minimumInterval: interval ?? 1.0 / 30, paused: still)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            SeaCanvas(sunRise: sky.sunRise, warn: sky.warning ? 1 : 0, horizon: horizon,
                      drift: still ? 0 : (t / 26).truncatingRemainder(dividingBy: 1),
                      breath: [.dawn, .rising, .reconnecting].contains(sky) && !still ? 0.5 + 0.5 * sin(t * .pi / 2.4) : 1,
                      animateStars: !still, moon: moon,
                      scan: sky == .reconnecting && !still ? (t / 1.6).truncatingRemainder(dividingBy: 1) : nil)
        }
        .animation(reduceMotion ? nil : (sky == .day ? TonoMotion.arrival : TonoMotion.ambient), value: sky)
        .accessibilityHidden(true)
        .ignoresSafeArea()
    }
}

/// Low Power Mode and thermal state as the scene reads them, kept current from the system's notifications.
@MainActor
final class SceneEnergy: ObservableObject {
    static let shared = SceneEnergy()
    @Published private(set) var lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    @Published private(set) var thermal = ProcessInfo.processInfo.thermalState
    private var observers: [NSObjectProtocol] = []

    var thermalPolicy: SceneAnimationPolicy.Thermal {
        switch thermal {
        case .nominal: return .nominal
        case .fair: return .fair
        case .serious: return .serious
        case .critical: return .critical
        @unknown default: return .critical
        }
    }

    private init() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled }
            },
            center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.thermal = ProcessInfo.processInfo.thermalState }
            },
        ]
    }
}

/// The drawing itself; `sunRise` and `warn` animate between skies through `animatableData`.
private struct SeaCanvas: View, Animatable {
    var sunRise: Double
    var warn: Double
    let horizon: CGFloat
    let drift: Double
    let breath: Double
    let animateStars: Bool
    let moon: Bool
    /// Position (0 at the horizon … 1 at the bottom) of the light travelling down the reflection.
    var scan: Double? = nil

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(sunRise, warn) }
        set { sunRise = newValue.first; warn = newValue.second }
    }

    static let stars: [(Double, Double, Double)] = {
        var g = SplitMix(seed: 0x70E0)
        return (0..<70).map { _ in (g.next(), g.next() * 0.9, g.next()) }
    }()

    var body: some View {
        Canvas { ctx, size in
            let horizonY = size.height * horizon
            let t = sunRise
            let mix = Color.mix
            let top = mix(mix(Color(hex: 0x070816), Color(hex: 0x1B1030), min(t * 1.4, 1)), Color(hex: 0x2A1426), warn * 0.4)
            let mid = mix(mix(Color(hex: 0x111433), Color(hex: 0x5A2238), t), Color(hex: 0x4A1A1C), warn * 0.5)
            let low = mix(mix(Color(hex: 0x1C2350), Color(hex: 0xE0784E), t), Color(hex: 0xB0452C), warn * 0.6)
            let skyRect = CGRect(x: 0, y: 0, width: size.width, height: horizonY)
            ctx.fill(Path(skyRect), with: .linearGradient(Gradient(colors: [top, mid, low]), startPoint: .zero, endPoint: CGPoint(x: 0, y: horizonY)))

            // Stars fade with daylight.
            let starAlpha = min(max(1 - t * 1.6, 0), 1)
            if starAlpha > 0 {
                for (i, star) in Self.stars.enumerated() {
                    let (x, y, tw) = star
                    let twinkle = !animateStars || i % 3 != 0 ? 1 : 0.55 + 0.45 * sin((drift * 12 + tw) * 2 * .pi)
                    let r = 0.6 + tw * 1.3
                    let c = CGPoint(x: x * size.width, y: y * horizonY * 0.85)
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                             with: .color(.white.opacity(starAlpha * (0.25 + 0.6 * tw) * twinkle)))
                }
            }

            // Sun rises from below the horizon (night) to just clear of it (connected), staying
            // under the title (Android feat/mobile-singbox-premium df28144: smaller, lower sun).
            let sunR = min(size.width, size.height) * 0.12
            let sunX = size.width * 0.5
            let sunY = horizonY + sunR * 1.05 - t * sunR * 2.2
            if t > 0.02 {
                var clipped = ctx
                clipped.clip(to: Path(skyRect))
                let glowR = sunR * 3.2
                clipped.fill(Path(ellipseIn: CGRect(x: sunX - glowR, y: sunY - glowR, width: glowR * 2, height: glowR * 2)),
                             with: .radialGradient(Gradient(colors: [TonoColor.sunMid.opacity(0.55 * breath * min(t, 1)), .clear]),
                                                   center: CGPoint(x: sunX, y: sunY), startRadius: 0, endRadius: glowR))
                let core = mix(TonoColor.sunCore, Color(hex: 0xFFC08A), warn)
                let edge = mix(TonoColor.sunEdge, TonoColor.ember, warn)
                clipped.fill(Path(ellipseIn: CGRect(x: sunX - sunR, y: sunY - sunR, width: sunR * 2, height: sunR * 2)),
                             with: .linearGradient(Gradient(colors: [core, TonoColor.sunMid, edge]),
                                                   startPoint: CGPoint(x: sunX, y: sunY - sunR), endPoint: CGPoint(x: sunX, y: sunY + sunR)))
            }

            // Crescent moon while disconnected.
            let moonAlpha = min(max(1 - t * 3, 0), 1)
            if moon, moonAlpha > 0 {
                let c = CGPoint(x: size.width * 0.78, y: horizonY * 0.66)
                let r = min(size.width, size.height) * 0.055
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - r * 4, y: c.y - r * 4, width: r * 8, height: r * 8)),
                         with: .radialGradient(Gradient(colors: [TonoColor.moon.opacity(0.18 * moonAlpha), .clear]), center: c, startRadius: 0, endRadius: r * 4))
                let moon = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
                let cut = Path(ellipseIn: CGRect(x: c.x - r * 0.45 - r * 0.95, y: c.y - r * 0.3 - r * 0.95, width: r * 1.9, height: r * 1.9))
                // Crescent = disc minus an offset disc (Path.subtracting needs iOS 17).
                ctx.drawLayer { layer in
                    layer.fill(moon, with: .color(TonoColor.moon.opacity(moonAlpha)))
                    layer.blendMode = .destinationOut
                    layer.fill(cut, with: .color(.black))
                }
            }

            // Sea.
            let seaRect = CGRect(x: 0, y: horizonY, width: size.width, height: size.height - horizonY)
            ctx.fill(Path(seaRect), with: .linearGradient(
                Gradient(colors: [mix(Color(hex: 0x1A1E3E), Color(hex: 0x3A1E2E), t), Color(hex: 0x0B0C1A), TonoColor.nightDeep]),
                startPoint: CGPoint(x: 0, y: horizonY), endPoint: CGPoint(x: 0, y: size.height)))
            var line = Path(); line.move(to: CGPoint(x: 0, y: horizonY)); line.addLine(to: CGPoint(x: size.width, y: horizonY))
            ctx.stroke(line, with: .color(mix(Color(hex: 0xB8C4FF, opacity: 0.2), Color(hex: 0xFFD2A0, opacity: 0.4), t)), lineWidth: 1.2)

            // Reflection: horizontal glints whose drift is the only ambient motion.
            let sunUp = t > 0.02
            let alpha = sunUp ? min(t, 1) : moon ? moonAlpha * 0.35 : 0
            guard alpha > 0 else { return }
            let x = sunUp ? sunX : size.width * 0.78
            let color = sunUp ? mix(TonoColor.sunMid, TonoColor.ember, warn) : TonoColor.moon
            var glints = ctx
            glints.blendMode = .screen
            let depth = size.height - horizonY
            let rows = 46
            for i in 0..<rows {
                let p = Double(i) / Double(rows)
                let y = horizonY + 4 + p * p * depth * 0.95
                let wave = sin(Double(i) * 1.7 + drift * 2 * .pi * 3)
                let width = sunR * (0.5 + p * 2.6) * (0.6 + 0.4 * wave * wave)
                let offset = sin(Double(i) * 2.3 + drift * 2 * .pi * 5) * sunR * 0.25 * p
                var a = alpha * (1 - p) * (0.35 + 0.5 * Double((i * 37) % 11) / 11)
                if let scan { a *= 0.4 + 1.1 * exp(-pow((p - scan) * 7, 2)) }
                var glint = Path()
                glint.move(to: CGPoint(x: x - width / 2 + offset, y: y))
                glint.addLine(to: CGPoint(x: x + width / 2 + offset, y: y))
                glints.stroke(glint, with: .color(color.opacity(min(max(a, 0), 1))), lineWidth: 1.5 + p * 2.5)
            }
        }
    }
}

/// Deterministic star field (same sky every launch).
private struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> Double {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        z ^= z >> 31
        return Double(z >> 11) / Double(1 << 53)
    }
}
