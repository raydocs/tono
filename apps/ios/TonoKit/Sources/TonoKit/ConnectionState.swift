import Foundation

/// Connection lifecycle as the user sees it; the same nine phases as the Android client.
public enum Phase: String, Sendable, CaseIterable {
    /// No account on this phone.
    case signedOut = "SIGNED_OUT"
    /// Signed in, tunnel off.
    case idle = "IDLE"
    /// The VPN configuration is missing or was declined; only the app can ask for it.
    case needsPermission = "NEEDS_PERMISSION"
    /// Refreshing the session and fetching the exit catalog.
    case preparing = "PREPARING"
    /// sing-box starting, the tunnel coming up, or the first exit checks running.
    case connecting = "CONNECTING"
    /// Tunnel up and the exit checks answered.
    case connected = "CONNECTED"
    /// Tunnel up; one exit check failed. Matched traffic fails closed, ordinary traffic still works.
    case degraded = "DEGRADED"
    case disconnecting = "DISCONNECTING"
    /// Could not connect, or the tunnel stopped on its own.
    case failed = "FAILED"

    public var tunnelUp: Bool { self == .connected || self == .degraded }
    /// The switch reads "on" in these phases.
    public var switchOn: Bool { [.preparing, .connecting, .connected, .degraded].contains(self) }
    public var busy: Bool { [.preparing, .connecting, .disconnecting].contains(self) }
}

/// Which sky the sea scene paints (desktop SeaScene destinations, Android `SkyState`).
public enum SkyState: Sendable {
    case night, dawn, day, duskWarning, ember

    public init(_ phase: Phase) {
        switch phase {
        case .preparing, .connecting, .disconnecting: self = .dawn
        case .connected: self = .day
        case .degraded: self = .duskWarning
        case .failed: self = .ember
        case .signedOut, .idle, .needsPermission: self = .night
        }
    }

    /// Sun height: 0 below the horizon (night) … 1 high (connected).
    public var sunRise: Double {
        switch self {
        case .night: return 0
        case .dawn: return 0.5
        case .day: return 1
        case .duskWarning: return 0.72
        case .ember: return 0.28
        }
    }

    public var warning: Bool { self == .duskWarning || self == .ember }
}

public enum ProbeState: String, Sendable { case unknown, checking, ok, failed }

public struct ExitProbe: Equatable, Sendable {
    public var state: ProbeState
    public var location: String?
    public var latencyMS: Int?
    public init(state: ProbeState = .unknown, location: String? = nil, latencyMS: Int? = nil) {
        self.state = state
        self.location = location
        self.latencyMS = latencyMS
    }
}

/// Exit checks through the live tunnel. They run in the app process, whose traffic the tunnel
/// carries (the extension's own sockets bypass it):
///  - www.cloudflare.com is on the explicit cloud list → proves the cloud exit;
///  - claude.ai is a Home suffix → proves cloud → Home (or cloud alone when no Home is assigned).
public enum Probes {
    public static let cloudURL = URL(string: "https://www.cloudflare.com/cdn-cgi/trace")!
    public static let homeURL = URL(string: "https://claude.ai/cdn-cgi/trace")!

    /// Any HTTP answer proves the path; `loc=` (two capital letters) names the exit country when present.
    public static func location(fromTrace body: String) -> String? {
        for line in body.split(whereSeparator: \.isNewline) where line.hasPrefix("loc=") {
            let value = line.dropFirst(4)
            if value.count == 2, value.allSatisfy({ $0.isASCII && $0.isUppercase }) { return String(value) }
            return nil
        }
        return nil
    }

    /// Android `runProbes`: cloud first, then Home; either failure leaves the tunnel up but DEGRADED.
    public static func outcome(cloud: ExitProbe, home: ExitProbe) -> (Phase, String?) {
        if cloud.state != .ok { return (.degraded, "CLOUD_UNREACHABLE") }
        if home.state != .ok { return (.degraded, "HOME_UNREACHABLE") }
        return (.connected, nil)
    }
}

/// What the tunnel itself reports, independent of Network Extension types so it can be tested.
public enum TunnelStatus: Sendable {
    case invalid, disconnected, connecting, connected, reasserting, disconnecting
}

/// Inputs from which the app derives one `Phase` + reason.
public struct ConnectionFacts: Sendable {
    public var signedIn: Bool
    public var preparing: Bool
    public var tunnel: TunnelStatus
    /// The VPN configuration exists and is enabled for Tono.
    public var configured: Bool
    public var cloudProbe: ExitProbe
    public var homeProbe: ExitProbe
    /// Last failure the user has not dismissed (app-side catalog failure or extension stop reason).
    public var failure: String?
    /// The last explicit permission problem ("DENIED" or "REVOKED"); nil when there is none.
    public var permission: String?

