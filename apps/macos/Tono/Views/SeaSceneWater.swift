import AppKit
import Foundation
import Metal
import QuartzCore
import simd

/// Live proxy throughput as the water reads it. Nil when there is no connected, live feed.
struct SeaTrafficSample: Equatable {
    var up: Int64
    var down: Int64
}

/// Traffic-driven sparkle on the full-quality water (decision 077, owner 2026-10-08).
/// Advanced once per drawn water frame; never a SwiftUI state update.
struct SeaWaterTraffic {
    /// Sparkle drive, 0...1, smoothed.
    private(set) var level = 0.0
    /// Fine-ripple roughness, follows `level` more slowly.
    private(set) var rough = 0.18
    private var last: SeaTrafficSample?
    private var unchanged = 0.0
    /// The core reports once a second; a reading frozen this long is stale.
    static let staleAfter = 4.0

    /// log10(1 + KB/s) against 20 MB/s, clamped to 0...1.
    static func target(bytesPerSecond: Double) -> Double {
        guard bytesPerSecond.isFinite, bytesPerSecond > 0 else { return 0 }
        return min(1, max(0, log10(1 + bytesPerSecond / 1024) / log10(1 + 20480)))
    }

    mutating func advance(_ sample: SeaTrafficSample?, dt: Double) {
        let step = dt.isFinite ? max(0, min(dt, 0.25)) : 0
        if let sample, sample == last { unchanged += step } else { unchanged = 0 }
        last = sample
        var target = 0.0
        if let sample, unchanged < Self.staleAfter {
            target = Self.target(bytesPerSecond: Double(max(0, sample.up)) + Double(max(0, sample.down)))
        }
        level += (target - level) * (1 - exp(-step / (target > level ? 0.6 : 1.5)))
        rough += (0.18 + 0.5 * level - rough) * (1 - exp(-step / 1.4))
    }
}

/// What the layer sky shows right now, in frame heights above the sea line.
struct SeaWaterInputs: Equatable {
    var sunHeight: Double
    var sunRadius: Double
    var moonHeight: Double
    var moonRadius: Double
    var glow: Double
    var red: Double
    var stars: Double
    var moon: Double
}

/// Matches `SeaWaterUniforms` in the shader: nine float4s.
struct SeaWaterUniforms {
    var frame: SIMD4<Float>     // full width px, full height px, water height px, time
    var sun: SIMD4<Float>       // column, height, radius, moon radius
    var light: SIMD4<Float>     // glow, red, stars, moon
    var sea: SIMD4<Float>       // rough, spark, haze, moon height
    var zenith: SIMD4<Float>
    var middle: SIMD4<Float>
    var horizon: SIMD4<Float>
    var glow: SIMD4<Float>
    var water: SIMD4<Float>

    /// Reflection colours follow the sun's glow, which rises monotonically
    /// idle -> failed -> connecting -> connected (the approved prototype table).
    private static let tones: [(glow: Double, zenith: UInt32, middle: UInt32, horizon: UInt32, light: UInt32, water: UInt32, haze: Double)] = [
        (0, 0x04050A, 0x090D20, 0x1C2448, 0xFF7A5A, 0x04050A, 0.35),
        (0.4, 0x070914, 0x3A1222, 0xB23A30, 0xE85A44, 0x05060B, 0.6),
        (0.75, 0x0B1128, 0x56182C, 0xFF9254, 0xFF8E58, 0x06070D, 0.9),
        (1, 0x1A2440, 0x6E3442, 0xF2965E, 0xFFA862, 0x06080F, 1),
    ]

