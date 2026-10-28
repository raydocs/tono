/// How much of the sea scene moves. The same rule on iOS and Android; macOS Lite is the precedent
/// (owner-approved 2026-10-28): Low Power stops the decorative loops and keeps what tells the user
/// something about the connection. Reduce Motion always wins and leaves everything static.
public enum SeaMotion: Equatable, Sendable {
    case full, lite, still

    public init(reduceMotion: Bool, lowPower: Bool) {
        self = reduceMotion ? .still : lowPower ? .lite : .full
    }

    /// Star twinkle, drift, the breathing glow and the drifting glints.
    public var ambient: Bool { self == .full }
    /// The reconnect scan and the sky's short transitions between states.
    public var status: Bool { self != .still }
}
