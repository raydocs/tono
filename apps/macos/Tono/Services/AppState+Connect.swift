import SwiftUI

extension AppState {
    // MARK: - Connection Control

    func connect() {
        guard !nativeUpdatePending, !RuntimeCleanup.nativeUpdateBlocksConnect else { return }
        connectionCoordinator.executeConnect(
            isDisconnecting: isDisconnecting,
            deferredFallback: { [weak self] in
                guard let self,
                      !self.isConnected,
                      !self.isConnecting,
                      !self.isDisconnecting else { return }
                self.connect()
            },
            prepare: { [weak self] in
                guard let self else { return (false, UUID()) }
                guard !self.isConnected && !self.isConnecting else { return (false, UUID()) }
                guard !self.catalogSelectionRequiresChoice else {
                    self.errorMessage = String(localized: "Choose an available cloud server before reconnecting.")
                    return (false, UUID())
                }
                guard self.isTonoReady else {
                    self.errorMessage = String(localized: "No protected Tono cloud exit is ready.")
                    return (false, UUID())
                }
                if let selected = self.selectedExitNode(), let reason = ConfigPipeline.singBoxUnavailableReason(selected) {
                    self.errorMessage = reason + ": this sing-box build cannot authenticate the catalog's HY2 certificate pin. Choose Reality."
                    return (false, UUID())
                }
                self.isProtectionBlocked = false
                self.connectionStage = .preparing
                self.completedConnectionStages = []
                self.lastConnectionStageDurations = []
                self.lastConnectionFailure = nil
                self.connectionStartedAt = Date()
                self.connectionStageStartedAt = self.connectionStartedAt
                if !self.isProtectedReconnectScheduled {
                    self.protectedReconnectAttempt = 0
                    self.protectedReconnectNextAttemptAt = nil
                    self.clearCatalogFailoverSweep()
                }
                self.lastClassifiedFailure = nil
                self.isConnecting = true
                self.errorMessage = nil
                // Any fresh connect attempt is user-visible intent to try again; the
                // reconnect loop re-pauses if the same user-action failure repeats.
                self.protectedReconnectPausedForUserAction = false

                // Session-dynamic mixed/controller ports avoid collisions with leftover
                // 7890/9090 listeners from other proxies or a previous core.
                let sessionPorts = SessionRuntimePorts.allocatePair()
                let port = sessionPorts.mixed
                self.config.mixedPort = port
                self.config.externalController = "127.0.0.1:\(sessionPorts.controller)"
                // Tono always requires TUN; LAN exposure is never allowed.
                self.config.tunEnabled = true
                self.config.allowLan = false
                self.config.mode = ProxyMode.rule.rawValue.lowercased()
                self.proxyMode = .rule

                let selectedExit = self.preferManagedCatalogExitForConnect()
                let selectedExitName = selectedExit?.name ?? ConfigPipeline.homeNodeName
                LocalTrafficAudit.shared.recordEvent(
                    "connect_requested",
                    details: [
                        "selected_exit": selectedExitName,
                        "claude_home_route": self.managedCatalogRouting?.homeSocks5 != nil
                            ? "homeSocks5"
                            : self.managedCatalogRouting?.homeProxy != nil
                                ? "homeProxy"
                                : "absent",
                        "mixed_port": String(port),
                        "controller_port": String(sessionPorts.controller),
                    ]
                )
                ConnectionTelemetryBuffer.shared.record(
                    "connectBegin",
                    stage: ConnectionStage.preparing.rawValue,
                    node: selectedExit?.name,
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration),
                    transport: selectedExit?.catalogTransport
                )
                return (true, UUID())
            },
            onWatchdog: { [weak self] attemptID in
                guard let self else { return }
                // A first-run attempt can legitimately sit on the administrator
                // prompt past the deadline; the prompt itself is already bounded
                // (180s in HelperManager), so grant that stage one extension
                // instead of tearing down under the user's credential dialog.
                if self.isConnecting,
                   self.connectionCoordinator.connectAttemptID == attemptID,
                   self.connectionStage == .preparingHelper
                    || self.connectionStage == .preparing {
                    try? await Task.sleep(for: .seconds(200))
                }
                guard !Task.isCancelled,
                      self.isConnecting, self.connectionCoordinator.connectAttemptID == attemptID else {
                    return
                }
                LocalTrafficAudit.shared.recordEvent(
                    "connect_watchdog_fired",
                    details: ["stage": String(describing: self.connectionStage)]
                )
                let stalledMessage = String(
                    localized: "The connection attempt stalled and was stopped."
                )
                if KillSwitchService.isArmed {
                    self.disconnect(releaseKillSwitch: false)
                    self.errorMessage = stalledMessage + " "
                        + String(localized: "Kill Switch is blocking traffic while Tono retries. Click Restore internet to get back online.")
                    self.scheduleProtectedReconnect()
                } else {
                    self.errorMessage = stalledMessage
                    self.disconnect(releaseKillSwitch: true)
                }
            },
            perform: { [weak self, coreRuntime] attemptID, generation in
                guard let self else { return }
                let routeOwner = ManagedExitCatalogOwnership.currentAccount
                let routeCatalogDigest = self.managedCatalogDigest
                let port = self.config.mixedPort
                let selectedExit = self.preferManagedCatalogExitForConnect()
                let selectedExitName = selectedExit?.name ?? ConfigPipeline.homeNodeName
                let overlay = ConfigPipeline.OverlayConfig(
                    mixedPort: port,
                    externalController: self.config.externalController,
                    secret: self.config.secret,
                    mode: "rule",
                    logLevel: "warning",
                    allowLan: false,
                    tunEnabled: true,
                    selectedNodeName: selectedExitName,
                    tonoTransport: self.tonoTransport,
                    claudeHomeNodeName: self.managedCatalogRouting?.homeProxy,
                    defaultNodeName: self.managedCatalogRouting?.defaultProxy,
                    claudeHomeSocks5: self.managedCatalogRouting?.homeSocks5
                )
                let apiHost = (Bundle.main.object(forInfoDictionaryKey: "TonoAPIBaseURL") as? String)
                    .flatMap { URL(string: $0)?.host }

                // Health-check: poll /version until mihomo is ready
                let apiPort = self.config.externalController.split(separator: ":").last.flatMap { Int($0) } ?? 9090
                let api = CoreControllerClient(port: apiPort, secret: self.config.secret)
                let runtimeNodes = self.importedExitNodes
                let usesHomeBootstrap = AppProfile.homeExitEnabled && self.tonoTransport != nil
                let trafficPolicy = self.managedTrafficPolicy

                do {
                    guard let networkService =
                        await PrivilegedRuntimeCoordinator.shared.primaryNetworkService()
                    else {
                        throw SystemProxyError.noNetworkService
                    }
                self.protectedDNSService = networkService
                var physicalInterface = await PrivilegedRuntimeCoordinator.shared
                    .primaryNetworkInterface()
                // A mid-transition network handoff can briefly report no
                // primary interface. Giving up here silently drops the whole
                // managed-direct feature for the session, so retry first.
                for _ in 0..<3 where physicalInterface == nil {
                    try await Task.sleep(for: .milliseconds(300))
                    physicalInterface = await PrivilegedRuntimeCoordinator.shared
                        .primaryNetworkInterface()
                }
                let policyIsEmpty = trafficPolicy.domains.isEmpty
                    && trafficPolicy.webDomains.isEmpty
                    && trafficPolicy.directSuffixes.isEmpty
                    && trafficPolicy.mediaEndpoints.isEmpty
                    && trafficPolicy.tcpEndpoints.isEmpty
                var committedDirectPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?
                if let physicalInterface {
                    do {
                        committedDirectPolicy = try self.initialDirectPolicy(
                            physicalInterface: physicalInterface,
                            policy: trafficPolicy
                        )
                    } catch {
                        committedDirectPolicy = nil
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_policy_invalid",
                            details: [
                                "error": String(describing: error),
                                "interface": physicalInterface,
                                "suffixes": String(trafficPolicy.directSuffixes.count),
                                "web_domains": String(trafficPolicy.webDomains.count),
                                "domains": String(trafficPolicy.domains.count),
                                "trusted": trafficPolicy.trusted ? "true" : "false",
                            ]
                        )
                    }
                } else {
                    committedDirectPolicy = nil
                    if !policyIsEmpty {
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_no_primary_interface"
                        )
                    }
                }
                let proxyEndpoints = try ConfigPipeline.dialEndpoints(for: selectedExit)
                    + self.claudeHomeDialEndpoints(excluding: selectedExit)
                let activeDirectPolicy = committedDirectPolicy
                // YAML generation only touches the app-support directory. Overlap
                // it with helper install and the first PF arm — those go through
                // the privileged actor and cannot run beside each other.
                async let runtimeDigest = coreRuntime.writeRuntimeConfig(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: activeDirectPolicy
                )
                // Always arm before TUN comes up so a crash mid-connect cannot
                // leak the real IP. The actor keeps this blocking PF/helper work
                // off SwiftUI and ordered with a possible cancel/disconnect.
                self.connectionStage = .preparingHelper
                do {
                    try await PrivilegedRuntimeCoordinator.shared.prepareHelper()
                } catch {
                    // Install, authorization and identity rejection all arrive
                    // here as an opaque error. Classifying the stage is what
                    // makes the copyable diagnostic and the failure telemetry
                    // say something other than "none".
                    self.lastClassifiedFailure = ProtectedConnectivity.failure(
                        .helperProtocolMismatch,
                        stage: "preparingHelper",
                        attempt: 1,
                        generation: self.connectionCoordinator.protectionOperationGeneration,
                        detail: String(describing: error)
                    )
                    throw error
                }
                try Task.checkCancellation()
                let protectedDNSState =
                    await PrivilegedRuntimeCoordinator.shared.protectedDNSStatus()
                // System resolution is allowed only on a clean, unprotected
                // first connection. Protected recovery, wake, and hotspot
                // transitions must use the helper's validated pin cache and
                // never query a possibly local/dead or ISP-provided resolver.
                let allowSystemResolution =
                    !KillSwitchService.isArmed
                        && protectedDNSState.available
                        && !protectedDNSState.configured
                        && !protectedDNSState.snapshotPresent
                self.connectionStage = .startingKillSwitch
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    // Retain only Tono's exact control-plane HTTPS addresses as
                    // a bounded crash-recovery path. Background applications
                    // still cannot use direct Internet or system DNS while PF
                    // is armed.
                    apiHosts: [apiHost].compactMap { $0 },
                    tunnelInterfaces: [],
                    proxyEndpoints: proxyEndpoints,
                    // Mihomo starts below with the committed policy's UDP
                    // media direct rules already in its config. Granting the
                    // matching PF exceptions in this same arm closes the
                    // multi-second window where those direct dials were
                    // silently dropped; the endpoints are already validated
                    // and harmless before Mihomo exists (root-only pass).
                    sessionDirectEndpoints:
                        activeDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled: usesHomeBootstrap,
                    allowSystemResolution: allowSystemResolution,
                    helperPrepared: true,
                    reviewedBundleDirect:
                        activeDirectPolicy?.requiresAddressFreeDirectPermit == true
                )
                try Task.checkCancellation()
                let digest = try await runtimeDigest
                self.connectionStage = .startingTunnel
                // /core/start only waits ~150 ms after spawn. Controller bind,
                // utun, and the loopback DNS listener appear after that IPC
                // returns — poll them as soon as the process exists.
                async let started: Void = coreRuntime.start(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: activeDirectPolicy,
                    helperPrepared: true,
                    precomputedDigest: digest
                )
                try await api.waitUntilReady()
                // Controller answering means the process exists. Start the
                // utun poll and loopback DNS now — not before spawn, or the
                // 2 s interface budget can expire while /core/start is still
                // snapshotting.
                async let tunReady = Self.waitForOwnedTunnelInterface()
                async let localDNSReady = self.testLocalProtectedDNS()
                try await started
                self.loadedRuntimeConfigDigest = digest
                self.commitResidentialRouteAuditContext(
                    overlay: overlay,
                    nodes: runtimeNodes,
                    digest: digest
                )
                RuntimeCleanup.markCoreStarted(tunEnabled: self.config.tunEnabled)
                try Task.checkCancellation()
                guard await tunReady else {
                    let diagnostic = await PrivilegedRuntimeCoordinator.shared
                        .coreStatus()
                        .lastError
                    let suffix = diagnostic.flatMap { $0.isEmpty ? nil : " (\($0))" } ?? ""
                    throw KillSwitchService.Error.commandFailed(
                        "Mihomo did not create the owned \(ConfigPipeline.tonoTunInterface) interface.\(suffix)"
                    )
                }
                // The helper refuses arbitrary/nonexistent interfaces. Only after
                // Mihomo is healthy may traffic leave through its owned TUN.
                self.connectionStage = .lockingTraffic
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    // The control plane is needed as a bounded direct recovery
                    // path before the tunnel exists. Once utun199 is live, clear
                    // that physical-interface exception so API traffic must use
                    // the protected exit as well.
                    apiHosts: [],
                    tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                    proxyEndpoints: proxyEndpoints,
                    sessionDirectEndpoints:
                        committedDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled: usesHomeBootstrap,
                    helperPrepared: true,
                    reviewedBundleDirect:
                        committedDirectPolicy?.requiresAddressFreeDirectPermit == true
                )
                try Task.checkCancellation()
                // Optional WeChat/Web DIRECT resolution is no longer on the
                // Connected critical path. Start with the last suffix/process
                // policy (or full tunnel) and apply resolved pins only after
                // the real TUN data plane has been proven.
                // Prove the root-owned loopback DNS listener can resolve through
                // the selected protected exit before changing any system DNS
                // setting. This makes the transition transactional: a port
                // conflict, broken DoH route, or node failure still leaves the
                // user's original Internet untouched.
                self.connectionStage = .securingDNS
                guard await localDNSReady else {
                    self.lastClassifiedFailure = ProtectedConnectivity.failure(
                        .protectedDnsNotReady,
                        stage: "securingDNS",
                        attempt: 1,
                        generation: self.connectionCoordinator.protectionOperationGeneration,
                        detail: "loopback DNS listener preflight failed"
                    )
                    throw CoreControllerError.protectionFailed(
                        "Mihomo's protected local DNS listener did not pass its preflight check."
                    )
                }
                LocalTrafficAudit.shared.recordEvent(
                    "local_dns_verified",
                    details: self.auditProtectionDetails()
                )
                try Task.checkCancellation()
                // macOS cannot hijack DNS queries addressed to a directly
                // reachable LAN resolver (commonly the DHCP router). Point the
                // active service at Mihomo's verified loopback listener only
                // after utun199 and its PF allowance are live. The root helper
                // snapshots and restores the original DHCP/custom setting.
                try await PrivilegedRuntimeCoordinator.shared.enableProtectedDNS(
                    service: networkService
                )
                try Task.checkCancellation()
                // `networksetup` echoing 127.0.0.1 proves only that the setting
                // was written. Require an ordinary unqualified DNS client to
                // receive Mihomo's fake IP through macOS's active resolver
                // before the UI can ever report Connected.
                guard await self.testSystemProtectedDNS() else {
                    let diagnostic = await self.systemProtectedDNSFailureMessage()
                    self.lastClassifiedFailure = ProtectedConnectivity.failure(
                        .protectedDnsNotReady,
                        stage: "securingDNS",
                        attempt: 2,
                        generation: self.connectionCoordinator.protectionOperationGeneration,
                        detail: "system resolver did not reach the protected listener"
                    )
                    throw CoreControllerError.protectionFailed(diagnostic)
                }
                LocalTrafficAudit.shared.recordEvent(
                    "system_dns_verified",
                    details: self.auditProtectionDetails()
                )
                try Task.checkCancellation()
                // Chromium can bypass system fake-IP DNS without changing the
                // macOS resolver. A residential Claude route therefore cannot
                // be claimed until every supported browser profile is clear.
                if self.isClaudeHomeConfigured {
                    let browserDNS = await self.scanBrowserProtectedDNS()
                    self.recordBrowserDNSPreflight(browserDNS)
                    guard browserDNS.outcome == .clear else {
                        self.lastClassifiedFailure = ProtectedConnectivity.failure(
                            .protectedDnsNotReady,
                            stage: "securingDNS",
                            attempt: 3,
                            generation: self.connectionCoordinator.protectionOperationGeneration,
                            detail: browserDNS.diagnosticDetail
                        )
                        throw CoreControllerError.protectionFailed(
                            browserDNS.failureMessage
                        )
                    }
                }
                try Task.checkCancellation()
                // Controller /delay is advisory. Two in-place TUN rounds keep
                // the core and PF live; only an exhausted real data plane can
                // refuse Connected.
                self.connectionStage = .checkingExit
                let controllerTask = Task {
                    await self.advisoryControllerExitProbe(
                        api: api,
                        selectedExit: selectedExit
                    )
                }
                self.connectionStage = .verifyingTraffic
                let verdict = await self.verifyProtectedConnection(
                    controllerTask: controllerTask,
                    mixedPort: self.config.mixedPort,
                    generation: self.connectionCoordinator.protectionOperationGeneration,
                    rounds: ProtectedConnectivity.postLockVerifyRounds
                )
                try Task.checkCancellation()
                switch verdict {
                case .connected(let advisory):
                    if let advisory {
                        LocalTrafficAudit.shared.recordEvent(
                            "controller_exit_advisory",
                            details: ["warning": String(advisory.prefix(200))]
                        )
                        ConnectionTelemetryBuffer.shared.record(
                            "controllerExitAdvisory",
                            stage: ConnectionStage.checkingExit.rawValue,
                            error: advisory,
                            node: selectedExit?.name,
                            generation: Int(self.connectionCoordinator.protectionOperationGeneration)
                        )
                    }
                case .failed(let failure):
                    self.lastClassifiedFailure = failure
                    throw CoreControllerError.protectionFailed(failure.userMessage)
                }
                LocalTrafficAudit.shared.recordEvent(
                    "system_data_plane_verified",
                    details: self.auditProtectionDetails()
                )
                self.activeDirectPolicy = committedDirectPolicy
                // /core/start already snapshots the exact digested config into
                // the root-owned runtime directory before launching Mihomo.
                // Reloading that identical file here added another helper/API
                // round trip and could interrupt a healthy first connection.
                let committed = await self.onCoreStarted(api: api)
                guard committed else { return }
                self.recordVerifiedRouteSuccess(selectedExitName, owner: routeOwner, generation: generation,
                                                catalogDigest: routeCatalogDigest)
                // Pins are for the *next* fail-closed window, not this
                // Connected commit. Resolving them here used to hold the UI
                // on Connecting after the real TUN path was already proven.
                let pinAPI = api
                Task { await self.refreshControlPlanePinCache(api: pinAPI) }
                if let started = self.connectionStageStartedAt {
                    let elapsedMs = max(
                        0,
                        Int(Date().timeIntervalSince(started) * 1_000)
                    )
                    if self.lastConnectionStageDurations.count < 32 {
                        self.lastConnectionStageDurations.append(
                            StageDuration(
                                stage: self.connectionStage,
                                milliseconds: elapsedMs
                            )
                        )
                    }
                }
                self.completedConnectionStages.insert(self.connectionStage)
                self.isConnecting = false
                self.connectionStartedAt = nil
                self.connectionStageStartedAt = nil
                self.protectedReconnectNextAttemptAt = nil
                self.connectionStage = .preparing
                self.lastProtectedFailureSignature = nil
                self.consecutiveProtectedFailureCount = 0
                self.connectionCoordinator.connectWatchdogTask?.cancel()
                self.connectionCoordinator.connectWatchdogTask = nil
                self.connectionCoordinator.connectTask = nil
            } catch {
                // A second click while connecting is an intentional cancel.
                // The serialized disconnect sequence runs after any in-flight
                // helper operation, so a late arm/start cannot win the race.
                if Task.isCancelled { return }
                self.retireFailedRouteSuccess(selectedExitName, owner: routeOwner, generation: generation)
                let failedStage = self.connectionStage
                let failedAt = Date()
                let totalDuration = self.connectionStartedAt.map {
                    max(0, Int(failedAt.timeIntervalSince($0) * 1_000))
                }
                let stageDuration = self.connectionStageStartedAt.map {
                    max(0, Int(failedAt.timeIntervalSince($0) * 1_000))
                }
                let status = await PrivilegedRuntimeCoordinator.shared.coreStatus()
                var failureDetails = [
                    "error": error.localizedDescription,
                    "stage": failedStage.rawValue,
                ]
                if let totalDuration {
                    failureDetails["duration_ms"] = String(totalDuration)
                }
                if let stageDuration {
                    failureDetails["stage_duration_ms"] = String(stageDuration)
                }
                LocalTrafficAudit.shared.recordEvent(
                    "connect_failed",
                    details: failureDetails
                )
                // The audit already carries the raw evidence, but only as text
                // on disk. The same failure as a typed event is what lets a
                // success rate be split by stage and code instead of parsing
                // uploaded audit prose.
                ConnectionTelemetryBuffer.shared.recordConnectFailure(
                    stage: failedStage.rawValue,
                    code: self.lastClassifiedFailure?.code ?? .unknownClassifiedFailure,
                    elapsedMs: totalDuration,
                    node: selectedExit?.name,
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration),
                    error: error.localizedDescription,
                    // The core's own last words are what turn "handshake failed"
                    // into a dial error an operator can act on.
                    coreErrors: [status.lastError].compactMap { $0 }
                )
                await MainActor.run {
                    // An explicit Disconnect/Quit can cancel while the status
                    // request is in flight. Never let this stale failure path
                    // re-arm protection after the user released it.
                    guard !Task.isCancelled else { return }
                    // Keep Core lastError / localizedDescription on the audit
                    // and the copyable classified detail. The dashboard must
                    // not interpolate them — handshake eof used to land as
                    // English debug on the main card.
                    let failureMessage = ConnectionFailurePresentation.userFacingMessage(
                        classified: self.lastClassifiedFailure
                    )
                    // Deterministic failures repeat verbatim; a fourth try of
                    // three identical same-stage outcomes will not differ.
                    // Environmental failures (no network service while Wi-Fi
                    // is off) are excluded: they repeat identically too, but
                    // resolve themselves — pausing on them would strand a
                    // fail-closed host that used to self-heal.
                    let environmentalFailure: Bool
                    if case SystemProxyError.noNetworkService = error {
                        environmentalFailure = true
                    } else {
                        environmentalFailure = false
                    }
                    if CatalogCityFailover.shouldRotate(
                        after: self.lastClassifiedFailure?.code
                    ) {
                        _ = self.rotateCatalogExitAfterConnectFailure()
                    }
                    if environmentalFailure {
                        // Leave the counter untouched either way.
                    } else {
                        let failureSignature =
                            "\(failedStage.rawValue)|\(failureMessage.prefix(120))"
                        if failureSignature == self.lastProtectedFailureSignature {
                            self.consecutiveProtectedFailureCount += 1
                        } else {
                            self.lastProtectedFailureSignature = failureSignature
                            self.consecutiveProtectedFailureCount = 1
                        }
                    }
                    self.lastConnectionFailure = ConnectionFailure(
                        stage: failedStage,
                        message: failureMessage,
                        occurredAt: failedAt
                    )
                    self.connectionStageStartedAt = nil
                    self.connectionCoordinator.connectWatchdogTask?.cancel()
                    if KillSwitchService.isArmed {
                        // Once PF has committed, every automatic failure path is
                        // fail-closed. Only the user's explicit Protected Offline
                        // action may restore direct Internet.
                        self.disconnect(releaseKillSwitch: false)
                        if Self.failureRequiresUserAction(error) {
                            self.protectedReconnectPausedForUserAction = true
                            self.protectedReconnectPauseLiftsOnNetworkChange = false
                            self.errorMessage = failureMessage + " "
                                + String(localized: "Kill Switch is blocking traffic. Automatic retries are paused because this needs your action — click Retry now after resolving it, or Restore internet to get back online.")
                        } else if !environmentalFailure,
                                  self.consecutiveProtectedFailureCount >= 3 {
                            self.protectedReconnectPausedForUserAction = true
                            self.protectedReconnectPauseLiftsOnNetworkChange = true
                            self.errorMessage = failureMessage + " "
                                + String(localized: "The same failure repeated three times, so automatic retries are paused. Click Retry now to try again, or Restore internet to get back online.")
                        } else {
                            self.errorMessage = failureMessage + " "
                                + String(localized: "Kill Switch is blocking traffic while Tono retries. Click Restore internet to get back online.")
                            self.scheduleProtectedReconnect()
                        }
                    } else {
                        // Installation/authorization can fail before PF exists.
                        // Do not claim the unrestricted host is protected or
                        // repeatedly trigger an administrator prompt. Releasing
                        // clears the failure card, but exactly these first-run
                        // failures need the copyable diagnostics — restore it.
                        self.errorMessage = failureMessage
                        let preservedFailure = self.lastConnectionFailure
                        let preservedStages = self.completedConnectionStages
                        self.disconnect(releaseKillSwitch: true)
                        self.lastConnectionFailure = preservedFailure
                        self.completedConnectionStages = preservedStages
                    }
                }
            }
        }
    )
}

    /// Stops Mihomo/TUN. Kill switch is NOT disarmed here — that only happens on
    /// intentional logout / user "turn off protection" so a crash or health failure
    /// leaves the host fail-closed via Kill Switch.
    func disconnect(releaseKillSwitch: Bool = false) {
        if nativeUpdatePending || RuntimeCleanup.nativeUpdateBlocksConnect
            || (releaseKillSwitch && RuntimeCleanup.nativeUpdatePending) {
            if releaseKillSwitch { disconnectPendingNativeUpdate() }
            return
        }
        let pendingConnect = self.connectionCoordinator.connectTask
        let pendingNodeSwitch = self.connectionCoordinator.nodeSwitchTask
        pendingNodeSwitch?.cancel()
        self.connectionCoordinator.nodeSwitchTask = nil
        let pendingConfigReload = self.connectionCoordinator.configReloadTask
        pendingConfigReload?.cancel()
        self.connectionCoordinator.configReloadTask = nil
        let pendingCoreMonitor = self.connectionCoordinator.coreMonitorTask
        pendingCoreMonitor?.cancel()
        self.connectionCoordinator.coreMonitorTask = nil

        let pendingTasks = [pendingConnect, pendingNodeSwitch, pendingConfigReload, pendingCoreMonitor]
            .compactMap { $0 }

        let shouldStopCore = isConnected
            || isConnecting
            || coreRuntime.isRunning
            || AppProfile.defaults.bool(forKey: SettingsKey.didStartCore)

        let runtimeMayOwnNetwork =
            KillSwitchService.isArmed
                || AppProfile.defaults.bool(forKey: SettingsKey.didStartCore)
                || HelperManager.hasInstalledHelperArtifact
        let networkProtection = self.networkProtection

        connectionCoordinator.executeDisconnect(
            releaseKillSwitch: releaseKillSwitch,
            pendingTasks: pendingTasks,
            prepare: { [weak self] in
                guard let self else { return }
                LocalTrafficAudit.shared.recordEvent(
                    "disconnect_requested",
                    details: [
                        "release_kill_switch": String(releaseKillSwitch),
                        "was_connected": String(self.isConnected),
                    ]
                )
                // Recorded here, at the top, because everything it reports is gone by
                // the time the teardown below returns: `trafficStats` is replaced with
                // a fresh one and `isConnected` goes false further down, and the
                // release branch clears `connectionStartedAt`. Guarded on `isConnected`
                // as well as the start date so a health-driven disconnect followed by
                // the user's own "Restore internet" — which reaches this function a
                // second time with the start date still set — cannot bank a second,
                // empty session.
                if self.isConnected, let sessionStartedAt = self.connectionStartedAt {
                    ConnectionTelemetryBuffer.shared.record(
                        "disconnectOk",
                        elapsedMs: max(0, Int(Date().timeIntervalSince(sessionStartedAt) * 1_000)),
                        node: self.selectedExitNode()?.name,
                        // Mihomo's top-level counters are cumulative, not the sum of live flows.
                        bytesUp: self.trafficStats.totalUpload,
                        bytesDown: self.trafficStats.totalDownload
                    )
                }
                let protectionMayBeActive = self.isProtectionBlocked
                    || self.isConnected
                    || self.isConnecting
                    || KillSwitchService.isArmed
                // An explicit release can spend up to 180 seconds on the administrator
                // repair prompt. Keep the UI protected/offline until core stop, DNS
                // restoration, and PF disarm have all committed.
                self.isProtectionBlocked = !releaseKillSwitch || protectionMayBeActive
                if releaseKillSwitch {
                    // A released host starts a genuinely new story; stale failure
                    // history must not let a single failure in a future session trip
                    // the "repeated three times" pause.
                    self.lastProtectedFailureSignature = nil
                    self.consecutiveProtectedFailureCount = 0
                    self.protectedReconnectPausedForUserAction = false
                    self.protectedReconnectPauseLiftsOnNetworkChange = false
                    self.isProtectedReconnectScheduled = false
                    self.protectedReconnectAttempt = 0
                    self.protectedReconnectNextAttemptAt = nil
                    self.resumeProtectionAfterWake = false
                    self.autoConnectRequested = false
                    self.connectionStartedAt = nil
                    self.connectionStageStartedAt = nil
                    self.completedConnectionStages = []
                    self.lastConnectionFailure = nil
                }
                // Connection-scoped observations. `/connections` stops arriving once the
                // core is gone, so leaving these set would have the next session judge a
                // phantom stream from the previous one — old enough to look in-flight —
                // and needlessly defer its first pin refreshes.
                self.oldestProxiedConnectionStart = nil
                self.lastManagedDirectActivity = nil
                self.pinRefreshDeferralCount = 0
                self.catalogApplyDeferralCount = 0
                self.connectionCoordinator.networkEnvironmentTask?.cancel()
                self.connectionCoordinator.networkEnvironmentTask = nil
                self.networkInfoTask?.cancel()
                self.networkInfoTask = nil
                self.pendingFullConfigReload = false
                self.pendingDirectPolicyReload = nil
                self.loadedRuntimeConfigDigest = nil
                self.residentialRouteAuditGeneration &+= 1
                self.residentialRouteAuditContext = nil
                LocalTrafficAudit.shared.setResidentialRouteContext(nil)
                LocalTrafficAudit.setAssistantDirectFirstMember(nil)

                self.isConnecting = false
                self.connectionStage = .preparing
                self.isDisconnecting = true
                self.disconnectionStartedAt = Date()
                self.disconnectionStage = .finishingOperation
                self.switchingNodeId = nil

                // Stop WebSocket streams
                self.webSocket?.stopAll()
                self.webSocket = nil
                self.coreController = nil
                self.proxyService.setAPI(nil)

                // Stop UI-side streams/timers immediately; blocking system operations
                // continue on the serialized runtime actor.
                self.stopProxyGuard()
                self.stopLatencyTestTimer()

                // Reset state
                self.isConnected = false
                self.lastPhysicalFingerprint = nil
                self.isProxyDegraded = false
                self.networkInfo = NetworkInfo()
                self.trafficStats = TrafficStats()
                self.trafficFeedLive = false
                self.connectionsFeedLive = false
                self.connections = []
                self.connectionsDisplayLimited = false
                self.appTrafficLedger.reset()
                self.logEntries = []
                self.activeRules = []
                self.ruleProviders = [:]
                self.providerRulesCache = []
                self.providerRulesLoaded = false
                self.isLoadingProviderRules = false
                self.activeDirectPolicy = nil
            },
            operation: { [weak self, coreRuntime] requestID in
            var transitionError: String?
            var helperReadyForRelease = true
            if releaseKillSwitch {
                do {
                    // A helper that rejects this GUI will also reject core stop,
                    // DNS restoration, and disarm; one on an older protocol
                    // answers, but its "restored" does not mean this build's
                    // DNS contract. Repair either once, while PF remains
                    // fail-closed, before attempting any release operation.
                    try await networkProtection.repairForRelease()
                } catch {
                    helperReadyForRelease = false
                    transitionError = String(
                        localized: "Tono's network helper needs repair before protection can be released, so your traffic stays protected. Choose Restore internet again and approve the administrator prompt. If repair keeps failing, the Support page has a recovery command. \(error.localizedDescription)"
                    )
                    LocalTrafficAudit.shared.recordEvent(
                        "helper_release_repair_failed",
                        details: ["error": error.localizedDescription]
                    )
                }
            }

            await MainActor.run {
                self?.disconnectionStage = .stoppingTunnel
            }
            let stopped = helperReadyForRelease
                ? (shouldStopCore ? await networkProtection.stopCore(coreRuntime) : true)
                : false
            let coreStillRunning: Bool
            if helperReadyForRelease && shouldStopCore {
                let status = await networkProtection.coreStatus()
                coreStillRunning = status.running || !status.verified
            } else {
                coreStillRunning = false
            }
            // A failed identity repair aborts the privileged release sequence.
            // Do not infer "stopped" from an unauthorized status endpoint.
            let coreStopped = helperReadyForRelease
                && (stopped || !coreStillRunning)
            if coreStopped {
                RuntimeCleanup.clearCoreStarted()
            }

            var protectedDNSRestored = !releaseKillSwitch
            if releaseKillSwitch {
                await MainActor.run {
                    self?.disconnectionStage = .restoringDNS
                }
                if helperReadyForRelease {
                    do {
                        _ = try await networkProtection.restoreDNS()
                        protectedDNSRestored = true
                    } catch {
                        // A first-run user may cancel the administrator prompt
                        // before any helper, PF rule, core, or DNS snapshot exists.
                        // Only that provably pristine case can treat an absent
                        // helper as "nothing to restore."
                        protectedDNSRestored = !runtimeMayOwnNetwork
                        if !protectedDNSRestored {
                            transitionError =
                                "Protected DNS restore failed; Kill Switch remains active. \(error.localizedDescription)"
                        }
                    }
                }
            } else {
                await MainActor.run {
                    self?.disconnectionStage = .preservingProtection
                }
            }
            var transitionLeavesProtectionBlocked =
                !releaseKillSwitch || !coreStopped || !protectedDNSRestored
            if !coreStopped, transitionError == nil {
                // The stop failure only means "Kill Switch remains active"
                // while PF is actually armed. A first connect interrupted
                // before its stage-1 arm holds no PF rule; its teardown must
                // not tell that host the Kill Switch is holding it (R1-F2).
                transitionError = KillSwitchService.isArmed
                    ? "The protected core could not be stopped. Kill Switch remains active; retry disconnecting."
                    : "The protected core could not be stopped; retry disconnecting."
            }
            do {
                try await networkProtection.disableSystemProxy()
            } catch {
                transitionError = String(
                    localized: "System proxy could not be turned off. Disable the proxy manually in System Settings > Network."
                )
            }

            if releaseKillSwitch {
                await MainActor.run {
                    self?.disconnectionStage = .restoringNetwork
                }
            }
            if helperReadyForRelease {
                do {
                    if releaseKillSwitch, coreStopped, protectedDNSRestored {
                        try await networkProtection.disarm()
                        transitionLeavesProtectionBlocked = false
                    } else {
                        try await networkProtection.restrictToBootstrap()
                        // `restrictToBootstrap` deliberately no-ops while PF
                        // is not armed, and that idle success is not held
                        // protection: a preserve teardown of a never-armed
                        // session must not publish Protected Offline over an
                        // open host (R1-F2). Every armed path keeps the
                        // claim, and an incomplete release stays fail-closed.
                        if !releaseKillSwitch, !KillSwitchService.isArmed {
                            transitionLeavesProtectionBlocked = false
                        } else {
                            transitionLeavesProtectionBlocked = true
                        }
                    }
                } catch {
                    transitionLeavesProtectionBlocked = true
                    transitionError = String(localized: "Kill switch transition failed: \(error.localizedDescription)")
                }
            } else {
                transitionLeavesProtectionBlocked = true
            }

            await MainActor.run {
                guard let self else { return }
                self.connectionCoordinator.completeDisconnect(requestID) {
                    self.isProtectionBlocked = transitionLeavesProtectionBlocked
                    if releaseKillSwitch, !transitionLeavesProtectionBlocked {
                        self.protectedDNSService = nil
                        self.recoveryCause = nil
                    }
                    if let transitionError {
                        self.errorMessage = transitionError
                    }
                    self.isDisconnecting = false
                    self.disconnectionStartedAt = nil
                    // A network change observed mid-disconnect was held
                    // pending (R1-F5); the teardown has settled, so
                    // reconcile it exactly as a fresh notification would.
                    self.consumePendingNetworkChange()
                }
            }
        }
    )
}

    func disconnectAndWait(releaseKillSwitch: Bool = false) async {
        disconnect(releaseKillSwitch: releaseKillSwitch)
        if releaseKillSwitch { await nativeUpdateDisconnectTask?.value }
        let pending = self.connectionCoordinator.disconnectSequence
        _ = await pending?.value
    }

    func finishPendingDisconnect() async {
        let pending = self.connectionCoordinator.disconnectSequence
        _ = await pending?.value
    }

    private func onCoreStarted(api: CoreControllerClient) async -> Bool {
        guard isConnecting, !Task.isCancelled else { return false }
        coreController = api
        proxyService.setAPI(api)

        // Auto-enable system proxy (skip for TUN mode — TUN handles routing itself)
        var proxyFailed = false
        if !config.tunEnabled {
            do {
                try await PrivilegedRuntimeCoordinator.shared.enableSystemProxy(
                    httpPort: config.mixedPort,
                    socksPort: config.mixedPort
                )
                startProxyGuard()
            } catch {
                errorMessage = String(localized: "System proxy failed: \(error.localizedDescription). Core is running but traffic is NOT proxied.")
                proxyFailed = true
            }
        }

        // Disconnect waits for this task before disabling the system proxy and
        // stopping Mihomo. If cancellation arrived during proxy setup, do not
        // resurrect the UI as connected while that teardown is queued.
        guard isConnecting, !Task.isCancelled else { return false }
        isConnected = true
        lastPhysicalFingerprint = PhysicalInterfaceFingerprint.current()
        isProtectionBlocked = false
        isRecoveringProtectedConnection = false
        isProxyDegraded = proxyFailed
        healthCounters = ProtectedHealthCounters()
        // The exit delay measured on the way in, so the customer timeline can
        // say how far away this node was at the moment it connected.
        let activeName = proxyService.activeNodeName ?? activeNode?.name
        let exitDelayMs = proxyService.lastExitSample.flatMap { sample in
            sample.node == activeName && sample.ms > 0 ? sample.ms : nil
        }
        ConnectionTelemetryBuffer.shared.record(
            "connectOk",
            stage: ConnectionStage.verifyingTraffic.rawValue,
            delayMs: exitDelayMs,
            node: selectedExitNode()?.name,
            generation: Int(self.connectionCoordinator.protectionOperationGeneration),
            transport: selectedExitNode()?.catalogTransport
        )
        do {
            if let pending = try await PrivilegedRuntimeCoordinator.shared.pendingNativeUpdate(), pending.pending {
                _ = try await PrivilegedRuntimeCoordinator.shared.nativeUpdate("commit")
                RuntimeCleanup.nativeUpdatePending = false
                ConnectionTelemetryBuffer.shared.record(
                    "updateResumeOk",
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration),
                    updateResume: true
                )
            }
        } catch {
            // A healthy App connection is not privileged update commit proof.
            updateIncomplete = true
            errorMessage = error.localizedDescription
            ConnectionTelemetryBuffer.shared.record(
                "updateResumeFailed",
                stage: "nativeUpdateRecovery",
                generation: Int(self.connectionCoordinator.protectionOperationGeneration),
                code: ProtectedFailureCode.updateRecoveryFailed.rawValue,
                updateResume: true
            )
        }
        scheduleBackgroundOptionalPolicy()
        startCoreMonitor()
        if managedCatalogReloadPending {
            applyManagedCatalogToRuntime()
        }
        let port = config.externalController.split(separator: ":").last.flatMap { Int($0) } ?? 9090

        // Start WebSocket streams
        trafficFeedLive = false
        connectionsFeedLive = false
        let ws = CoreWebSocket(port: port, secret: config.secret)
        webSocket = ws

        ws.onTraffic = { [weak self] traffic in
            guard let self else { return }
            var stats = self.trafficStats
            stats.uploadSpeed = traffic.up
            stats.downloadSpeed = traffic.down
            self.trafficStats = stats
            self.trafficFeedLive = true
        }

        ws.onConnections = { [weak self] response in
            guard let self else { return }
            self.connectionsFeedLive = true
            if let apiConnections = response.connections {
                LocalTrafficAudit.shared.recordConnections(
                    apiConnections,
                    protection: self.trafficAuditProtectionSnapshot(),
                    residentialContext: self.residentialRouteAuditContext
                )
                // Refresh scheduling depends on this, so it must not be gated on
                // a window being visible: the rest of this handler only feeds
                // the Activity list, but pin refreshes have to make the same
                // decision whether or not anyone is looking at that page.
                self.recordLongLivedRouteActivity(apiConnections)
                // Above the visibility guard deliberately: totals that only
                // advance while someone is looking at Activity would depend on
                // where the user navigated, which is worse than showing none.
                self.appTrafficLedger.ingest(apiConnections)
            }
            // Keep the Activity snapshot even when that page is not visible.
            // Gating it made the first paint a lie ("no connections") until the
            // next 2.5s websocket frame. Mapping 2k rows is cheaper than the
            // old 50-card VStack that this used to protect.
            let visibleConnections = self.updateConnections(from: response)
            var stats = self.trafficStats
            stats.totalUpload = response.uploadTotal
            stats.totalDownload = response.downloadTotal
            // Count what the list actually shows. Counting the raw array made
            // the headline include the loopback DNS rows the list hides, so it
            // read "104 active" above a list of forty.
            stats.activeConnections = visibleConnections
            self.trafficStats = stats
        }

        ws.onLogs = { [weak self] entries in
            LocalTrafficAudit.shared.recordCoreLogs(entries)
            let logsEnabled = AppProfile.defaults.object(forKey: SettingsKey.logsEnabled) as? Bool ?? true
            // Buffer regardless of the visible page. Dropping frames while
            // Logs was off-screen meant a user who connected, browsed, then
            // opened Logs was told "0 records" about a session full of traffic.
            guard logsEnabled, let self else { return }

            let now = Date()
            self.logEntries.append(contentsOf: entries.map {
                LogEntry(level: $0.level, message: $0.message, timestamp: now)
            })
            // Keep last 500 logs
            if self.logEntries.count > 500 {
                self.logEntries.removeFirst(self.logEntries.count - 500)
            }
        }

        ws.onStreamStalled = { [weak self] stream in
            LocalTrafficAudit.shared.recordEvent(
                "audit_observer_stream_stalled",
                details: [
                    "stream": stream,
                    "protection_impact": "none",
                ]
            )
            guard let self else { return }
            if stream == "traffic" { self.trafficFeedLive = false }
            if stream == "connections" { self.connectionsFeedLive = false }
        }
        ws.onStreamRecovered = { [weak self] stream in
            LocalTrafficAudit.shared.recordEvent(
                "audit_observer_stream_recovered",
                details: [
                    "stream": stream,
                    "protection_impact": "none",
                ]
            )
            guard let self else { return }
            if stream == "traffic" { self.trafficFeedLive = true }
            if stream == "connections" { self.connectionsFeedLive = true }
        }

        updateLiveStreamSubscriptions()

        // The generated Tono-Exit group's `now` value is authoritative. Avoid a
        // redundant PF reload + health probe immediately after a successful
        // start; that old round trip made the UI appear connected and then hang.
        networkInfoTask?.cancel()
        networkInfoTask = Task { [weak self] in
            guard let self else { return }
            await self.proxyService.refresh()
            await MainActor.run {
                if let selected = self.proxyService.activeNodeName,
                   self.applyProxySelection(selected) {
                    self.proxyService.activeGroupName = ConfigPipeline.exitGroupName
                    self.persistProxySelection(selected)
                } else {
                    self.restoreProxySelection(persistFallback: true)
                }
            }
            try? await Task.sleep(for: .milliseconds(1_500))
            guard !Task.isCancelled, self.isConnected else { return }
            if let selected = self.proxyService.activeNodeName {
                _ = await self.proxyService.testLatency(name: selected)
            }
            guard !Task.isCancelled, self.isConnected else { return }
            await self.fetchNetworkInfo()
        }
        Task { await fetchActiveRules() }
        startLatencyTestTimer()

        // Legacy subscription networking is available only in the explicitly
        // isolated developer profile. Production server state comes solely
        // from the authenticated managed catalog.
        let failedSubs = AppProfile.isDev
            ? subscriptions.filter { $0.nodeCount == 0 && $0.isEnabled }
            : []
        if !failedSubs.isEmpty, isOwnedTonoMode {
            Task {
                try? await Task.sleep(for: .seconds(2))
                try? await updateAllSubscriptions()
            }
        }

        // A network change observed mid-connect was held pending (R1-F5); the
        // baseline captured above is what the reconciliation compares against,
        // so consume it now. The reconciliation's own debounce waits out this
        // connect's epilogue clearing `isConnecting`.
        consumePendingNetworkChange()
        return true
    }

    /// Controller streams are observation only, never part of TUN/PF safety.
    /// UI-only streams stop with their page. The optional local audit keeps
    /// only its low-frequency connection and route evidence streams alive.
    func updateLiveStreamSubscriptions() {
        guard isConnected, let webSocket else { return }

        // Module 6: Screen lock powers down foreground UI traffic charts to save energy,
        // without touching connectivity health checks, helper monitoring, or pin refresh.
        if isMainWindowVisible && !isScreenLocked,
           selectedPage == .dashboard || selectedPage == .activity {
            webSocket.startTrafficStream()
        } else {
            webSocket.stopTrafficStream()
            trafficStats.uploadSpeed = 0
            trafficStats.downloadSpeed = 0
            // Leaving the dashboard used to keep `trafficFeedLive` true with
            // zeroed rates, so coming back showed "Connected" next to 0 B/s.
            trafficFeedLive = false
        }

        let localAuditEnabled = LocalTrafficAudit.isEnabled
        let claudeTrafficResearchEnabled =
            LocalTrafficAudit.isClaudeTrafficResearchEnabled
        let appRoutingResearchEnabled = AppRoutingResearch.isCollectionActive
        // Pin-refresh scheduling reads this stream, so it has to run for the
        // whole connected session. Gating it on the audit toggle alone meant a
        // user who turned the audit log off — the obvious choice in a privacy
        // product — silently lost every pin refresh, which is the exact
        // stranding this refresher exists to prevent.
        if isConnected || localAuditEnabled || claudeTrafficResearchEnabled
            || appRoutingResearchEnabled
            || (isMainWindowVisible && selectedPage == .activity) {
            webSocket.startConnectionsStream(intervalMilliseconds: 2_500)
        } else {
            webSocket.stopConnectionsStream()
        }

        let logsEnabled =
            AppProfile.defaults.object(forKey: SettingsKey.logsEnabled) as? Bool
                ?? true
        let uiLogsRequested = isMainWindowVisible && !isScreenLocked && selectedPage == .logs && logsEnabled
        if localAuditEnabled || claudeTrafficResearchEnabled || uiLogsRequested {
            webSocket.startLogsStream(level: logLevel)
        } else {
            webSocket.stopLogsStream()
        }
    }

    /// Consecutive health failures before a dead TUN data plane earns one
    /// in-place PF re-arm, and before the ladder ends in the same restart the
    /// unreachable-core code performs. Health probes run every third ten-second
    /// cycle, so these are roughly ninety seconds and three minutes.
    private static let tunRouteRearmAfterFailures = 3
    private static let tunRouteEscalateAfterFailures = 6

    /// Consecutive ticks the owned TUN must stay absent before the monitor
    /// fails closed on it. Runtime replacements (node switch, config reload,
    /// post-connect background policy) restart sing-box through helper
    /// /core/sync and rebuild the interface in well under one tick interval,
    /// so a single missing sighting is not proof the data plane died. A
    /// genuinely dead TUN still fails closed — the verdict waits one
    /// confirmation tick, it is never skipped.
    private static let tunMissingVerdictTicks = 2

    /// Mutable state the core monitor carries across ticks. Production holds
    /// one instance inside the monitor task; tests hold one to drive
    /// `runCoreMonitorTick(state:)` directly.
    struct CoreMonitorState {
        var healthCycle = 0
        var consecutiveHealthFailures = 0
        var tunRouteRearmAttempts = 0
        /// Consecutive ticks that observed the owned TUN absent. Any tick that
        /// sees the interface resets it.
        var consecutiveMissingTUNTicks = 0
    }

    /// Whether the monitor loop should keep ticking after one iteration.
    /// `.stopMonitoring` mirrors the old in-loop `return`: the session is
    /// gone, or a verdict has torn it down.
    enum CoreMonitorTickOutcome {
        case continueMonitoring
        case stopMonitoring
    }

    /// Keep the root-owned Mihomo/TUN path alive while the signed-in sidecar is
    /// healthy. Loss of Mihomo removes its exact utun; detecting that interface
    /// avoids a synchronous helper IPC call on the UI actor. Recovery fails
    /// closed first, then retries the same selected exit.
    private func startCoreMonitor() {
        self.connectionCoordinator.coreMonitorTask?.cancel()
        self.connectionCoordinator.coreMonitorTask = Task { [weak self] in
            var state = CoreMonitorState()
            while !Task.isCancelled {
                let intervalSeconds = state.consecutiveHealthFailures > 0 ? 2 : 5
                try? await Task.sleep(for: .seconds(intervalSeconds))
                guard let self, !Task.isCancelled, self.isConnected else { return }
                if await self.runCoreMonitorTick(state: &state) == .stopMonitoring {
                    return
                }
            }
        }
    }

    /// One iteration of the core monitor. Extracted from the loop above so the
    /// owned-TUN verdict is drivable in tests through the `tunInterfaceExists`
    /// seam; the loop itself only owns sleeping and exit. Every `continue` the
    /// loop used to execute is a `.continueMonitoring` return here, and every
    /// `return` a `.stopMonitoring`.
    func runCoreMonitorTick(state: inout CoreMonitorState) async -> CoreMonitorTickOutcome {
        if self.config.tunEnabled {
            let tunExists = self.tunInterfaceExists(ConfigPipeline.tonoTunInterface)
            if tunExists {
                state.consecutiveMissingTUNTicks = 0
            } else {
                state.consecutiveMissingTUNTicks += 1
                // Node switches, config reloads and the post-connect background
                // policy replacement all restart sing-box through helper
                // /core/sync: the old process is terminated, a new one starts
                // and recreates the owned utun, and PF stays armed across the
                // whole window. The reassert and probe branches below already
                // refuse to race those same tasks; the verdict must hold too,
                // or every replacement landing on a tick is misread as a dead
                // TUN and tears down a healthy session.
                guard self.switchingNodeId == nil,
                      self.connectionCoordinator.configReloadTask == nil else {
                    return .continueMonitoring
                }
                // A replacement that just finished can still leave the new
                // process a fraction of a second from recreating the
                // interface, so one missing sighting without a task in flight
                // is not a verdict either. Require the absence to persist
                // across consecutive ticks; a real TUN death fails closed on
                // the next one.
                guard state.consecutiveMissingTUNTicks >= Self.tunMissingVerdictTicks else {
                    return .continueMonitoring
                }
                self.disconnect(releaseKillSwitch: false)
                self.errorMessage = String(
                    localized: "Protected TUN stopped; Kill Switch is blocking traffic while Tono retries."
                )
                self.scheduleProtectedReconnect()
                return .stopMonitoring
            }
            state.healthCycle += 1
            // Network and DNS changes arrive through SCDynamicStore.
            // Keep a roughly once-per-minute command-based audit only as a
            // fallback for missed notifications (12 cycles * 5s = 60s).
            if state.healthCycle.isMultiple(of: 12),
               let service = self.protectedDNSService {
                // Both probes queue behind the release sequence on the
                // one privileged actor, so a user who taps Restore
                // internet inside this window has their DNS restored
                // *before* these resume. Without re-checking, the stale
                // verdict then re-armed protection and blamed "Protected
                // DNS stopped" — an explicit release silently undone.
                // Cancelling self.connectionCoordinator.coreMonitorTask cannot help: a task
                // suspended on an actor call still resumes.
                let observedGeneration = self.connectionCoordinator.protectionOperationGeneration
                let primaryService =
                    await PrivilegedRuntimeCoordinator.shared
                        .primaryNetworkService()
                guard !Task.isCancelled, self.isConnected,
                  self.connectionCoordinator.protectionOperationGeneration == observedGeneration
                else { return .stopMonitoring }
                guard primaryService == service else {
                    self.recoveryCause = .networkChange
                    self.disconnect(releaseKillSwitch: false)
                    self.errorMessage = String(
                        localized: "The active network changed; Kill Switch is blocking traffic while Tono protects the new connection."
                    )
                    self.scheduleProtectedReconnect()
                    return .stopMonitoring
                }
                let dnsIntegrity =
                    await PrivilegedRuntimeCoordinator.shared
                        .protectedDNSIntegrity(service: service)
                guard !Task.isCancelled, self.isConnected,
                  self.connectionCoordinator.protectionOperationGeneration == observedGeneration
                else { return .stopMonitoring }
                guard dnsIntegrity != .unverifiable else { return .continueMonitoring }
                guard dnsIntegrity == .intact else {
                    self.disconnect(releaseKillSwitch: false)
                    self.errorMessage = String(
                        localized: "Protected DNS stopped; Kill Switch is blocking traffic while Tono retries."
                    )
                    self.scheduleProtectedReconnect()
                    return .stopMonitoring
                }
            }
        }

        guard self.isOwnedTonoMode else { return .continueMonitoring }
        if !self.config.tunEnabled { state.healthCycle += 1 }
        // Browser preferences can change after connect. Recheck on the
        // same one-minute cadence as protected system DNS so a newly
        // enabled explicit DoH mode cannot leave a residential claim
        // active for the rest of a long-running session.
        if state.healthCycle.isMultiple(of: 6), self.isClaudeHomeConfigured {
            let observedGeneration = self.connectionCoordinator.protectionOperationGeneration
            let browserDNS = await self.scanBrowserProtectedDNS()
            guard !Task.isCancelled, self.isConnected,
                  self.connectionCoordinator.protectionOperationGeneration == observedGeneration
            else { return .stopMonitoring }
            self.recordBrowserDNSPreflight(browserDNS)
            guard browserDNS.outcome == .clear else {
                self.lastClassifiedFailure = ProtectedConnectivity.failure(
                    .protectedDnsNotReady,
                    stage: "health",
                    attempt: state.healthCycle,
                    generation: observedGeneration,
                    detail: browserDNS.diagnosticDetail
                )
                self.disconnect(releaseKillSwitch: false)
                self.errorMessage = browserDNS.failureMessage
                return .stopMonitoring
            }
        }
        // A catalog held back for an in-flight stream has to be
        // retried from somewhere, or the deferral becomes a discard.
        if self.managedCatalogReloadPending {
            self.applyManagedCatalogToRuntime()
        }
        // A helper self-heal reinstalls PF from persisted state, which
        // deliberately omits this session's direct exceptions — Mihomo
        // keeps routing WeChat direct while PF silently drops it.
        // Re-arm with the live session's endpoints as soon as the
        // helper reports a heal.
        // Never race a node switch or config reload: both arm PF with
        // transaction-specific endpoint unions this reassert would
        // clobber. The flag stays set and retries next cycle.
        if KillSwitchService.needsSessionExceptionReassert,
           self.switchingNodeId == nil,
           self.connectionCoordinator.configReloadTask == nil {
            LocalTrafficAudit.shared.recordEvent(
                "killswitch_heal_reassert",
                details: [
                    "session_endpoints": String(
                        self.activeDirectPolicy?.sessionEndpoints.count ?? 0
                    ),
                ]
            )
            do {
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    apiHosts: [],
                    tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                    proxyEndpoints: self.currentProxyEndpoints(),
                    sessionDirectEndpoints:
                        self.activeDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled:
                        AppProfile.homeExitEnabled && self.tonoTransport != nil,
                    helperPrepared: true,
                    reviewedBundleDirect:
                        self.activeDirectPolicy?.requiresAddressFreeDirectPermit == true
                )
                // Only a successful re-arm may consume the intent: a
                // busy helper or a generation-guard rejection must
                // leave the flag set so the next tick retries instead
                // of silently black-holing session direct traffic.
                KillSwitchService.needsSessionExceptionReassert = false
            } catch {
                LocalTrafficAudit.shared.recordEvent(
                    "killswitch_heal_reassert_failed",
                    details: ["error": error.localizedDescription]
                )
            }
        }
        // This refresh existed because pins were the only thing routing
        // these hosts direct, so a rotated CDN answer stranded the flow
        // on a stale /32. Pins are no longer that load-bearing: the
        // reviewed bundle routes direct by process path, and the web
        // hosts route direct by domain suffix with China DoH behind
        // them. Neither reads a pin.
        //
        // What the refresh does still cost is exact and measured. It
        // rewrites the runtime config, and `api.reloadConfig` tears
        // down every connection in the session — timed here at 21m26s
        // after connect, with all 20 health probes then timing out and
        // zero targets reachable directly. That is the customer-facing
        // "Connection closed mid-response" in AI tools and long
        // downloads, and it recurred for as long as a session stayed
        // up. Address churn is normal CDN behaviour; severing every
        // long-lived connection to chase it is not a trade worth
        // making now that nothing depends on the result.
        //
        // Pins therefore stay a connect-time snapshot and a redundant
        // narrower match. A stale one costs a redundant rule, not a
        // route: the suffix and process rules still resolve and dial
        // the current address.
        //
        // A policy with no suffix routes has no such backstop, so the
        // refresh stays available for it rather than being deleted.
        // The same predicate the decision uses, so the schedule and the
        // decision cannot drift apart into a refresh that is scheduled
        // and then always declined, or worse the reverse.
        let pinsAreLoadBearing =
            self.activeDirectPolicy?.webDomainSuffixes.isEmpty ?? false
        if pinsAreLoadBearing, state.healthCycle.isMultiple(of: 30) {
            await self.refreshManagedDirectPins()
            guard !Task.isCancelled, self.isConnected else { return .stopMonitoring }
        }
        // Full external probes are recovery/liveness checks, not the
        // leak barrier. In healthy state, probe every 2 cycles (10s)
        // to maintain low overhead. In degraded state (consecutiveHealthFailures > 0),
        // probe immediately on every 2-second cycle for rapid 3-4s self-healing.
        let shouldProbeTraffic = state.consecutiveHealthFailures > 0 || state.healthCycle.isMultiple(of: 2)
        guard shouldProbeTraffic,
              self.switchingNodeId == nil,
              self.connectionCoordinator.configReloadTask == nil,
              let api = self.coreController
        else { return .continueMonitoring }

        let controllerTask = Task {
            await self.advisoryControllerExitProbe(
                api: api,
                selectedExit: self.selectedExitNode()
            )
        }
        let tun = await ProtectedConnectivityVerifier.raceSystemTUNProbes(
            timeoutSeconds: 6,
            preferredLabel: self.lastSuccessfulProbeOrigin
        )
        if case .won(let label) = tun {
            self.lastSuccessfulProbeOrigin = label
        }
        let controller: ProbeCheck
        if case .won = tun {
            controllerTask.cancel()
            controller = .ok
        } else {
            controller = await controllerTask.value
        }
        guard !Task.isCancelled, self.isConnected else { return .stopMonitoring }
        guard self.switchingNodeId == nil,
              self.connectionCoordinator.configReloadTask == nil else {
            state.consecutiveHealthFailures = 0
            return .continueMonitoring
        }
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: controller,
            tun: tun.tunCheck,
            networkOffline: PhysicalNetworkReachability.shared
                .isPhysicallyOffline,
            stage: "health",
            attempt: state.healthCycle,
            generation: self.connectionCoordinator.protectionOperationGeneration
        )
        switch decision {
        case .connected(let advisory):
            state.consecutiveHealthFailures = 0
            state.tunRouteRearmAttempts = 0
            self.healthCounters.recordSuccess(
                controller: advisory == nil,
                dns: true,
                tun: true,
                core: true
            )
            if let advisory {
                self.healthCounters.recordFailure(
                    controller: true, dns: false, tun: false, core: false
                )
                ConnectionTelemetryBuffer.shared.record(
                    "controllerExitAdvisory",
                    reason: ProtectedFailureCode.probeOriginDegraded.rawValue,
                    error: advisory,
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration)
                )
            }
            self.isProxyDegraded = advisory != nil
            self.isRecoveringProtectedConnection = false
            // The connection healed on its own. Leaving the retry-loop
            // message in place kept "last error" showing a failure that
            // had already resolved, which sends support down the wrong
            // path.
            if advisory == nil { self.errorMessage = nil }
            return .continueMonitoring
        case .retry(let failure):
            self.lastClassifiedFailure = failure
            let controllerFailed: Bool
            if case .failed = controller {
                controllerFailed = true
            } else {
                controllerFailed = false
            }
            self.healthCounters.recordFailure(
                controller: controllerFailed,
                dns: failure.code == .protectedDnsNotReady,
                tun: true,
                core: failure.code == .coreExitUnreachable
            )
            state.consecutiveHealthFailures += 1
            self.isProxyDegraded = true
            ConnectionTelemetryBuffer.shared.record(
                "probeResult",
                reason: failure.code.rawValue,
                error: failure.detail,
                counter: state.consecutiveHealthFailures,
                generation: Int(self.connectionCoordinator.protectionOperationGeneration)
            )
            guard self.healthCounters.shouldEnterRecovering
                || state.consecutiveHealthFailures >= 2 else {
                return .continueMonitoring
            }
            self.isRecoveringProtectedConnection = true
            ConnectionTelemetryBuffer.shared.record(
                "recoveryBegin",
                reason: failure.code.rawValue,
                generation: Int(self.connectionCoordinator.protectionOperationGeneration)
            )
            // Recover in place first. Restart or switch the core when the
            // node/core path or the real TUN data path is proven dead.
            if (failure.code == .coreExitUnreachable || failure.code == .tunRouteUnavailable),
               await self.attemptAutomaticCloudFailover() {
                state.consecutiveHealthFailures = 0
                self.healthCounters = ProtectedHealthCounters()
                self.isProxyDegraded = false
                self.isRecoveringProtectedConnection = false
                return .continueMonitoring
            }
            if failure.code == .networkEnvironmentOffline {
                self.errorMessage = failure.userMessage
                return .continueMonitoring
            }
            if failure.code == .tunRouteUnavailable {
                // The ten-second check above only proves utun199
                // exists; a data plane that has stopped carrying
                // packets keeps that check green forever, so this code
                // used to park the session in Recovering for the rest
                // of its life with no counter and no remedy.
                //
                // One in-place remedy is worth trying first: a helper
                // self-heal reinstalls PF from persisted state without
                // this session's exact endpoints, which drops the
                // exit's dial tuples while Mihomo keeps routing to
                // them. Re-arm with the live session, let the next
                // cycle re-verify, and if the route is still dead take
                // the same restart the unreachable-core code takes.
                if state.consecutiveHealthFailures < Self.tunRouteRearmAfterFailures {
                    self.errorMessage = String(localized: "Recovering protected connection…")
                    return .continueMonitoring
                }
                if state.tunRouteRearmAttempts == 0 {
                    // A restatement of the guard taken before the
                    // classification above — nothing between the two
                    // suspends — so that the arm below carries its own
                    // precondition instead of inheriting one from far
                    // up the loop. Both a node switch and a config
                    // reload hold PF with transaction-specific endpoint
                    // unions this re-arm would clobber, so a cycle that
                    // finds either simply retries at the next one.
                    guard self.switchingNodeId == nil,
                          self.connectionCoordinator.configReloadTask == nil else {
                        self.errorMessage = String(localized: "Recovering protected connection…")
                        return .continueMonitoring
                    }
                    state.tunRouteRearmAttempts += 1
                    LocalTrafficAudit.shared.recordEvent(
                        "tun_route_rearm",
                        details: [
                            "failures": String(state.consecutiveHealthFailures),
                            "session_endpoints": String(
                                self.activeDirectPolicy?.sessionEndpoints.count ?? 0
                            ),
                        ]
                    )
                    do {
                        try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                            apiHosts: [],
                            tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                            proxyEndpoints: self.currentProxyEndpoints(),
                            sessionDirectEndpoints:
                                self.activeDirectPolicy?.sessionEndpoints ?? [],
                            tailscaleBootstrapEnabled:
                                AppProfile.homeExitEnabled && self.tonoTransport != nil,
                            helperPrepared: true,
                            reviewedBundleDirect:
                                self.activeDirectPolicy?.requiresAddressFreeDirectPermit == true
                        )
                    } catch {
                        LocalTrafficAudit.shared.recordEvent(
                            "tun_route_rearm_failed",
                            details: ["error": error.localizedDescription]
                        )
                    }
                    guard !Task.isCancelled, self.isConnected else { return .stopMonitoring }
                    self.errorMessage = String(localized: "Recovering protected connection…")
                    return .continueMonitoring
                }
                if state.consecutiveHealthFailures < Self.tunRouteEscalateAfterFailures {
                    self.errorMessage = String(localized: "Recovering protected connection…")
                    return .continueMonitoring
                }
            } else if failure.code != .coreExitUnreachable {
                self.errorMessage = String(localized: "Recovering protected connection…")
                return .continueMonitoring
            }
            guard self.isConnected, !self.isDisconnecting else { return .stopMonitoring }
            self.disconnect(releaseKillSwitch: false)
            self.errorMessage = failure.userMessage
            self.scheduleProtectedReconnect()
            return .stopMonitoring
        }
    }

    /// Switch to one alternate validated managed cloud exit without releasing
    /// the protected TUN/PF transaction. Home-US as the selected exit can also
    /// fail over onto a catalog cloud node; Claude's residential hop is unchanged
    /// when a cloud node was already selected and only the dialer moves.
    private func attemptAutomaticCloudFailover() async -> Bool {
        guard isConnected,
              !isDisconnecting,
              switchingNodeId == nil,
              self.connectionCoordinator.configReloadTask == nil else {
            return false
        }
        let current = selectedExitNode()
        let catalog = managedCatalogNodes
        guard catalog.count > (current == nil ? 0 : 1) else {
            LocalTrafficAudit.shared.recordEvent(
                "automatic_cloud_failover_unavailable",
                details: ["reason": current == nil
                    ? "no_validated_cloud_node"
                    : "single_validated_node"]
            )
            return false
        }

        guard let candidate = nextCatalogExit(after: current, in: catalog) else {
            return false
        }

        LocalTrafficAudit.shared.recordEvent(
            "automatic_cloud_failover_requested",
            details: [
                "from": current?.name ?? ConfigPipeline.homeNodeName,
                "to": candidate.name,
            ]
        )
        selectNode(candidate.name)
        guard let switchTask = self.connectionCoordinator.nodeSwitchTask else { return false }
        _ = await switchTask.value
        guard !Task.isCancelled,
              isConnected,
              !isDisconnecting,
              switchingNodeId == nil,
              let active = selectedExitNode(),
              active.id == candidate.id else {
            return false
        }
        errorMessage = nil
        LocalTrafficAudit.shared.recordEvent(
            "automatic_cloud_failover_succeeded",
            details: ["selected_exit": candidate.name]
        )
        return true
    }

    /// Non-prompting foreground reconciliation for the documented root
    /// emergency recovery path. Only an authenticated helper response that
    /// confirms both armed=false and wanted=false may clear Protected Offline.
    func reconcileExternalProtectionState() {
        guard isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return }
        Task { [weak self] in
            _ = await self?.reconcileConfirmedExternalProtectionRelease()
        }
    }

    /// Returns true only when a confirmed external release was accepted. Every
    /// unavailable, malformed, or rejecting response remains fail-closed.
    /// `protectionWasArmed` carries the app's armed intent from when the caller
    /// scheduled its recovery: a session this app itself tore down before the
    /// first arm (mid-connect policy update, the wake handoff after the sleep
    /// path already disarmed) also leaves `isProtectionBlocked` set, and a
    /// helper that was never asked to arm answers with no persisted state —
    /// reading that as an external release silently drops the connect intent
    /// the recovery exists to fulfill.
    @discardableResult
    private func reconcileConfirmedExternalProtectionRelease(
        protectionWasArmed: Bool = true
    ) async -> Bool {
        guard protectionWasArmed, isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return false }
        let observedGeneration = self.connectionCoordinator.protectionOperationGeneration
        let networkProtection = self.networkProtection
        let observation = await networkProtection.refreshKillSwitchStatus()
        guard !Task.isCancelled,
              self.connectionCoordinator.protectionOperationGeneration == observedGeneration,
              isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return false }

        switch observation {
        case .unavailable:
            return false
        case .rejected:
            // No automatic retry can make an identity/UID rejection succeed.
            // Do not prompt on activation; the explicit Protected Offline
            // action owns the one administrator repair attempt.
            protectedReconnectPausedForUserAction = true
            protectedReconnectPauseLiftsOnNetworkChange = false
            self.connectionCoordinator.protectedReconnectTask?.cancel()
            self.connectionCoordinator.protectedReconnectTask = nil
            self.connectionCoordinator.protectedReconnectID = nil
            isProtectedReconnectScheduled = false
            protectedReconnectNextAttemptAt = nil
            errorMessage =
                String(
                    localized: "Tono's network helper rejected this copy of Tono, so automatic retries are paused. Choose Repair and reconnect to reinstall the helper, or Restore internet to turn protection off. If repair keeps failing, the Support page has a recovery command."
                )
            return false
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            guard !requiresProtectionRecovery else { return false }
            acceptConfirmedExternalProtectionRelease()
            return true
        }
    }

    private func acceptConfirmedExternalProtectionRelease() {
        self.connectionCoordinator.bumpGeneration()
        recoveryCause = nil
        KillSwitchService.isArmed = false
        KillSwitchService.needsSessionExceptionReassert = false
        self.connectionCoordinator.protectedReconnectTask?.cancel()
        self.connectionCoordinator.protectedReconnectTask = nil
        self.connectionCoordinator.protectedReconnectID = nil
        self.connectionCoordinator.lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectAttempt = 0
        protectedReconnectNextAttemptAt = nil
        protectedReconnectPausedForUserAction = false
        protectedReconnectPauseLiftsOnNetworkChange = false
        lastProtectedFailureSignature = nil
        consecutiveProtectedFailureCount = 0
        self.connectionCoordinator.wakeRecoveryTask?.cancel()
        self.connectionCoordinator.wakeRecoveryTask = nil
        self.connectionCoordinator.sleepRestrictTask?.cancel()
        self.connectionCoordinator.sleepRestrictTask = nil
        resumeProtectionAfterWake = false
        autoConnectRequested = false
        connectionStartedAt = nil
        connectionStageStartedAt = nil
        completedConnectionStages = []
        lastConnectionFailure = nil
        protectedDNSService = nil
        isProtectionBlocked = false
        errorMessage = nil
        LocalTrafficAudit.shared.recordEvent(
            "external_protection_release_confirmed"
        )
    }

    /// Failures the automatic reconnect loop can never resolve: repeating the
    /// identical transaction would re-raise the same administrator prompt or
    /// fail installation the same way. Weak-network and transient helper
    /// errors deliberately stay retryable.
    private static func failureRequiresUserAction(_ error: Error) -> Bool {
        switch error {
        case KillSwitchService.Error.userDenied,
             KillSwitchService.Error.installFailed,
             KillSwitchService.Error.helperRejected,
             HelperInstallError.userDenied,
             HelperInstallError.resourceNotFound,
             HelperInstallError.installFailed,
             HelperIPCError.forbidden:
            true
        default:
            false
        }
    }

    func scheduleProtectedReconnect(immediate: Bool = false) {
        guard !nativeUpdatePending, !RuntimeCleanup.nativeUpdateBlocksConnect else { return }
        // A network-change kick carries new information: a repeated-failure
        // pause may be lifted (the environment changed, the outcome can
        // differ). A user-action pause stays — only Retry Now lifts it, or
        // the admin prompt would re-appear on every route flap.
        if immediate, protectedReconnectPausedForUserAction,
           protectedReconnectPauseLiftsOnNetworkChange {
            protectedReconnectPausedForUserAction = false
            protectedReconnectPauseLiftsOnNetworkChange = false
            lastProtectedFailureSignature = nil
            consecutiveProtectedFailureCount = 0
        }

        // Snapshot before scheduling: this is the armed intent the pending
        // teardown inherited. An internal transition that tears the session
        // down before the first arm (mid-connect policy update, the wake
        // handoff after the sleep path already disarmed) schedules this loop
        // with `isArmed == false`, and its own teardown is what left
        // `isProtectionBlocked` set — the loop must not later read the
        // never-armed helper's "no persisted state" answer as an external
        // release and abandon the connect intent it exists to fulfill.
        let protectionWasArmedWhenScheduled = KillSwitchService.isArmed

        self.connectionCoordinator.scheduleProtectedReconnectLoop(
            immediate: immediate,
            onAttemptScheduled: { [weak self] attempt, delay in
                guard let self else { return false }
                if self.protectedReconnectPausedForUserAction { return false }
                self.isProtectedReconnectScheduled = true
                self.protectedReconnectAttempt = attempt + 1
                self.protectedReconnectNextAttemptAt = delay > 0
                    ? Date().addingTimeInterval(delay)
                    : nil
                return true
            },
            onCleanup: { [weak self] in
                guard let self else { return }
                self.isProtectedReconnectScheduled = false
                self.protectedReconnectNextAttemptAt = nil
                if self.isConnected || !self.isProtectionBlocked {
                    self.protectedReconnectAttempt = 0
                }
            },
            performAttempt: { [weak self] in
                guard let self else { return true }
                if !self.isTonoReady {
                    return false
                }
                self.protectedReconnectNextAttemptAt = nil

                await self.finishPendingDisconnect()
                guard !Task.isCancelled, !self.isConnected else { return true }
                // Root emergency recovery may have released helper-owned PF
                // state while this loop was sleeping. Accept only an
                // authenticated unarmed status and exit before connect can
                // re-arm it; rejection pauses for explicit helper repair. A
                // loop scheduled without armed protection skips the check:
                // only its own never-armed teardown could have produced the
                // blocked claim, and that is not an external release.
                if await self.reconcileConfirmedExternalProtectionRelease(
                    protectionWasArmed: protectionWasArmedWhenScheduled
                ) {
                    return true
                }
                guard !Task.isCancelled,
                      !self.protectedReconnectPausedForUserAction else { return true }
                if self.catalogSelectionRequiresChoice {
                    return true
                }
                if self.isConnecting {
                    let pending = self.connectionCoordinator.connectTask
                    _ = await pending?.value
                } else if !self.isDisconnecting {
                    LocalTrafficAudit.shared.recordEvent(
                        "protected_reconnect_attempt",
                        details: [
                            "selected_exit": self.selectedExitNode()?.name ?? "unknown",
                        ]
                    )
                    self.connect()
                    let pending = self.connectionCoordinator.connectTask
                    _ = await pending?.value
                }
                await self.finishPendingDisconnect()
                return self.isConnected
            }
        )
    }

    /// Let the user bypass the weak-network backoff without weakening PF. The
    /// previous recovery loop is cancelled by ID before a new immediate loop
    /// waits for any in-flight teardown and starts the same full transaction.
    func retryProtectedConnectionNow() {
        guard isProtectionBlocked, !isConnected, !isConnecting else { return }
        protectedReconnectPausedForUserAction = false
        protectedReconnectPauseLiftsOnNetworkChange = false
        // Explicit user intent earns a fresh cycle of three attempts, not a
        // single shot against a counter already sitting at the threshold.
        lastProtectedFailureSignature = nil
        consecutiveProtectedFailureCount = 0
        clearCatalogFailoverSweep()
        self.connectionCoordinator.protectedReconnectTask?.cancel()
        self.connectionCoordinator.protectedReconnectTask = nil
        self.connectionCoordinator.protectedReconnectID = nil
        self.connectionCoordinator.lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectNextAttemptAt = nil
        scheduleProtectedReconnect(immediate: true)
    }

    /// Catalog hy2 the user can pick by hand. Prefer same-city; otherwise
    /// another city (Tokyo UDP is blocked, so China may need Dedirock).
    /// Offered while protected-offline unless the classified failure is
    /// something hy2 cannot answer (DNS, helper, TUN). Restart may have
    /// dropped the classified record; still name the row. A first-connect
    /// handshake eof fully releases protection, so the dashboard must still
    /// offer this next hand while disconnected.
    func backupHy2SiblingName() -> String? {
        if let code = lastClassifiedFailure?.code {
            switch code {
            case .coreExitUnreachable, .unknownClassifiedFailure:
                break
            default:
                return nil
            }
        }
        let selected = currentProxySelectionTarget() ?? activeNode?.name
        guard let selected else { return nil }
        let names = Set(importedExitNodes.map(\.name))
        return ProxyNode.backupChannelName(selected: selected, catalogNames: names)
    }

    func shouldOfferManualBackupChannel() -> Bool {
        ManualBackupChannelOffer.shouldShow(
            hasSibling: backupHy2SiblingName() != nil,
            protectionBlocked: isProtectionBlocked,
            connecting: isConnecting,
            connected: isConnected,
            disconnecting: isDisconnecting,
            hasFailureRecord: lastConnectionFailure != nil || lastClassifiedFailure != nil
        )
    }

    /// User-tapped next hand. Does not run on its own (G2.8 stays off).
    func tryBackupChannelManually() {
        guard let backup = backupHy2SiblingName() else { return }
        guard applyProxySelection(backup) else { return }
        persistProxySelection(backup)
        if isProtectionBlocked {
            retryProtectedConnectionNow()
        } else {
            connect()
        }
    }

}

