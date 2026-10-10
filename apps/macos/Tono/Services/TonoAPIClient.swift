import Foundation

nonisolated private final class TonoNoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Control-plane endpoints are a fixed origin. Following redirects risks
        // changing the authority of requests carrying access or refresh tokens.
        completionHandler(nil)
    }
}

/// The credentials and the account read revision a request started under
/// (#582). An answer counts for the session only while those credentials are
/// still the current ones.
nonisolated private struct SessionScope: Sendable {
    let generation: UInt64
    let readScope: UInt64
}

/// How one exchange's answer bears on the session (#582). Parity with the
/// Windows `SessionUse`.
nonisolated private enum SessionUse: Sendable {
    /// No session: sign-in and other public endpoints.
    case noSession
    /// A first attempt with the held access token. Its bare 401 only means
    /// the token is stale; the renewal that follows answers for the session.
    case bearer(SessionScope)
    /// `auth/refresh`, or a replay with a freshly renewed token: a 401 here
    /// is the server refusing the session.
    case decisive(SessionScope)
}

/// One caller's wait for a shared token renewal (535R-C-F2), settled exactly
/// once: with the renewal's answer, or with cancellation when the caller is
/// cancelled first, possibly before the continuation is installed.
nonisolated private final class RenewalWait: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, Error>?
    private var outcome: Result<String, Error>?

    func install(_ continuation: CheckedContinuation<String, Error>) {
        lock.lock()
        if let outcome {
            lock.unlock()
            continuation.resume(with: outcome)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func finish(_ result: Result<String, Error>) {
        lock.lock()
        guard outcome == nil else {
            lock.unlock()
            return
        }
        outcome = result
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}

actor TonoAPIClient {
    enum APIError: LocalizedError, Equatable {
        case invalidConfiguration, transport(String), unauthorized, forbidden, notFound
        case deviceLimit, server(status: Int, message: String), invalidResponse
        /// The credential is valid but the account may not use it — disabled,
        /// past its expiry, or at its data allowance. Kept apart from
        /// `unauthorized` so it is neither retried behind a token refresh nor
        /// reported to the user as an expired session.
        case entitlementBlocked(code: String, message: String?)
        /// `auth/email/verify` refused the code: wrong, already used, or past
        /// its validity window. No session is involved, so it must not read
        /// as an expired session (#595).
        case invalidOrExpiredCode
        /// #588: TLS refused the control plane's certificate on its dates, so
        /// this Mac's clock is wrong. No status line arrived: offline
        /// admission reads it as unreachable, but the user is told the clock.
        case clockSkew
        /// H21-O-F8: the system trust store refused the control plane's
        /// certificate for its issuer, chain or name: the network (or local
        /// security software) is intercepting TLS. No status line arrived, so
        /// offline admission reads it as unreachable, like `clockSkew`.
        case tlsIntercepted
        /// No control-plane path answered: which ones ran and how each
        /// failed, for copy that says where it failed (mainland audit). No
        /// status line arrived, so offline admission reads it as unreachable,
        /// like `transport`.
        case unreachable(ControlPlaneUnreachable)
        /// HTTP 503 `EXIT_IDENTITY_PROPAGATING`: this device's exit identity
        /// is not yet acknowledged by every served exit. Transient by design;
        /// a launch without a cached catalog waits and asks again soon.
        case exitIdentityPropagating
        case credentialPersistence
        case credentialRecoveryRecord

        var errorDescription: String? {
            switch self {
            case .invalidConfiguration: String(localized: "Tono service is not configured.")
            case .transport: String(localized: "Could not reach Tono. Check your connection and try again.")
            case .unauthorized: String(localized: "Your session has expired. Please sign in again.")
            case .forbidden: String(localized: "This account does not have permission for that action.")
            case .notFound: String(localized: "The requested item no longer exists.")
            case .deviceLimit: String(localized: "This Tono account has reached its device allowance. Revoke another device first.")
            // Server-provided text is shown verbatim; not a catalog key.
            case let .server(_, message): message
            case .invalidResponse: String(localized: "Tono returned an invalid response.")
            case let .entitlementBlocked(code, _): Self.entitlementDescription(code)
            case .invalidOrExpiredCode: String(localized: "That code is wrong or expired. Request a new one.")
            case .clockSkew: CertificateClock.userMessage
            case .tlsIntercepted: NetworkInterception.userMessage
            case let .unreachable(paths): paths.userMessage
            case .exitIdentityPropagating: String(localized: "Tono is still preparing this Mac's secure identity. Try again in a minute.")
            case .credentialPersistence: String(localized: "Tono could not save your sign-in in Keychain. You are signed out. Check that your login keychain is unlocked, then try again.")
            case .credentialRecoveryRecord: String(localized: "Tono could not update its sign-in recovery record. You are signed out. Check available disk space and Tono's Application Support folder permissions, then try again.")
            }
        }

        /// Localized copy per entitlement reason. The envelope's own message is
        /// English operator text, so it is carried as detail rather than shown.
        private static func entitlementDescription(_ code: String) -> String {
            switch code {
            case "ACCOUNT_EXPIRED":
                String(localized: "This Tono plan has expired. Renew it to keep connecting.")
            case "QUOTA_EXCEEDED":
                String(localized: "This Tono plan has used its full data allowance.")
            default:
                String(localized: "This Tono account is not active. Contact Tono support to restore access.")
            }
        }
    }

    /// Reasons the control plane refuses an authenticated caller for an account
    /// problem rather than a credential problem. `USER_DISABLED` is the only one
    /// it names today — expiry and quota still answer 401 `UNAUTHORIZED`, which
    /// is indistinguishable from a stale access token — so the rest are accepted
    /// ahead of that server change instead of needing another client release.
    static let entitlementCodes: Set<String> = [
        "ACCOUNT_DISABLED",
        "ACCOUNT_EXPIRED",
        "ACCOUNT_SUSPENDED",
        "ENTITLEMENT_REQUIRED",
        "QUOTA_EXCEEDED",
        "USER_DISABLED",
    ]

    private struct APIErrorBody: Decodable { let message: String?; let code: String? }
    private struct ErrorEnvelope: Decodable { let error: APIErrorBody }
    private let baseURL: URL
    /// The control-plane `URLSession`, which resolves the host through the
    /// system resolver.
    private let systemPath: ControlPlanePath
    /// #584: the bundled pinned addresses, tried when the system resolver
    /// fails before any status line.
    private let pinnedPath: ControlPlanePath?
    /// Decision 077: the Tono-owned relays outside Cloudflare, tried when
    /// the system resolver and the pinned addresses both fail before any
    /// status line.
    private let relayPath: ControlPlanePath?
    /// Decision 086: whether protection is armed without a tunnel, when the
    /// relays are the only control-plane path PF admits. Production reads
    /// `KillSwitchService.isArmedWithoutTunnel`; an injected session (tests)
    /// reads false unless a reader is passed.
    private let armedWithoutTunnel: @Sendable () -> Bool
    /// How long a read waits for a status line on a path that has a head
    /// budget (the system resolver) before the walk moves on
    /// (`ControlPlanePath.systemHeadBudget`).
    private let systemHeadBudget: TimeInterval
    /// #584: the label of a later path that answered where the paths before
    /// it failed, so later requests try it first. Cleared when a preferred
    /// attempt fails, is cancelled or its body fails. Kept in the app
    /// profile for a day (`preferredPathKey`), so the next launch on the
    /// same network does not pay the dead paths again before the first
    /// sign-in or refresh; the Windows client remembers per process (#583).
    private var preferredPathLabel: String? {
        didSet {
            preferredPathRevision &+= 1
            persistPreferredPath()
        }
    }
    /// Bumped on every change of `preferredPathLabel`, so a pre-login probe
    /// (backlog A4) that finishes after a real exchange has moved the
    /// preference leaves it alone: an answer outranks a handshake.
    private var preferredPathRevision: UInt64 = 0
    private let preferredPathKey: String
    /// A remembered path older than this is forgotten at launch: the network
    /// that needed it has likely changed.
    private static let preferredPathLifetime: TimeInterval = 24 * 60 * 60
    /// The header naming the path that carries each attempt, so the control
    /// plane can tell a relayed request from one that arrived through an exit
    /// node (decision 077). Values are the path labels.
    static let pathHeader = "X-Tono-Path"
    /// Decision 080: the paths this request already lost on its walk, in
    /// attempt order, comma-separated, on every attempt; present and empty
    /// when none was, which marks this client as reporting. Labels only:
    /// no address, timing, error text or account value.
    static let pathFailedHeader = "X-Tono-Path-Failed"
    /// The labels the control plane reads in either header; any other label
    /// (a test path's) is never reported as lost. Six labels and their
    /// commas fit in 43 characters, under the server's 96.
    nonisolated private static let reportablePathLabels: Set<String> = [
        "pinned", "system_dns", "relay", "doh", "alt_port", "tunnel",
    ]
    private let keychain: KeychainStore
    private var accessToken: String?
    /// A failed credential adoption must not use either account's credentials
    /// in this process; the durable marker also blocks old-item restoration.
    private var failedAdoption = false
    nonisolated private struct RetiredCredential: Sendable {
        let refresh: String?
        let bearer: String?
    }
    private var authenticationPrepared = false
    private var authenticationRetiredCredential: RetiredCredential?
    private var refreshTask: (id: UUID, task: Task<String, Error>)?
    private var logoutTask: (id: UUID, generation: UInt64, task: Task<Void, Never>)?
    private var credentialGeneration: UInt64 = 0
    private var isLoggingOut = false
    /// Expiry of `accessToken`, read from its own `exp` claim.
    ///
    /// Nothing here trusts the claim for security — the server validates the
    /// signature on every request. It is used only to decide when to renew, and
    /// a wrong value costs at most one extra refresh or falls through to the
    /// existing 401 path. Reading it locally is what avoids adding a field to
    /// the token response and waiting for every client to ship it.
    private var accessTokenExpiry: Date?
    /// Renew this far ahead of expiry. The production access TTL is one day;
    /// claims are only a client refresh clock because the server still checks
    /// session, user and device state in D1 on every protected request.
    private static let accessTokenRenewalWindow: TimeInterval = 60
    /// Platform and marketing version on every request, so the control plane
    /// can record which build signs in, refreshes and fetches the catalog even
    /// when no telemetry is sent. Nothing account- or network-specific.
    private static let clientHeader = "macos/" + (
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    )
    /// A rotated refresh token whose keychain write failed. The server has
    /// already invalidated the previous token, so this value must stay usable
    /// in-memory (and be re-persisted at the next opportunity) or the user is
    /// irreversibly logged out by a transient keychain error.
    private var unpersistedRefreshToken: String?
    /// Where every classified server answer about this session goes, and the
    /// writer of the offline grant (#582). Read synchronously by the account
    /// session and by Connect.
    nonisolated let offlineGate: OfflineGrantGate
    /// A19: where a path that failed before the next one ran goes, for the
    /// customer timeline. The account session opens it (`admit`) only while a
    /// verified account is ready and the timeline switch is on.
    nonisolated let controlPlanePathTimeline: ControlPlanePathTimeline

    init(
        baseURL: URL = TonoAPIClient.configuredBaseURL(),
        keychain: KeychainStore = KeychainStore(),
        session: URLSession? = nil,
        offlineGate: OfflineGrantGate = OfflineGrantGate(directory: ConfigStorage.shared.appSupportDirectory),
        pinnedPath: ControlPlanePath? = nil,
        relayPath: ControlPlanePath? = nil,
        systemHandshake: (@Sendable () async -> Bool)? = nil,
        controlPlanePathTimeline: ControlPlanePathTimeline = ControlPlanePathTimeline(),
        armedWithoutTunnel: (@Sendable () -> Bool)? = nil,
        systemHeadBudget: TimeInterval = ControlPlanePath.systemHeadBudget
    ) {
        self.baseURL = baseURL
        self.systemHeadBudget = systemHeadBudget
        self.keychain = keychain
        self.offlineGate = offlineGate
        self.controlPlanePathTimeline = controlPlanePathTimeline
        let urlSession = session ?? URLSession(
            configuration: Self.controlPlaneSessionConfiguration(),
            delegate: TonoNoRedirectDelegate(),
            delegateQueue: nil
        )
        var system = ControlPlanePath.systemResolver(urlSession)
        // Backlog A4: an injected session (tests) has no handshake unless one
        // is passed.
        system.handshake = systemHandshake
            ?? (session == nil ? ControlPlanePath.systemResolverHandshake(for: baseURL) : nil)
        systemPath = system
        // #584: production falls back to the pinned addresses. An injected
        // session (tests) has none unless one is passed.
        self.pinnedPath = pinnedPath
            ?? (session == nil ? ControlPlanePath.pinnedAddresses(for: baseURL) : nil)
        self.relayPath = relayPath
            ?? (session == nil ? ControlPlanePath.relays(for: baseURL) : nil)
        let protectionReader: @Sendable () -> Bool = { KillSwitchService.isArmedWithoutTunnel }
        let fixtureReader: @Sendable () -> Bool = { false }
        self.armedWithoutTunnel = armedWithoutTunnel
            ?? (session == nil ? protectionReader : fixtureReader)
        preferredPathKey = Self.preferredPathKey(forHost: baseURL.host ?? "")
        preferredPathLabel = Self.loadPreferredPath(key: preferredPathKey)
    }

    /// The app-profile key under which the remembered path for `host` lives.
    nonisolated static func preferredPathKey(forHost host: String) -> String {
        "controlPlanePreferredPath:" + host.lowercased()
    }

    /// The remembered path label, or nil when none was stored, it is older
    /// than `preferredPathLifetime`, or it names no path this client has.
    nonisolated private static func loadPreferredPath(key: String) -> String? {
        guard let stored = AppProfile.defaults.dictionary(forKey: key),
              let label = stored["label"] as? String,
              let at = stored["at"] as? Double,
              Date().timeIntervalSince1970 - at < preferredPathLifetime,
              Date().timeIntervalSince1970 >= at else { return nil }
        return label
    }

    private func persistPreferredPath() {
        if let preferredPathLabel {
            AppProfile.defaults.set(
                ["label": preferredPathLabel, "at": Date().timeIntervalSince1970],
                forKey: preferredPathKey
            )
        } else {
            AppProfile.defaults.removeObject(forKey: preferredPathKey)
        }
    }

    /// Backlog A4 (D14-A, decision 079): the pre-login network self-check.
    /// Handshakes every path in parallel (`ControlPlanePath.handshake`: TCP
    /// and TLS only, no request, nothing identifying, at most
    /// `ControlPlaneHandshake.budget` each) and makes the first path in the
    /// usual order that completed one the remembered path, exactly as if a
    /// request had answered there: kept in the app profile for
    /// `preferredPathLifetime` and tried first by the next sign-in. The
    /// system resolver completing puts the usual order back. Nothing reached,
    /// or a path that cannot be probed ahead of the first one that was, says
    /// nothing and leaves the preference as it was, as does a real exchange
    /// that moved it while the probe ran. The walk itself is unchanged: a
    /// preferred path that fails hands over to the usual order under the same
    /// retry rule, so a request that may have arrived is never sent again.
    func probePathsBeforeSignIn() async {
        let paths = [systemPath] + [pinnedPath, relayPath].compactMap { $0 }
        guard paths.count > 1 else { return }
        let revision = preferredPathRevision
        let startedAt = Date()
        let reached: [Bool?] = await withTaskGroup(of: (Int, Bool?).self) { group in
            for (index, path) in paths.enumerated() {
                let handshake = path.handshake
                group.addTask {
                    let result = await handshake?()
                    return (index, result)
                }
            }
            var results = [Bool?](repeating: nil, count: paths.count)
            for await (index, result) in group { results[index] = result }
            return results
        }
        var details = ["duration_ms": Self.durationMilliseconds(since: startedAt)]
        for (path, result) in zip(paths, reached) {
            details[path.label] = result.map { $0 ? "reached" : "failed" } ?? "not_probed"
        }
        var winner: Int?
        for (index, result) in reached.enumerated() {
            guard let result else { break }
            if result {
                winner = index
                break
            }
        }
        let adopted = winner != nil && revision == preferredPathRevision
        details["adopted"] = adopted ? paths[winner ?? 0].label : "none"
        LocalTrafficAudit.shared.recordEvent("control_plane_path_probe", details: details)
        guard adopted, let winner else { return }
        preferredPathLabel = winner == 0 ? nil : paths[winner].label
    }

    /// The production control-plane session configuration. An injected
    /// session (tests) is used as given.
    nonisolated static func controlPlaneSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        // Mainland cross-border paths can take several seconds to recover
        // DNS, TLS, or connectivity. Keep the wait bounded, but do not
        // turn a short network transition into an immediate login error.
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        configuration.waitsForConnectivity = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        // #587: no system proxy or PAC. Another app's local proxy set as the
        // system proxy would carry account calls, and PF blocks its upstream
        // in Protected Offline. Windows uses no_proxy for the same reason.
        configuration.connectionProxyDictionary = [:]
        return configuration
    }

    nonisolated static func configuredBaseURL(bundle: Bundle = .main, environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        #if DEBUG
        if let override = environment["TONO_API_BASE_URL"], let url = URL(string: override) { return url }
        #endif
        if let value = bundle.object(forInfoDictionaryKey: "TonoAPIBaseURL") as? String, let url = URL(string: value) { return url }
        return URL(string: "https://api.tono.invalid")!
    }

    func authMethods() async throws -> TonoAuthMethodsResponse {
        try await publicGet("auth/methods")
    }
    func startEmailSignIn(_ body: TonoEmailStartRequest) async throws -> TonoEmailChallengeResponse {
        try await publicRequest("auth/email/start", body: body)
    }
    func verifyEmailSignIn(_ body: TonoEmailVerifyRequest) async throws -> TonoAuthResponse {
        try await publicAuthRequest("auth/email/verify", body: body)
    }
    func oidcChallenge(_ body: TonoOIDCChallengeRequest) async throws -> TonoOIDCChallengeResponse {
        try await publicRequest("auth/oidc/challenge", body: body)
    }
    func verifyOIDC(_ body: TonoOIDCVerifyRequest) async throws -> TonoAuthResponse {
        try await publicAuthRequest("auth/oidc/verify", body: body)
    }
    func me() async throws -> TonoMeResponse { try await authorizedRequest("me", method: "GET") }
    func devices() async throws -> TonoDevicesResponse { try await authorizedRequest("devices", method: "GET") }
    func exitCatalog() async throws -> TonoExitCatalogResponse {
        try await authorizedRequest(
            "exit-catalog",
            method: "GET",
            bodyData: nil,
            additionalHeaders: ["X-Tono-Accept": "hy2"]
        )
    }
    func trafficPolicy() async throws -> TonoTrafficPolicyResponse {
        try await authorizedRequest("traffic-policy", method: "GET")
    }
    func deviceActions() async throws -> TonoDeviceActionsResponse {
        try await authorizedRequest("device-actions", method: "GET")
    }
    func submitAppRoutingResearch(
        _ snapshot: TonoAppRoutingResearchSnapshot,
        ownerHash: String,
        isLeaseCurrent: @escaping @Sendable () -> Bool
    ) async throws -> TonoAppRoutingResearchResponse {
        guard ownerHash.range(
            of: #"^[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil else { throw APIError.invalidResponse }
        return try await authorizedRequest(
            "routing-research/snapshots",
            method: "POST",
            body: snapshot,
            additionalHeaders: ["X-Tono-Routing-Owner": ownerHash],
            requestIsCurrent: isLeaseCurrent
        )
    }
    /// Uploads one gzip segment of the local audit log.
    ///
    /// The body is compressed bytes, not JSON: a base64 envelope would inflate
    /// every segment by a third, and these are the largest uploads the client
    /// makes. `additionalHeaders` is applied after the JSON content type is set,
    /// so declaring gzip here replaces it rather than adding a second value.
    func uploadDiagnosticsLogSegment(
        payload: Data,
        sessionID: String,
        sequence: Int,
        lineCount: Int,
        clientVersion: String,
        osVersion: String,
        requestIsCurrent: (@Sendable () -> Bool)? = nil
    ) async throws -> TonoDiagnosticsLogSegmentResponse {
        let receipt: TonoDiagnosticsLogSegmentResponse = try await authorizedRequest(
            "diagnostics/logs",
            method: "POST",
            bodyData: payload,
            additionalHeaders: [
                "Content-Type": "application/gzip",
                "X-Tono-Log-Session": sessionID,
                "X-Tono-Log-Sequence": String(sequence),
                "X-Tono-Log-Lines": String(lineCount),
                "X-Tono-Log-Client-Version": clientVersion,
                "X-Tono-Log-Os-Version": osVersion,
            ],
            requestIsCurrent: requestIsCurrent
        )
        guard receipt.wasStored else { throw DiagnosticsLogNotStoredError() }
        return receipt
    }

    func uploadTelemetryWindow(
        _ window: TonoTelemetryWindowReport
    ) async throws -> TonoTelemetryWindowReceipt {
        try await authorizedRequest(
            "telemetry/windows",
            method: "POST",
            body: TonoTelemetryWindowRequest(window: window)
        )
    }

    /// Repost a saved telemetry body on the pinned client. `path` is one of the
    /// two telemetry routes; this does not post anywhere else.
    func uploadSavedTelemetry(path: String, body: Data) async throws {
        // Empty struct: JSONDecoder ignores keys that are not declared.
        guard path == "telemetry/failures" || path == "telemetry/diagnostics" else { return }
        let _: TonoEmptyObject = try await authorizedRequest(path, method: "POST", bodyData: body)
    }

    func reportConnectFailure(
        _ report: TonoConnectFailureReport,
        requestIsCurrent: (@Sendable () -> Bool)? = nil
    ) async throws -> TonoConnectFailureReceipt {
        try await authorizedRequest(
            "telemetry/failures", method: "POST", body: report,
            requestIsCurrent: requestIsCurrent
        )
    }

    func uploadSupportReport(
        _ request: TonoSupportReportRequest,
        requestIsCurrent: @escaping @Sendable () -> Bool
    ) async throws -> TonoSupportReceipt {
        let receipt: TonoSupportReceipt = try await authorizedRequest(
            "diagnostics/reports", method: "POST", body: request,
            requestIsCurrent: requestIsCurrent
        )
        try Self.requireCurrent(requestIsCurrent)
        guard !receipt.referenceCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              receipt.referenceCode.count <= 100,
              !receipt.referenceCode.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw APIError.invalidResponse }
        return receipt
    }

    func submitDeviceActionResult(id: String, result: TonoDeviceActionResult) async throws {
        let validID = try validatedDeviceID(id)
        let _: TonoDeviceActionResultResponse = try await authorizedRequest(
            "device-actions/\(validID)/result", method: "POST", body: result
        )
    }
    func revokeDevice(_ id: String) async throws { try await authorizedVoid("devices/\(try validatedDeviceID(id))", method: "DELETE") }
    func enrollment(deviceId: String, installationId: String) async throws -> TonoEnrollmentResponse {
        try await authorizedRequest("devices/\(try validatedDeviceID(deviceId))/enrollment", method: "POST", body: TonoEnrollmentRequest(installationId: installationId))
    }
    func confirm(deviceId: String, identity: TonoNodeIdentity) async throws -> TonoConfirmResponse {
        try await authorizedRequest(
            "devices/\(try validatedDeviceID(deviceId))/confirm",
            method: "POST",
            body: TonoConfirmRequest(
                stableNodeId: identity.stableNodeId,
                nodeId: identity.nodeId,
                publicKey: identity.publicKey,
                tailscaleIPs: identity.tailscaleIPs
            )
        )
    }

    /// Invalidate recovery before the verification callback can rebind a device
    /// server-side. A failure here aborts authentication before that mutation.
    func prepareForAuthentication() async throws {
        try Task.checkCancellation()
        let previous = authenticationRetiredCredential ?? captureCredentialForRevocation()
        retireCredentialGeneration()
        offlineGate.withdrawAcceptance()
        offlineGate.leaveOffline()
        accessToken = nil
        accessTokenExpiry = nil
        unpersistedRefreshToken = nil
        failedAdoption = true
        do { try keychain.suppressRefreshTokenRestoration() }
        catch {
            try? keychain.remove(.refreshToken)
            await revokeCapturedCredential(previous, generation: credentialGeneration)
            throw APIError.credentialRecoveryRecord
        }
        authenticationPrepared = true
        authenticationRetiredCredential = previous
    }

    func adopt(_ auth: TonoAuthResponse) async throws {
        try Task.checkCancellation()
        guard let refresh = auth.refreshToken, !refresh.isEmpty else {
            throw APIError.invalidResponse
        }
        let previous = authenticationRetiredCredential ?? captureCredentialForRevocation()
        retireCredentialGeneration()
        // Nothing the server told the previous identity applies to this one.
        offlineGate.adoptNewIdentity()
        accessToken = nil
        accessTokenExpiry = nil
        unpersistedRefreshToken = nil
        failedAdoption = true
        // Record suppression before touching Keychain. If replacement and
        // deletion both fail, the old item remains unreadable on relaunch.
        do { try keychain.suppressRefreshTokenRestoration() }
        catch {
            try? keychain.remove(.refreshToken)
            await revokeCapturedCredential(previous, generation: credentialGeneration)
            throw APIError.credentialRecoveryRecord
        }
        do { try keychain.set(refresh, for: .refreshToken) }
        catch {
            try? keychain.remove(.refreshToken)
            await revokeCapturedCredential(previous, generation: credentialGeneration)
            throw APIError.credentialPersistence
        }
        do {
            try keychain.recordAcceptedRefreshToken(refresh)
            try keychain.clearRefreshTokenSuppression()
        }
        catch {
            try? keychain.remove(.refreshToken)
            await revokeCapturedCredential(previous, generation: credentialGeneration)
            throw APIError.credentialRecoveryRecord
        }
        failedAdoption = false
        accessToken = auth.accessToken
        accessTokenExpiry = Self.expiry(ofJWT: auth.accessToken)
    }

    /// `exp` from a JWT payload, or nil when the token is not a readable JWT.
    ///
    /// Returning nil disables proactive renewal for that token rather than
    /// guessing a lifetime: the 401 path still works, so an unreadable token
    /// degrades to the previous behaviour instead of to a wrong deadline.
    nonisolated static func expiry(ofJWT token: String) -> Date? {
        let segments = token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3 else { return nil }
        var encoded = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // base64url drops the padding a strict decoder still requires.
        if encoded.count % 4 != 0 {
            encoded += String(repeating: "=", count: 4 - encoded.count % 4)
        }
        guard let data = Data(base64Encoded: encoded),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? Double,
              exp.isFinite, exp > 0 else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    /// The token to send, renewed first when it is about to expire.
    ///
    /// Every authorized path went through the same `if let accessToken` dance,
    /// which used a token right up to its final second and then paid for a 401.
    private func currentAccessToken() async throws -> String {
        retryRefreshTokenPersistence()
        if let accessToken {
            guard let expiry = accessTokenExpiry else { return accessToken }
            if expiry.timeIntervalSinceNow > Self.accessTokenRenewalWindow {
                return accessToken
            }
            // Expired or nearly so: drop it first, so a refresh failure cannot
            // leave a stale token in place to be retried forever.
            self.accessToken = nil
            accessTokenExpiry = nil
        }
        return try await refreshAccessToken()
    }

    func logout() async {
        if let current = logoutTask, current.generation == credentialGeneration {
            await current.task.value
            return
        }
        let id = UUID()
        let generation = credentialGeneration
        // Block ordinary requests immediately, but allow a refresh already
        // rotating this account to finish so logout can revoke its newest token.
        isLoggingOut = true
        let task = Task { await performLogout(generation: generation) }
        logoutTask = (id, generation, task)
        await task.value
        if logoutTask?.id == id { logoutTask = nil }
    }

    private func performLogout(generation: UInt64) async {
        guard generation == credentialGeneration else { return }
        if let pending = refreshTask { _ = try? await pending.task.value }
        guard generation == credentialGeneration else { return }
        // Revoke server-side whenever a refresh token exists, even without a
        // live access token — deleting only the local copy leaves a valid
        // credential orphaned server-side. The body is re-encoded per attempt:
        // a 401-triggered refresh rotates the token, and revoking the
        // pre-rotation value would orphan the freshly rotated one instead.
        // A token that cannot be read cannot be revoked; local deletion below
        // is all that remains, as before.
        if (try? currentRefreshToken()) != nil {
            let scope = SessionScope(generation: generation, readScope: offlineGate.readScope)
            do {
                let token: String
                if let accessToken {
                    token = accessToken
                } else {
                    token = try await refreshAccessToken()
                }
                guard generation == credentialGeneration else { return }
                do {
                    try await sendLogout(bearer: token, session: .bearer(scope))
                } catch APIError.unauthorized {
                    guard generation == credentialGeneration else { return }
                    let renewed = try await accessTokenAfterUnauthorized(token)
                    guard generation == credentialGeneration else { return }
                    try await sendLogout(bearer: renewed, session: .decisive(scope))
                }
            } catch {
                // Refresh or revoke failed: the token is already dead
                // server-side or the network is gone. Local deletion is all
                // that remains either way.
            }
        }
        // A new sign-in may have been adopted while server revocation waited.
        // The old logout may finish remotely, but does not own those credentials.
        guard generation == credentialGeneration else { return }
        retireCredentialGeneration()
        accessToken = nil
        accessTokenExpiry = nil
        unpersistedRefreshToken = nil
        try? keychain.remove(.refreshToken)
    }

    private func retireCredentialGeneration() {
        credentialGeneration &+= 1
        authenticationPrepared = false
        authenticationRetiredCredential = nil
        refreshTask?.task.cancel()
        refreshTask = nil
        isLoggingOut = false
    }

    /// Captured only for best-effort deletion, never for ordinary admission.
    private func captureCredentialForRevocation() -> RetiredCredential {
        RetiredCredential(refresh: unpersistedRefreshToken ?? (try? keychain.string(for: .refreshToken)),
                          bearer: accessToken)
    }

    private func revokeCapturedCredential(_ previous: RetiredCredential, generation: UInt64) async {
        guard !Task.isCancelled else { return }
        // Best-effort remote cleanup must not hold the local failure screen
        // through the transport's full resource timeout. Cancel and drain it
        // here, rather than leave a logout racing the next authentication.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.performCapturedCredentialRevocation(previous, generation: generation) }
            group.addTask { try? await Task.sleep(for: .seconds(2)) }
            _ = await group.next()
            group.cancelAll()
        }
    }

    private func performCapturedCredentialRevocation(_ previous: RetiredCredential, generation: UInt64) async {
        guard let refresh = previous.refresh, !refresh.isEmpty,
              generation == credentialGeneration, !Task.isCancelled else { return }
        do {
            if let bearer = previous.bearer {
                do {
                    _ = try await sendData("auth/logout", method: "POST",
                        body: TonoCoding.encoder().encode(TonoLogoutRequest(refreshToken: refresh)),
                        bearer: bearer, session: .noSession)
                    return
                } catch APIError.unauthorized { }
            }
            guard generation == credentialGeneration, !Task.isCancelled else { return }
            let renewed: TonoTokenResponse = try await publicRequest("auth/refresh",
                body: TonoRefreshRequest(refreshToken: refresh), session: .noSession)
            guard generation == credentialGeneration, !Task.isCancelled else { return }
            _ = try await sendData("auth/logout", method: "POST",
                body: TonoCoding.encoder().encode(TonoLogoutRequest(refreshToken: renewed.refreshToken)),
                bearer: renewed.accessToken, session: .noSession)
        } catch {
            // Local recovery remains denied even when the server is unreachable.
        }
    }

    private func requireCredentialGeneration(_ generation: UInt64) throws {
        guard !Task.isCancelled, generation == credentialGeneration else {
            throw CancellationError()
        }
    }

    private func requireAuthenticatedRequest(_ generation: UInt64) throws {
        try requireCredentialGeneration(generation)
        guard !isLoggingOut else { throw CancellationError() }
    }

    private func sendLogout(bearer: String, session: SessionUse) async throws {
        let body = try TonoCoding.encoder().encode(
            TonoLogoutRequest(refreshToken: try? currentRefreshToken())
        )
        _ = try await sendData(
            "auth/logout", method: "POST", body: body, bearer: bearer, session: session
        )
    }

    /// The freshest usable refresh token: a rotated-but-unpersisted value
    /// always wins over the keychain copy it failed to replace.
    ///
    /// Only a missing item means there is no session. Any other keychain
    /// status (a locked login keychain, interaction not allowed) is thrown as
    /// the local, retryable read failure it is. Reported as nil, it became
    /// `.unauthorized` without asking the server, which suspends or signs out
    /// an account the server never refused.
    private func currentRefreshToken() throws -> String? {
        guard !failedAdoption else { return nil }
        guard try !keychain.isRefreshTokenRestorationSuppressed() else { return nil }
        if let pending = unpersistedRefreshToken { return pending }
        guard let stored = try keychain.string(for: .refreshToken) else { return nil }
        return try keychain.hasAcceptedRefreshToken(stored) ? stored : nil
    }

    /// A launch restores only a credential this process has not discarded.
    func hasRestorableSession() throws -> Bool {
        retryRefreshTokenPersistence()
        return try currentRefreshToken() != nil
    }

    private func retryRefreshTokenPersistence() {
        if let pending = unpersistedRefreshToken,
           (try? keychain.set(pending, for: .refreshToken)) != nil {
            if (try? keychain.recordAcceptedRefreshToken(pending)) != nil {
                unpersistedRefreshToken = nil
            }
        }
    }

    /// Exit starts no request, but a shared renewal can outlive its cancelled
    /// caller. Save its successor before losing the in-memory replacement.
    /// The app's termination deadline bounds this wait after network cleanup.
    func finishCredentialPersistence(renewalObserved: (@Sendable () -> Void)? = nil) async {
        if let pending = refreshTask {
            renewalObserved?()
            _ = await pending.task.result
        }
        retryRefreshTokenPersistence()
    }

    /// A delayed 401 must not rotate the session that superseded its bearer.
    private func accessTokenAfterUnauthorized(_ bearer: String) async throws -> String {
        if let accessToken, accessToken != bearer { return accessToken }
        if let refreshTask { return try await Self.awaitRenewal(refreshTask.task) }
        // Still current, or already dropped with no renewal running: renew as before.
        accessToken = nil
        accessTokenExpiry = nil
        return try await refreshAccessToken()
    }

    private func refreshAccessToken() async throws -> String {
        if let refreshTask { return try await Self.awaitRenewal(refreshTask.task) }
        let id = UUID()
        let generation = credentialGeneration
        let scope = SessionScope(generation: generation, readScope: offlineGate.readScope)
        let task = Task<String, Error> {
            // The slot is released when the renewal ends, not when its caller
            // stops waiting: a second renewal beside it would send the refresh
            // token this one is rotating (535R-C-F2).
            defer { if refreshTask?.id == id { refreshTask = nil } }
            try requireCredentialGeneration(generation)
            retryRefreshTokenPersistence()
            guard let refresh = try currentRefreshToken() else { throw APIError.unauthorized }
            // The renewal answers for the session: its 401 is the server refusing it.
            let response: TonoTokenResponse = try await publicRequest(
                "auth/refresh",
                body: TonoRefreshRequest(refreshToken: refresh),
                session: .decisive(scope)
            )
            try requireCredentialGeneration(generation)
            accessToken = response.accessToken
            accessTokenExpiry = Self.expiry(ofJWT: response.accessToken)
            do {
                try keychain.set(response.refreshToken, for: .refreshToken)
                try keychain.recordAcceptedRefreshToken(response.refreshToken)
                unpersistedRefreshToken = nil
            } catch {
                // The server has already rotated; dropping the new token here
                // would be an irreversible logout. Keep it usable in-memory
                // and retry persistence on ordinary reads and before exit.
                unpersistedRefreshToken = response.refreshToken
            }
            return response.accessToken
        }
        refreshTask = (id, task)
        return try await Self.awaitRenewal(task)
    }

    /// 535R-C-F2: every caller that needs a renewal shares one, and it runs
    /// to the end even when they stop waiting: the server rotates the refresh
    /// token on the way, and dropping its answer would sign the user out. A
    /// cancelled caller stops waiting at once (Restore internet and sign-out
    /// cancel account work, then wait for it) and leaves the renewal running.
    nonisolated private static func awaitRenewal(_ renewal: Task<String, Error>) async throws -> String {
        try Task.checkCancellation()
        let wait = RenewalWait()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
                wait.install(continuation)
                Task {
                    let result = await renewal.result
                    wait.finish(result)
                }
            }
        } onCancel: {
            wait.finish(.failure(CancellationError()))
        }
    }

    private func publicRequest<Response: Decodable, Body: Encodable>(
        _ path: String, body: Body, session: SessionUse = .noSession
    ) async throws -> Response {
        try await send(path, method: "POST", body: TonoCoding.encoder().encode(body), bearer: nil, session: session)
    }
    private func publicGet<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(path, method: "GET", body: nil, bearer: nil, session: .noSession)
    }
    private func publicAuthRequest<Body: Encodable>(_ path: String, body: Body) async throws -> TonoAuthResponse {
        if !authenticationPrepared { try await prepareForAuthentication() }
        let envelope: TonoAuthEnvelope = try await publicRequest(path, body: body)
        return envelope.auth
    }
    private func authorizedRequest<Response: Decodable>(_ path: String, method: String) async throws -> Response {
        try await authorizedRequest(path, method: method, bodyData: nil)
    }
    private func authorizedRequest<Response: Decodable, Body: Encodable>(
        _ path: String,
        method: String,
        body: Body,
        additionalHeaders: [String: String] = [:],
        requestIsCurrent: (@Sendable () -> Bool)? = nil
    ) async throws -> Response {
        try await authorizedRequest(
            path,
            method: method,
            bodyData: TonoCoding.encoder().encode(body),
            additionalHeaders: additionalHeaders,
            requestIsCurrent: requestIsCurrent
        )
    }
    private func authorizedRequest<Response: Decodable>(
        _ path: String,
        method: String,
        bodyData: Data?,
        additionalHeaders: [String: String] = [:],
        requestIsCurrent: (@Sendable () -> Bool)? = nil
    ) async throws -> Response {
        let generation = credentialGeneration
        let scope = SessionScope(generation: generation, readScope: offlineGate.readScope)
        try requireAuthenticatedRequest(generation)
        try Self.requireCurrent(requestIsCurrent)
        let token = try await currentAccessToken()
        try requireAuthenticatedRequest(generation)
        try Self.requireCurrent(requestIsCurrent)
        do {
            try Self.requireCurrent(requestIsCurrent)
            let response: Response = try await send(
                path,
                method: method,
                body: bodyData,
                bearer: token,
                session: .bearer(scope),
                additionalHeaders: additionalHeaders,
                requestIsCurrent: requestIsCurrent
            )
            try requireAuthenticatedRequest(generation)
            return response
        }
        catch APIError.unauthorized {
            try requireAuthenticatedRequest(generation)
            try Self.requireCurrent(requestIsCurrent)
            let renewed = try await accessTokenAfterUnauthorized(token)
            try requireAuthenticatedRequest(generation)
            try Self.requireCurrent(requestIsCurrent)
            do {
                let response: Response = try await send(
                    path,
                    method: method,
                    body: bodyData,
                    bearer: renewed,
                    session: .decisive(scope),
                    additionalHeaders: additionalHeaders,
                    requestIsCurrent: requestIsCurrent
                )
                try requireAuthenticatedRequest(generation)
                return response
            } catch {
                try requireAuthenticatedRequest(generation)
                throw error
            }
        } catch {
            try requireAuthenticatedRequest(generation)
            throw error
        }
    }
    private func authorizedVoid(_ path: String, method: String) async throws {
        let generation = credentialGeneration
        let scope = SessionScope(generation: generation, readScope: offlineGate.readScope)
        try requireAuthenticatedRequest(generation)
        let token = try await currentAccessToken()
        try requireAuthenticatedRequest(generation)
        do { _ = try await sendData(path, method: method, body: nil, bearer: token, session: .bearer(scope)) }
        catch APIError.unauthorized {
            try requireAuthenticatedRequest(generation)
            let renewed = try await accessTokenAfterUnauthorized(token)
            try requireAuthenticatedRequest(generation)
            _ = try await sendData(path, method: method, body: nil, bearer: renewed, session: .decisive(scope))
        }
        try requireAuthenticatedRequest(generation)
    }
    private func authorizedVoid<Body: Encodable>(_ path: String, method: String, body: Body) async throws {
        let generation = credentialGeneration
        let scope = SessionScope(generation: generation, readScope: offlineGate.readScope)
        try requireAuthenticatedRequest(generation)
        let token = try await currentAccessToken()
        try requireAuthenticatedRequest(generation)
        let bodyData = try TonoCoding.encoder().encode(body)
        do { _ = try await sendData(path, method: method, body: bodyData, bearer: token, session: .bearer(scope)) }
        catch APIError.unauthorized {
            try requireAuthenticatedRequest(generation)
            let renewed = try await accessTokenAfterUnauthorized(token)
            try requireAuthenticatedRequest(generation)
            _ = try await sendData(path, method: method, body: bodyData, bearer: renewed, session: .decisive(scope))
        }
        try requireAuthenticatedRequest(generation)
    }

    private func send<Response: Decodable>(
        _ path: String,
        method: String,
        body: Data?,
        bearer: String?,
        session: SessionUse,
        additionalHeaders: [String: String] = [:],
        requestIsCurrent: (@Sendable () -> Bool)? = nil
    ) async throws -> Response {
        let data = try await sendData(
            path,
            method: method,
            body: body,
            bearer: bearer,
            session: session,
            additionalHeaders: additionalHeaders,
            requestIsCurrent: requestIsCurrent
        )
        do { return try TonoCoding.decoder().decode(Response.self, from: data.isEmpty ? Data("{}".utf8) : data) }
        catch { throw APIError.invalidResponse }
    }
    private func sendData(
        _ path: String,
        method: String,
        body: Data?,
        bearer: String?,
        session: SessionUse,
        additionalHeaders: [String: String] = [:],
        requestIsCurrent: (@Sendable () -> Bool)? = nil,
        retryStaleBearer: Bool = true
    ) async throws -> Data {
        let validOrigin: Bool
        #if DEBUG
        validOrigin = {
            guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
                  let scheme = components.scheme?.lowercased(),
                  let host = components.host?.lowercased() else { return false }
            return (scheme == "https" && (components.port == nil || components.port == 443)) ||
                (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
        }()
        #else
        validOrigin = {
            guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
                  components.scheme?.lowercased() == "https" else { return false }
            return components.port == nil || components.port == 443
        }()
        #endif
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              validOrigin
        else { throw APIError.invalidConfiguration }
        let requestStartedAt = Date()
        // A19: taken once per request, so its path failures join the timeline
        // only under the account and consent it started with.
        let pathTimelineTicket = controlPlanePathTimeline.ticket()
        let auditDetails = [
            "method": method,
            "endpoint": path,
            "host": baseURL.host ?? "invalid",
        ]
        LocalTrafficAudit.shared.recordEvent(
            "control_plane_request_started",
            details: auditDetails
        )
        var request = URLRequest(url: baseURL.appending(path: "api/v1/\(path)")); request.httpMethod = method; request.httpBody = body
        // Tono rejects unlisted UDP. HTTP/3 would try QUIC and surface as a
        // TLS/timeout failure from China while TCP HTTPS still works.
        request.assumesHTTP3Capable = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.clientHeader, forHTTPHeaderField: "X-Tono-Client")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        for (field, value) in additionalHeaders {
            request.setValue(value, forHTTPHeaderField: field)
        }
        let maximumAttempts = 2
        for attempt in 1...maximumAttempts {
            try Self.requireCurrent(requestIsCurrent)
            let answer: ControlPlaneAnswer
            let pathLabel: String
            do {
                (answer, pathLabel) = try await exchangeOverPaths(
                    request,
                    method: method,
                    auditDetails: auditDetails,
                    pathTimelineTicket: pathTimelineTicket,
                    requestIsCurrent: requestIsCurrent
                )
            } catch ControlPlaneExchangeError.invalidResponse {
                throw APIError.invalidResponse
            } catch {
                try await handleTransportFailure(
                    error,
                    method: method,
                    attempt: attempt,
                    maximumAttempts: maximumAttempts,
                    requestStartedAt: requestStartedAt,
                    auditDetails: auditDetails
                )
                continue
            }
            let status = answer.status
            let data = answer.body
            // A renewal revokes the predecessor SID. Its delayed 401, even on
            // a decisive replay's transport retry, says nothing about the
            // replacement session and must not reach the verdict sink.
            if status == 401, let bearer, bearer != accessToken {
                switch session {
                case .noSession:
                    break
                case let .bearer(scope), let .decisive(scope):
                    try requireCredentialGeneration(scope.generation)
                    try Self.requireCurrent(requestIsCurrent)
                    if let failure = answer.bodyFailure, Self.isCancellation(failure) {
                        throw CancellationError()
                    }
                    // The first attempt's existing handler replays with the
                    // newer token, including an entitlement-coded stale 401.
                    if case .bearer = session { throw APIError.unauthorized }
                    guard retryStaleBearer else { throw CancellationError() }
                    let current = try await accessTokenAfterUnauthorized(bearer)
                    try requireCredentialGeneration(scope.generation)
                    try Self.requireCurrent(requestIsCurrent)
                    return try await sendData(
                        path, method: method, body: body, bearer: current, session: session,
                        additionalHeaders: additionalHeaders,
                        requestIsCurrent: requestIsCurrent, retryStaleBearer: false
                    )
                }
            }
            if let failure = answer.bodyFailure {
                guard !(200..<300).contains(status) else {
                    try await handleTransportFailure(
                        failure,
                        method: method,
                        attempt: attempt,
                        maximumAttempts: maximumAttempts,
                        requestStartedAt: requestStartedAt,
                        auditDetails: auditDetails,
                        httpStatus: status
                    )
                    continue
                }
                // #582: a non-2xx status line is the server's answer even when
                // its body is cut off. It is classified from what arrived and
                // thrown as that status below, never as an unreachable control
                // plane that offline admission accepts.
                if Self.isCancellation(failure) {
                    reportSessionAnswer(status: status, body: data, session: session)
                    throw CancellationError()
                }
            }
            reportSessionAnswer(status: status, body: data, session: session)
            guard (200..<300).contains(status) else {
                var rejectionDetails = auditDetails.merging([
                    "duration_ms": Self.durationMilliseconds(since: requestStartedAt),
                    "http_status": String(status),
                    "path": pathLabel,
                    // This event describes one HTTP exchange. In particular,
                    // an authenticated 401 can be followed by token refresh
                    // and a successful retry; it is not yet an operation-level
                    // control-plane failure.
                    "scope": "http_exchange",
                ]) { _, new in new }
                if status == 401 {
                    rejectionDetails["auth_recovery_eligible"] = String(bearer != nil)
                }
                LocalTrafficAudit.shared.recordEvent(
                    "control_plane_http_response_rejected",
                    details: rejectionDetails
                )
                let envelope = try? TonoCoding.decoder().decode(ErrorEnvelope.self, from: data)
                if status == 401 || status == 403,
                   let code = envelope?.error.code,
                   Self.entitlementCodes.contains(code) {
                    throw APIError.entitlementBlocked(
                        code: code, message: envelope?.error.message
                    )
                }
                // #595: the Worker's refusal of a sign-in code, not an expired session. Keyed on
                // the code: the verify endpoint also answers a plain 401 (AUTHENTICATION_FAILED).
                if status == 401, envelope?.error.code == "INVALID_OR_EXPIRED_CODE" { throw APIError.invalidOrExpiredCode }
                if status == 401 { throw APIError.unauthorized }; if status == 403 { throw APIError.forbidden }
                if status == 404 { throw APIError.notFound }
                if status == 409 && envelope?.error.code == "DEVICE_LIMIT" { throw APIError.deviceLimit }
                if status == 503 && envelope?.error.code == "EXIT_IDENTITY_PROPAGATING" { throw APIError.exitIdentityPropagating }
                throw APIError.server(status: status, message: envelope?.error.message ?? "Tono request failed (\(status)).")
            }
            LocalTrafficAudit.shared.recordEvent(
                "control_plane_request_succeeded",
                details: auditDetails.merging([
                    "attempt": String(attempt),
                    "duration_ms": Self.durationMilliseconds(since: requestStartedAt),
                    "http_status": String(status),
                    "path": pathLabel,
                ]) { _, new in new }
            )
            return data
        }
        throw APIError.transport("Retry attempts exhausted.")
    }

    /// #584: one exchange, over the system resolver first, then the pinned
    /// addresses, then the relays (decision 077). A healthy network keeps
    /// today's path; the pinned client only runs where the system resolver
    /// could not deliver, and the relays only where neither direct path could.
    ///
    /// A request moves to the next path only on a failure `shouldRetry`
    /// would replay for its method: a read after any failure, a mutating
    /// request only when no connection was made. An exchange that may have
    /// reached the server is never sent again elsewhere, and an answered one
    /// (any status line) is returned as it came. The caller's retry wraps
    /// the whole walk, as `ApiClient` wraps the Windows transport (#583).
    private func exchangeOverPaths(
        _ request: URLRequest,
        method: String,
        auditDetails: [String: String],
        pathTimelineTicket: UInt64?,
        requestIsCurrent: (@Sendable () -> Bool)?
    ) async throws -> (ControlPlaneAnswer, String) {
        let maximumResponseBytes = 2 * 1024 * 1024
        let fallbacks = [pinnedPath, relayPath].compactMap { $0 }
        guard !fallbacks.isEmpty else {
            var attempt = request
            attempt.setValue(systemPath.label, forHTTPHeaderField: Self.pathHeader)
            attempt.setValue("", forHTTPHeaderField: Self.pathFailedHeader)
            let answer = try await systemPath.exchange(attempt, maximumResponseBytes)
            return (answer, systemPath.label)
        }
        // A path that answered where the ones before it could not goes in
        // front; the rest keep their order behind it.
        var order = [systemPath] + fallbacks
        // Decision 086 (H1-F5, Option A): armed without a tunnel, the helper's
        // PF permits the control plane only through the Tono relays. The
        // system resolver and the pinned Cloudflare addresses would only wait
        // out their timeouts against PF, so the relays are the whole walk,
        // and the remembered preference is neither read nor changed. TLS
        // still names the API host and is validated by default trust.
        let relayOnly = relayPath != nil && armedWithoutTunnel()
        if relayOnly, let relayPath { order = [relayPath] }
        let preferred = relayOnly ? nil : preferredPathLabel
        let preferredFirst: Bool
        if let preferred, let index = order.firstIndex(where: { $0.label == preferred }), index > 0 {
            order.insert(order.remove(at: index), at: 0)
            preferredFirst = true
        } else {
            preferredFirst = false
        }
        // #588: a path that failed on a certificate date is the cause to
        // report when no path answers, whatever the next path failed on.
        var clockFailure: (any Error)?
        // H21-O-F8: likewise a path whose certificate the trust store refused.
        // Only marked on the error thrown; its code, and so the retry rule, is
        // the one that would have been thrown anyway.
        var sawRefusedCertificate = false
        // Every path's failure, `label[detail]`, so the reported error names
        // them all, as the Windows transport's combined message does.
        var failures: [String] = []
        // The same failures as labels and classes, for the copy that names
        // where the request failed (`ControlPlaneUnreachable`).
        var attempts: [ControlPlaneUnreachable.Attempt] = []
        // Decision 080: the labels of the paths lost so far, each once.
        var lostPaths: [String] = []
        for (index, path) in order.enumerated() {
            if index > 0 { try Self.requireCurrent(requestIsCurrent) }
            let startedAt = Date()
            var attempt = request
            attempt.setValue(path.label, forHTTPHeaderField: Self.pathHeader)
            attempt.setValue(lostPaths.joined(separator: ","), forHTTPHeaderField: Self.pathFailedHeader)
            do {
                let answer: ControlPlaneAnswer
                // A read with another path behind it waits for a status line
                // only `systemHeadBudget` on a path that can bound it, so a
                // resolver answer that drops every packet cannot hold the
                // remaining paths back for the session's 45 s. A mutating
                // request keeps the full wait: it may already have arrived.
                if method == "GET", index + 1 < order.count, let bounded = path.exchangeWithinHeadBudget {
                    answer = try await bounded(attempt, maximumResponseBytes, systemHeadBudget)
                } else {
                    answer = try await path.exchange(attempt, maximumResponseBytes)
                }
                if answer.bodyFailure != nil {
                    // A body that failed after the status line, or was
                    // cancelled, neither keeps nor earns the preference.
                    if index == 0, preferredFirst { preferredPathLabel = nil }
                } else if index > 0, !preferredFirst {
                    // This path answered where the ones before it could not.
                    preferredPathLabel = path.label
                }
                NetworkInterception.record(intercepted: false)
                return (answer, path.label)
            } catch {
                // A preferred attempt that fails or is cancelled puts the
                // system resolver back in front for the next request.
                if index == 0, preferredFirst { preferredPathLabel = nil }
                if CertificateClock.isDateFailure(error) { clockFailure = error }
                if NetworkInterception.isTrustFailure(error) { sawRefusedCertificate = true }
                failures.append("\(path.label)[\(Self.failureDetail(error))]")
                attempts.append(.init(path: path.label, failure: ControlPlanePathTimeline.failureClass(error)))
                if Self.reportablePathLabels.contains(path.label), !lostPaths.contains(path.label) {
                    lostPaths.append(path.label)
                }
                guard index + 1 < order.count,
                      !(error is ControlPlaneExchangeError),
                      !Self.isCancellation(error),
                      // The retry rule itself, as if this were a first attempt
                      // with one retry left, or a TLS failure that proves no
                      // request byte left on this path.
                      Self.shouldRetry(
                        method: method,
                        error: error as NSError,
                        responseReceived: false,
                        attempt: 1,
                        maximumAttempts: 2
                      ) || Self.failedBeforeRequest(error)
                else {
                    // A mutating request the first path may have delivered (a
                    // timeout) ends its walk here. Handshake every path now, as
                    // the pre-login probe does (no request, nothing
                    // identifying), so the user's retry goes first to one that
                    // completes TLS instead of waiting out the same dead path.
                    if index == 0, index + 1 < order.count, method != "GET",
                       !(error is ControlPlaneExchangeError), !Self.isCancellation(error) {
                        Task { await self.probePathsBeforeSignIn() }
                    }
                    if let clockFailure, !(error is ControlPlaneExchangeError),
                       !Self.isCancellation(error) {
                        throw Self.combined(clockFailure, failures: failures)
                    }
                    if error is ControlPlaneExchangeError || Self.isCancellation(error) { throw error }
                    throw Self.combined(
                        error, failures: failures, intercepted: sawRefusedCertificate,
                        attempts: attempts, stoppedEarly: index + 1 < order.count
                    )
                }
                let failure = error as NSError
                LocalTrafficAudit.shared.recordEvent(
                    "control_plane_path_failed",
                    details: auditDetails.merging([
                        "path": path.label,
                        "next_path": order[index + 1].label,
                        "error_domain": failure.domain,
                        "error_code": String(failure.code),
                        "duration_ms": Self.durationMilliseconds(since: startedAt),
                        "detail": String(failure.localizedDescription.prefix(300)),
                    ]) { _, new in new }
                )
                // A19: the same pair for the customer timeline, labels, class
                // and time only. The last failure has no next path and stops
                // above, so it is never paired with another request's path.
                controlPlanePathTimeline.record(
                    path: path.label,
                    nextPath: order[index + 1].label,
                    error: error,
                    elapsedMs: Int(Date().timeIntervalSince(startedAt) * 1_000),
                    ticket: pathTimelineTicket
                )
            }
        }
        // Unreachable: the last path either answers or throws above.
        throw APIError.transport("No control-plane path answered.")
    }

    /// The failure's own words, one line, bounded.
    nonisolated private static func failureDetail(_ error: any Error) -> String {
        let text = (error as NSError).localizedDescription
            .replacingOccurrences(of: "\n", with: " ")
        return String(text.prefix(200))
    }

    /// `error` with every path's failure in its description
    /// (`system_dns[...]; pinned[...]; relay[...]`), same domain and code, so
    /// the retry rule and the clock check still read it as the same failure.
    /// With `attempts`, also the walk's paths and their failure classes
    /// (`ControlPlaneUnreachable`), and whether paths were left untried.
    nonisolated private static func combined(
        _ error: any Error, failures: [String], intercepted: Bool = false,
        attempts: [ControlPlaneUnreachable.Attempt] = [], stoppedEarly: Bool = false
    ) -> any Error {
        // One failure is `error` itself, which already carries its own evidence.
        guard failures.count > 1 || !attempts.isEmpty else { return error }
        let original = error as NSError
        var userInfo = original.userInfo
        if failures.count > 1 {
            userInfo[NSLocalizedDescriptionKey] = failures.joined(separator: "; ")
            if intercepted { userInfo[NetworkInterception.evidenceKey] = true }
        }
        if !attempts.isEmpty {
            userInfo[ControlPlaneUnreachable.attemptsKey] = attempts
            userInfo[ControlPlaneUnreachable.stoppedEarlyKey] = stoppedEarly
        }
        return NSError(domain: original.domain, code: original.code, userInfo: userInfo)
    }

    /// #582: the one place this client reads the server's answer about the
    /// session. It sits below the transport retry and below every renewal, so
    /// each answer is classified and reported whatever its caller then does
    /// with it (a logout that swallows it, a catalog read that keeps the last
    /// cache). Only an HTTP answer is classified: an `unauthorized` this client
    /// throws on its own (no stored token) never reaches the sink.
    private func reportSessionAnswer(status: Int, body: Data, session: SessionUse) {
        let scope: SessionScope
        let decisive: Bool
        switch session {
        case .noSession:
            return
        case let .bearer(value):
            scope = value
            decisive = false
        case let .decisive(value):
            scope = value
            decisive = true
        }
        // A retired identity's late answer must never reach its replacement.
        guard scope.generation == credentialGeneration else { return }
        let verdict: TonoSessionVerdict
        if (200..<300).contains(status) {
            verdict = .verified
        } else {
            let code = (try? TonoCoding.decoder().decode(ErrorEnvelope.self, from: body))?.error.code
            if status == 401 || status == 403, let code, Self.entitlementCodes.contains(code) {
                verdict = .refused(code: code)
            } else if status == 401, decisive {
                verdict = .refused(code: code)
            } else if status == 403 {
                verdict = .forbidden
            } else {
                // A first attempt's bare 401 is only a stale access token, and
                // any other status says nothing about the session.
                return
            }
        }
        // A revocation binds the session it revoked: the refresh token this
        // actor holds now, which is the one the refused exchange carried.
        let tokenSha256 = verdict == .verified ? nil : currentRefreshTokenDigest()
        offlineGate.report(verdict, readScope: scope.readScope, tokenSha256: tokenSha256)
    }

    /// #582: the digest of the refresh token this session holds now, as it
    /// was hydrated (a rotated token still in memory first), for offline
    /// admission.
    func currentRefreshTokenDigest() -> String? {
        guard let token = try? currentRefreshToken() else { return nil }
        return OfflineGrantGate.tokenDigest(token)
    }

    /// #582: record the offline grant for a catalog the server has just
    /// confirmed. It binds only a refresh token the keychain acknowledged: a
    /// rotated token that is only in memory would leave a grant no relaunch
    /// could match, and a logout in progress owns these credentials.
    func recordOfflineGrant(accountId: String, confirmed digests: InstalledCatalogDigests) {
        guard !failedAdoption, unpersistedRefreshToken == nil, !isLoggingOut,
              (try? keychain.isRefreshTokenRestorationSuppressed()) == false,
              let token = try? keychain.string(for: .refreshToken) else { return }
        offlineGate.writeGrant(OfflineGrant(
            accountId: accountId,
            tokenSha256: OfflineGrantGate.tokenDigest(token),
            catalogSha256: digests.catalogSha256,
            routingSha256: digests.routingSha256,
            verifiedAt: Int64(Date().timeIntervalSince1970 * 1_000)
        ))
    }

    nonisolated private static func requireCurrent(
        _ validator: (@Sendable () -> Bool)?
    ) throws {
        guard !Task.isCancelled, validator?() ?? true else {
            throw CancellationError()
        }
    }

    private func handleTransportFailure(
        _ error: Error,
        method: String,
        attempt: Int,
        maximumAttempts: Int,
        requestStartedAt: Date,
        auditDetails: [String: String],
        httpStatus: Int? = nil
    ) async throws {
        if Self.isCancellation(error) {
            throw CancellationError()
        }
        let networkError = error as NSError
        let willRetry = Self.shouldRetry(
            method: method,
            error: networkError,
            responseReceived: httpStatus != nil,
            attempt: attempt,
            maximumAttempts: maximumAttempts
        )
        var failureDetails = auditDetails.merging([
            "attempt": String(attempt),
            "duration_ms": Self.durationMilliseconds(since: requestStartedAt),
            "error_domain": networkError.domain,
            "error_code": String(networkError.code),
            "will_retry": String(willRetry),
            // Every path's failure (`system_dns[...]; pinned[...]; relay[...]`).
            "detail": String(networkError.localizedDescription.prefix(300)),
        ]) { _, new in new }
        if let httpStatus {
            failureDetails["http_status"] = String(httpStatus)
        }
        LocalTrafficAudit.shared.recordEvent(
            "control_plane_transport_failed",
            details: failureDetails
        )
        guard willRetry else {
            if CertificateClock.isDateFailure(error) { throw APIError.clockSkew }
            if NetworkInterception.isTrustFailure(error) {
                NetworkInterception.record(intercepted: true)
                throw APIError.tlsIntercepted
            }
            // Where it failed, when the walk said so.
            if let unreachable = ControlPlaneUnreachable(error) { throw APIError.unreachable(unreachable) }
            throw APIError.transport(error.localizedDescription)
        }
        try await Task.sleep(for: .seconds(1))
    }

    nonisolated private static func shouldRetry(
        method: String,
        error: NSError,
        responseReceived: Bool,
        attempt: Int,
        maximumAttempts: Int
    ) -> Bool {
        guard attempt < maximumAttempts else { return false }
        // Reads are safe to replay after any transport failure. Mutating
        // requests are retried only when URLSession says no server connection
        // was established; retrying a timed-out POST could duplicate a code or
        // consume/rotate an authentication credential twice.
        if method == "GET" { return true }
        guard !responseReceived else { return false }
        guard error.domain == NSURLErrorDomain else { return false }
        return [
            NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost,
            NSURLErrorDNSLookupFailed,
            NSURLErrorNotConnectedToInternet,
        ].contains(error.code)
    }

    /// A URLSession failure in the TLS handshake: the handshake did not
    /// complete (`secureConnectionFailed`, e.g. a reset in the middle of it)
    /// or the trust store refused the certificate (a poisoned resolver answer
    /// that leads to another site's certificate, an intercepting network). TLS
    /// comes before the request, so no request byte left on this path, and
    /// the walk may hand a mutating request to the next path as it does after
    /// `cannotConnectToHost`. Only the walk reads this: the retry rule for the
    /// same path, and a certificate date the clock cannot pass (#588), are
    /// unchanged. The pinned client already files its own TLS failures as
    /// not connected.
    nonisolated private static func failedBeforeRequest(_ error: any Error) -> Bool {
        let failure = error as NSError
        guard failure.domain == NSURLErrorDomain else { return false }
        if failure.code == NSURLErrorSecureConnectionFailed { return true }
        return [
            NSURLErrorServerCertificateUntrusted,
            NSURLErrorServerCertificateHasUnknownRoot,
        ].contains(failure.code) && NetworkInterception.isTrustFailure(error)
    }

    nonisolated private static func durationMilliseconds(since startedAt: Date) -> String {
        String(Int(Date().timeIntervalSince(startedAt) * 1_000))
    }

    nonisolated private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let value = error as NSError
        return value.domain == NSURLErrorDomain
            && value.code == NSURLErrorCancelled
    }

    private func validatedDeviceID(_ value: String) throws -> String {
        guard UUID(uuidString: value) != nil else { throw APIError.invalidResponse }
        return value
    }
}

private struct TonoEmptyObject: Decodable {}
