import Foundation

/// Backoff for probes that must not install PF or a tunnel.
enum UnarmedReconnect {
    static let delays: [TimeInterval] = [2, 5, 15, 30, 60, 120]

    static func delaySeconds(attempt: Int) -> TimeInterval {
        delays[min(max(attempt, 0), delays.count - 1)]
    }

    /// Connect only after a TCP proof, and only while protection is down.
    static func shouldConnect(tcpReachable: Bool, protectionArmed: Bool) -> Bool {
        tcpReachable && !protectionArmed
    }
}
