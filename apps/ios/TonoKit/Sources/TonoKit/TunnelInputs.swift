import Foundation

/// What the app hands the packet tunnel: the last admitted catalog body plus the user's choices.
/// The app writes it to the App Group before starting or reloading; the extension re-admits the
/// body and builds the sing-box configuration itself, so an On Demand restart without the app,
/// or an IPv6 change on the underlying network, regenerates the same graph. No tokens inside.
public struct TunnelInputs: Equatable, Sendable {
    public static let version = 1

    public var catalogBody: String
    public var mode: RoutingMode
    public var selectedNode: String?
    public var logLevel: String

    public init(catalogBody: String, mode: RoutingMode, selectedNode: String?, logLevel: String = "warn") {
        self.catalogBody = catalogBody
        self.mode = mode
        self.selectedNode = selectedNode
        self.logLevel = logLevel
    }

    public func encoded() -> Data {
        var o = JSONObject()
        o["version"] = .int(Self.version)
        o["catalog"] = .string(catalogBody)
        o["mode"] = .string(mode.rawValue)
        o["selectedNode"] = selectedNode.map(JSON.string) ?? .null
        o["logLevel"] = .string(logLevel)
        return Data(JSON.object(o).serialized().utf8)
    }

    public static func decode(_ data: Data) throws -> TunnelInputs {
        let json = try JSON.parse(data)
        guard json["version"]?.int == version, let body = json["catalog"]?.string,
              let modeText = json["mode"]?.string, let mode = RoutingMode(rawValue: modeText),
              let level = json["logLevel"]?.string, ["trace", "debug", "info", "warn", "error"].contains(level) else {
            throw CatalogRejected("TUNNEL_INPUTS", "tunnel inputs are unreadable")
        }
        return TunnelInputs(catalogBody: body, mode: mode, selectedNode: json["selectedNode"]?.string, logLevel: level)
    }

    /// The identity of the catalog these inputs build from: SHA-256 (base64url) of the exact body,
    /// so any change of nodes, Home or rules changes it. With the mode and line beside it
    /// (`TunnelAnswer.routing`) it names the inputs a graph was built from. A digest only: the body
    /// (node credentials) never leaves the App Group file.
    public var catalogDigest: String { Self.catalogDigest(catalogBody) }

    public static func catalogDigest(_ body: String) -> String { SHA256.base64URL(body) }

    /// Admits the stored body again (the extension trusts nothing it did not check) and builds the config.
    public func makeConfig(underlyingIPv6: Bool, cacheFilePath: String?) throws -> String {
        let catalog = try CatalogAdmission.admit(JSON.parse(catalogBody))
        return SingBoxConfig.buildJSON(ConfigInput(catalog: catalog, selectedCloudNode: selectedNode, mode: mode,
                                                   underlyingIPv6: underlyingIPv6, cacheFilePath: cacheFilePath, logLevel: logLevel))
    }
}

/// App → extension messages (`NETunnelProviderSession.sendProviderMessage`) and their replies.
public enum TunnelMessage: Equatable, Sendable {
    /// Inputs changed on disk; rebuild and reload sing-box in place.
    case reload
    /// TCP connect time from the extension (outside the tunnel) to each cloud node.
    case measure
    /// Core version, start time and the underlying network the extension sees.
    case status
    /// The tunnel's latest throughput sample ([TrafficSample]). Read-only; the app asks once a second
    /// while it is on screen, and the extension keeps its statistics client only while asked.
    case traffic

    public var encoded: Data {
        let op: String
        switch self {
        case .reload: op = "reload"
        case .measure: op = "measure"
        case .status: op = "status"
        case .traffic: op = "traffic"
        }
        return Data(JSON.obj(("op", .string(op))).serialized().utf8)
    }

    /// How long the app waits for the reply before it counts as no answer. A rebuild starts
    /// sing-box again; a measure dials every node (3 s each, in parallel).
    public var replyTimeout: TimeInterval {
        switch self {
        case .status: return 5
        case .traffic: return 2
        case .measure: return 10
        case .reload: return 20
        }
    }

    public static func decode(_ data: Data) -> TunnelMessage? {
        switch (try? JSON.parse(data))?["op"]?.string {
        case "reload": return .reload
        case "measure": return .measure
        case "status": return .status
        case "traffic": return .traffic
        default: return nil
        }
    }
}

/// The extension's stop/start failure, written to the App Group for the app to explain.
public struct TunnelFailure: Equatable, Sendable {
    public var code: String
    public var message: String
    public var at: Date
    /// Optional for old extension reports; account-origin releases identify their sign-in epoch.
    public var source: String?
    public var accountEpoch: UInt64?

    public init(code: String, message: String, at: Date, source: String? = nil, accountEpoch: UInt64? = nil) {
        self.code = code
        self.message = message
        self.at = at
        self.source = source
        self.accountEpoch = accountEpoch
    }

    public func encoded() -> Data {
        Data(JSON.obj(("code", .string(code)), ("message", .string(message)), ("at", .number(at.timeIntervalSince1970)),
                      ("source", source.map(JSON.string) ?? .null),
                      ("accountEpoch", accountEpoch.map { .string(String($0)) } ?? .null)).serialized().utf8)
    }

    public static func decode(_ data: Data) -> TunnelFailure? {
        guard let j = try? JSON.parse(data), let code = j["code"]?.string, let message = j["message"]?.string,
              case .number(let at)? = j["at"] else { return nil }
        return TunnelFailure(code: code, message: message, at: Date(timeIntervalSince1970: at),
                             source: j["source"]?.string, accountEpoch: j["accountEpoch"]?.string.flatMap(UInt64.init))
    }
}
