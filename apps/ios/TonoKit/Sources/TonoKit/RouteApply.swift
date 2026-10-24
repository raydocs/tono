import Foundation

/// The two routing choices the tunnel is built from: the mode and the cloud line.
public struct RouteSettings: Equatable, Sendable {
    public var mode: RoutingMode
    public var node: String?

    public init(mode: RoutingMode, node: String?) {
        self.mode = mode
        self.node = node
    }

    public var json: JSON { JSON.obj(("mode", .string(mode.rawValue)), ("node", node.map(JSON.string) ?? .null)) }

    public init?(_ json: JSON?) {
        guard let text = json?["mode"]?.string, let mode = RoutingMode(rawValue: text) else { return nil }
        self.init(mode: mode, node: json?["node"]?.string)
    }
}

extension TunnelInputs {
    public var settings: RouteSettings { RouteSettings(mode: mode, node: selectedNode) }
}

/// The extension's answer to `TunnelMessage.reload`. Success is explicit: no reply, or a reply this
/// does not understand, is never read as "applied".
public enum ReloadReply: Equatable, Sendable {
    /// The new graph is running.
    case applied(RouteSettings)
    /// The new graph was refused. `running` is the graph still (or again) in use; nil means none is.
    case refused(code: String, running: RouteSettings?)

    public var encoded: Data { Data(JSON.object(object).serialized().utf8) }

    /// The reply with the tunnel's stamp on what runs afterwards (`TunnelAnswer`).
    public func encoded(answer: TunnelAnswer) -> Data {
        var o = object
        o["tunnel"] = answer.json
        return Data(JSON.object(o).serialized().utf8)
    }

    private var object: JSONObject {
        switch self {
        case .applied(let s): return JSONObject([("applied", s.json)])
        case .refused(let code, let running): return JSONObject([("refused", .string(code)), ("running", running?.json ?? .null)])
        }
    }

    public static func decode(_ data: Data?) -> ReloadReply? {
        guard let data, let json = try? JSON.parse(data) else { return nil }
        if let s = RouteSettings(json["applied"]) { return .applied(s) }
        if let code = json["refused"]?.string { return .refused(code: code, running: RouteSettings(json["running"])) }
        return nil
    }
}

/// The `running` field of the extension's status reply.
public enum TunnelRunning: Equatable, Sendable {
    case graph(RouteSettings)
    /// The extension answered: no graph runs.
    case noGraph

    /// nil when there is no reply or it does not say.
    public static func decode(_ data: Data?) -> TunnelRunning? {
        guard let data, let json = try? JSON.parse(data), let running = json["running"] else { return nil }
        if let s = RouteSettings(running) { return .graph(s) }
        return running == .null ? .noGraph : nil
    }
}

public enum RouteApplyOutcome: Equatable, Sendable {
    /// The running tunnel confirmed the new graph.
    case applied(RouteSettings)
    /// The tunnel is off: saved, and the next start builds it.
    case saved(RouteSettings)
    /// Not in effect. `inEffect` is what the tunnel uses (or, when off, will use); nil when the
    /// running tunnel has no graph at all.
    case notApplied(code: String, inEffect: RouteSettings?)
    /// The tunnel answered neither the rebuild nor the question of what it runs: the request may or
    /// may not be in effect, so neither it nor the previous routes are claimed. The file keeps the
    /// request (it was not refused).
    case unconfirmed(RouteSettings)
}

public struct RouteApplyReport: Equatable, Sendable {
    public var outcome: RouteApplyOutcome
    /// Put-back of the inputs file that failed: what the file should hold and does not. The app
    /// retries it, and says so, instead of swallowing the error.
    public var unsaved: RouteSettings?
    /// Whether any write of the inputs file succeeded in this run.
    public var wrote: Bool
    /// The tunnel's stamped answer in the last reply it gave (rebuild, else status); nil when it
    /// gave none. The app's confirmation comes from this, not from `outcome`.
    public var answer: TunnelAnswer?

    public init(_ outcome: RouteApplyOutcome, unsaved: RouteSettings? = nil, wrote: Bool = true, answer: TunnelAnswer? = nil) {
        self.outcome = outcome
        self.unsaved = unsaved
        self.wrote = wrote
        self.answer = answer
    }

    /// What the inputs file still has to be put back to after this run, given what was owed before
    /// it. An earlier failed put-back stays owed until a write of the file succeeds: a run whose
    /// saves all failed left the file as it was, holding the refused routes.
    public func owed(before: RouteSettings?) -> RouteSettings? { wrote ? unsaved : unsaved ?? before }
}

/// Changing the mode or line: save the inputs, ask a running tunnel to rebuild, and report only
/// what the tunnel confirmed. The screens show `inEffect`, never the request, as the routes in use.
public enum RouteApply {
    /// A change with no catalog to build from. Tunnel off: the choice is kept for the first start.
    /// Tunnel up: nothing can be rebuilt, so the request is not applied (and not written) and what
    /// runs stays in effect; the app says so instead of taking the request as in use.
    public static func withoutCatalog(_ requested: RouteSettings, previous: RouteSettings, tunnelUp: Bool) -> RouteApplyReport {
        guard tunnelUp else { return RouteApplyReport(.saved(requested)) }
        return RouteApplyReport(.notApplied(code: "NO_CATALOG", inEffect: previous), wrote: false)
    }

    public static func run(_ requested: RouteSettings, previous: RouteSettings, tunnelUp: Bool,
                           save: (RouteSettings) throws -> Void,
                           reload: () async -> Data?,
                           status: () async -> Data?,
                           acceptReply: (TunnelAnswer?) -> Bool = { _ in true }) async -> RouteApplyReport {
        do {
            try save(requested)
        } catch {
            // The inputs file is written atomically: it still holds the previous choice.
            return RouteApplyReport(.notApplied(code: "SAVE_FAILED", inEffect: previous), wrote: false)
        }
        guard tunnelUp else { return RouteApplyReport(.saved(requested)) }
        var unsaved: RouteSettings?
        // A later On Demand restart reads the file: keep it on the graph that runs.
        func putBack(_ s: RouteSettings) {
            do { try save(s) } catch { unsaved = s }
        }
        let outcome: RouteApplyOutcome
        let reply = await reload()
        var answer = TunnelAnswer.decode(reply)
        guard acceptReply(answer) else { return RouteApplyReport(.unconfirmed(requested), answer: answer) }
        switch ReloadReply.decode(reply) {
        case .applied(let running) where running == requested:
            outcome = .applied(requested)
        case .applied(let running):
            // The extension read other inputs than these (a concurrent write).
            putBack(running)
            outcome = .notApplied(code: "NOT_APPLIED", inEffect: running)
        case .refused(let code, let running):
            putBack(running ?? previous)
            outcome = .notApplied(code: code, inEffect: running)
        case nil:
            // No answer is not a refusal: the rebuild may have run. Ask what runs instead of assuming.
            let said = await status()
            answer = TunnelAnswer.decode(said)
            guard acceptReply(answer) else { return RouteApplyReport(.unconfirmed(requested), answer: answer) }
            switch TunnelRunning.decode(said) {
            case .graph(let running) where running == requested:
                outcome = .applied(requested)
            case .graph(let running):
                putBack(running)
                outcome = .notApplied(code: "NO_REPLY", inEffect: running)
            case .noGraph:
                putBack(previous)
                outcome = .notApplied(code: "NO_REPLY", inEffect: nil)
            case nil:
                outcome = .unconfirmed(requested)
            }
        }
        return RouteApplyReport(outcome, unsaved: unsaved, answer: answer)
    }
}
