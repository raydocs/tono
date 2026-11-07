import Foundation

/// One throughput sample from the tunnel (bytes per second), the reply to `TunnelMessage.traffic`.
/// It describes statistics only; it never certifies that the tunnel protects anything.
public struct TrafficSample: Equatable, Sendable {
    public var down: Int64
    public var up: Int64

    public init(down: Int64, up: Int64) {
        self.down = down
        self.up = up
    }

    public var encoded: Data {
        Data(JSON.obj(("down", .int(Int(down))), ("up", .int(Int(up)))).serialized().utf8)
    }

    /// Nil for anything but a well-formed sample: an older extension's "unknown message", an
    /// "unavailable" reply, a negative or fractional count. The app treats nil as a lost stream.
    public static func decode(_ data: Data?) -> TrafficSample? {
        guard let data, let json = try? JSON.parse(data),
              let down = json["down"]?.int, let up = json["up"]?.int, down >= 0, up >= 0 else { return nil }
        return TrafficSample(down: Int64(down), up: Int64(up))
    }

    /// What the extension answers while it has no statistics client to read from.
    public static let unavailable = Data(JSON.obj(("unavailable", .bool(true))).serialized().utf8)
}

/// Extension side: its statistics client runs only while the app keeps asking. Uptime seconds
/// (a monotonic clock), so a wall-clock change neither keeps a client alive nor ends one early.
public struct TrafficDemand: Equatable, Sendable {
    /// Five missed one-second asks: the app is gone (background, closed, suspended).
    public static let idle: TimeInterval = 5
    private var lastAsked: TimeInterval?

    public init() {}

    public mutating func asked(at uptime: TimeInterval) { lastAsked = uptime }

    public func expired(at uptime: TimeInterval) -> Bool {
        guard let lastAsked else { return true }
        return uptime - lastAsked >= Self.idle
    }
}