enum CatalogCityFailover {
    /// Live connect used to hop cities on `CORE_EXIT_UNREACHABLE`. From China
    /// that is the same TLS close on every city, so the picker jumped and the
    /// backup-channel button never sat on a stable city. Windows already left
    /// `rotate_catalog_exit_after_failure` off the live path. Keep this off
    /// until G2.8 has home-broadband proof.
    static func shouldRotate(after _: ProtectedFailureCode?) -> Bool {
        false
    }
}

enum IdleCatalogSelect {
    /// Idle disconnected: picking a city (including hy2) is Connect.
    static func shouldConnect(
        connected: Bool,
        protectionBlocked: Bool,
        connecting: Bool = false
    ) -> Bool {
        !connected && !protectionBlocked && !connecting
    }

    /// Protected Offline: picking a city retries in place, same as Retry now.
    static func shouldRetryProtected(connected: Bool, protectionBlocked: Bool) -> Bool {
        !connected && protectionBlocked
    }
}

enum ManualBackupChannelOffer {
    /// Protected Offline (including restart), or a released first-connect
    /// handshake failure. Idle disconnected must not show the button.
    static func shouldShow(
        hasSibling: Bool,
        protectionBlocked: Bool,
        connecting: Bool,
        connected: Bool,
        disconnecting: Bool,
        hasFailureRecord: Bool
    ) -> Bool {
        guard hasSibling, !connecting, !connected, !disconnecting else { return false }
        return protectionBlocked || hasFailureRecord
    }
}

enum ReleasedConnectFailureActions {
    /// First-connect handshake eof fully releases protection. Retry must call
    /// Connect (not protected retry) and still offer another route, even when
    /// the catalog has no hy2 sibling.
    static func shouldOfferRetryAndRoute(
        protectionBlocked: Bool,
        connecting: Bool,
        disconnecting: Bool,
        hasFailureRecord: Bool
    ) -> Bool {
        hasFailureRecord && !protectionBlocked && !connecting && !disconnecting
    }
}
