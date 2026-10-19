import Foundation

/// One reply to one app → tunnel message, bounded in time. Network Extension may never call the
/// response handler (the tunnel hung, was killed mid-message or the session went away), so the
/// app's question ends at `timeout` with no answer, which the tracker reads as "not confirmed".
/// Whichever comes first, the reply or the timer, is delivered, exactly once; the other is dropped.
public enum ProviderReply {
    /// Runs `work` after the delay (the app: a dispatch timer; tests: by hand).
    public typealias Schedule = (TimeInterval, @escaping @Sendable () -> Void) -> Void

    /// `send` hands the message to the tunnel with the handler it must call; a throw is no answer.
    public static func ask(timeout: TimeInterval, schedule: Schedule,
                           send: (@escaping @Sendable (Data?) -> Void) throws -> Void,
                           done: @escaping @Sendable (Data?) -> Void) {
        let gate = Gate(done)
        schedule(timeout) { gate.deliver(nil) }
        do {
            try send { gate.deliver($0) }
        } catch {
            gate.deliver(nil)
        }
    }

    public static func ask(timeout: TimeInterval, schedule: Schedule,
                           send: (@escaping @Sendable (Data?) -> Void) throws -> Void) async -> Data? {
        await withCheckedContinuation { continuation in
            ask(timeout: timeout, schedule: schedule, send: send, done: { continuation.resume(returning: $0) })
        }
    }

    /// Passes on the first value only, from whichever thread delivers it.
    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var done: (@Sendable (Data?) -> Void)?

        init(_ done: @escaping @Sendable (Data?) -> Void) { self.done = done }

        func deliver(_ value: Data?) {
            lock.lock()
            let pending = done
            done = nil
            lock.unlock()
            pending?(value)
        }
    }
}