    init(inputs: SeaWaterInputs, drawable: CGSize, time: Double, traffic: SeaWaterTraffic) {
        let glow = min(1, max(0, inputs.glow.isFinite ? inputs.glow : 0))
        let upper = Self.tones.firstIndex { $0.glow >= glow } ?? Self.tones.count - 1
        let lower = max(0, upper - 1)
        let a = Self.tones[lower], b = Self.tones[upper]
        let t = Float(b.glow > a.glow ? (glow - a.glow) / (b.glow - a.glow) : 1)
        func rgb(_ hex: UInt32) -> SIMD4<Float> {
            SIMD4(Float((hex >> 16) & 255) / 255, Float((hex >> 8) & 255) / 255, Float(hex & 255) / 255, 1)
        }
        func mix(_ x: UInt32, _ y: UInt32) -> SIMD4<Float> { rgb(x) + (rgb(y) - rgb(x)) * t }
        let height = Float(max(1, drawable.height))
        frame = SIMD4(Float(max(1, drawable.width)), height / 0.45, height, Float(time))
        sun = SIMD4(0.673913, Float(inputs.sunHeight), Float(max(0.001, inputs.sunRadius)), Float(max(0.001, inputs.moonRadius)))
        light = SIMD4(Float(glow), Float(inputs.red), Float(inputs.stars), Float(inputs.moon))
        sea = SIMD4(Float(traffic.rough), Float(traffic.level),
                    Float(a.haze + (b.haze - a.haze) * Double(t)), Float(inputs.moonHeight))
        zenith = mix(a.zenith, b.zenith)
        middle = mix(a.middle, b.middle)
        horizon = mix(a.horizon, b.horizon)
        self.glow = mix(a.light, b.light)
        water = mix(a.water, b.water)
    }
}

/// Real-time water for Full quality: a port of the approved WebGL shader.
/// Any Metal failure leaves the layer water in place.
@MainActor
final class SeaWaterRenderer: NSObject, CAMetalDisplayLinkDelegate {
    let layer = CAMetalLayer()
    var onFirstPresent: (() -> Void)?
    var onFailure: (() -> Void)?
    /// Called on the main thread for each frame with its target time; nil skips the frame.
    var frameUniforms: ((Double) -> SeaWaterUniforms?)?
    private let queue: any MTLCommandQueue
    private var pipeline: (any MTLRenderPipelineState)?
    private var awaitingPresent = true
    private var link: CAMetalDisplayLink?

