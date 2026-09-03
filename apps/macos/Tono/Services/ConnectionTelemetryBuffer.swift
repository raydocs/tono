import Foundation

/// In-memory ring of redacted connection events for periodic telemetry.
/// Never stores tokens, emails, browsed hosts, raw IPs, configs, or payload.
nonisolated final class ConnectionTelemetryBuffer: @unchecked Sendable {
    static let shared = ConnectionTelemetryBuffer()
    static let capacity = 128

    private let lock = NSLock()
    private var events: [TonoTelemetryEvent] = []
    private var dropped = 0

    func record(
        _ kind: String,
        stage: String? = nil,
        elapsedMs: Int? = nil,
        probe: String? = nil,
        reason: String? = nil,
        error: String? = nil,
        node: String? = nil,
        action: String? = nil,
        mode: String? = nil,
        counter: Int? = nil,
        revision: Int? = nil,
        generation: Int? = nil,
        outcome: String? = nil,
        code: String? = nil,
        updateResume: Bool? = nil
    ) {
        let event = TonoTelemetryEvent(
            ts: Int64(Date().timeIntervalSince1970 * 1_000),
            kind: String(kind.prefix(40)),
            stage: stage.map { String($0.prefix(40)) },
            error: error.map { String($0.prefix(200)) },
            node: node.map { String($0.prefix(64)) },
            action: action.map { String($0.prefix(40)) },
            reason: reason.map { String($0.prefix(80)) },
            probe: probe.map { String($0.prefix(40)) },
            mode: mode.map { String($0.prefix(40)) },
            elapsedMs: elapsedMs.map { Int64($0) },
            counter: counter.map { Int64($0) },
            revision: revision.map { Int64($0) },
            generation: generation.map { Int64($0) },
            outcome: outcome.map { String($0.prefix(40)) },
            code: code.map { String($0.prefix(64)) },
            updateResume: updateResume
        )
        lock.lock()
        events.append(event)
        if events.count > Self.capacity {
            let overflow = events.count - Self.capacity
            events.removeFirst(overflow)
            dropped += overflow
        }
        lock.unlock()
    }

    /// One classified connect or health failure, in the shape the uploader
    /// already receives from the Windows client: kind `connectFail` carrying
    /// the stage the attempt stopped at, the taxonomy code, and how long it
    /// took. The code is what makes a failing machine classifiable at all, so
    /// it travels with the event rather than being reconstructed from prose.
    func recordConnectFailure(
        stage: String,
        code: ProtectedFailureCode,
        elapsedMs: Int? = nil,
        node: String? = nil,
        generation: Int? = nil
    ) {
        record(
            "connectFail",
            stage: stage,
            elapsedMs: elapsedMs,
            node: node,
            generation: generation,
            code: code.rawValue
        )
    }

    func drain() -> (events: [TonoTelemetryEvent], dropped: Int) {
        lock.lock()
        let snapshot = events
        let snapshotDropped = dropped
        events.removeAll(keepingCapacity: true)
        dropped = 0
        lock.unlock()
        return (snapshot, snapshotDropped)
    }
}
