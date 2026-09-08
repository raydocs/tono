import Foundation
import Observation

extension AccountSession {
    func stopRuntime(logOutIdentity: Bool = false, releaseKillSwitch: Bool = false) async {
        invalidateAccountReads()
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

    func releaseNetworkProtection() async {
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

    func startSidecar(
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
    func startCloudOnlyRuntime() async {
        do {
            try await startCloudOnlyRuntimeThrowing()
        } catch {
            await fail(error)
        }
    }

    func startCloudOnlyRuntimeThrowing() async throws {
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

    func startRuntimeMonitor() {
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
    func activateCloudFallback(resumeProtection: Bool? = nil) async throws {
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

    func startCatalogSync(refreshImmediately: Bool = false) {
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
}
