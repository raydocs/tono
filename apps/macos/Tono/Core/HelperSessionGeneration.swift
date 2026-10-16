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
    /// Serialises admission, so two first requests of one session cannot
    /// both swap the helper's generation.
    private let admission = NSLock()
    private var stored: UInt64?
    private var predatesAdmission = false
    private var retired = false
    /// Created by the user's own Connect. Only such a session may admit a
    /// machine that Restore internet released; an automatic connect (wake,
    /// protected reconnect, launch) never reopens it (R-F3).
    let userInitiated: Bool

    init(userInitiated: Bool = false) {
        self.userInitiated = userInitiated
    }

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

    /// Atomic with `retire`: a box retired before this call keeps no
    /// generation, so an admission that finished after a Restore belongs to
    /// no live session (R-F3).
    @discardableResult
    func adopt(_ generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !retired else { return false }
        stored = generation
        return true
    }

    /// Runs `admit` at most once at a time for this box and adopts what it
    /// returns; nil from `admit` means the helper predates admission. False
    /// when the box is retired, before or during the admission.
    func admitIfNeeded(_ admit: () throws -> UInt64?) rethrows -> Bool {
        admission.lock()
        defer { admission.unlock() }
        if value != nil || helperPredatesAdmission { return true }
        if isRetired { return false }
        guard let generation = try admit() else {
            markHelperPredatesAdmission()
            return true
        }
        return adopt(generation)
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
