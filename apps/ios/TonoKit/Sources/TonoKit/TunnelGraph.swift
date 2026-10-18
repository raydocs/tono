import Foundation

/// The packet tunnel's record of the sing-box graph: which inputs it was built from and whether it
/// runs. The extension holds one under its service lock and passes libbox in as `start`; keeping the
/// bookkeeping here lets the refused-rebuild path, and what the heartbeat then tells widgets, run in
/// tests without libbox.
public struct TunnelGraph: Sendable {
    /// The inputs of the last graph that started. Kept after a refusal closed it.
    public private(set) var inputs: TunnelInputs?
    public private(set) var running = false

    public init() {}

    /// What runs now; nil when no graph does.
    public var runningSettings: RouteSettings? { running ? inputs?.settings : nil }

    /// Builds the config, then starts it. A build failure leaves the running graph as it was;
    /// libbox's StartOrReloadService closes the running graph before it starts the next, so a start
    /// failure leaves none.
    public mutating func run(_ next: TunnelInputs, build: (TunnelInputs) throws -> String,
                             start: (String) throws -> Void) throws {
        let config = try build(next)
        running = false
        try start(config)
        inputs = next
        running = true
    }

    /// The service was closed (tunnel stop).
    public mutating func closed() { running = false }

    /// The app asked for a rebuild from the inputs file. On a refusal the previous graph is brought
    /// back if libbox closed it, and the file is put back to the last inputs that ran, so an On
    /// Demand restart never builds the refused one. The reply says what runs afterwards.
    public mutating func reload(load: () throws -> TunnelInputs, build: (TunnelInputs) throws -> String,
                                start: (String) throws -> Void, persist: (TunnelInputs) -> Void) -> ReloadReply {
        let code: String
        do {
            let next = try load()
            do {
                try run(next, build: build, start: start)
                return .applied(next.settings)
            } catch {
                code = (error as? CatalogRejected)?.code ?? "CORE_START"
            }
        } catch {
            code = "NO_INPUTS"
        }
        if !running, let last = inputs {
            // Nothing runs after this fails too; the tunnel stays up and the app offers Retry.
            try? run(last, build: build, start: start)
        }
        if let last = inputs { persist(last) }
        return .refused(code: code, running: runningSettings)
    }

    /// The heartbeat's write: a live process without a graph is reported failed, never on.
    public func heartbeat(since: Date?, previous: StatusSnapshot?, now: Date) -> StatusSnapshot {
        StatusSnapshot.fromTunnel(running: true, routing: running, since: since, failure: nil, previous: previous, now: now)
    }
}
