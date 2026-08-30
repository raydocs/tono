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
    /// `periodic_telemetry_enabled`, down to reading a missing value as on.
    nonisolated static let periodicTelemetryEnabled =
        "periodicTelemetryEnabled"
}

@MainActor @Observable
final class AccountSession {
    enum State: Equatable { case restoring, signedOut, authenticating, enrolling, ready, suspended, error(String) }
    private(set) var state: State = .restoring
    private(set) var user: TonoUser?
    private(set) var device: TonoDevice?
    private(set) var enrollment: TonoEnrollment?
    private(set) var devices: [TonoDevice] = []
    private(set) var authMethods: TonoAuthMethodsResponse?
    private(set) var emailChallenge: TonoEmailChallengeResponse?
    /// Device management reports here instead of through `fail`: a failed
    /// revoke is not an authentication or runtime failure, and must not take
    /// the tunnel, the background tasks and the whole window with it.
    private(set) var deviceActionError: String?
    /// Why an authenticated account may not connect — expiry, data allowance or
    /// an operator disabling it. Rendered by the suspended screen.
    private(set) var entitlementDetail: String?
    /// Whether the entitlement block interrupted a session that was already
    /// running. Only that session can be resumed by a re-read of the account;
    /// a block raised before the runtime came up still needs a full restore.
    private var blockedWhileReady = false
    private var enrollmentAuthKey: String?
    private var enrollmentHostname: String?
    private let api: TonoAPIClient
    private let keychain: KeychainStore
    private let sidecar: TonoSidecarService
    private let descriptorConsumer: @MainActor (TonoTransportDescriptor?) async -> Void
    private let catalogConsumer: @MainActor (TonoExitCatalogResponse) async throws -> Void
    private let trafficPolicyConsumer: @MainActor (TonoTrafficPolicyResponse) async throws -> Void
    private let cloudFallbackPreferred: @MainActor () -> Bool
    private let cloudFallbackConsumer: @MainActor (Bool) throws -> Void
    private let killSwitchDisarmConsumer: @MainActor () async -> Void
    private let diagnosticSnapshotConsumer: @MainActor () -> TonoDiagnosticSnapshot
    private let pathLatencyConsumer: @MainActor () -> TonoPathLatency
    private let claudeTrafficResearchConsumer:
        @MainActor () async -> TonoClaudeTrafficResearchSnapshot
    private let protectionBlockedConsumer: @MainActor () -> Bool
    private let protectedRetryConsumer: @MainActor () -> Void
    private let appRoutingResearchActivationConsumer: @MainActor () -> Void
    private let exitNode: String
    private var runtimeMonitor: Task<Void, Never>?
    private var catalogSyncTask: Task<Void, Never>?
    /// One catalog request owns fetch, validation, persistence, and runtime
    /// application all the way to completion. Replacing only the final write
    /// gate is insufficient: two account-specific bodies can legitimately have
    /// the same fleet revision, so an older response arriving last would still
    /// replace the newer routing and credentials.
    private var catalogRefreshTask: (id: UInt64, task: Task<Bool, Never>)?
    private var nextCatalogRefreshID: UInt64 = 0
    private var deviceRefreshTask: Task<Void, Never>?
    private var deviceActionTask: Task<Void, Never>?
    private var appRoutingResearchTask: Task<Void, Never>?
    private var periodicTelemetryTask: Task<Void, Never>?
    private var lastPeriodicTelemetryAt: Date?
    /// Slightly under the 20-minute cadence so an on-time window is never
    /// dropped by clock jitter, and comfortably inside the six-an-hour budget.
    private static let periodicTelemetryMinimumSpacing: TimeInterval = 18 * 60
    /// Test-programme raw-log upload. Built lazily on first use so a signed-out
    /// launch never touches the audit directory, and kept for the process
    /// lifetime so its upload cursor survives sign-out and sleep.
    private var diagnosticsLogUploader: DiagnosticsLogUploader?
    private var systemSleeping = false
    private var lastCatalogFailureMessage: String?
    private var lastTrafficPolicyFailureMessage: String?
    private var lastTrafficPolicyRevision: Int?
    private var authMethodsLoading = false
    private var hasStartedRestore = false
    private var shouldResumeProtection = false

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
    /// A missing value reads as on: the Windows client defaults the same wire
    /// shape on for the test programme, and a Mac that never appears on the
    /// dashboard cannot be supported. Turning it off in Settings › Privacy
    /// stops the upload for good.
    nonisolated static var isPeriodicTelemetryEnabled: Bool {
        AppProfile.defaults.object(forKey: SettingsKey.periodicTelemetryEnabled) == nil
            ? true
            : AppProfile.defaults.bool(forKey: SettingsKey.periodicTelemetryEnabled)
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

    func restore() async {
        guard !hasStartedRestore else { return }
        hasStartedRestore = true
        state = .restoring
        do {
            if var journal = UpdateHandoffStore.load() {
                ConnectionTelemetryBuffer.shared.record(
                    "updateResumeBegin",
                    stage: journal.phase.rawValue,
                    mode: "updateResume",
                    generation: Int(journal.connectionGeneration),
                    updateResume: true
                )
                journal = journal.advancing(to: .firstLaunchMigration)
                try? UpdateHandoffStore.write(journal)
            }
            // Crash recovery can invoke networksetup and helper IPC. Run it on
            // the serialized runtime actor so the first window paints
            // immediately instead of blocking AppKit's launch callback.
            shouldResumeProtection =
                try await RuntimeCleanup.cleanupStaleRuntime()
            guard try keychain.string(for: .refreshToken) != nil else {
                deactivateAppRoutingResearch()
                // No account owns this launch, so the cache loaded from disk a
                // moment ago may not stay installed or selectable.
                ManagedExitCatalogOwnership.purge()
                // Signed out: never leave a previous session's kill switch armed.
                if !AppProfile.homeExitEnabled {
                    // A force-quit of an older Home-US build may have left its
                    // child daemon behind. Cleanup is local-only and does not
                    // invoke the Tailscale CLI or contact its control plane.
                    try? await sidecar.prepareCloudOnly()
                }
                do {
                    try await PrivilegedRuntimeCoordinator.shared.disarmKillSwitch()
                } catch {
                    state = .error(
                        String(localized: "Tono could not release a protection state left by an earlier session. Run the documented sudo emergency-disarm command, then reopen Tono. \(error.localizedDescription)")
                    )
                    return
                }
                shouldResumeProtection = false
                state = .signedOut
                await loadAuthMethods()
                return
            }
            // A stale crash state has already been stopped and DNS-restored.
            // PF remains armed with only Tono's bounded control-plane recovery
            // path; protection resumes after the authenticated cached/cloud
            // exit is ready below.
            if !AppProfile.homeExitEnabled {
                // The cloud-only path does not need the device inventory to
                // establish a protected route. Validate the account first,
                // then populate device-management UI in parallel with local
                // runtime preparation instead of adding another round trip to
                // the first-screen critical path.
                let restoredUser = try await api.me().user
                user = restoredUser
                ManagedExitCatalogOwnership.adopt(restoredUser.id)
                guard restoredUser.suspended != true else {
                    pauseAppRoutingResearch()
                    state = .suspended
                    return
                }
                refreshDevicesInBackground()
                await startCloudOnlyRuntime()
                return
            }
            // These are independent authenticated reads. TonoAPIClient
            // coalesces their access-token refresh, so restoring them
            // concurrently removes one control-plane round trip.
            async let meResponse = api.me()
            async let devicesResponse = api.devices()
            let (restoredUser, restoredDevices) = try await (
                meResponse.user,
                devicesResponse.devices
            )
            user = restoredUser
            devices = restoredDevices
            ManagedExitCatalogOwnership.adopt(restoredUser.id)
            guard user?.suspended != true else {
                pauseAppRoutingResearch()
                state = .suspended
                return
            }
            device = devices.first(where: { $0.current == true })
            await resumeOrEnrollRuntime()
        } catch is CancellationError {
            // The restore task is scoped to the SwiftUI window. Closing and
            // recreating that window must be allowed to start a fresh restore
            // instead of stranding the session behind hasStartedRestore.
            hasStartedRestore = false
        } catch {
            await fail(error, signsOutOnUnauthorized: true)
        }
    }

    func loadAuthMethods() async {
        guard user == nil, !authMethodsLoading else { return }
        authMethodsLoading = true
        defer { authMethodsLoading = false }
        do {
            authMethods = try await api.authMethods()
        } catch is CancellationError {
            // SwiftUI cancels view-scoped tasks during ordinary transitions.
            // Cancellation is not a control-plane outage and must not replace
            // the sign-in screen with an error that immediately retries.
            return
        } catch {
            authMethods = nil
            if state != .authenticating {
                state = .error(
                    (error as? LocalizedError)?.errorDescription
                        ?? String(localized: "Tono sign-in is temporarily unavailable.")
                )
            }
        }
    }

    /// Re-runs the complete token/account validation after a transient launch
    /// failure, or after the account state that blocked it has been settled.
    /// Retrying only the sign-in-method request would leave an existing refresh
    /// token stranded behind the login screen.
    func retryRestore() async {
        switch state {
        case .error: break
        case .suspended:
            // A block raised over a running session is an account fact, not a
            // broken session. Re-read the account instead of re-running the
            // launch sequence, whose first step stops the core this Mac is
            // still protected by.
            if blockedWhileReady {
                await refreshAccount()
                return
            }
        default: return
        }
        entitlementDetail = nil
        blockedWhileReady = false
        hasStartedRestore = false
        await restore()
    }

    func requestEmailCode(email: String, deviceName: String) async {
        guard TonoAccountRules.validEmail(email) else {
            state = .error(String(localized: "Enter a valid email address."))
            return
        }
        state = .authenticating
        do {
            emailChallenge = try await api.startEmailSignIn(TonoEmailStartRequest(
                email: TonoAccountRules.normalizedEmail(email),
                deviceName: TonoAccountRules.normalizedDeviceName(deviceName),
                installationId: try keychain.installationId()
            ))
            state = .signedOut
        } catch {
            await fail(error)
        }
    }

    func verifyEmailCode(_ code: String) async {
        let normalizedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let emailChallenge,
              normalizedCode.count == 6,
              normalizedCode.unicodeScalars.allSatisfy({ (48...57).contains($0.value) })
        else {
            state = .error(String(localized: "Enter the six-digit code from your email."))
            return
        }
        await authenticate {
            try await self.api.verifyEmailSignIn(TonoEmailVerifyRequest(
                challengeId: emailChallenge.challengeId,
                code: normalizedCode
            ))
        }
    }

    #if DEBUG
    func signInWithApple(deviceName: String) async {
        guard authMethods?.apple.enabled == true else {
            state = .error(String(localized: "Sign in with Apple is not configured."))
            return
        }
        await authenticate {
            let challenge = try await self.api.oidcChallenge(TonoOIDCChallengeRequest(
                provider: "apple",
                deviceName: TonoAccountRules.normalizedDeviceName(deviceName),
                installationId: try self.keychain.installationId()
            ))
            let token = try await AppleSignInCoordinator().identityToken(
                nonce: challenge.nonce
            )
            return try await self.api.verifyOIDC(TonoOIDCVerifyRequest(
                provider: "apple",
                challengeId: challenge.challengeId,
                idToken: token
            ))
        }
    }

    func signInWithGoogle(deviceName: String) async {
        guard authMethods?.google.enabled == true,
              let advertisedClientID = authMethods?.google.clientId
        else {
            state = .error(String(localized: "Google sign-in is not configured."))
            return
        }
        await authenticate {
            let challenge = try await self.api.oidcChallenge(TonoOIDCChallengeRequest(
                provider: "google",
                deviceName: TonoAccountRules.normalizedDeviceName(deviceName),
                installationId: try self.keychain.installationId()
            ))
            guard challenge.audience == advertisedClientID else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            let token = try await GoogleSignInCoordinator.identityToken(
                clientID: advertisedClientID,
                nonce: challenge.nonce
            )
            return try await self.api.verifyOIDC(TonoOIDCVerifyRequest(
                provider: "google",
                challengeId: challenge.challengeId,
                idToken: token
            ))
        }
    }
    #endif

    func logout() async {
        // Purge before any suspension point so no pending aggregate can cross
        // into a later account even when server logout is slow or unavailable.
        deactivateAppRoutingResearch()
        ManagedExitCatalogOwnership.purge()
        await stopRuntime(logOutIdentity: true, releaseKillSwitch: true)
        await api.logout(); clearAccount(); state = .signedOut
    }

    func retryRuntime() async {
        if !AppProfile.homeExitEnabled {
            await startCloudOnlyRuntime()
        } else if device?.status == "pending" {
            await beginEnrollment()
        } else {
            await resumeOrEnrollRuntime()
        }
    }

    @discardableResult
    func refreshManagedCatalog(attempts: Int = 1) async -> Bool {
        if let current = catalogRefreshTask {
            return await current.task.value
        }
        nextCatalogRefreshID &+= 1
        let id = nextCatalogRefreshID
        let task = Task { [weak self] in
            guard let self else { return false }
            return await self.performManagedCatalogRefresh(attempts: attempts)
        }
        catalogRefreshTask = (id, task)
        let succeeded = await task.value
        // Cancellation cleanup owns a cancelled slot until it has awaited the
        // worker. This prevents a stop/logout from admitting a second refresh
        // while the first consumer is still suspended, and the ID prevents an
        // older waiter from clearing a later task.
        if catalogRefreshTask?.id == id, !task.isCancelled {
            catalogRefreshTask = nil
        }
        return succeeded
    }

    private func performManagedCatalogRefresh(attempts: Int) async -> Bool {
        let boundedAttempts = min(max(attempts, 1), 3)
        for attempt in 0..<boundedAttempts {
            guard !Task.isCancelled else { return false }
            do {
                let catalog = try await api.exitCatalog()
                try Task.checkCancellation()
                try await catalogConsumer(catalog)
                try Task.checkCancellation()
                lastCatalogFailureMessage = nil
                return true
            } catch is CancellationError {
                return false
            } catch {
                guard !Task.isCancelled else { return false }
                // Keep the last verified, mode-0600 cache. Catalog
                // availability must never turn a temporary control-plane
                // failure into a clearnet fallback or erase usable exits.
                lastCatalogFailureMessage =
                    (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
                if attempt + 1 < boundedAttempts {
                    do {
                        try await Task.sleep(for: .seconds(1))
                    } catch {
                        return false
                    }
                }
            }
        }
        return false
    }

    private func cancelManagedCatalogRefresh() async {
        guard let current = catalogRefreshTask else { return }
        current.task.cancel()
        _ = await current.task.value
        if catalogRefreshTask?.id == current.id {
            catalogRefreshTask = nil
        }
    }

    @discardableResult
    func refreshManagedTrafficPolicy(attempts: Int = 1) async -> Bool {
        let boundedAttempts = min(max(attempts, 1), 3)
        for attempt in 0..<boundedAttempts {
            do {
                let policy = try await api.trafficPolicy()
                try await trafficPolicyConsumer(policy)
                lastTrafficPolicyFailureMessage = nil
                lastTrafficPolicyRevision = policy.revision
                return true
            } catch {
                // Direct routing is optional. A failed refresh keeps the last
                // verified policy; an absent policy never becomes clearnet.
                lastTrafficPolicyFailureMessage =
                    (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
                if attempt + 1 < boundedAttempts {
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        }
        return false
    }

    func reloadDevices() async throws { devices = try await api.devices().devices }

    func clearDeviceActionError() { deviceActionError = nil }

    /// Device management never routes through `fail`. An unreachable or 5xx
    /// control plane here is not an authentication or runtime failure, and
    /// dropping the descriptor over one would take a protected Mac offline
    /// behind an armed kill switch and replace the window with the gate.
    func revoke(_ target: TonoDevice) async {
        guard target.id != device?.id && target.current != true else {
            deviceActionError = String(localized: "The current device cannot revoke itself.")
            return
        }
        deviceActionError = nil
        do {
            try await api.revokeDevice(target.id)
        } catch is CancellationError {
            return
        } catch {
            deviceActionError = (error as? LocalizedError)?.errorDescription
                ?? String(localized: "Something went wrong. Please try again.")
            return
        }
        // The device is revoked either way; only the refreshed inventory is
        // missing, and the next panel appearance reloads it.
        try? await reloadDevices()
    }

    /// Plan, expiry, quota and usage are read once at sign-in and then drift for
    /// as long as this menu-bar client stays resident. Re-read on the catalog
    /// cadence, when the account panel appears, and after a wake.
    func refreshAccount() async {
        guard user != nil else { return }
        do {
            let refreshed = try await api.me().user
            // The account may have been cleared across the request.
            guard user != nil else { return }
            user = refreshed
            if refreshed.suspended == true {
                enterEntitlementBlock(detail: nil)
            } else {
                leaveEntitlementBlock()
            }
        } catch is CancellationError {
            return
        } catch let error as TonoAPIClient.APIError where Self.isEntitlementFailure(error) {
            enterEntitlementBlock(detail: error.errorDescription)
        } catch TonoAPIClient.APIError.unauthorized {
            // The control plane still refuses this session after the client's
            // own token renewal. Today it answers the same way for an expired
            // plan, an exhausted allowance and a revoked session, so show what
            // is actually known and leave signing out to the user rather than
            // reporting an account problem as an expired sign-in.
            enterEntitlementBlock(detail: nil)
        } catch {
            // Transient control-plane failure; the next cadence re-reads it.
        }
    }

    private static func isEntitlementFailure(
        _ error: TonoAPIClient.APIError
    ) -> Bool {
        if case .entitlementBlocked = error { return true }
        return false
    }

    /// The credential is good and the account may not use it. The user is told
    /// which — expiry, allowance or a disabled account — instead of being signed
    /// out with a session-expired message, and protection is left exactly as it
    /// is. A nil detail falls back to the screen's own general copy.
    private func enterEntitlementBlock(detail: String?) {
        entitlementDetail = detail
        if state == .ready { blockedWhileReady = true }
        pauseAppRoutingResearch()
        state = .suspended
    }

    /// The control plane accepted this account again, so the block is lifted
    /// and the running session it interrupted resumes where it paused —
    /// including the synchronization loop, which stops outside `.ready`.
    private func leaveEntitlementBlock() {
        guard state == .suspended, blockedWhileReady else { return }
        blockedWhileReady = false
        entitlementDetail = nil
        state = .ready
        startCatalogSync()
    }

    /// Transfers the one-time enrollment material and immediately removes the
    /// only credential-bearing copies retained by AccountSession.
    private func consumeEnrollmentCredentials() -> (authKey: String, hostname: String)? {
        defer {
            enrollmentAuthKey = nil
            enrollmentHostname = nil
        }
        guard let authKey = enrollmentAuthKey, !authKey.isEmpty,
              let hostname = enrollmentHostname, !hostname.isEmpty else {
            return nil
        }
        return (authKey, hostname)
    }

    private func adoptEnrollment(_ value: TonoEnrollment?) {
        enrollmentAuthKey = value?.authKey
        enrollmentHostname = value?.hostname
        // Keep only non-secret status metadata for observation/UI.
        enrollment = value.map {
            TonoEnrollment(
                id: $0.id,
                authKey: nil,
                hostname: nil,
                expiresAt: $0.expiresAt,
                state: $0.state
            )
        }
    }

    func beginEnrollment() async {
        guard AppProfile.homeExitEnabled else {
            await startCloudOnlyRuntime()
            return
        }
        guard let device else { state = .error(String(localized: "No Tono device is available to enroll.")); return }
        state = .enrolling
        do {
            let response = try await api.enrollment(deviceId: device.id, installationId: keychain.installationId())
            adoptEnrollment(response.enrollment)
            guard let credentials = consumeEnrollmentCredentials() else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            try await startSidecar(
                authKey: credentials.authKey,
                enrollmentHostname: credentials.hostname,
                confirm: true
            )
        } catch { await fail(error) }
    }

    private func authenticate(_ operation: () async throws -> TonoAuthResponse) async {
        state = .authenticating
        // A failed revoke from the device-limit list belongs to the attempt
        // that raised it, not to the one starting here.
        deviceActionError = nil
        do {
            let response = try await operation(); try await api.adopt(response)
            emailChallenge = nil
            user = response.user
            device = response.device
            // Before any transport can select an exit, so nothing published for
            // the previous account is reachable by this one.
            ManagedExitCatalogOwnership.adopt(response.user.id)
            adoptEnrollment(response.enrollment)
            try await reloadDevices()
            if response.user.suspended == true {
                pauseAppRoutingResearch()
                state = .suspended
                return
            }
            if !AppProfile.homeExitEnabled {
                // Managed Reality exits authenticate directly with the Tono
                // control plane. They never consume or wait for a Tailscale
                // enrollment credential.
                enrollmentAuthKey = nil
                enrollmentHostname = nil
                enrollment = nil
                await startCloudOnlyRuntime()
            } else if response.enrollment == nil {
                await resumeOrEnrollRuntime()
            } else {
                state = .enrolling
                guard let credentials = consumeEnrollmentCredentials() else {
                    throw TonoAPIClient.APIError.invalidResponse
                }
                try await startSidecar(
                    authKey: credentials.authKey,
                    enrollmentHostname: credentials.hostname,
                    confirm: true
                )
            }
        } catch { await fail(error) }
    }

    /// Stops transport. Kill switch is released only on intentional logout/user disconnect.
    func stopRuntime(logOutIdentity: Bool = false, releaseKillSwitch: Bool = false) async {
        pauseAppRoutingResearch()
        runtimeMonitor?.cancel()
        runtimeMonitor = nil
        catalogSyncTask?.cancel()
        catalogSyncTask = nil
        await cancelManagedCatalogRefresh()
        deviceRefreshTask?.cancel()
        deviceRefreshTask = nil
        deviceActionTask?.cancel()
        deviceActionTask = nil
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        periodicTelemetryTask?.cancel()
        periodicTelemetryTask = nil
        if logOutIdentity {
            await abandonDiagnosticsLogUploader()
        } else if let uploader = diagnosticsLogUploader {
            await uploader.stop()
        }
        // Clear descriptor first so Mihomo stops, while kill switch may remain armed.
        await descriptorConsumer(nil)
        if AppProfile.homeExitEnabled {
            if logOutIdentity { await sidecar.logoutAndStop() }
            else { await sidecar.stop() }
        } else {
            // The VLESS-only profile never logs into Tailscale. Also clean a
            // verified stale child daemon left behind by an older app process.
            try? await sidecar.prepareCloudOnly()
        }
        if releaseKillSwitch {
            await releaseNetworkProtection()
        }
    }

    /// Explicit user escape hatch for a fail-closed host while the session is
    /// NOT ready (crash recovery with an unreachable control plane). Without
    /// it the sign-in gate and menu bar offered no way to restore internet.
    func restoreDirectInternet() async {
        await releaseNetworkProtection()
    }

    private func releaseNetworkProtection() async {
        await killSwitchDisarmConsumer()
        // The app-state consumer performs the same ordered transaction and
        // surfaces any UI error. Keep an idempotent fallback here for
        // launch/termination paths where that consumer is unavailable:
        // DNS must be restored before PF is opened.
        do {
            _ = try await PrivilegedRuntimeCoordinator.shared
                .restoreProtectedDNSIfConfigured()
            try await PrivilegedRuntimeCoordinator.shared.disarmKillSwitch()
        } catch {
            // Retain fail-closed protection when recovery cannot be proven.
        }
    }

    private func startSidecar(
        authKey: String?,
        enrollmentHostname: String? = nil,
        confirm: Bool
    ) async throws {
        guard AppProfile.homeExitEnabled else {
            try await startCloudOnlyRuntimeThrowing()
            return
        }
        guard !exitNode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw TonoSidecarService.Error.exitNodeUnavailable("Set TonoExitNode in the app Info.plist")
        }

        // Arm kill switch BEFORE establishing tunnel so a mid-setup failure cannot leak.
        let apiHost = (Bundle.main.object(forInfoDictionaryKey: "TonoAPIBaseURL") as? String)
            .flatMap { URL(string: $0)?.host }
        try await PrivilegedRuntimeCoordinator.shared.prepareHelper()
        let protectedDNSState =
            await PrivilegedRuntimeCoordinator.shared.protectedDNSStatus()
        try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
            apiHosts: [apiHost].compactMap { $0 },
            exitNodeHints: [exitNode],
            tunnelInterfaces: [],
            proxyEndpoints: [],
            tailscaleBootstrapEnabled: confirm || AppProfile.homeExitEnabled,
            allowSystemResolution:
                !KillSwitchService.isArmed
                    && protectedDNSState.available
                    && !protectedDNSState.configured
                    && !protectedDNSState.snapshotPresent,
            helperPrepared: true,
            // Pre-tunnel setup arm: no traffic policy has been reviewed or
            // committed yet, so nothing may be permitted outside the tunnel.
            reviewedBundleDirect: false
        )

        if confirm {
            guard let device, let authKey, let enrollmentHostname else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            let identity = try await sidecar.enroll(
                authKey: authKey,
                hostname: enrollmentHostname
            )
            self.device = try await api.confirm(deviceId: device.id, identity: identity).device
            try await reloadDevices()
        }
        // Pull the authenticated catalog before choosing a data path. A failed
        // fetch leaves the last verified mode-0600 cache untouched.
        async let trafficPolicyRefresh: Bool = refreshManagedTrafficPolicy()
        await refreshManagedCatalog()
        _ = await trafficPolicyRefresh
        if !AppProfile.homeExitEnabled || cloudFallbackPreferred() {
            // A persisted managed-cloud selection is independent of Home-US.
            // While Home-US is disabled, every production launch takes this
            // path and skips its daemon/exit/SOCKS timeout chain completely.
            try await sidecar.prepareCloudOnly()
            try await activateCloudFallback()
        } else {
            do {
                try await sidecar.start(exitNode: exitNode)
                await descriptorConsumer(try await sidecar.descriptor())
                startRuntimeMonitor()
            } catch TonoSidecarService.Error.socksUnavailable {
                // Enrollment and confirm are already authoritative. Home-US is
                // an optional data path, so a failed home SOCKS probe must not
                // strand every separately authenticated managed cloud exit.
                await sidecar.stop()
                try await activateCloudFallback()
            } catch TonoSidecarService.Error.exitNodeUnavailable(_) {
                await sidecar.stop()
                try await activateCloudFallback()
            }
        }
        state = .ready
        startCatalogSync()
    }

    /// Starts the production VLESS Reality path without creating a Tailscale
    /// process, requesting an auth key, or depending on a Home-US exit node.
    private func startCloudOnlyRuntime() async {
        do {
            try await startCloudOnlyRuntimeThrowing()
        } catch {
            await fail(error)
        }
    }

    private func startCloudOnlyRuntimeThrowing() async throws {
        runtimeMonitor?.cancel()
        runtimeMonitor = nil
        await descriptorConsumer(nil)

        // Terminate a verified legacy Tono sidecar, including one left by an
        // older app process. This starts no daemon and performs no Tailscale
        // CLI, API, enrollment, or network operation.
        try await sidecar.prepareCloudOnly()

        // A normal signed-in-but-disconnected launch must leave the host's
        // network usable. The last authenticated mode-0600 catalog cache is
        // sufficient to paint the first usable screen; refreshing it is not a
        // launch gate and happens immediately in the background below.
        try await activateCloudFallback()
        state = .ready
        startCatalogSync(refreshImmediately: true)
    }

    private func startRuntimeMonitor() {
        runtimeMonitor?.cancel()
        runtimeMonitor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard let self, !Task.isCancelled else { return }
                if await sidecar.isHealthy(exitNode: exitNode) == false {
                    // Drop the failed Home-US path but KEEP the kill switch
                    // armed. A separately authenticated managed cloud exit
                    // must not depend on the optional home sidecar remaining
                    // healthy after startup.
                    await descriptorConsumer(nil)
                    await sidecar.stop()
                    do {
                        try await activateCloudFallback(resumeProtection: true)
                        state = .ready
                    } catch {
                        pauseAppRoutingResearch()
                        state = .error(
                            String(localized: "The Tono home transport stopped and no managed cloud exit is available. Internet remains blocked by the kill switch.")
                        )
                    }
                    return
                }
            }
        }
    }

    /// Prefer the last verified cache, then retry the authenticated catalog
    /// after the failed Home-US sidecar is fully stopped. The first catalog
    /// request can otherwise reuse a control-plane connection invalidated when
    /// PF is armed and its previous states are flushed.
    private func activateCloudFallback(resumeProtection: Bool? = nil) async throws {
        let resume = resumeProtection ?? shouldResumeProtection
        do {
            try cloudFallbackConsumer(resume)
            shouldResumeProtection = false
            return
        } catch {
            guard await refreshManagedCatalog(attempts: 2) else {
                let detail = lastCatalogFailureMessage.map { " \($0)" } ?? ""
                throw TonoSidecarService.Error.commandFailed(
                    "Managed cloud catalog is unavailable.\(detail)"
                )
            }
            try cloudFallbackConsumer(resume)
            shouldResumeProtection = false
        }
    }

    private func startCatalogSync(refreshImmediately: Bool = false) {
        guard !systemSleeping else { return }
        guard state == .ready, let user else {
            pauseAppRoutingResearch()
            return
        }
        AppRoutingResearch.shared.activate(forAuthenticatedUser: user.id)
        appRoutingResearchActivationConsumer()
        catalogSyncTask?.cancel()
        catalogSyncTask = Task { [weak self] in
            if refreshImmediately {
                guard let self, !Task.isCancelled, state == .ready else { return }
                async let catalog: Bool = refreshManagedCatalog()
                async let policy: Bool = refreshManagedTrafficPolicy()
                _ = await (catalog, policy)
            }
            while !Task.isCancelled {
                // Catalog changes are not part of the packet-level leak
                // boundary. Five-minute synchronization keeps normal node
                // additions/removals prompt without maintaining a push socket
                // or waking every signed-in Mac once per minute. Launch and
                // explicit recovery paths still refresh immediately.
                try? await Task.sleep(for: .seconds(300))
                guard let self, !Task.isCancelled, state == .ready else { return }
                async let catalog: Bool = refreshManagedCatalog()
                async let policy: Bool = refreshManagedTrafficPolicy()
                _ = await (catalog, policy)
                await refreshAccount()
            }
        }
        updateRemoteDiagnosticsPolling()
        updateAppRoutingResearchUploading()
        updateDiagnosticsLogUploading()
        updatePeriodicTelemetry()
    }

    func remoteDiagnosticsSettingChanged() {
        updateRemoteDiagnosticsPolling()
    }

    func appRoutingResearchSettingChanged() {
        if state == .ready, !systemSleeping, let user {
            AppRoutingResearch.shared.activate(forAuthenticatedUser: user.id)
        } else {
            AppRoutingResearch.shared.pause()
        }
        appRoutingResearchActivationConsumer()
        updateAppRoutingResearchUploading()
    }

    func prepareForSystemSleep() {
        systemSleeping = true
        pauseAppRoutingResearch()
        catalogSyncTask?.cancel(); catalogSyncTask = nil
        deviceActionTask?.cancel(); deviceActionTask = nil
        appRoutingResearchTask?.cancel(); appRoutingResearchTask = nil
        periodicTelemetryTask?.cancel(); periodicTelemetryTask = nil
        if let uploader = diagnosticsLogUploader {
            Task { await uploader.stop() }
        }
    }

    func resumeAfterSystemWake() {
        systemSleeping = false
        guard state == .ready else { return }
        startCatalogSync(refreshImmediately: false)
        updateDiagnosticsLogUploading()
        updatePeriodicTelemetry()
        // startCatalogSync resumes opted-in actions immediately, while its
        // catalog request — and the account re-read that follows it — wait for
        // the normal timer and cannot race wake protection.
    }

    private func updateRemoteDiagnosticsPolling() {
        deviceActionTask?.cancel()
        deviceActionTask = nil
        guard state == .ready, !systemSleeping,
              AppProfile.defaults.bool(forKey: SettingsKey.remoteDiagnosticsEnabled) else { return }
        deviceActionTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, state == .ready, !systemSleeping else { return }
                await pollDeviceActions()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }

    /// Starts or stops the raw-log upload loop.
    ///
    /// Deliberately not gated on `remoteDiagnosticsEnabled`: that switch governs
    /// the four fixed remote device actions and nothing else, and borrowing it
    /// here would make one consent cover a pipeline it never described. This has
    /// its own switch and its own Settings copy, as does the periodic protection
    /// snapshot below.
    private func updateDiagnosticsLogUploading() {
        let enabled = AppProfile.defaults
            .object(forKey: SettingsKey.networkLogUploadEnabled) == nil
            ? true
            : AppProfile.defaults.bool(forKey: SettingsKey.networkLogUploadEnabled)
        guard state == .ready, !systemSleeping, user != nil, enabled else {
            if let uploader = diagnosticsLogUploader {
                Task { await uploader.stop() }
            }
            return
        }
        if diagnosticsLogUploader == nil {
            let api = self.api
            diagnosticsLogUploader = DiagnosticsLogUploader(
                upload: { payload, sessionID, sequence, lineCount, clientVersion, osVersion in
                    _ = try await api.uploadDiagnosticsLogSegment(
                        payload: payload,
                        sessionID: sessionID,
                        sequence: sequence,
                        lineCount: lineCount,
                        clientVersion: clientVersion,
                        osVersion: osVersion
                    )
                }
            )
        }
        if let uploader = diagnosticsLogUploader {
            Task { await uploader.start() }
        }
    }

    private func abandonDiagnosticsLogUploader() async {
        guard let uploader = diagnosticsLogUploader else { return }
        await uploader.abandonUnsentForAccountSwitch()
        diagnosticsLogUploader = nil
    }

    func networkLogUploadSettingChanged() {
        updateDiagnosticsLogUploading()
    }

    func periodicTelemetrySettingChanged() {
        updatePeriodicTelemetry()
    }

    /// Ops "online" is derived from `POST telemetry/windows`. Windows already
    /// sends this; without it a signed-in Mac never appears on the dashboard.
    ///
    /// Gated on its own switch, like the Windows client's: the window carries
    /// the connection event ring and the whole protection state, which is more
    /// than "this device is online" and more than any other Privacy row on the
    /// Settings screen describes.
    private func updatePeriodicTelemetry() {
        guard state == .ready, !systemSleeping, user != nil,
              Self.isPeriodicTelemetryEnabled else {
            periodicTelemetryTask?.cancel()
            periodicTelemetryTask = nil
            return
        }
        // Sign-in, every settings change, and every wake route through here.
        // Cancelling and restarting on each one turned a 20-minute cadence into
        // an extra window per event, and the account budget is six an hour, so
        // a laptop opened a few times an hour would 429 its own heartbeat.
        guard periodicTelemetryTask == nil else { return }
        periodicTelemetryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(45))
            while !Task.isCancelled {
                guard let self, state == .ready, !systemSleeping else { return }
                await uploadPeriodicTelemetryWindow()
                do { try await Task.sleep(for: .seconds(20 * 60)) } catch { return }
            }
        }
    }

    private func uploadPeriodicTelemetryWindow() async {
        // The switch can be turned off while this task is parked on its sleep,
        // and the cancellation only lands at the next suspension point.
        guard Self.isPeriodicTelemetryEnabled else { return }
        // A sleep cancels the timer and a wake starts a fresh one, so the task
        // being new is not evidence that a window is due. Hold the cadence
        // across restarts rather than spending the hourly budget on them.
        let now = Date()
        if let last = lastPeriodicTelemetryAt,
           now.timeIntervalSince(last) < Self.periodicTelemetryMinimumSpacing {
            return
        }
        lastPeriodicTelemetryAt = now
        let drained = ConnectionTelemetryBuffer.shared.drain()
        let snapshot = diagnosticSnapshotConsumer()
        let nowMs = Int64(now.timeIntervalSince1970 * 1_000)
        let uiState: String
        if snapshot.connected {
            uiState = "connected"
        } else if snapshot.connecting {
            uiState = "connecting"
        } else if snapshot.disconnecting {
            uiState = "disconnecting"
        } else if snapshot.protectionBlocked {
            uiState = "protectedOffline"
        } else {
            uiState = "notConnected"
        }
        #if arch(arm64)
        let osArch = "arm64"
        #elseif arch(x86_64)
        let osArch = "x86_64"
        #else
        let osArch = "unknown"
        #endif
        let path = pathLatencyConsumer()
        let window = TonoTelemetryWindowReport(
            schemaVersion: 1,
            kind: "periodic_window",
            windowStartMs: nowMs - 22 * 60 * 1_000,
            windowEndMs: nowMs,
            appVersion: String(snapshot.appVersion.prefix(40)),
            osVersion: String(
                DiagnosticsLogUploader.compactOperatingSystemVersion().prefix(80)
            ),
            osArch: osArch,
            uiState: uiState,
            accountState: "ready",
            selectedServer: snapshot.selectedExit == "unknown" ? nil : snapshot.selectedExit,
            catalogRevision: snapshot.catalogRevision,
            killSwitchMode: snapshot.killSwitchArmed ? "locked" : "off",
            killSwitchWanted: snapshot.killSwitchArmed || snapshot.connected,
            killSwitchLive: snapshot.killSwitchArmed,
            dnsEnabled: snapshot.protectedDNSConfigured,
            exitDelayMs: path.exitDelayMs,
            tcpDelayMs: path.tcpDelayMs,
            exitDelayAtMs: path.exitDelayAtMs,
            tcpDelayAtMs: path.tcpDelayAtMs,
            eventCount: drained.events.count,
            eventsDropped: drained.dropped,
            events: drained.events
        )
        do {
            _ = try await api.uploadTelemetryWindow(window)
        } catch TonoAPIClient.APIError.unauthorized {
            await fail(
                TonoAPIClient.APIError.unauthorized,
                signsOutOnUnauthorized: true
            )
        } catch {
            // The next cadence retries. This path must not drop protection.
        }
    }

    /// Sends whatever is unsent right now, for the Support page's button, and
    /// reports what the sweep actually did. The three outcomes are materially
    /// different to the person waiting on them — a segment reached support, the
    /// log had not advanced, or the POST was refused — and collapsing them into
    /// "the run finished" left a failed upload indistinguishable from a sent one.
    @discardableResult
    func uploadDiagnosticsLogNow() async -> DiagnosticsLogUploader.SweepOutcome {
        updateDiagnosticsLogUploading()
        // `updateDiagnosticsLogUploading` only builds the uploader once the
        // account, sleep and consent preconditions hold. A nil one is therefore
        // a pipeline that cannot run, never an upload that found nothing.
        guard let uploader = diagnosticsLogUploader else { return .disabled }
        return await uploader.sweep()
    }

    private func updateAppRoutingResearchUploading() {
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        guard state == .ready, !systemSleeping,
              AppRoutingResearch.isCollectionActive, user != nil else { return }
        appRoutingResearchTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, state == .ready, !systemSleeping,
                      AppRoutingResearch.isCollectionActive else { return }
                if let lease = await AppRoutingResearch.shared.readySnapshot() {
                    do {
                        guard !Task.isCancelled,
                              AppRoutingResearch.shared.isCurrent(lease) else {
                            return
                        }
                        let response = try await api.submitAppRoutingResearch(
                            lease.snapshot,
                            ownerHash: lease.ownerHash,
                            isLeaseCurrent: {
                                AppRoutingResearch.shared.isCurrent(lease)
                            }
                        )
                        guard !Task.isCancelled,
                              response.snapshotId == lease.snapshot.snapshotId,
                              AppRoutingResearch.shared.isCurrent(lease) else {
                            return
                        }
                        AppRoutingResearch.shared.acknowledge(lease)
                    } catch TonoAPIClient.APIError.unauthorized {
                        await fail(
                            TonoAPIClient.APIError.unauthorized,
                            signsOutOnUnauthorized: true
                        )
                        return
                    } catch {
                        // The single persisted idempotent pending snapshot is
                        // retried on the next low-frequency check.
                    }
                }
                do { try await Task.sleep(for: .seconds(3_600)) } catch { return }
            }
        }
    }

    private func pollDeviceActions() async {
        guard !systemSleeping else { return }
        do {
            for action in try await api.deviceActions().actions {
                guard !Task.isCancelled, !systemSleeping else { return }
                guard action.expiresAt > Int(Date().timeIntervalSince1970) else {
                    continue
                }
                let result: TonoDeviceActionResult
                switch action.action {
                case .diagnosticSnapshot:
                    result = TonoDeviceActionResult(
                        outcome: "succeeded", message: nil,
                        snapshot: diagnosticSnapshotConsumer(),
                        trafficResearch: nil
                    )
                case .claudeTrafficSnapshot:
                    guard AppProfile.defaults.bool(
                        forKey: SettingsKey.claudeTrafficResearchEnabled
                    ) else {
                        result = TonoDeviceActionResult(
                            outcome: "failed",
                            message: "Claude traffic research is not enabled.",
                            snapshot: nil,
                            trafficResearch: nil
                        )
                        break
                    }
                    result = TonoDeviceActionResult(
                        outcome: "succeeded", message: nil, snapshot: nil,
                        trafficResearch: await claudeTrafficResearchConsumer()
                    )
                case .refreshCatalog:
                    // Support's one remote repair lever must cover the traffic
                    // policy too: a stale policy (WeChat direct pins) was
                    // previously unrepairable remotely.
                    let catalogRefreshed = await refreshManagedCatalog()
                    let policyRefreshed = await refreshManagedTrafficPolicy()
                    let succeeded = catalogRefreshed && policyRefreshed
                    result = TonoDeviceActionResult(
                        outcome: succeeded ? "succeeded" : "failed",
                        message: succeeded ? nil : [
                            catalogRefreshed ? nil : "Managed catalog refresh failed.",
                            policyRefreshed ? nil : "Traffic policy refresh failed.",
                        ].compactMap { $0 }.joined(separator: " "),
                        snapshot: nil,
                        trafficResearch: nil
                    )
                case .retryProtection:
                    guard protectionBlockedConsumer() else {
                        result = TonoDeviceActionResult(
                            outcome: "failed",
                            message: "Protection is not in Protected Offline state.",
                            snapshot: nil,
                            trafficResearch: nil
                        )
                        break
                    }
                    protectedRetryConsumer()
                    result = TonoDeviceActionResult(
                        outcome: "succeeded",
                        message: "Protected retry requested.",
                        snapshot: nil,
                        trafficResearch: nil
                    )
                }
                try await api.submitDeviceActionResult(id: action.id, result: result)
            }
        } catch {
            // A transient control-plane failure is retried by the next pull;
            // delivered actions are replayed by the Worker until completion.
        }
    }

    private func refreshDevicesInBackground() {
        deviceRefreshTask?.cancel()
        deviceRefreshTask = Task { [weak self] in
            guard let self else { return }
            do {
                let refreshed = try await api.devices().devices
                guard !Task.isCancelled else { return }
                devices = refreshed
                device = refreshed.first(where: { $0.current == true })
            } catch {
                // Device management can be retried from account settings. A
                // transient inventory failure must not hold the dashboard.
            }
        }
    }

    private func resumeOrEnrollRuntime() async {
        if !AppProfile.homeExitEnabled {
            await startCloudOnlyRuntime()
            return
        }
        do {
            try await startSidecar(authKey: nil, confirm: false)
        } catch TonoSidecarService.Error.needsEnrollment {
            await beginEnrollment()
        } catch {
            await fail(error)
        }
    }

    private func fail(_ error: Error, signsOutOnUnauthorized: Bool = false) async {
        // Task cancellation is an ownership/lifecycle event, not an account or
        // control-plane failure. In particular, do not turn URLSession -999
        // into a login error or tear down an otherwise protected route.
        guard !(error is CancellationError) else { return }
        // Authenticated but not entitled. Signing out here would replace the
        // real reason with "your session has expired", and the account is not
        // lost, so nothing about the runtime is torn down.
        if let apiError = error as? TonoAPIClient.APIError,
           Self.isEntitlementFailure(apiError) {
            enterEntitlementBlock(detail: apiError.errorDescription)
            return
        }
        let accountLost = signsOutOnUnauthorized
            && error as? TonoAPIClient.APIError == .unauthorized
        // Account loss purges synchronously before the first suspension point;
        // a crash or actor reentrancy can never leave the old account's pending
        // aggregate available to a later session.
        if accountLost {
            deactivateAppRoutingResearch()
            ManagedExitCatalogOwnership.purge()
            await abandonDiagnosticsLogUploader()
        } else {
            pauseAppRoutingResearch()
        }
        runtimeMonitor?.cancel()
        runtimeMonitor = nil
        catalogSyncTask?.cancel()
        catalogSyncTask = nil
        await cancelManagedCatalogRefresh()
        deviceRefreshTask?.cancel()
        deviceRefreshTask = nil
        deviceActionTask?.cancel()
        deviceActionTask = nil
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        periodicTelemetryTask?.cancel()
        periodicTelemetryTask = nil
        await descriptorConsumer(nil)
        // Health / runtime failures keep kill switch; only auth sign-out disarms.
        if accountLost {
            await sidecar.stop()
            await releaseNetworkProtection()
            await api.logout(); clearAccount(); state = .signedOut
        } else {
            // Leave kill switch armed if it was armed — prevents IP leak on failed reconnect.
            state = .error((error as? LocalizedError)?.errorDescription ?? String(localized: "Something went wrong. Please try again."))
        }
    }

    private func pauseAppRoutingResearch() {
        AppRoutingResearch.shared.pause()
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        appRoutingResearchActivationConsumer()
    }

    private func deactivateAppRoutingResearch() {
        AppRoutingResearch.shared.deactivateAndPurge()
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        appRoutingResearchActivationConsumer()
    }

    private func clearAccount() {
        // Managed exits carry this account's own client identity, so they are
        // dropped here rather than being left for the next account to connect
        // with. Idempotent: the logout and account-loss paths already purged.
        ManagedExitCatalogOwnership.purge()
        shouldResumeProtection = false
        user = nil
        device = nil
        enrollment = nil
        devices = []
        enrollmentAuthKey = nil
        enrollmentHostname = nil
        emailChallenge = nil
        deviceActionError = nil
        entitlementDetail = nil
        blockedWhileReady = false
    }
}
