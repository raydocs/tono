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

    public var encoded: Data {
        let json: JSON
        switch self {
        case .applied(let s): json = JSON.obj(("applied", s.json))
        case .refused(let code, let running): json = JSON.obj(("refused", .string(code)), ("running", running?.json ?? .null))
        }
        return Data(json.serialized().utf8)
    }

    public static func decode(_ data: Data?) -> ReloadReply? {
        guard let data, let json = try? JSON.parse(data) else { return nil }
        if let s = RouteSettings(json["applied"]) { return .applied(s) }
        if let code = json["refused"]?.string { return .refused(code: code, running: RouteSettings(json["running"])) }
        return nil
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
}

/// Changing the mode or line: save the inputs, ask a running tunnel to rebuild, and report only
/// what the tunnel confirmed. The screens show `inEffect`, never the request, as the routes in use.
public enum RouteApply {
    public static func run(_ requested: RouteSettings, previous: RouteSettings, tunnelUp: Bool,
                           save: (RouteSettings) throws -> Void,
                           reload: () async -> Data?) async -> RouteApplyOutcome {
        do {
            try save(requested)
        } catch {
            // The inputs file is written atomically: it still holds the previous choice.
            return .notApplied(code: "SAVE_FAILED", inEffect: previous)
        }
        guard tunnelUp else { return .saved(requested) }
        switch ReloadReply.decode(await reload()) {
        case .applied(let running) where running == requested:
            return .applied(requested)
        case .applied(let running):
            // The extension read other inputs than these (a concurrent write): keep the file and the
            // screens on what actually runs.
            try? save(running)
            return .notApplied(code: "NOT_APPLIED", inEffect: running)
        case .refused(let code, let running):
            // A later On Demand restart reads the file: keep it on the graph that runs.
            try? save(running ?? previous)
            return .notApplied(code: code, inEffect: running)
        case nil:
            // No answer from the tunnel: the switch is unconfirmed, so nothing claims it.
            try? save(previous)
            return .notApplied(code: "NO_REPLY", inEffect: previous)
        }
    }
}
