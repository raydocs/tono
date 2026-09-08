import Foundation

/// Weak-network reconnect cadence. Values are part of the fail-closed contract:
/// PF stays armed while this loop retries. Do not change them in a structural move.
enum ProtectedReconnectSchedule {
    static let delaysSeconds: [Int] = [2, 5, 10, 20, 30]
    static let networkChangeKickCooldown: TimeInterval = 30
}
