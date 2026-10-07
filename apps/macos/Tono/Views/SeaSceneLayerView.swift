import AppKit
import CoreImage
import QuartzCore
import SwiftUI

/// The scene is painted on size changes, then animated by the render server.
/// No timer, Canvas, TimelineView or SwiftUI state update drives ambient frames.
struct SeaSceneLayerView: NSViewRepresentable {
    let phase: SeaPresentationPhase
    let progress: Double?
    let preference: String
    let reduceMotion: Bool
    let decorations: Bool
    let active: Bool

    func makeNSView(context: Context) -> SeaSceneNativeView { SeaSceneNativeView() }
    func updateNSView(_ view: SeaSceneNativeView, context: Context) {
        view.configure(phase: phase, progress: progress, preference: preference,
                       reduceMotion: reduceMotion, decorations: decorations, active: active)
    }
    static func dismantleNSView(_ view: SeaSceneNativeView, coordinator: ()) { view.stop() }
}

@MainActor
final class SeaSceneNativeView: NSView {
    override var isFlipped: Bool { true }
    private let scene = CALayer()
    private var renderer: SeaSceneLayers?
    private var phase = SeaPresentationPhase.night
    private var progress: Double?
    private var preference = "Static"
    private var reduced = true
    private var decorations = true
    private var active = true
    private var probe = SeaSceneQualityProbe()
    private var qualityDisplayLink: CADisplayLink?
    private var observers: [NSObjectProtocol] = []
    private var lastSize = CGSize.zero
    private var lastBackingScale: CGFloat = 0
    private var resizeTask: Task<Void, Never>?
    private var liveResizeActive = false
    private var paused = false
    private var selectedQuality = SeaSceneQuality.static
    private lazy var probeTarget = SeaSceneProbeTarget(view: self)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layerUsesCoreImageFilters = true
        scene.anchorPoint = .zero
        scene.masksToBounds = true
        layer?.addSublayer(scene)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        guard bounds.size.width > 0, bounds.size.height > 0 else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // AppKit already flips a flipped NSView's backing hierarchy. Normalize
        // once against that hierarchy, rather than blindly flipping it twice.
        scene.isGeometryFlipped = !(layer?.contentsAreFlipped() ?? false)
        scene.frame = bounds
        updateRendererGeometry()
        CATransaction.commit()
        reconcileVisibility()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        // Display density is not a drag-size change. Rebuild it now so a
        // queued layout/debounce cannot leave the old-density bitmap in use.
        if lastBackingScale != (window?.backingScaleFactor ?? 2) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            scene.isGeometryFlipped = !(layer?.contentsAreFlipped() ?? false)
            scene.frame = bounds
            rebuildRendererIfNeeded()
            CATransaction.commit()
        }
        needsLayout = true
    }

    override func viewWillStartLiveResize() {
        super.viewWillStartLiveResize()
        liveResizeActive = true
        resizeTask?.cancel()
        resizeTask = nil
    }

    override func viewDidEndLiveResize() {
        super.viewDidEndLiveResize()
        liveResizeActive = false
        rebuildRendererIfNeeded()
    }

    private func updateRendererGeometry() {
        guard renderer == nil || lastSize != bounds.size
                || lastBackingScale != (window?.backingScaleFactor ?? 2) else {
            resizeTask?.cancel()
            resizeTask = nil
            scene.sublayerTransform = CATransform3DIdentity
            return
        }
        if renderer == nil {
            rebuildRendererIfNeeded()
            return
        }
        // Reuse compositor geometry during a drag/full-screen resize; bake
        // only the final size, not every intermediate main-thread layout.
        scene.sublayerTransform = CATransform3DMakeScale(
            bounds.width / lastSize.width, bounds.height / lastSize.height, 1)
        resizeTask?.cancel()
        resizeTask = nil
        guard !liveResizeActive && !inLiveResize else { return }
        resizeTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .milliseconds(150)) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.rebuildRendererIfNeeded()
        }
    }

    private func rebuildRendererIfNeeded() {
        resizeTask?.cancel()
        resizeTask = nil
        let scale = window?.backingScaleFactor ?? 2
        guard bounds.width > 0, bounds.height > 0 else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        scene.sublayerTransform = CATransform3DIdentity
        guard renderer == nil || lastSize != bounds.size || lastBackingScale != scale else {
            CATransaction.commit()
            return
        }
        lastSize = bounds.size
        lastBackingScale = scale
        renderer = SeaSceneLayers(root: scene, size: bounds.size, backingScale: scale)
        renderer?.apply(phase: phase, progress: progress, animated: false)
        renderer?.setQuality(selectedQuality, decorations: decorations, phase: phase)
        CATransaction.commit()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        let center = NotificationCenter.default
        if let window {
            for name in [NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
                         NSWindow.didDeminiaturizeNotification] {
                observers.append(center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in self?.reconcileVisibility() }
                })
            }
        }
        for name in [NSApplication.didHideNotification, NSApplication.didUnhideNotification,
                     Notification.Name.NSProcessInfoPowerStateDidChange] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.reconcileVisibility() }
            })
        }
        reconcileVisibility()
    }

    func configure(phase: SeaPresentationPhase, progress: Double?, preference: String,
                   reduceMotion: Bool, decorations: Bool, active: Bool) {
        let changed = self.phase != phase || self.progress != progress
        let wasPhase = self.phase
        self.phase = phase
        self.progress = progress
        self.preference = preference
        reduced = reduceMotion
        self.decorations = decorations
        self.active = active
        let quality = currentQuality
        if changed {
            renderer?.apply(phase: phase, progress: progress,
                animated: quality != .static && sceneIsVisible && !paused,
                stageAdvance: wasPhase == .dawn && phase == .dawn)
        }
        updateQuality(quality)
        reconcileVisibility()
    }

    private var currentQuality: SeaSceneQuality {
        SeaSceneQuality.requested(preference, reduceMotion: reduced,
            lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled, automatic: probe.quality)
    }

    private func updateQuality(_ quality: SeaSceneQuality) {
        selectedQuality = quality
        renderer?.setQuality(quality, decorations: decorations, phase: phase)
        if quality == .static { renderer?.apply(phase: phase, progress: progress, animated: false) }
    }

    private var sceneIsVisible: Bool {
        active && !isHidden && !NSApp.isHidden
            && window?.isVisible == true && window?.isMiniaturized == false
            && window?.occlusionState.contains(.visible) == true
    }

    private func reconcileVisibility() {
        let visible = sceneIsVisible
        if visible && paused {
            scene.speed = 1
            let held = scene.timeOffset
            scene.timeOffset = 0
            scene.beginTime = 0
            scene.beginTime = scene.convertTime(CACurrentMediaTime(), from: nil) - held
            paused = false
        } else if !visible && !paused {
            let held = scene.convertTime(CACurrentMediaTime(), from: nil)
            scene.speed = 0
            scene.timeOffset = held
            paused = true
        }
        updateQuality(currentQuality)
        let shouldSample = visible && probe.canSample(preference: preference, reduceMotion: reduced,
            lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
        if shouldSample {
            if qualityDisplayLink == nil {
                let link = displayLink(target: probeTarget, selector: #selector(SeaSceneProbeTarget.tick(_:)))
                qualityDisplayLink = link
                link.add(to: .main, forMode: .common)
            }
        } else {
            qualityDisplayLink?.invalidate()
            qualityDisplayLink = nil
            probe.pause()
        }
    }

    fileprivate func sample(_ link: CADisplayLink) {
        let before = probe.quality
        probe.frame(at: link.timestamp)
        if before != probe.quality { updateQuality(currentQuality) }
        if probe.complete {
            link.invalidate()
            qualityDisplayLink = nil
        }
    }

    func stop() {
        resizeTask?.cancel()
        resizeTask = nil
        qualityDisplayLink?.invalidate()
        qualityDisplayLink = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        scene.removeAllAnimations()
        scene.sublayers?.forEach { $0.removeFromSuperlayer() }
        renderer = nil
    }
}

@MainActor
private final class SeaSceneProbeTarget: NSObject {
    weak var view: SeaSceneNativeView?
    init(view: SeaSceneNativeView) { self.view = view }
    @objc func tick(_ link: CADisplayLink) { view?.sample(link) }
}

@MainActor
private final class SeaSceneLayers {
    private let root: CALayer
    private let size: CGSize
    private let scale: CGFloat
    private let unit: CGFloat
    private let sky: CALayer
    private let water: CALayer
    private var named: [String: CALayer] = [:]
    private var loops: [(CALayer, String, CAAnimation, Bool)] = []
    private var quality: SeaSceneQuality?
    private var decorated: Bool?
    private var lastPhase: SeaPresentationPhase?
    private var loopPhase: SeaPresentationPhase?

    init(root: CALayer, size: CGSize, backingScale: CGFloat) {
        self.root = root
        self.size = size
        scale = backingScale
        unit = CGFloat(SeaSceneParameters.unit(height: size.height))
        sky = CALayer()
        water = CALayer()
        root.contentsScale = scale
        sky.contentsScale = scale
        water.contentsScale = scale
        root.sublayers?.forEach { $0.removeFromSuperlayer() }
        sky.frame = CGRect(x: 0, y: 0, width: size.width, height: size.height * 0.55)
        water.frame = CGRect(x: 0, y: size.height * 0.55, width: size.width, height: size.height * 0.45)
        sky.masksToBounds = true
        water.masksToBounds = true
        root.addSublayer(sky)
        root.addSublayer(water)
        buildSky()
        buildWater()
        let horizon = radial("horizon", parent: root,
            frame: CGRect(x: 0, y: size.height * 0.55 - 9, width: size.width, height: 18),
            colors: ["FFD6AA60", "FF966420", "00000000"], stops: [0, 0.45, 1],
            center: CGPoint(x: size.width * 0.673913, y: 9), radius: CGSize(width: 260 * unit, height: 9))
        horizon.opacity = 0
        let grain = image("grain", parent: root, frame: root.bounds,
            name: "grain", tile: CGSize(width: 220, height: 220), luminance: false)
        grain.opacity = 0.5
        grain.compositingFilter = CIFilter(name: "CIOverlayBlendMode")
    }

    private func buildSky() {
        linear("sky-night", parent: sky, colors: ["04050A", "080B19", "111529"], stops: [0, 0.56, 1])
        let stars = layer("stars", parent: sky)
        let count = min(200, max(37, Int((54 * size.width * size.height / (920 * 600)).rounded())))
        for tier in 0..<3 {
            let group = layer("stars-\(tier)", parent: stars)
            for star in SeaSceneStar.seeded.prefix(count) where star.tier == tier {
                let dot = CALayer()
                dot.contentsScale = scale
                let diameter: CGFloat = [1, 1.5, 2.5][tier]
                dot.frame = CGRect(x: sky.bounds.width * star.x / 100,
                    y: sky.bounds.height * star.y / 100, width: diameter, height: diameter)
                dot.cornerRadius = diameter / 2
                dot.backgroundColor = Self.color(star.color)
                dot.opacity = Float([0.3, 0.55, 0.9][tier])
                group.addSublayer(dot)
                if star.twinkle {
                    let pulse = keyframes("opacity", values: [dot.opacity, dot.opacity * 0.2, dot.opacity],
                        times: [0, 0.5, 1], duration: star.duration, delay: star.delay)
                    loops.append((dot, "twinkle", pulse, true))
                }
            }
        }
        let meteor = linear("meteor", parent: sky, colors: ["00000000", "CED8FFB3"], stops: [0, 1])
        meteor.frame = CGRect(x: size.width * 0.42, y: sky.bounds.height * 0.18, width: 100, height: 1)
        meteor.startPoint = CGPoint(x: 0, y: 0.5)
        meteor.endPoint = CGPoint(x: 1, y: 0.5)
        meteor.opacity = 0
        meteor.setAffineTransform(CGAffineTransform(rotationAngle: .pi * 24 / 180))
        let shot = CAAnimationGroup()
        shot.animations = [keyframes("opacity", values: [0, 0.7, 0, 0], times: [0, 0.003, 0.01166667, 1], duration: 60),
            keyframes("transform.translation.x", values: [0, 180, 180], times: [0, 0.01166667, 1], duration: 60),
            keyframes("transform.translation.y", values: [0, 80, 80], times: [0, 0.01166667, 1], duration: 60)]
        shot.animations?.forEach { $0.beginTime = 0; $0.repeatCount = 0 }
        shot.duration = 60
        shot.repeatCount = .infinity
        shot.beginTime = root.convertTime(CACurrentMediaTime(), from: nil) + 55
        loops.append((meteor, "meteor", shot, true))

        let dusk = layer("sky-dusk", parent: sky)
        _ = skyTint("evening", parent: dusk, night: false)
        let night = layer("night-blend", parent: dusk)
        let blue = skyTint("night-bottom", parent: night, night: true)
        blue.mask = gradientMask(frame: blue.bounds, stops: [0, 0.454545, 0.606061, 1], values: [0, 0, 1, 1])
        let top = skyTint("night-top", parent: night, night: false)
        top.mask = gradientMask(frame: top.bounds, stops: [0, 0.454545, 0.606061, 1], values: [1, 1, 0, 0])
        night.compositingFilter = CIFilter(name: "CIAdditionCompositing")
        let day = layer("sky-day", parent: sky)
        linear("day-linear", parent: day, colors: ["00000000", "00000000", "FFAC6266"], stops: [0, 0.42, 1])
        radial("day-light", parent: day, frame: day.bounds,
            colors: ["FFB4648C", "E260463D", "00000000"], stops: [0, 0.46, 1],
            center: CGPoint(x: size.width * 0.673913, y: sky.bounds.height - 134 * unit),
            radius: CGSize(width: 440 * unit, height: 310 * unit))

        let moon = layer("moon", parent: sky,
            frame: CGRect(x: size.width * 0.8108696 - 70 * unit, y: sky.bounds.height - 238 * unit,
                          width: 140 * unit, height: 140 * unit))
        let glow = radial("moon-glow", parent: moon, frame: moon.bounds,
            colors: ["CED8FF33", "CED8FF0F", "00000000"], stops: [0, 0.4, 0.7])
        loops.append((glow, "moon-breathe", keyframes("opacity", values: [0.82, 1, 0.82],
            times: [0, 0.5, 1], duration: 12), true))
        loops.append((glow, "moon-scale", keyframes("transform.scale", values: [1, 1.025, 1],
            times: [0, 0.5, 1], duration: 12), true))
        let crescent = CAShapeLayer()
        crescent.frame = CGRect(x: 50 * unit, y: 50 * unit, width: 40 * unit, height: 40 * unit)
        let path = CGMutablePath()
        let a = CGPoint(x: 11.17 * unit, y: 3.17 * unit)
        let b = CGPoint(x: 36.83 * unit, y: 28.83 * unit)
        path.move(to: a)
        path.addArc(center: CGPoint(x: 20 * unit, y: 20 * unit), radius: 19 * unit,
                    startAngle: atan2(a.y - 20 * unit, a.x - 20 * unit),
                    endAngle: atan2(b.y - 20 * unit, b.x - 20 * unit), clockwise: true)
        path.addArc(center: CGPoint(x: 28 * unit, y: 12 * unit), radius: 19 * unit,
                    startAngle: atan2(b.y - 12 * unit, b.x - 28 * unit),
                    endAngle: atan2(a.y - 12 * unit, a.x - 28 * unit), clockwise: false)
        path.closeSubpath()
        crescent.path = path
        crescent.fillRule = .evenOdd
        crescent.fillColor = Self.color("F4EEE2")
        crescent.setAffineTransform(CGAffineTransform(rotationAngle: -.pi * 16 / 180))
        moon.addSublayer(crescent)
        radial("afterglow", parent: sky,
            frame: CGRect(x: size.width * 0.673913 - 220 * unit, y: sky.bounds.height - 28 * unit,
                          width: 440 * unit, height: 28 * unit),
            colors: ["FF96544D", "F2685A14", "00000000"], stops: [0, 0.5, 0.72],
            center: CGPoint(x: 220 * unit, y: 28 * unit))
        for (index, height, bottom, duration, delay) in [(1, 64.0, 32.0, 110.0, -47.0), (2, 58.0, 8.0, 137.0, -98.0)] {
            let cloud = image("cloud-\(index)", parent: sky,
                frame: CGRect(x: 0, y: sky.bounds.height - bottom - height, width: size.width * 0.6, height: height),
                name: "cloud-\(index)")
            loops.append((cloud, "cloud-drift", keyframes("transform.translation.x",
                values: [-size.width * 0.65, size.width], times: [0, 1], duration: duration, delay: delay), true))
        }
        let track = layer("sun-track", parent: sky,
            frame: CGRect(x: size.width * 0.673913 - 95 * unit, y: sky.bounds.height - 240 * unit,
                          width: 190 * unit, height: 190 * unit))
        let motion = layer("sun-motion", parent: track)
        radial("arrival-bloom", parent: motion, frame: motion.bounds.insetBy(dx: -100 * unit, dy: -100 * unit),
            colors: ["FFF6DE33", "FFB46414", "00000000"], stops: [0, 0.45, 0.72]).opacity = 0
        let halo = layer("halo", parent: motion, frame: motion.bounds.insetBy(dx: -90 * unit, dy: -90 * unit))
        let breath = radial("halo-breathe", parent: halo, frame: halo.bounds,
            colors: ["FF965A99", "F0545A3D", "00000000"], stops: [0, 0.45, 0.72])
        loops.append((breath, "halo-breathe", keyframes("opacity", values: [0.35, 1, 0.35],
            times: [0, 0.5, 1], duration: 2.4), true))
        let sunGlow = layer("sun-glow", parent: motion)
        let pulse = layer("sun-glow-pulse", parent: sunGlow)
        radial("sun-glow-wide", parent: pulse, frame: pulse.bounds.insetBy(dx: -250 * unit, dy: -250 * unit),
            colors: ["FFAA6080", "FFAA6052", "F0605429", "00000000"], stops: [0, 0.27, 0.58, 0.72])
        radial("sun-glow-edge", parent: pulse, frame: pulse.bounds.insetBy(dx: -10 * unit, dy: -10 * unit),
            colors: ["FFE9C280", "FFE9C280", "FFCB7F66", "00000000"], stops: [0, 0.85, 0.91, 1])
        disk("sun", parent: motion, mirrored: false)
    }

    private func buildWater() {
        linear("water-night", parent: water, colors: ["0B0D19", "05060A"], stops: [0, 1])
        let dusk = layer("water-dusk", parent: water)
        linear("water-evening", parent: dusk, colors: ["CE423280", "5C162842", "00000000"], stops: [0, 0.26, 0.7])
        let night = linear("water-night-blend", parent: dusk, colors: ["56629480", "26295142", "00000000"], stops: [0, 0.26, 0.7])
        night.compositingFilter = CIFilter(name: "CIAdditionCompositing")
        linear("water-day", parent: water, colors: ["FFA66057", "AA40361F", "00000000"], stops: [0, 0.32, 0.76])
        let swell = layer("swell-envelope", parent: water)
        swell.mask = gradientMask(frame: swell.bounds,
            stops: [0, 0.16, 0.42, NSNumber(value: Double(max(0.43, 1 - 100 / water.bounds.height)))], values: [0, 1, 0.5, 0])
        for (index, duration, delay, direction) in [(1, 40.0, 0.0, 1.0), (2, 65.0, -19.0, -1.0)] {
            let fold = layer("swell-\(index)", parent: swell,
                frame: CGRect(x: 0, y: -180, width: size.width, height: water.bounds.height + 180))
            fold.backgroundColor = Self.color("CED8FF")
            fold.opacity = 0.04
            fold.mask = textureMask("swell-\(index)", size: fold.bounds.size, tile: CGSize(width: size.width, height: 180))
            loops.append((fold, "swell-flow", keyframes("transform.translation.y", values: [0, 180 * direction],
                times: [0, 1], duration: duration, delay: delay), false))
        }
        let light = layer("water-light", parent: water,
            frame: CGRect(x: size.width * 0.673913 - 280 * unit, y: 0, width: 560 * unit, height: 270 * unit))
        for (name, color) in [("light-warm", "FFB46E"), ("light-red", "E2443F")] {
            radial(name, parent: light, frame: light.bounds, colors: [color, color + "57", "00000000"],
                stops: [0, 0.42, 1], center: CGPoint(x: 280 * unit, y: 0), radius: CGSize(width: 280 * unit, height: 270 * unit))
        }
        radial("reflection-lift", parent: water,
            frame: CGRect(x: size.width * 0.673913 - 130 * unit, y: 0, width: 260 * unit, height: 60 * unit),
            colors: ["FFCF8C30", "FFB8780F", "00000000"], stops: [0, 0.45, 0.72], center: CGPoint(x: 130 * unit, y: 0))
        let mirror = layer("mirror", parent: water,
            frame: CGRect(x: size.width * 0.673913 - 165 * unit, y: 0, width: 330 * unit, height: 270 * unit))
        mirror.anchorPoint = CGPoint(x: 0.5, y: 0)
        mirror.position = CGPoint(x: size.width * 0.673913, y: 0)
        mirror.setAffineTransform(CGAffineTransform(scaleX: 1, y: 1.45))
        mirror.mask = textureMask("reflection-envelope", size: mirror.bounds.size)
        let softTrack = mirrorTrack("mirror-soft-track", parent: mirror)
        radial("mirror-soft", parent: softTrack, frame: softTrack.bounds.insetBy(dx: -7, dy: -7),
            colors: ["FF824C73", "FF824C4D", "00000000"], stops: [0, 0.5, 0.72])
        for (index, duration, delay) in [(1, 24.0, 0.0), (2, 31.0, -7.0)] {
            let ripple = layer("ripple-\(index)", parent: mirror,
                frame: CGRect(x: 0, y: -270, width: 330 * unit, height: 270 * unit + 270))
            ripple.mask = textureMask("ripple-\(index)", size: ripple.bounds.size, tile: CGSize(width: 330 * unit, height: 270))
            let counter = layer("counter-\(index)", parent: ripple,
                frame: CGRect(x: 0, y: 270, width: 330 * unit, height: 270 * unit))
            let track = mirrorTrack("mirror-track-\(index)", parent: counter)
            disk("mirror-disk-\(index)", parent: track, mirrored: true)
            loops.append((ripple, "ripple-flow", keyframes("transform.translation.y", values: [0, 270],
                times: [0, 1], duration: duration, delay: delay), false))
            loops.append((counter, "ripple-counter", keyframes("transform.translation.y", values: [0, -270],
                times: [0, 1], duration: duration, delay: delay), false))
        }
        let moon = layer("moon-path", parent: water,
            frame: CGRect(x: size.width * 0.8108696 - 84 * unit, y: 0, width: 168 * unit, height: 170 * unit))
        glints(parent: moon, tone: "moon")
        let column = layer("light-column", parent: water,
            frame: CGRect(x: size.width * 0.673913 - 130 * unit, y: 0, width: 260 * unit, height: water.bounds.height * 0.7))
        radial("column-gold", parent: column, frame: column.bounds, colors: ["FFD9A040", "FFD9A014", "00000000"],
            stops: [0, 0.4, 0.7], center: CGPoint(x: 130 * unit, y: 0))
        radial("column-red", parent: column, frame: column.bounds, colors: ["F07C5426", "E8553F0A", "00000000"],
            stops: [0, 0.4, 0.7], center: CGPoint(x: 130 * unit, y: 0))
        radial("column-day", parent: column, frame: CGRect(x: 0, y: 0, width: 260 * unit, height: 60),
            colors: ["FFD9A035", "00000000"], stops: [0, 1], center: CGPoint(x: 130 * unit, y: 0))
        let sun = layer("sun-path", parent: water,
            frame: CGRect(x: size.width * 0.673913 - 150 * unit, y: 0, width: 300 * unit, height: 270 * unit))
        sun.anchorPoint = CGPoint(x: 0.5, y: 0)
        sun.position = CGPoint(x: size.width * 0.673913, y: 0)
        glints(parent: sun, tone: "sun")
        let sweep = linear("arrival-sweep", parent: sun, colors: ["00000000", "FFE2B099", "00000000"], stops: [0, 0.5, 1])
        sweep.frame = CGRect(x: 0, y: -60 * unit, width: 300 * unit, height: 60 * unit)
        sweep.opacity = 0
    }

    private func glints(parent: CALayer, tone: String) {
        parent.mask = textureMask("path-envelope", size: parent.bounds.size)
        for (depth, tile, duration1, duration2) in [("far", 96.0, 16.0, 21.0), ("near", 192.0, 8.0, 11.0)] {
            let envelope = layer("\(tone)-glints-\(depth)", parent: parent)
            envelope.masksToBounds = true
            envelope.mask = depth == "far"
                ? gradientMask(frame: envelope.bounds, stops: [0, 0.2, 0.72, 1], values: [1, 1, 0, 0])
                : gradientMask(frame: envelope.bounds, stops: [0, 0.34, 0.8, 1], values: [0, 1, 1, 0])
            for index in 1...2 {
                let moving = layer("\(tone)-\(depth)-specks-\(index)", parent: envelope,
                    frame: CGRect(x: 0, y: -tile, width: envelope.bounds.width, height: envelope.bounds.height + tile))
                moving.mask = textureMask("specks-\(index)", size: moving.bounds.size,
                    tile: CGSize(width: envelope.bounds.width * (depth == "far" ? 0.5 : 1), height: tile))
                if tone == "moon" { moving.backgroundColor = Self.color("C6CFF0") }
                else {
                    let gold = layer("gold-\(depth)-\(index)", parent: moving)
                    gold.backgroundColor = Self.color("FFD9A0")
                    let red = layer("red-\(depth)-\(index)", parent: moving)
                    red.backgroundColor = Self.color("E8553F")
                }
                let delay = depth == "far" ? (index == 1 ? -5.0 : -11.0) : (index == 1 ? 0.0 : -4.0)
                let shimmerDelay = depth == "far" ? (index == 1 ? -5.3 : -1.1) : (index == 1 ? -2.0 : -7.0)
                loops.append((moving, "glint-flow", keyframes("transform.translation.y", values: index == 1 ? [0, tile] : [tile, 0],
                    times: [0, 1], duration: index == 1 ? duration1 : duration2, delay: delay), depth == "far"))
                loops.append((moving, "glint-shimmer", keyframes("opacity", values: [1, 0.72, 0.94, 0.8, 1],
                    times: [0, 0.27, 0.61, 0.82, 1], duration: index == 1 ? 9.2 : 13.7, delay: shimmerDelay), depth == "far"))
            }
        }
    }

    private func mirrorTrack(_ name: String, parent: CALayer) -> CALayer {
        layer(name, parent: parent, frame: CGRect(x: 70 * unit, y: 50 * unit, width: 190 * unit, height: 190 * unit))
    }

    private func disk(_ prefix: String, parent: CALayer, mirrored: Bool) {
        let body = layer(prefix + "-body", parent: parent)
        let base = linear(prefix + "-disk", parent: body,
            colors: ["FFF6DE", "FFD58E", "FFA35E", "F2685A"], stops: [0, 0.3, 0.66, 1])
        let red = linear(prefix + "-red", parent: body,
            colors: ["FFB86E", "FF7A44", "E0403E", "9A1E38"], stops: [0, 0.34, 0.7, 1])
        let shade = layer(prefix + "-shade", parent: body)
        shade.backgroundColor = Self.color("2A0714")
        body.mask = radialMask(size: body.bounds.size, stops: [0, 1 - (mirrored ? 32 * unit : 1.5) / (95 * unit), 1], values: [1, 1, 0])
        if mirrored {
            base.setAffineTransform(CGAffineTransform(scaleX: 1, y: -1))
            red.setAffineTransform(CGAffineTransform(scaleX: 1, y: -1))
        } else {
            radial("sun-rim", parent: body, frame: body.bounds,
                colors: ["00000000", "00000000", "FFD59A99", "FFE6BFCF"],
                stops: [0, 1 - 8 / 95, 1 - 2 / 95, 1])
        }
    }

    private func skyTint(_ prefix: String, parent: CALayer, night: Bool) -> CALayer {
        let group = layer(prefix, parent: parent)
        linear(prefix + "-linear", parent: group,
            colors: night ? ["00000000", "26295199", "5763B1D9", "96A9F8F2"]
                          : ["00000000", "5C162899", "CE4232D9", "FF9654F2"],
            stops: [0.18, 0.62, 0.9, 1])
        radial(prefix + "-radial", parent: group, frame: group.bounds,
            colors: [night ? "9DACFA9E" : "FF96549E", "00000000"], stops: [0, 1],
            center: CGPoint(x: size.width * 0.673913, y: sky.bounds.height), radius: CGSize(width: 540 * unit, height: 210 * unit))
        return group
    }

    func apply(phase: SeaPresentationPhase, progress: Double?, animated: Bool, stageAdvance: Bool = false) {
        let p = SeaSceneParameters.forPhase(phase, progress: progress)
        let sunTime = animated ? SeaSceneTiming.sunDuration(phase: phase, stageAdvance: stageAdvance) : 0
        let skyTime = animated ? (phase == .night ? 6 : phase == .dusk || phase == .blocked ? 2.2 : 2.6) : 0
        let dayTime = animated ? (phase == .night ? 3.4 : phase == .dusk || phase == .blocked ? 1.8 : 2.6) : 0
        let pathTime = animated && phase == .night ? 4.4 : skyTime
        let lightTime = animated && phase == .night ? 5.6 : skyTime
        let ease = phase == .dawn ? SeaSceneTiming.dawn : phase == .dusk || phase == .blocked ? SeaSceneTiming.failEase : SeaSceneTiming.sun
        let skyEase = phase == .dawn ? SeaSceneTiming.dawn : phase == .night
            ? CAMediaTimingFunction(controlPoints: 0.5, 0, 0.3, 1) : SeaSceneTiming.skyEase
        func opacity(_ name: String, _ value: Double, _ duration: Double) {
            change(name, "opacity", value, duration: duration, ease: skyEase)
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        opacity("sky-day", p.day, dayTime)
        opacity("water-day", p.day, dayTime)
        opacity("sky-dusk", p.dusk, skyTime)
        opacity("water-dusk", p.dusk, skyTime)
        // Windows' existing warm hold: the sun reaches the horizon before the sky cools.
        let handoffTime = animated ? (phase == .night ? 2.2 : 0.5) : 0
        let handoffDelay = animated && phase == .night ? 3.8 : 0
        for name in ["night-blend", "water-night-blend"] {
            change(name, "opacity", phase == .night ? 1 : 0, duration: handoffTime,
                ease: CAMediaTimingFunction(name: .linear), delay: handoffDelay)
        }
        for name in ["evening", "water-evening"] {
            change(name, "opacity", phase == .night ? 0 : 1, duration: handoffTime,
                ease: CAMediaTimingFunction(name: .linear), delay: handoffDelay)
        }
        for tier in 0..<3 {
            change("stars-\(tier)", "opacity", p.stars, duration: animated ? (phase == .dawn || phase == .day ? 2 : phase == .dusk || phase == .blocked ? 2.6 : skyTime) : 0,
                ease: skyEase, delay: animated && (phase == .dawn || phase == .day) ? Double(tier) * 0.3 : 0)
        }
        change("sun-track", "position.y", Double(sky.bounds.height - 145 * unit) + p.offset * Double(unit),
            duration: sunTime, ease: ease, sunset: phase == .night)
        change("sun-track", "transform.scale", p.scale, duration: sunTime, ease: ease, sunset: phase == .night)
        for name in ["mirror-soft-track", "mirror-track-1", "mirror-track-2"] {
            change(name, "position.y", (145 - p.offset) * Double(unit), duration: sunTime, ease: ease, sunset: phase == .night)
            change(name, "transform.scale", p.scale, duration: sunTime, ease: ease, sunset: phase == .night)
        }
        for prefix in ["sun", "mirror-disk-1", "mirror-disk-2"] {
            change(prefix + "-body", "transform.scale.y", p.diskShape, duration: sunTime, ease: ease, sunset: phase == .night, shape: true)
            opacity(prefix + "-red", prefix == "sun" ? p.red : max(0.65, p.red), animated ? 2.2 : 0)
            opacity(prefix + "-shade", p.shade, sunTime)
            if prefix != "sun" { opacity(prefix + "-body", phase == .dusk || phase == .blocked ? 0.9 : phase == .dawn ? 0.62 : 0.6, skyTime) }
        }
        change("sun-glow", "transform.scale.y", p.diskShape, duration: sunTime, ease: ease, sunset: phase == .night, shape: true)
        opacity("sun-glow", p.glow, dayTime)
        opacity("halo", phase == .dawn ? 1 : 0, animated ? 0.8 : 0)
        opacity("water-light", p.light, lightTime)
        opacity("light-warm", 1 - p.lightRed, lightTime)
        opacity("light-red", p.lightRed, lightTime)
        opacity("mirror", phase == .dusk || phase == .blocked || phase == .dawn && (progress ?? 1) <= 0 ? 0 : p.mirror, skyTime)
        opacity("reflection-lift", phase == .dawn ? 1 : 0, skyTime)
        opacity("mirror-soft", phase == .dusk || phase == .blocked ? 0.18 : 1, skyTime)
        opacity("sun-path", p.path, pathTime)
        change("sun-path", "transform.scale.y", p.pathScale, duration: sunTime, ease: ease, sunset: phase == .night)
        opacity("light-column", p.path, pathTime)
        for depth in ["near", "far"] {
            for index in 1...2 {
                opacity("gold-\(depth)-\(index)", 1 - p.pathRed, pathTime)
                opacity("red-\(depth)-\(index)", p.pathRed, pathTime)
            }
        }
        opacity("column-gold", 1 - p.pathRed, pathTime)
        opacity("column-red", p.pathRed, pathTime)
        opacity("column-day", p.day, dayTime)
        opacity("horizon", p.horizon, skyTime)
        opacity("moon", phase == .night ? 1 : 0, animated ? (phase == .night ? 3.4 : 0.5) : 0)
        change("moon", "transform.translation.y", phase == .night ? 0 : Double(30 * unit), duration: animated ? (phase == .night ? 4.2 : 0.5) : 0, ease: ease)
        opacity("moon-path", phase == .night ? 0.34 : 0, animated ? (phase == .night ? 3.4 : 0.5) : 0)
        opacity("afterglow", phase == .night ? 0 : 0.5, animated && phase == .night ? 6.6 : skyTime)
        if phase == .day && lastPhase != nil && lastPhase != .day && animated { arrival() }
        else if phase != .day || !animated {
            named["arrival-bloom"]?.removeAllAnimations()
            named["arrival-sweep"]?.removeAllAnimations()
        }
        CATransaction.commit()
        lastPhase = phase
    }

    func setQuality(_ quality: SeaSceneQuality, decorations: Bool, phase: SeaPresentationPhase) {
        let rebuild = self.quality != quality || decorated != decorations
        guard rebuild || loopPhase != phase else { return }
        self.quality = quality
        decorated = decorations
        loopPhase = phase
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for name in ["stars", "cloud-1", "cloud-2", "moon-glow", "sun-glow", "halo", "mirror", "sun-path", "moon-path", "horizon", "grain", "swell-envelope", "water-light", "light-column"] {
            named[name]?.isHidden = !decorations
        }
        for tone in ["sun", "moon"] { named[tone + "-glints-far"]?.isHidden = quality != .full }
        for (target, key, animation, fullOnly) in loops {
            let moonLoop = key.hasPrefix("moon-") || target.name?.hasPrefix("moon-") == true
            let phaseAllowed = key == "meteor" || moonLoop ? phase == .night
                : key == "halo-breathe" ? phase == .dawn : true
            // Hold phase-specific loop clocks independently of their parent's exit fade.
            if phaseAllowed && target.speed == 0 {
                let held = target.timeOffset
                target.speed = 1
                target.timeOffset = 0
                target.beginTime = 0
                target.beginTime = target.convertTime(CACurrentMediaTime(), from: nil) - held
            } else if !phaseAllowed && target.speed != 0 {
                target.timeOffset = target.convertTime(CACurrentMediaTime(), from: nil)
                target.speed = 0
            }
            let enabled = decorations && quality != .static && (!fullOnly || quality == .full)
            if !enabled || key == "meteor" && !phaseAllowed { target.removeAnimation(forKey: key) }
            else if phaseAllowed && (rebuild || target.animation(forKey: key) == nil) {
                let copy = animation.copy() as! CAAnimation
                if key == "meteor" { copy.beginTime = target.convertTime(CACurrentMediaTime(), from: nil) + 55 }
                target.add(copy, forKey: key)
            }
        }
        for name in ["sun-motion", "sun-glow-pulse", "mirror-soft-track", "mirror-track-1", "mirror-track-2"] { named[name]?.removeAnimation(forKey: "phase-loop") }
        named["sun-glow-pulse"]?.removeAnimation(forKey: "phase-scale")
        if decorations && quality == .full {
            if phase == .day {
                named["sun-glow-pulse"]?.add(keyframes("opacity", values: [0.9, 1, 0.9], times: [0, 0.5, 1], duration: 7.6), forKey: "phase-loop")
                named["sun-glow-pulse"]?.add(keyframes("transform.scale", values: [1, 1.03, 1], times: [0, 0.5, 1], duration: 7.6), forKey: "phase-scale")
            } else if phase == .dusk || phase == .blocked {
                named["sun-motion"]?.add(keyframes("transform.translation.y", values: [0, 3, 0, -3, 0], times: [0, 0.25, 0.5, 0.75, 1], duration: 5), forKey: "phase-loop")
                for name in ["mirror-soft-track", "mirror-track-1", "mirror-track-2"] {
                    named[name]?.add(keyframes("transform.translation.y", values: [0, -3, 0, 3, 0], times: [0, 0.25, 0.5, 0.75, 1], duration: 5), forKey: "phase-loop")
                }
                named["sun-glow-pulse"]?.add(keyframes("opacity", values: [0.82, 1, 0.82], times: [0, 0.5, 1], duration: 6.4), forKey: "phase-loop")
                named["sun-glow-pulse"]?.add(keyframes("transform.scale", values: [1, 1.025, 1], times: [0, 0.5, 1], duration: 6.4), forKey: "phase-scale")
            }
        }
        CATransaction.commit()
    }

    private func arrival() {
        named["arrival-bloom"]?.add(keyframes("opacity", values: [0, 0.12, 0, 0, 0.5, 0],
            times: [0, 0.08, 0.2, 0.52, 0.74, 1], duration: 2.4, repeats: false), forKey: "arrival")
        named["arrival-bloom"]?.add(keyframes("transform.scale", values: [1, 1.025, 1, 1, 1.08, 1],
            times: [0, 0.08, 0.2, 0.52, 0.74, 1], duration: 2.4, repeats: false), forKey: "arrival-scale")
        named["arrival-sweep"]?.add(keyframes("opacity", values: [0, 0.45, 0], times: [0, 0.2, 1],
            duration: 0.9, delay: 1.4, repeats: false), forKey: "arrival")
        named["arrival-sweep"]?.add(keyframes("transform.translation.y", values: [0, 330 * unit], times: [0, 1],
            duration: 0.9, delay: 1.4, repeats: false), forKey: "arrival-position")
    }

    private func change(_ name: String, _ key: String, _ value: Double, duration: Double,
                        ease: CAMediaTimingFunction, delay: Double = 0, sunset: Bool = false, shape: Bool = false) {
        guard let layer = named[name] else { return }
        let from = (layer.presentation()?.value(forKeyPath: key) ?? layer.value(forKeyPath: key)) as? NSNumber
        layer.setValue(value, forKeyPath: key)
        guard duration > 0, let from, abs(from.doubleValue - value) > 0.000001 else {
            layer.removeAnimation(forKey: "transition-" + key)
            return
        }
        let animation: CAPropertyAnimation
        if sunset {
            let travel = CAKeyframeAnimation(keyPath: key)
            travel.keyTimes = shape ? SeaSceneTiming.shapeTimes : SeaSceneTiming.setTimes
            travel.values = (shape ? SeaSceneTiming.shapeValues : SeaSceneTiming.setValues).map { from.doubleValue + (value - from.doubleValue) * $0 }
            travel.calculationMode = .linear
            animation = travel
        } else {
            let travel = CABasicAnimation(keyPath: key)
            travel.fromValue = from
            travel.toValue = value
            travel.timingFunction = ease
            animation = travel
        }
        animation.duration = duration
        animation.beginTime = root.convertTime(CACurrentMediaTime(), from: nil) + delay
        animation.fillMode = .backwards
        layer.add(animation, forKey: "transition-" + key)
    }

    private func keyframes(_ key: String, values: [Any], times: [NSNumber], duration: Double,
                           delay: Double = 0, repeats: Bool = true) -> CAKeyframeAnimation {
        let animation = CAKeyframeAnimation(keyPath: key)
        animation.values = values
        animation.keyTimes = times
        animation.duration = duration
        animation.beginTime = root.convertTime(CACurrentMediaTime(), from: nil) + delay
        animation.repeatCount = repeats ? .infinity : 0
        animation.calculationMode = .linear
        if key == "opacity" || key == "transform.scale" {
            animation.timingFunctions = (1..<times.count).map { _ in CAMediaTimingFunction(name: .easeInEaseOut) }
        }
        return animation
    }

    @discardableResult private func layer(_ name: String, parent: CALayer, frame: CGRect? = nil) -> CALayer {
        let layer = CALayer()
        layer.name = name
        layer.frame = frame ?? parent.bounds
        layer.contentsScale = scale
        parent.addSublayer(layer)
        named[name] = layer
        return layer
    }

    @discardableResult private func linear(_ name: String, parent: CALayer, colors: [String], stops: [NSNumber]) -> CAGradientLayer {
        let gradient = CAGradientLayer()
        gradient.name = name
        gradient.contentsScale = scale
        gradient.frame = parent.bounds
        gradient.colors = colors.map(Self.color)
        gradient.locations = stops
        gradient.startPoint = CGPoint(x: 0.5, y: 0)
        gradient.endPoint = CGPoint(x: 0.5, y: 1)
        parent.addSublayer(gradient)
        named[name] = gradient
        return gradient
    }

    @discardableResult private func radial(_ name: String, parent: CALayer, frame: CGRect,
        colors: [String], stops: [CGFloat], center: CGPoint? = nil, radius: CGSize? = nil) -> CALayer {
        let result = layer(name, parent: parent, frame: frame)
        result.contents = Self.radialImage(size: frame.size, scale: scale, colors: colors.map(Self.color),
            stops: stops, center: center ?? CGPoint(x: frame.width / 2, y: frame.height / 2),
            radius: radius ?? CGSize(width: frame.width / 2, height: frame.height / 2))
        return result
    }

    private func gradientMask(frame: CGRect, stops: [NSNumber], values: [CGFloat]) -> CALayer {
        let mask = CAGradientLayer()
        mask.contentsScale = scale
        mask.frame = frame
        mask.colors = values.map { CGColor(gray: 1, alpha: $0) }
        mask.locations = stops
        mask.startPoint = CGPoint(x: 0.5, y: 0)
        mask.endPoint = CGPoint(x: 0.5, y: 1)
        return mask
    }

    private func radialMask(size: CGSize, stops: [CGFloat], values: [CGFloat]) -> CALayer {
        let mask = CALayer()
        mask.contentsScale = scale
        mask.frame = CGRect(origin: .zero, size: size)
        mask.contents = Self.radialImage(size: size, scale: scale,
            colors: values.map { Self.color("FFFFFF").copy(alpha: $0)! }, stops: stops,
            center: CGPoint(x: size.width / 2, y: size.height / 2), radius: CGSize(width: size.width / 2, height: size.height / 2))
        return mask
    }

    private func textureMask(_ name: String, size: CGSize, tile: CGSize? = nil) -> CALayer {
        let mask = CALayer()
        mask.contentsScale = scale
        mask.frame = CGRect(origin: .zero, size: size)
        mask.contents = Self.texture(name, size: size, scale: scale, tile: tile, luminance: true)
        return mask
    }

    private func image(_ name: String, parent: CALayer, frame: CGRect, name asset: String,
                       tile: CGSize? = nil, luminance: Bool = false) -> CALayer {
        let result = layer(name, parent: parent, frame: frame)
        result.contents = Self.texture(asset, size: frame.size, scale: scale, tile: tile, luminance: luminance)
        return result
    }

    private static func color(_ hex: String) -> CGColor {
        let rgb = UInt64(hex, radix: 16) ?? 0
        let alpha = hex.count == 8 ? Double(rgb & 255) / 255 : 1
        let value = hex.count == 8 ? rgb >> 8 : rgb
        return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [
            CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255, alpha])!
    }

    private static func context(size: CGSize, scale: CGFloat) -> CGContext? {
        CGContext(data: nil, width: max(1, Int((size.width * scale).rounded(.up))),
            height: max(1, Int((size.height * scale).rounded(.up))), bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
    }

    private static func radialImage(size: CGSize, scale: CGFloat, colors: [CGColor], stops: [CGFloat],
                                    center: CGPoint, radius: CGSize) -> CGImage? {
        guard let context = context(size: size, scale: scale),
              let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                colors: colors as CFArray, locations: stops) else { return nil }
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: center.x, y: size.height - center.y)
        context.scaleBy(x: max(0.1, radius.width), y: max(0.1, radius.height))
        context.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0,
            endCenter: .zero, endRadius: 1, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        return context.makeImage()
    }

    private static func texture(_ name: String, size: CGSize, scale: CGFloat,
                                tile: CGSize?, luminance: Bool) -> CGImage? {
        guard let source = NSImage(named: NSImage.Name("sea-" + name))?.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let context = context(size: size, scale: scale) else { return nil }
        context.scaleBy(x: scale, y: scale)
        let period = tile ?? size
        for y in stride(from: CGFloat.zero, to: size.height, by: period.height) {
            for x in stride(from: CGFloat.zero, to: size.width, by: period.width) {
                context.draw(source, in: CGRect(x: x, y: y, width: period.width, height: period.height))
            }
        }
        if luminance, let data = context.data?.assumingMemoryBound(to: UInt8.self) {
            // CSS mask-mode:luminance -> native alpha mask, once per size, never per frame.
            for y in 0..<context.height {
                for x in 0..<context.width {
                    let p = data + y * context.bytesPerRow + x * 4
                    let red = 0.2126 * Double(p[0])
                    let green = 0.7152 * Double(p[1])
                    let blue = 0.0722 * Double(p[2])
                    let alpha = UInt8((red + green + blue).rounded())
                    p[0] = alpha; p[1] = alpha; p[2] = alpha; p[3] = alpha
                }
            }
        }
        return context.makeImage()
    }
}