    var running: Bool { link != nil }

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
        self.queue = queue
        super.init()
        layer.name = "water-metal"
        layer.device = device
        layer.pixelFormat = .bgra8Unorm
        layer.framebufferOnly = true
        layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        layer.contentsGravity = .resize
        layer.maximumDrawableCount = 3
        layer.isHidden = true
        Self.compile(device: device) { [weak self] state in
            Task { @MainActor in self?.compiled(state) }
        }
    }

    private func compiled(_ state: (any MTLRenderPipelineState)?) {
        guard let state else {
            onFailure?()
            return
        }
        pipeline = state
    }

    /// Water is soft; 1x-1.5x of its point size is enough.
    func resize(to size: CGSize, backingScale: CGFloat) {
        let scale = min(1.5, max(1, backingScale))
        layer.contentsScale = scale
        let pixels = CGSize(width: max(1, (size.width * scale).rounded()), height: max(1, (size.height * scale).rounded()))
        if layer.drawableSize != pixels { layer.drawableSize = pixels }
    }

    /// Restart the "first frame on screen" handshake (after the water was off).
    func resetPresentation() { awaitingPresent = true }

    /// A Metal display link hands out drawables when they are free, so the main
    /// thread never blocks in `nextDrawable()` while the compositor holds them.
    func start() {
        guard link == nil else { return }
        let link = CAMetalDisplayLink(metalLayer: layer)
        link.delegate = self
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.preferredFrameLatency = 2
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    nonisolated func metalDisplayLink(_ link: CAMetalDisplayLink, needsUpdate update: CAMetalDisplayLink.Update) {
        // Added to the main run loop, so this arrives on the main thread.
        MainActor.assumeIsolated {
            self.render(update.drawable, at: update.targetPresentationTimestamp)
        }
    }

    private func render(_ drawable: any CAMetalDrawable, at time: Double) {
        guard let pipeline, !layer.isHidden, layer.drawableSize.width > 1,
              let uniforms = frameUniforms?(time), let buffer = queue.makeCommandBuffer() else { return }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = drawable.texture
        pass.colorAttachments[0].loadAction = .dontCare
        pass.colorAttachments[0].storeAction = .store
        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        var values = uniforms
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBytes(&values, length: MemoryLayout<SeaWaterUniforms>.stride, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        if awaitingPresent {
            Self.watch(drawable) { [weak self] in
                Task { @MainActor in
                    guard let self, self.awaitingPresent else { return }
                    self.awaitingPresent = false
                    self.onFirstPresent?()
                }
            }
        }
        buffer.present(drawable)
        buffer.commit()
    }

    nonisolated private static func watch(_ drawable: any MTLDrawable, presented: @escaping @Sendable () -> Void) {
        drawable.addPresentedHandler { shown in
            if shown.presentedTime > 0 { presented() }
        }
    }

    nonisolated private static func compile(device: any MTLDevice,
                                            done: @escaping @Sendable ((any MTLRenderPipelineState)?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let library = try device.makeLibrary(source: SeaWaterRenderer.shaderSource, options: nil)
                let descriptor = MTLRenderPipelineDescriptor()
                descriptor.vertexFunction = library.makeFunction(name: "seaWaterVertex")
                descriptor.fragmentFunction = library.makeFunction(name: "seaWaterFragment")
                descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
                done(try device.makeRenderPipelineState(descriptor: descriptor))
            } catch {
                done(nil)
            }
        }
    }

    /// Compiled at runtime so the build needs no Metal toolchain. Coordinates follow
    /// the WebGL prototype: x right, y up, horizon at 45% from the frame bottom.
    nonisolated static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct SeaWaterUniforms {
        float4 frame;
        float4 sun;
        float4 light;
        float4 sea;
        float4 zenith;
        float4 middle;
        float4 horizon;
        float4 glow;
        float4 water;
    };

    struct SeaWaterVertexOut { float4 position [[position]]; };

    constant float HZ = 0.45;
    constant float FOV = 1.25;
    constant float CAMH = 2.0;

    vertex SeaWaterVertexOut seaWaterVertex(uint vid [[vertex_id]]) {
        float2 p = float2(float((vid << 1) & 2u), float(vid & 2u));
        SeaWaterVertexOut o;
        o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
        return o;
    }

    static float ss(float a, float b, float x) {
        float t = clamp((x - a) / (b - a), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }
    static float hash21(float2 p) {
        p = fract(p * float2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }
    static float vnoise(float2 p) {
        float2 i = floor(p);
        float2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + float2(1.0, 0.0)), f.x),
                   mix(hash21(i + float2(0.0, 1.0)), hash21(i + float2(1.0, 1.0)), f.x), f.y) * 2.0 - 1.0;
    }
    static float2 scr(float3 d) { return d.xy / max(d.z, 1e-3) * FOV; }

    static float3 sunDisk(float2 q, float red) {
        float y = clamp(0.5 - 0.5 * q.y, 0.0, 1.0);
        float3 a = mix(float3(1.0, 0.965, 0.871), float3(1.0, 0.835, 0.557), ss(0.0, 0.3, y));
        a = mix(a, float3(1.0, 0.639, 0.369), ss(0.3, 0.66, y));
        a = mix(a, float3(0.949, 0.408, 0.353), ss(0.66, 1.0, y));
        float3 r = mix(float3(1.0, 0.66, 0.36), float3(0.9, 0.26, 0.2), ss(0.1, 0.9, y));
        r = mix(r, float3(0.6, 0.12, 0.22), ss(0.7, 1.0, y));
        float3 c = mix(a, r, red);
        float l = length(q);
        float core = (1.0 - ss(0.2, 0.95, l)) * (1.0 - 0.8 * red);
        c = mix(c, float3(1.0, 0.975, 0.92), core * 0.42);
        c *= mix(0.82, 1.0, sqrt(max(1.0 - l * l, 0.0)));
        return c * mix(1.55, 1.0, red);
    }

    static float3 sky(float3 d, float refl, constant SeaWaterUniforms& u, float aspect, float time) {
        float e = max(d.y, 0.0);
        float3 c = mix(u.horizon.rgb, u.middle.rgb, ss(0.0, 0.11, e));
        c = mix(c, u.zenith.rgb, ss(0.1, 0.5, e));
        float2 sp = scr(d);
        float2 sun = float2((u.sun.x - 0.5) * aspect, u.sun.y);
        float radius = max(u.sun.z, 1e-3);
        float2 q = (sp - sun) / radius;
        float r = length(q);
        float glow = u.light.x;
        float red = u.light.y;
        float wide = exp(-r * r / 9.0);
        float tight = exp(-max(r - 1.0, 0.0) * 2.2);
        float dx = (sp.x - sun.x) / 1.1;
        float hband = exp(-e * 22.0) * exp(-dx * dx);
        c += u.glow.rgb * glow * (0.26 * wide + 0.26 * tight * (1.0 - red * 0.5) + 0.22 * hband);
        c = mix(c, u.horizon.rgb * 1.02 + u.glow.rgb * 0.08 * glow, exp(-e * 70.0) * 0.38 * u.sea.z);
        float aa = refl > 0.0 ? 0.06 : 2.5 / (u.frame.y * radius);
        float disk = 1.0 - ss(1.0 - aa, 1.0, r);
        if (refl < 0.5) disk *= step(0.0, d.y);
        if (refl > 1.5) disk = 0.0;
        c = mix(c, sunDisk(q, red) * mix(1.0, 1.18, red * step(u.sun.y, 0.0)), disk * clamp(glow * 1.6 + 0.25, 0.0, 1.0));
        float stars = u.light.z;
        if (stars > 0.0) {
            float2 g = sp * 70.0;
            float2 id = floor(g);
            float h = hash21(id);
            float2 f = fract(g) - 0.5 - (float2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.6;
            float s = step(0.975, h) * ss(0.09, 0.0, length(f));
            float tw = 0.6 + 0.4 * sin(time * (1.0 + h * 3.0) + h * 40.0);
            c += float3(0.85, 0.88, 1.0) * s * tw * stars * ss(0.0, 0.08, e) * (refl > 0.5 ? 0.25 : 1.0);
        }
        float moon = u.light.w;
        if (moon > 0.0) {
            float2 mc = float2((0.8108696 - 0.5) * aspect, u.sea.w);
            float2 m = (sp - mc) / max(u.sun.w, 1e-3);
            float md = length(m);
            float body = 1.0 - ss(0.92, 1.0, md);
            float bite = 1.0 - ss(0.92, 1.0, length(m - float2(-0.38, 0.26)));
            c += float3(0.96, 0.95, 0.9) * body * (1.0 - bite) * moon * 1.2;
            c += float3(0.55, 0.62, 0.9) * exp(-md * md / 40.0) * 0.10 * moon;
        }
        return c;
    }

    static float2 waves(float2 p, float t, float foot, float rough) {
        float2 g = float2(0.0);
        float amp = 0.055;
        float len = 15.0;
        for (int i = 0; i < 9; i++) {
            float fi = float(i);
            float ang = -0.35 + fi * 2.39 + sin(fi * 3.7) * 0.6;
            float2 D = normalize(float2(cos(ang), sin(ang) * 0.55 + 0.6));
            float k = 6.2832 / len;
            float w = sqrt(9.81 * k);
            float att = ss(len * 0.6, len * 0.18, foot);
            float s = amp * (fi < 4.0 ? 1.0 : mix(0.6, 1.6, rough));
            g += D * s * cos(dot(D, p) * k - w * t * 0.8 + fi * 1.7) * att;
            len *= 0.62;
            amp *= 0.82;
        }
        return g;
    }

    fragment float4 seaWaterFragment(SeaWaterVertexOut v [[stage_in]], constant SeaWaterUniforms& u [[buffer(0)]]) {
        float2 res = u.frame.xy;
        float aspect = res.x / res.y;
        float time = u.frame.w;
        // The drawable is the water band only: its top row is the sea line.
        float2 uv = float2(v.position.x / res.x, HZ * (1.0 - v.position.y / u.frame.z));
        float3 d = normalize(float3((uv - float2(0.5, HZ)) * float2(aspect, 1.0), FOV));
        float3 col;
        if (d.y >= 0.0) {
            col = sky(d, 0.0, u, aspect, time);
        } else {
            float t = CAMH / -d.y;
            float2 p = d.xz * t;
            float pix = 1.0 / (res.y * FOV);
            float foot = t * pix / max(-d.y, 0.002);
            float rough = u.sea.x;
            float spark = u.sea.y;
            float2 g = waves(p, time, foot, rough);
            // Fine ripples carry the traffic sparkle.
            float2 rp = p * float2(1.0, 1.6);
            float fa = ss(0.5, 0.08, foot) * (0.012 + 0.05 * rough);
            g += fa * float2(sin(rp.x * 9.1 + time * 3.1 + sin(rp.y * 4.3)), sin(rp.y * 11.3 - time * 2.6 + sin(rp.x * 3.7)));
            float na = ss(2.0, 0.3, foot) * 0.035;
            g += na * float2(vnoise(p * 0.7 + time * 0.15) - vnoise(p * 0.7 + float2(3.1, 0.0) + time * 0.15),
                             vnoise(p * 0.7 + float2(0.0, 5.2) - time * 0.12) - vnoise(p * 0.7 + float2(1.7, 2.9) - time * 0.12));
            float3 n = normalize(float3(-g.x, 1.0, -g.y));
            float3 r = reflect(d, n);
            r.y = abs(r.y) + 0.002;
            float cosT = clamp(dot(n, -d), 0.0, 1.0);
            float k = 1.0 - cosT;
            float F = 0.02 + 0.98 * k * k * k * k * k;
            float3 refl = sky(r, 1.0, u, aspect, time);
            // Glints: sharp sun hits on wave facets, modestly brighter with traffic.
            float2 sun = float2((u.sun.x - 0.5) * aspect, u.sun.y);
            float2 rq = (scr(r) - sun) / max(u.sun.z, 1e-3);
            float rr = dot(rq, rq) * step(0.0, r.z);
            float path = exp(-rr * 0.8);
            float sparkle = exp(-rr * 7.0);
            float glow = u.light.x;
            float red = u.light.y;
            float3 deep = u.water.rgb + u.glow.rgb * 0.03 * glow;
            col = mix(deep, refl, F);
            col += u.glow.rgb * glow * (1.0 - red * 0.6) * F * (1.2 * path + (1.5 + 6.0 * spark) * sparkle);
            // Distance haze toward the horizon.
            float fog = 1.0 - exp(-t / 420.0);
            col = mix(col, sky(float3(d.x, 0.0005, d.z), 2.0, u, aspect, time) * 0.9, fog * 0.7);
        }
        // Highlights roll to white instead of clipping.
        float m = max(col.r, max(col.g, col.b));
        if (m > 1.0) col = mix(col / m, float3(1.0), clamp((m - 1.0) * 0.5, 0.0, 1.0));
        col += (hash21(v.position.xy + fract(time)) - 0.5) / 255.0;
        return float4(saturate(col), 1.0);
    }
    """
}

extension AppState {
    /// The water's traffic reading: nil unless connected with a live rate feed.
    var seaTrafficSample: SeaTrafficSample? {
        isConnected && trafficFeedLive
            ? SeaTrafficSample(up: trafficStats.uploadSpeed, down: trafficStats.downloadSpeed) : nil
    }
}

