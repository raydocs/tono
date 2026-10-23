import Foundation

/// What a verified connection protects. Read from the session the Core
/// runtime captured at connect, never from the saved Settings choice: the
/// saved mode describes the next connect, and a saved AI Home choice on an
/// account without a Home line runs Stable (decision 131).
enum ProtectionScope: Equatable {
    /// Stable and Three-tier: PF fails closed for the whole host.
    case wholeHost
    /// AI Home: listed AI stays on the Home line and fails closed; unmatched
    /// traffic goes DIRECT and is never locked (decision 130).
    case listedAI

    init(sessionRoutingMode: String) {
        self = sessionRoutingMode == "ai-home" ? .listedAI : .wholeHost
    }
}

extension AppState {
    /// Scope of the session the Core runtime holds. It qualifies a verified
    /// connection only; callers keep the status precedence (connecting,
    /// unconfirmed, Protected Offline, degraded) ahead of it.
    var sessionProtectionScope: ProtectionScope {
        ProtectionScope(sessionRoutingMode: coreRuntime.routingMode)
    }
}
