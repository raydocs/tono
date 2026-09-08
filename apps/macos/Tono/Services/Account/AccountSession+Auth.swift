import Foundation
import Observation

extension AccountSession {
    func restore() async {
        await accountLifecycle.run { await self.performRestore() }
    }

    private func performRestore() async {
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
                await startCloudOnlyRuntime()
                try Task.checkCancellation()
                if !Task.isCancelled, state == .ready { refreshDevicesInBackground() }
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
            try Task.checkCancellation()
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
        let revision = accountReadRevision
        authMethodsLoading = true
        defer { authMethodsLoading = false }
        do {
            let methods = try await api.authMethods()
            guard !Task.isCancelled, user == nil, accountReadRevision == revision else { return }
            authMethods = methods
        } catch is CancellationError {
            // SwiftUI cancels view-scoped tasks during ordinary transitions.
            // Cancellation is not a control-plane outage and must not replace
            // the sign-in screen with an error that immediately retries.
            return
        } catch {
            guard !Task.isCancelled, user == nil, accountReadRevision == revision else { return }
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
        guard !accountLifecycle.isBusy else { return }
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

    /// Return to the email step without altering an authenticated session or
    /// cancelling an in-flight request. The old challenge expires server-side.
    func resetEmailSignIn() {
        guard user == nil else { return }
        switch state {
        case .signedOut, .error: break
        default: return
        }
        emailChallenge = nil
        state = .signedOut
    }

    func requestEmailCode(email: String, deviceName: String) async {
        await accountLifecycle.run {
            await self.performEmailCodeRequest(email: email, deviceName: deviceName)
        }
    }

    private func performEmailCodeRequest(email: String, deviceName: String) async {
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
        guard !accountLifecycle.isBusy else { return }
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
        guard !accountLifecycle.isBusy else { return }
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
        guard !accountLifecycle.isBusy else { return }
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
        invalidateAccountReads()
        // Purge before any suspension point so no pending aggregate can cross
        // into a later account even when server logout is slow or unavailable.
        deactivateAppRoutingResearch()
        ManagedExitCatalogOwnership.purge()
        await accountLifecycle.enqueueCleanup(kind: .signOut) {
            await self.stopRuntime(logOutIdentity: true, releaseKillSwitch: true)
            await self.api.logout()
            self.clearAccount()
            self.state = .signedOut
        }.value
    }

    func retryRuntime() async {
        await accountLifecycle.run { await self.performRuntimeRetry() }
    }

    private func performRuntimeRetry() async {
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
        guard user != nil, !Task.isCancelled else { return false }
        if let current = catalogRefreshTask {
            return await current.task.value
        }
        nextCatalogRefreshID &+= 1
        let id = nextCatalogRefreshID
        let revision = accountReadRevision
        let task = Task { [weak self] in
            guard let self else { return false }
            return await self.performManagedCatalogRefresh(attempts: attempts, accountRevision: revision)
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

    func performManagedCatalogRefresh(attempts: Int, accountRevision: UInt64) async -> Bool {
        let boundedAttempts = min(max(attempts, 1), 3)
        for attempt in 0..<boundedAttempts {
            guard !Task.isCancelled, accountReadRevision == accountRevision else { return false }
            do {
                let catalog = try await api.exitCatalog()
                try Task.checkCancellation()
                guard accountReadRevision == accountRevision else { return false }
                try await catalogConsumer(catalog)
                try Task.checkCancellation()
                guard accountReadRevision == accountRevision else { return false }
                lastCatalogFailureMessage = nil
                return true
            } catch is CancellationError {
                return false
            } catch {
                guard !Task.isCancelled, accountReadRevision == accountRevision else { return false }
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

    func cancelManagedCatalogRefresh() async {
        guard let current = catalogRefreshTask else { return }
        current.task.cancel()
        _ = await current.task.value
        if catalogRefreshTask?.id == current.id {
            catalogRefreshTask = nil
        }
    }

    @discardableResult
    func refreshManagedTrafficPolicy(attempts: Int = 1) async -> Bool {
        guard user != nil, !Task.isCancelled else { return false }
        let accountRevision = accountReadRevision
        nextTrafficPolicyRefreshID &+= 1
        let requestID = nextTrafficPolicyRefreshID
        let boundedAttempts = min(max(attempts, 1), 3)
        for attempt in 0..<boundedAttempts {
            guard !Task.isCancelled, accountReadRevision == accountRevision, nextTrafficPolicyRefreshID == requestID else { return false }
            do {
                let policy = try await api.trafficPolicy()
                guard !Task.isCancelled, accountReadRevision == accountRevision, nextTrafficPolicyRefreshID == requestID else { return false }
                let acceptedRevision = try await trafficPolicyConsumer(policy)
                guard !Task.isCancelled, accountReadRevision == accountRevision, nextTrafficPolicyRefreshID == requestID else { return false }
                guard acceptedRevision >= 0 else { throw TonoAPIClient.APIError.invalidResponse }
                lastTrafficPolicyFailureMessage = nil
                // The install owner may have kept a newer verified disk policy.
                // Report what is active, not merely what this response advertised.
                lastTrafficPolicyRevision = max(lastTrafficPolicyRevision ?? acceptedRevision, acceptedRevision)
                return true
            } catch is CancellationError {
                return false
            } catch {
                guard !Task.isCancelled, accountReadRevision == accountRevision, nextTrafficPolicyRefreshID == requestID else { return false }
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

    @discardableResult
    func reloadDevices() async throws -> Bool {
        guard let ownerID = user?.id, !Task.isCancelled else { throw CancellationError() }
        let revision = accountReadRevision
        nextDeviceReloadID &+= 1
        let requestID = nextDeviceReloadID
        let refreshed = try await api.devices().devices
        guard !Task.isCancelled, user?.id == ownerID, accountReadRevision == revision else {
            throw CancellationError()
        }
        // A superseded inventory read must not abort its enclosing sign-in;
        // another current read owns the inventory publication now.
        guard nextDeviceReloadID == requestID else { return false }
        devices = refreshed
        return true
    }

    func clearDeviceActionError() { deviceActionError = nil }

    /// Device management never routes through `fail`. An unreachable or 5xx
    /// control plane here is not an authentication or runtime failure, and
    /// dropping the descriptor over one would take a protected Mac offline
    /// behind an armed kill switch and replace the window with the gate.
    func revoke(_ target: TonoDevice) async {
        guard let ownerID = user?.id, !Task.isCancelled else { return }
        let revision = accountReadRevision
        nextDeviceRevokeID &+= 1
        let requestID = nextDeviceRevokeID
        func isCurrent() -> Bool {
            !Task.isCancelled && user?.id == ownerID && accountReadRevision == revision
        }
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
            guard isCurrent(), nextDeviceRevokeID == requestID else { return }
            deviceActionError = (error as? LocalizedError)?.errorDescription
                ?? String(localized: "Something went wrong. Please try again.")
            return
        }
        // The device is revoked either way; only the refreshed inventory is
        // missing, and the next panel appearance reloads it.
        guard isCurrent() else { return }
        try? await reloadDevices()
    }

    /// Plan, expiry, quota and usage are read once at sign-in and then drift for
    /// as long as this menu-bar client stays resident. Re-read on the catalog
    /// cadence, when the account panel appears, and after a wake.
    func refreshAccount() async {
        guard let ownerID = user?.id else { return }
        let revision = accountReadRevision
        nextAccountRefreshID &+= 1
        let requestID = nextAccountRefreshID
        func isCurrent() -> Bool {
            !Task.isCancelled && accountReadRevision == revision
                && user?.id == ownerID && nextAccountRefreshID == requestID
        }
        do {
            let refreshed = try await api.me().user
            guard isCurrent(), refreshed.id == ownerID else { return }
            user = refreshed
            if refreshed.suspended == true {
                enterEntitlementBlock(detail: nil)
            } else {
                leaveEntitlementBlock()
            }
        } catch is CancellationError {
            return
        } catch let error as TonoAPIClient.APIError where Self.isEntitlementFailure(error) {
            guard isCurrent() else { return }
            enterEntitlementBlock(detail: error.errorDescription)
        } catch TonoAPIClient.APIError.unauthorized {
            guard isCurrent() else { return }
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

    static func isEntitlementFailure(
        _ error: TonoAPIClient.APIError
    ) -> Bool {
        if case .entitlementBlocked = error { return true }
        return false
    }

    /// The credential is good and the account may not use it. The user is told
    /// which — expiry, allowance or a disabled account — instead of being signed
    /// out with a session-expired message, and protection is left exactly as it
    /// is. A nil detail falls back to the screen's own general copy.
    func enterEntitlementBlock(detail: String?) {
        entitlementDetail = detail
        if state == .ready { blockedWhileReady = true }
        pauseAppRoutingResearch()
        state = .suspended
    }

    /// The control plane accepted this account again, so the block is lifted
    /// and the running session it interrupted resumes where it paused —
    /// including the synchronization loop, which stops outside `.ready`.
    func leaveEntitlementBlock() {
        guard state == .suspended, blockedWhileReady else { return }
        blockedWhileReady = false
        entitlementDetail = nil
        state = .ready
        startCatalogSync()
    }

    /// Transfers the one-time enrollment material and immediately removes the
    /// only credential-bearing copies retained by AccountSession.
    func consumeEnrollmentCredentials() -> (authKey: String, hostname: String)? {
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

    func adoptEnrollment(_ value: TonoEnrollment?) {
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

    func authenticate(_ operation: @escaping @MainActor () async throws -> TonoAuthResponse) async {
        await accountLifecycle.run { await self.performAuthentication(operation) }
    }

    private func performAuthentication(_ operation: @MainActor () async throws -> TonoAuthResponse) async {
        state = .authenticating
        // A failed revoke from the device-limit list belongs to the attempt
        // that raised it, not to the one starting here.
        deviceActionError = nil
        do {
            let response = try await operation()
            try Task.checkCancellation()
            try await api.adopt(response)
            try Task.checkCancellation()
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

}