    public init(signedIn: Bool, preparing: Bool = false, tunnel: TunnelStatus, configured: Bool = true,
                cloudProbe: ExitProbe = ExitProbe(), homeProbe: ExitProbe = ExitProbe(), failure: String? = nil, permission: String? = nil) {
        self.signedIn = signedIn
        self.preparing = preparing
        self.tunnel = tunnel
        self.configured = configured
        self.cloudProbe = cloudProbe
        self.homeProbe = homeProbe
        self.failure = failure
        self.permission = permission
    }
}

public enum ConnectionState {
    /// The single place iOS status, probes and failures become the phase the UI shows.
    public static func derive(_ f: ConnectionFacts) -> (phase: Phase, reason: String?) {
        switch f.tunnel {
        case .connecting, .reasserting:
            return (.connecting, nil)
        case .disconnecting:
            return (.disconnecting, nil)
        case .connected:
            if f.cloudProbe.state == .unknown || f.cloudProbe.state == .checking || f.homeProbe.state == .checking {
                return (.connecting, nil)
            }
            return Probes.outcome(cloud: f.cloudProbe, home: f.homeProbe)
        case .invalid, .disconnected:
            if !f.signedIn { return (.signedOut, f.failure == "SESSION_ENDED" ? f.failure : nil) }
            if f.preparing { return (.preparing, nil) }
            if let p = f.permission { return (.needsPermission, p) }
            if let failure = f.failure { return (.failed, failure) }
            return (.idle, nil)
        }
    }
}

/// The action a reason banner offers (Android `ReasonBanner`).
public enum BannerAction: Equatable, Sendable {
    case allow, otherLine, recheck, retry, none

    public static func forPhase(_ phase: Phase, reason: String?) -> BannerAction {
        if phase == .needsPermission { return .allow }
        if reason == "CLOUD_UNREACHABLE" { return .otherLine }
        if reason == "HOME_UNREACHABLE" { return .recheck }
        if phase == .failed { return .retry }
        return .none
    }

    public static func showsBanner(_ phase: Phase, reason: String?) -> Bool {
        reason != nil && [.failed, .degraded, .needsPermission, .idle, .signedOut].contains(phase)
    }
}

public enum LatencyLevel: Sendable {
    case good, slow, verySlow, unknown

    /// Desktop thresholds: <200 good, <400 slow, ≥400 very slow.
    public init(_ ms: Int?) {
        guard let ms else { self = .unknown; return }
        self = ms < 200 ? .good : ms < 400 ? .slow : .verySlow
    }
}

public enum Format {
    /// Same output as Android `Format.rate`: two decimals in MB/s, whole KB/s, bytes below that.
    public static func rate(_ bytesPerSecond: Int64) -> String {
        let b = max(0, bytesPerSecond)
        if b >= 1_000_000 { return String(format: "%.2f MB/s", Double(b) / 1_000_000) }
        if b >= 1_000 { return "\(b / 1_000) KB/s" }
        return "\(b) B/s"
    }

    /// Android `Format.CITY_ZH`, keyed by lowercase English city.
    static let chineseCities: [String: String] = [
        "los angeles": "洛杉矶", "salt lake city": "盐湖城", "buffalo": "布法罗", "new york": "纽约",
        "san jose": "圣何塞", "seattle": "西雅图", "chicago": "芝加哥", "dallas": "达拉斯", "miami": "迈阿密",
        "tokyo": "东京", "osaka": "大阪", "singapore": "新加坡", "hong kong": "香港", "seoul": "首尔",
        "taipei": "台北", "london": "伦敦", "frankfurt": "法兰克福",
    ]

    /// City in the user's language when known; otherwise the catalog's own word.
    public static func city(_ city: String, chinese: Bool) -> String {
        chinese ? chineseCities[city.lowercased()] ?? city : city
    }
}

/// Why the tunnel went down, decided when iOS reports it disconnected.
public enum TunnelStop: Equatable, Sendable {
    /// The user switched off (or it was already down); nothing to explain.
    case expected
    /// A start the user asked for never reached connected. Shown as FAILED, and On Demand is
    /// turned off so iOS does not keep retrying a broken start in the background.
    case startFailed(String)
    /// It was up and stopped without the user (core exit, jetsam, system). Shown as FAILED;
    /// On Demand stays on so iOS brings the tunnel back and holds traffic meanwhile.
    case stoppedBySystem(String)

    public static func classify(before: TunnelStatus, userStarting: Bool, userStopping: Bool, recordedFailure: String?) -> TunnelStop {
        if userStarting { return .startFailed(recordedFailure ?? "CORE_START") }
        if userStopping { return .expected }
        if [.connected, .reasserting, .disconnecting].contains(before) { return .stoppedBySystem(recordedFailure ?? "CORE_STOPPED") }
        return .expected
    }
}
