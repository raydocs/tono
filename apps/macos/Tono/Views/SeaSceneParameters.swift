import Foundation
import QuartzCore

/// Scalar endpoints from Windows sea-scene.css. No connection decisions live here.
struct SeaSceneParameters: Equatable {
    var offset: Double
    var scale: Double
    var diskShape: Double
    var day: Double
    var dusk: Double
    var stars: Double
    var red: Double
    var shade: Double
    var glow: Double
    var mirror: Double
    var path: Double
    var pathScale: Double
    var pathRed: Double
    var light: Double
    var lightRed: Double
    var horizon: Double

    static func forPhase(_ phase: SeaPresentationPhase, progress: Double? = nil) -> Self {
        switch phase {
        case .day:
            return .init(offset: 0, scale: 1, diskShape: 1, day: 1, dusk: 0.75,
                stars: 0, red: 0, shade: 0, glow: 1, mirror: 0.1,
                path: 1, pathScale: 1, pathRed: 0, light: 0.5, lightRed: 0, horizon: 0.9)
        case .dawn:
            let offset = progress.flatMap { $0.isFinite ? 205 - 150 * min(1, max(0, $0)) : nil } ?? 125
            return .init(offset: offset, scale: 1.08,
                diskShape: 1 - min(0.03, max(0, (offset - 85) * 0.0005)),
                day: 0.18, dusk: 1, stars: 0.3, red: 0.45, shade: 0, glow: 0.75,
                mirror: 0.6, path: 0.9, pathScale: 0.72,
                pathRed: 0.6, light: 0.6, lightRed: 0.45, horizon: 0.9)
        case .dusk, .blocked:
            return .init(offset: 223, scale: 1.1, diskShape: 0.97, day: 0, dusk: 0.5,
                stars: 0.6, red: 1, shade: 0.08, glow: 0.4, mirror: 0.7,
                path: 0.22, pathScale: 0.2, pathRed: 1, light: 0.4, lightRed: 1, horizon: 0.55)
        case .night:
            return .init(offset: 290, scale: 1.1, diskShape: 0.97, day: 0, dusk: 0.22,
                stars: 1, red: 1, shade: 0.26, glow: 0, mirror: 0,
                path: 0, pathScale: 0.3, pathRed: 1, light: 0, lightRed: 1, horizon: 0.26)
        }
    }

    static func progress(for stage: ConnectionStage) -> Double {
        Double(ConnectionStage.allCases.firstIndex(of: stage) ?? 0)
            / Double(max(1, ConnectionStage.allCases.count - 1))
    }

    static func unit(height: Double) -> Double { min(1.5789474, max(1, 0.001368421 * height)) }
}

enum SeaSceneQuality: String {
    case full, lite, `static`

    static func requested(_ preference: String, reduceMotion: Bool, lowPower: Bool,
                          automatic: Self) -> Self {
        if reduceMotion || preference == "Static" { return .static }
        if preference == "Lite" || preference == "Simple" { return .lite }
        if lowPower { return preference == "Auto" && automatic == .static ? .static : .lite }
        return preference == "Full" ? .full : automatic
    }
}

/// A single visible 3 s sample budget, like scene-quality-probe.ts. No lasting frame callback.
struct SeaSceneQualityProbe {
    private(set) var quality = SeaSceneQuality.full
    private(set) var complete = false
    private(set) var elapsed = 0.0
    private var last: Double?
    private var checkpoint = false
    private var intervals: [Double] = []
    private var liteIntervals: [Double] = []

    init() {
        intervals.reserveCapacity(1000)
        liteIntervals.reserveCapacity(1000)
    }

    mutating func pause() { last = nil }

    func canSample(preference: String, reduceMotion: Bool, lowPower: Bool) -> Bool {
        preference == "Auto" && !reduceMotion && !lowPower && !complete
    }

    mutating func frame(at time: Double) {
        guard !complete else { return }
        defer { last = time }
        guard let last, time > last, time.isFinite else { return }
        let interval = (time - last) * 1000
        elapsed += interval
        intervals.append(interval)
        if quality == .lite { liteIntervals.append(interval) }
        if elapsed >= 1500 && !checkpoint {
            checkpoint = true
            downgrade()
        }
        if elapsed >= 3000 || intervals.count >= 1000 {
            downgrade()
            complete = true
        }
        if quality == .static { complete = true }
    }

    private mutating func downgrade() {
        if quality == .full && Self.p95(intervals) > 34 { quality = .lite }
        if quality == .lite && Self.p95(liteIntervals) > 50 { quality = .static }
    }

    private static func p95(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        return sorted[max(0, Int(ceil(Double(sorted.count) * 0.95)) - 1)]
    }
}

enum SeaSceneTiming {
    static let arrival = 2.4
    static let rise = 2.6
    static let progress = 0.9
    static let fail = 1.8
    static let set = 4.6
    static let sky = 2.6
    static let night = 6.0
    static let sun = CAMediaTimingFunction(controlPoints: 0.3, 0, 0.2, 1)
    static let skyEase = CAMediaTimingFunction(controlPoints: 0.4, 0, 0.4, 1)
    static let dawn = CAMediaTimingFunction(controlPoints: 0.25, 0, 0.75, 1)
    static let failEase = CAMediaTimingFunction(controlPoints: 0.45, 0, 0.3, 1)
    // motion.css @supports linear(): preserve the actual piecewise travel/shape curves.
    static let setTimes: [NSNumber] = [0, 0.06, 0.18, 0.38, 0.55, 0.72, 0.82, 0.91, 1]
    static let setValues = [0.0, 0.05, 0.3, 0.58, 0.72, 0.82, 0.86, 0.91, 1]
    static let shapeTimes: [NSNumber] = [0, 0.18, 0.38, 0.55, 1]
    static let shapeValues = [0.0, 0, 0.6, 1, 1]

    static func sunDuration(phase: SeaPresentationPhase, stageAdvance: Bool) -> Double {
        switch phase {
        case .night: return set
        case .dawn: return stageAdvance ? progress : rise
        case .day: return arrival
        case .dusk, .blocked: return fail
        }
    }
}

struct SeaSceneStar {
    let x: Double
    let y: Double
    let tier: Int
    let twinkle: Bool
    let duration: Double
    let delay: Double
    let color: String

    static let seeded: [Self] = {
        var seed: UInt32 = 47
        func random() -> Double {
            seed = seed &* 1664525 &+ 1013904223
            return Double(seed) / 4294967296
        }
        // Sky percent, as Windows `SeaScene.tsx`: a bright star beside a glyph
        // reads as stray punctuation ("Tono." / "未连接 ."), so the title
        // chrome and the copy column keep only the faint tier.
        func behindText(_ x: Double, _ y: Double) -> Bool {
            (y < 16 && (x < 52 || x > 84)) || (x < 50 && y > 22)
        }
        return (0..<200).map { index in
            let x = 3 + random() * 94
            let y = 8 + random() * 72
            let tier = index % 11 < 6 ? 0 : index % 11 < 9 ? 1 : 2
            return Self(x: x, y: y, tier: behindText(x, y) ? 0 : tier,
                twinkle: index % 3 == 0, duration: 3 + random() * 6,
                delay: -random() * 9, color: ["B8CAFF", "F4EEE2", "FFE0B0"][index % 3])
        }
    }()
}
