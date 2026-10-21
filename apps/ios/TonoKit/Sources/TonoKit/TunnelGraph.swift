import Foundation

/// The packet tunnel's record of the sing-box graph: which inputs it was built from and whether it
/// runs. The extension holds one under its service lock and passes libbox in as `start`; keeping the
/// bookkeeping here lets the refused-rebuild path, and what the heartbeat then tells widgets, run in
/// tests without libbox.
public struct TunnelGraph: Sendable {
    /// One packet-tunnel start; a new graph record is made for each.
    public let session: String
    public let opened: Date
    /// Bumped by every start attempt and close: an answer names the graph it is about.
    public private(set) var generation = 0
    /// The inputs of the last graph that started. Kept after a refusal closed it.
    public private(set) var inputs: TunnelInputs?
    /// `inputs.catalogDigest`, taken when that graph started: the catalog identity every answer and
    /// report of it carries. Kept with `inputs` after a refusal closed it.
    public private(set) var catalogDigest: String?
    public private(set) var running = false

    public init(session: String = UUID().uuidString, opened: Date = Date()) {
        self.session = session
        self.opened = opened
    }

    /// What runs now; nil when no graph does.
    public var runningSettings: RouteSettings? { running ? inputs?.settings : nil }

    /// The catalog of what runs now; nil when no graph does.
    public var runningCatalog: String? { running ? catalogDigest : nil }

    /// Builds the config, then starts it. A build failure leaves the running graph as it was;
    /// libbox's StartOrReloadService closes the running graph before it starts the next, so a start
    /// failure leaves none.
    public mutating func run(_ next: TunnelInputs, build: (TunnelInputs) throws -> String,
                             start: (String) throws -> Void) throws {
        let config = try build(next)
        // An IPv6 or core reload rebuilds the same body: no need to hash it again.
        let digest = next.catalogBody == inputs?.catalogBody ? catalogDigest ?? next.catalogDigest : next.catalogDigest
        running = false
        generation += 1
        try start(config)
        inputs = next
        catalogDigest = digest
        running = true
    }

    /// The service was closed (tunnel stop).
    public mutating func closed() {
        running = false
        generation += 1
    }

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

    /// What the tunnel tells the app it runs (status and rebuild replies). After sing-box stopped
    /// its own service (`coreStopped`, the code) no graph runs, whatever the bookkeeping still holds.
    public func answer(since: Date?, now: Date, coreStopped: String? = nil) -> TunnelAnswer {
        let live = coreStopped == nil
        return TunnelAnswer(session: session, generation: generation, routing: live ? runningSettings : nil, since: since, at: now,
                            catalog: live ? runningCatalog : nil)
    }

    /// The tunnel's record in the shared status. `process` is whether the tunnel itself is up; a
    /// live process without a graph is reported as such and reads as Routes stopped, never on. Once
    /// sing-box stopped its service (`coreStopped`) the record says the tunnel stopped with that
    /// code, from the stop until the process ends, so no beat in between says it runs.
    public func report(process running: Bool, since: Date?, failure: String?, now: Date, coreStopped: String? = nil) -> TunnelReport {
        let up = running && coreStopped == nil
        return TunnelReport(session: session, opened: opened, generation: generation, running: up,
                            routing: up ? runningSettings : nil, since: since, failure: up ? nil : coreStopped ?? failure, beatAt: now,
                            catalog: up ? runningCatalog : nil)
    }
}
