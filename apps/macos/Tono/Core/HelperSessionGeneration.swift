import Foundation

/// The session a privileged helper request belongs to (PROPOSAL §10 v5).
///
/// One box per session. Connect, reconnect and teardown tasks capture the box
/// that is current when they are created, and the helper client sends its
/// generation with every request that changes the network. A preemptive
/// Restore internet replaces the box, so work an earlier session issues late
/// carries the earlier generation and the helper refuses it instead of
/// touching the newer session.
nonisolated final class HelperSessionGeneration: @unchecked Sendable {
    @TaskLocal static var current: HelperSessionGeneration?

    private let lock = NSLock()
    private var stored: UInt64?
    private var predatesAdmission = false
    private var retired = false

    init() {}

    /// The generation the helper admitted this session with, if any.
    var value: UInt64? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    /// A helper older than 4.52.50 has no admission; the session then sends
    /// no generation and behaves exactly as before.
    var helperPredatesAdmission: Bool {
        lock.lock()
        defer { lock.unlock() }
        return predatesAdmission
    }

    func adopt(_ generation: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        stored = generation
    }

    /// Set when a preemptive Restore replaced this session. A retired
    /// session that was never admitted must not admit itself late: its
    /// requests are refused before they reach the helper.
    var isRetired: Bool {
        lock.lock()
        defer { lock.unlock() }
        return retired
    }

    func retire() {
        lock.lock()
        defer { lock.unlock() }
        retired = true
    }

    func markHelperPredatesAdmission() {
        lock.lock()
        defer { lock.unlock() }
        predatesAdmission = true
    }
}
