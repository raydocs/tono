import Foundation
import Observation

extension SettingsKey {
    /// Test-programme protection snapshot: the twenty-minute telemetry window
    /// carrying UI state, selected exit, catalog revision, kill-switch and DNS
    /// state, path latencies and the connection event ring.
    ///
    /// Deliberately not `remoteDiagnosticsEnabled`: that switch starts the
    /// fifteen-second poll for the four fixed remote device actions, and a
    /// consent to be remotely actionable is not a consent to a periodic upload
    /// it never described. Mirrors the Windows client's
    /// `periodic_telemetry_enabled`, including the v2 default-off migration.
    nonisolated static let periodicTelemetryEnabled =
        "periodicTelemetryEnabled"
    nonisolated static let periodicTelemetryDefaultV2Applied =
        "periodicTelemetryDefaultV2Applied"
}

@MainActor @Observable
final class AccountSession {
    enum State: Equatable { case restoring, signedOut, authenticating, enrolling, ready, suspended, error(String) }
    var state: State = .restoring {
        didSet {
            if state != oldValue { invalidateAccountReads() }
        }
    }
    // Read results belong to one account/presentation, not merely a state
    // enum value. Leaving and returning to the same account/state retires them.
    @ObservationIgnored private(set) var accountReadRevision: UInt64 = 0
    @ObservationIgnored var nextAccountRefreshID: UInt64 = 0
    func invalidateAccountReads() { accountReadRevision &+= 1 }

    var user: TonoUser? {
        didSet {
            if user?.id != oldValue?.id { invalidateAccountReads() }
        }
    }
    var device: TonoDevice?
    var enrollment: TonoEnrollment?
    var devices: [TonoDevice] = []
    var authMethods: TonoAuthMethodsResponse?
    var emailChallenge: TonoEmailChallengeResponse?
    /// Device management reports here instead of through `fail`: a failed
    /// revoke is not an authentication or runtime failure, and must not take
    /// the tunnel, the background tasks and the whole window with it.
    var deviceActionError: String?
    /// Why an authenticated account may not connect — expiry, data allowance or
    /// an operator disabling it. Rendered by the suspended screen.
    var entitlementDetail: String?
    /// Whether the entitlement block interrupted a session that was already
    /// running. Only that session can be resumed by a re-read of the account;
    /// a block raised before the runtime came up still needs a full restore.
    var blockedWhileReady = false
    var enrollmentAuthKey: String?
    var enrollmentHostname: String?
    let api: TonoAPIClient
    let keychain: KeychainStore
    let sidecar: TonoSidecarService
    let descriptorConsumer: @MainActor (TonoTransportDescriptor?) async -> Void
    let catalogConsumer: @MainActor (TonoExitCatalogResponse) async throws -> Void
    let trafficPolicyConsumer: @MainActor (TonoTrafficPolicyResponse) async throws -> Void
    let cloudFallbackPreferred: @MainActor () -> Bool
    let cloudFallbackConsumer: @MainActor (Bool) throws -> Void
    let killSwitchDisarmConsumer: @MainActor () async -> Void
    let diagnosticSnapshotConsumer: @MainActor () -> TonoDiagnosticSnapshot
    let pathLatencyConsumer: @MainActor () -> TonoPathLatency
    let claudeTrafficResearchConsumer:
        @MainActor () async -> TonoClaudeTrafficResearchSnapshot
    let protectionBlockedConsumer: @MainActor () -> Bool
    let protectedRetryConsumer: @MainActor () -> Void
    let appRoutingResearchActivationConsumer: @MainActor () -> Void
    let exitNode: String
    var runtimeMonitor: Task<Void, Never>?
    var catalogSyncTask: Task<Void, Never>?
    /// One catalog request owns fetch, validation, persistence, and runtime
    /// application all the way to completion. Replacing only the final write
    /// gate is insufficient: two account-specific bodies can legitimately have
    /// the same fleet revision, so an older response arriving last would still
    /// replace the newer routing and credentials.
    var catalogRefreshTask: (id: UInt64, task: Task<Bool, Never>)?
    var nextCatalogRefreshID: UInt64 = 0
    var deviceRefreshTask: Task<Void, Never>?
    var deviceActionTask: Task<Void, Never>?
    var appRoutingResearchTask: Task<Void, Never>?
    var periodicTelemetryTask: Task<Void, Never>?
    var lastPeriodicTelemetryAt: Date?
    /// Slightly under the 20-minute cadence so an on-time window is never
    /// dropped by clock jitter, and comfortably inside the six-an-hour budget.
    static let periodicTelemetryMinimumSpacing: TimeInterval = 18 * 60
    /// Test-programme raw-log upload. Built lazily on first use so a signed-out
    /// launch never touches the audit directory, and kept for the process
    /// lifetime so its upload cursor survives sign-out and sleep.
    var diagnosticsLogUploader: DiagnosticsLogUploader?
    var systemSleeping = false
    var lastCatalogFailureMessage: String?
    var lastTrafficPolicyFailureMessage: String?
    var lastTrafficPolicyRevision: Int?
    var authMethodsLoading = false
    var hasStartedRestore = false
    var shouldResumeProtection = false

    var deviceLimit: Int { user?.deviceLimit ?? TonoAccountRules.maximumDevices }
    var isAtDeviceLimit: Bool { devices.count >= deviceLimit }
    var isReady: Bool { state == .ready }
    var catalogFailureMessage: String? { lastCatalogFailureMessage }
    /// A stale managed traffic policy silently degrades the WeChat direct
    /// route; without this accessor the stored failure was write-only and
    /// invisible to every UI and diagnostic surface.
    var trafficPolicyFailureMessage: String? { lastTrafficPolicyFailureMessage }
    /// Revision of the managed traffic policy this run last accepted, or nil
    /// before the first successful refresh. Support needs it beside the catalog
    /// revision to tell "the policy is old" from "the policy never arrived".
    var trafficPolicyRevision: Int? { lastTrafficPolicyRevision }

    /// Whether the twenty-minute protection snapshot may be uploaded.
    ///
    /// New installations default off. The marker resets the former default-on
    /// value exactly once; once marked, a later explicit opt-in stays on.
    nonisolated static var isPeriodicTelemetryEnabled: Bool {
        if !AppProfile.defaults.bool(
            forKey: SettingsKey.periodicTelemetryDefaultV2Applied
        ) {
            AppProfile.defaults.set(
                false,
                forKey: SettingsKey.periodicTelemetryEnabled
            )
            AppProfile.defaults.set(
                true,
                forKey: SettingsKey.periodicTelemetryDefaultV2Applied
            )
            return false
        }
        return AppProfile.defaults.bool(
            forKey: SettingsKey.periodicTelemetryEnabled
        )
    }

    init(api: TonoAPIClient = TonoAPIClient(), keychain: KeychainStore = KeychainStore(), sidecar: TonoSidecarService,
         exitNode: String = Bundle.main.object(forInfoDictionaryKey: "TonoExitNode") as? String ?? "",
         descriptorConsumer: @escaping @MainActor (TonoTransportDescriptor?) async -> Void,
         catalogConsumer: @escaping @MainActor (TonoExitCatalogResponse) async throws -> Void = { _ in },
         trafficPolicyConsumer: @escaping @MainActor (TonoTrafficPolicyResponse) async throws -> Void = { _ in },
         cloudFallbackPreferred: @escaping @MainActor () -> Bool = { false },
         cloudFallbackConsumer: @escaping @MainActor (Bool) throws -> Void = { _ in },
         killSwitchDisarmConsumer: @escaping @MainActor () async -> Void = {},
         diagnosticSnapshotConsumer: @escaping @MainActor () -> TonoDiagnosticSnapshot = {
             TonoDiagnosticSnapshot(
                 appVersion: "unknown", build: "unknown", connected: false,
                 connecting: false, disconnecting: false, protectionBlocked: false,
                 killSwitchArmed: false, utunPresent: false,
                 protectedDNSConfigured: false, selectedExit: "unknown",
                 connectionStage: "unknown", reconnectAttempt: 0,
                 lastErrorCategory: nil, lastCrashLabel: nil,
                 catalogRevision: nil
             )
         },
         claudeTrafficResearchConsumer: @escaping
            @MainActor () async -> TonoClaudeTrafficResearchSnapshot = {
                TonoClaudeTrafficResearchSnapshot(
                    observedSince: 0,
                    droppedEndpointCount: 0,
                    observedConnectionCount: 0,
                    identifiedProcessConnectionCount: 0,
                    proxiedConnectionCount: 0,
                    residentialConnectionCount: 0,
                    directConnectionCount: 0,
                    blockedConnectionCount: 0,
                    directRouteAttemptCount: 0,
                    managedDirectRouteCount: 0,
                    unclassifiedRouteCount: 0,
                    unsafeProtectionObservationCount: 0,
                    webManagedDirectConnectionCount: 0,
                    weChatConnectionCount: 0,
                    weChatManagedDirectConnectionCount: 0,
                    weChatProxiedConnectionCount: 0,
                    weChatBlockedConnectionCount: 0,
                    weChatEndpointUnknownProcessConnectionCount: 0,
                    unknownManagedDirectConnectionCount: 0,
                    otherManagedDirectConnectionCount: 0,
                    protectedDirectConnectionCount: 0,
                    connectionLimitReached: false,
                    connected: false,
                    killSwitchArmed: false,
                    tunPresent: false,
                    protectedDNSConfigured: false,
                    exitIdentityConsistency: "INCONCLUSIVE",
                    physicalBypassProbe: "INCONCLUSIVE",
                    entries: []
                )
            },
         protectionBlockedConsumer: @escaping @MainActor () -> Bool = { false },
         protectedRetryConsumer: @escaping @MainActor () -> Void = {},
         appRoutingResearchActivationConsumer: @escaping
            @MainActor () -> Void = {},
         pathLatencyConsumer: @escaping @MainActor () -> TonoPathLatency = {
             TonoPathLatency()
         }) {
        // Apply the one-shot default-off migration before Settings can present
        // or change the AppStorage value. A later user opt-in then sees the v2
        // marker and is never reset on a subsequent callback or launch.
        _ = Self.isPeriodicTelemetryEnabled
        self.api = api; self.keychain = keychain; self.sidecar = sidecar
        self.exitNode = exitNode
        self.descriptorConsumer = descriptorConsumer
        self.catalogConsumer = catalogConsumer
        self.trafficPolicyConsumer = trafficPolicyConsumer
        self.cloudFallbackPreferred = cloudFallbackPreferred
        self.cloudFallbackConsumer = cloudFallbackConsumer
        self.killSwitchDisarmConsumer = killSwitchDisarmConsumer
        self.diagnosticSnapshotConsumer = diagnosticSnapshotConsumer
        self.claudeTrafficResearchConsumer = claudeTrafficResearchConsumer
        self.protectionBlockedConsumer = protectionBlockedConsumer
        self.protectedRetryConsumer = protectedRetryConsumer
        self.appRoutingResearchActivationConsumer =
            appRoutingResearchActivationConsumer
        self.pathLatencyConsumer = pathLatencyConsumer
    }
}
