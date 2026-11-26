import SwiftUI

extension AppState {
    // MARK: - Proxy Management

    struct NodeSwitchOperations {
        var armKillSwitch: (_ proxyEndpoints: [ConfigPipeline.DialEndpoint]) async throws -> Void
        var applyRuntimeConfig: (_ overlay: ConfigPipeline.OverlayConfig) async throws -> Void
        var waitForTunnel: () async -> Bool
        var verify: (_ selectedExit: ProxyNode?) async throws -> ConnectivityVerdict
        var closeConnections: (_ exitName: String?) async -> Void
        var rememberNode: (_ node: ProxyNode?, _ name: String) -> Void
        var refreshProxy: () async -> Void
    }

    private func defaultNodeSwitchOperations(
        api: CoreControllerClient,
        generation: UInt64
    ) -> NodeSwitchOperations {
        NodeSwitchOperations(
            armKillSwitch: { [weak self] proxyEndpoints in
                guard let self else { throw CancellationError() }
                try await self.armSwitchKillSwitch(proxyEndpoints: proxyEndpoints)
            },
            applyRuntimeConfig: { [weak self] overlay in
                guard let self else { throw CancellationError() }
                let runtimeNodes = self.importedExitNodes
                let digest = try await self.coreRuntime.writeRuntimeConfig(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: self.activeDirectPolicy,
                    installed: self.loadedRuntimeConfigDigest
                )
                try Task.checkCancellation()
                let path: String
                do {
                    path = try await PrivilegedRuntimeCoordinator.shared.syncCoreConfig(
                        configDirectory: self.coreRuntime.configDirectory.path,
                        configSHA256: digest
                    )
                } catch {
                    if Self.syncReplyWasLost(error) { self.loadedRuntimeConfigDigest = nil }
                    throw error
                }
                try Task.checkCancellation()
                self.loadedRuntimeConfigDigest = digest
                try await api.reloadConfig(path: path)
                self.commitResidentialRouteAuditContext(
                    overlay: overlay,
                    nodes: runtimeNodes,
                    digest: digest
                )
            },
            waitForTunnel: { [weak self] in
                guard await AppState.waitForOwnedTunnelInterface() else { return false }
                guard let self else { return false }
                _ = await self.testLocalProtectedDNS(timeout: 2)
                return true
            },
            verify: { [weak self] selectedExit in
                guard let self else { throw CancellationError() }
                return await self.verifyProtectedConnection(
                    advisoryProbe: {
                        Task {
                            await self.advisoryControllerExitProbe(
                                api: api,
                                selectedExit: selectedExit
                            )
                        }
                    },
                    mixedPort: self.config.mixedPort,
                    generation: generation,
                    rounds: 1
                )
            },
            closeConnections: { [weak self] exitName in
                guard let self else { return }
                await self.closeConnectionsBoundToExit(exitName, using: api)
            },
            rememberNode: { [weak self] node, name in
                self?.rememberSwitchedNode(node, name: name)
            },
            refreshProxy: { [weak self] in
                await self?.proxyService.refresh()
            }
        )
    }

    /// Select a node/group by name or id.
    func selectNode(_ nameOrId: String, releaseNetworkIfSwitchFails: Bool = false,
                    forceRuntimeReplacement: Bool = false,
                    operations: NodeSwitchOperations? = nil) {
        guard !isDisconnecting, switchingNodeId == nil else { return }
        guard connectionCoordinator.configReloadTask == nil else {
            errorMessage = String(
                localized: "Secure routing is updating. Try switching the cloud server again in a moment."
            )
            return
        }
        if nameOrId == ConfigPipeline.homeNodeName,
           !AppProfile.homeExitEnabled || tonoTransport == nil {
            errorMessage = String(localized: "Home-US is temporarily disabled. Choose a managed cloud server.")
            return
        }
        let desiredNode = nameOrId == ConfigPipeline.homeNodeName
            ? nil
            : localProxyNode(matching: nameOrId)
        let nodeName = desiredNode?.name ?? ConfigPipeline.homeNodeName
        guard nameOrId == ConfigPipeline.homeNodeName || desiredNode != nil else {
            errorMessage = String(localized: "The selected node is unavailable.")
            return
        }
        if let desiredNode, let reason = ConfigPipeline.singBoxUnavailableReason(desiredNode) {
            errorMessage = reason + ": this sing-box build cannot authenticate the catalog's HY2 certificate pin. Choose Reality."
            return
        }
        if isConnected, !forceRuntimeReplacement,
           let current = proxyService.activeNodeName,
           proxyTarget(current, matches: nodeName) {
            hy2AutoSwitch.noteManualSelection(nodeName)
            selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
            activeNode = desiredNode
            persistProxySelection(nodeName)
            networkInfoTask?.cancel()
            networkInfoTask = Task { [weak self] in
                await self?.fetchNetworkInfo()
            }
            return
        }
        if isConnected, coreRuntime.routingMode == "three-tier" {
            errorMessage = String(localized: "Disconnect before switching cloud servers in Strict mode.")
            return
        }
        // A17: a pick is the user's own block. Manual hy2 stays hy2, and the
        // node's automatic-switch memory starts over.
        hy2AutoSwitch.noteManualSelection(nodeName)

        guard isConnected else {
            selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
            activeNode = desiredNode
            proxyService.activeNodeName = nodeName
            persistProxySelection(nodeName)
            catalogSelectionRequiresChoice = false
            // First-connect handshake eof fully releases protection, so a
            // tap on the server list used to persist only. The card already
            // feels like Connect; actually connect. Protected Offline retries
            // in place, same as Retry now / Try backup channel.
            if IdleCatalogSelect.shouldRetryProtected(
                connected: false,
                protectionBlocked: isProtectionBlocked
            ) {
                retryProtectedConnectionNow()
            } else if IdleCatalogSelect.shouldConnect(
                connected: false,
                protectionBlocked: isProtectionBlocked,
                connecting: isConnecting
            ) {
                userConnect()
            }
            return
        }
        // Cancel previous IP detection
        networkInfoTask?.cancel()
        let previousNetworkInfo = networkInfo
        networkInfo = NetworkInfo()
        switchingNodeId = desiredNode?.id ?? nodeName
        let api = coreController
        let switchStartedAt = Date()
        LocalTrafficAudit.shared.recordEvent(
            "node_switch_requested",
            details: [
                "from": proxyService.activeNodeName ?? "unknown",
                "to": nodeName,
            ]
        )
        let switchGeneration = connectionCoordinator.protectionOperationGeneration
        let routeOwner = ManagedExitCatalogOwnership.currentAccount
        let routeCatalogDigest = managedCatalogDigest
        connectionCoordinator.nodeSwitchTask = Task { [weak self] in
            guard let self else { return }
            var switchTargetRejected = false
            var recoveryHandledSelection = false
            defer {
                self.switchingNodeId = nil
                if self.connectionCoordinator.protectionOperationGeneration == switchGeneration {
                    self.startPendingConfigReloadIfPossible()
                } else if !switchTargetRejected,
                          !recoveryHandledSelection,
                          !self.isConnected,
                          !self.connectionCoordinator.disconnectQueueRequestsRelease {
                    // A preserve teardown (sleep, network change, policy
                    // update) retired this switch. Its reconnect must go where
                    // the switch was going, not back to the exit it was
                    // leaving (X1-5). The session is already down, so this is
                    // the next connect target, not a claim about the runtime.
                    if nodeName == ConfigPipeline.homeNodeName,
                       AppProfile.homeExitEnabled,
                       self.tonoTransport != nil {
                        self.rememberSwitchedNode(nil, name: nodeName)
                    } else if nodeName != ConfigPipeline.homeNodeName,
                              let current = self.localProxyNode(matching: nodeName) {
                        self.rememberSwitchedNode(current, name: current.name)
                    }
                }
            }
            let ops: NodeSwitchOperations
            if let operations {
                ops = operations
            } else {
                guard let api else { return }
                ops = defaultNodeSwitchOperations(api: api, generation: switchGeneration)
            }
            @MainActor func checkSwitchCurrent() throws {
                try Task.checkCancellation()
                guard self.connectionCoordinator.protectionOperationGeneration == switchGeneration else {
                    throw CancellationError()
                }
            }
            // Until a verified selector has an exact endpoint set, a failed arm/rollback
            // cannot be treated as an ordinary UI error over a still-Connected session.
            var protectionTransitionInFlight = false
            var recoveryNode = desiredNode
            var recoveryName = nodeName
            SingBoxDelayGate.suspend()
            defer {
                if self.isConnected { SingBoxDelayGate.prove() }
            }
            do {
                try checkSwitchCurrent()
                let previousName = self.proxyService.activeNodeName
                let previousNode: ProxyNode? = previousName == ConfigPipeline.homeNodeName
                    ? nil
                    : (self.selectedExitNode() ?? previousName.flatMap { self.localProxyNode(matching: $0) })
                let previousEndpoints = self.currentProxyEndpoints()
                let previousClassifiedFailure = self.lastClassifiedFailure
                let nextEndpoints = try ConfigPipeline.dialEndpoints(for: desiredNode)
                    + self.claudeHomeDialEndpoints(excluding: desiredNode)
                let transitionEndpoints = ConfigPipeline.uniqueDialEndpoints(
                    previousEndpoints + nextEndpoints
                )
                // Old ∪ new first. Arming only the new destination blocked the
                // still-selected old exit; a failed switch then rolled the
                // selector back without restoring that PF permit.
                protectionTransitionInFlight = true
                try await ops.armKillSwitch(transitionEndpoints)
                try checkSwitchCurrent()
                ConnectionTelemetryBuffer.shared.record(
                    "switchBegin",
                    node: desiredNode?.id,
                    generation: Int(switchGeneration)
                )
                var switchError: Error?
                do {
                    var nextOverlay = self.currentOwnedRuntimeOverlay()
                    nextOverlay.selectedNodeName = nodeName
                    try await ops.applyRuntimeConfig(nextOverlay)
                    try checkSwitchCurrent()
                    let tunnelReady = await ops.waitForTunnel()
                    try checkSwitchCurrent()
                    // Prove the new exit before tearing leftover sockets on the
                    // previous destination. Closing everything first dumped the
                    // session onto an unverified node.
                    if !tunnelReady {
                        switchError = CoreControllerError.protectionFailed(
                            ProtectedFailureCode.tunRouteUnavailable.userMessage
                        )
                    } else {
                        let switchVerdict = try await ops.verify(desiredNode)
                        try checkSwitchCurrent()
                        if case .failed(let failure) = switchVerdict {
                            self.lastClassifiedFailure = failure
                            switchError = CoreControllerError.protectionFailed(failure.userMessage)
                        }
                    }
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    try checkSwitchCurrent()
                    guard !self.isDisconnecting else { throw CancellationError() }
                    switchError = error
                }
                if let switchError {
                    switchTargetRejected = true
                    let rollbackStillAllowed = !self.pendingRemovedCatalogExit
                        && !previousEndpoints.isEmpty
                        && previousName.map { name in
                            !self.proxyTarget(name, matches: nodeName)
                                && (name == ConfigPipeline.homeNodeName
                                    ? (AppProfile.homeExitEnabled && self.tonoTransport != nil)
                                    : self.localProxyNode(matching: name) != nil)
                        } == true
                    if rollbackStillAllowed, let rollbackName = previousName {
                        var rollbackArmFailed = false
                        do {
                            let rollbackNode: ProxyNode? = rollbackName == ConfigPipeline.homeNodeName
                                ? nil
                                : (self.localProxyNode(matching: rollbackName) ?? previousNode)
                            var rollbackOverlay = self.currentOwnedRuntimeOverlay()
                            rollbackOverlay.selectedNodeName = rollbackName
                            try await ops.applyRuntimeConfig(rollbackOverlay)
                            try checkSwitchCurrent()
                            let rollbackTunnelReady = await ops.waitForTunnel()
                            try checkSwitchCurrent()
                            guard rollbackTunnelReady else {
                                throw switchError
                            }
                            let rollbackVerdict = try await ops.verify(rollbackNode)
                            try checkSwitchCurrent()
                            if case .failed = rollbackVerdict {
                                throw switchError
                            }
                            await ops.closeConnections(nodeName)
                            try checkSwitchCurrent()
                            recoveryNode = rollbackNode
                            recoveryName = rollbackName
                            self.lastClassifiedFailure = previousClassifiedFailure
                            rollbackArmFailed = true
                            try await ops.armKillSwitch(previousEndpoints)
                            try checkSwitchCurrent()
                            ops.rememberNode(rollbackNode, rollbackName)
                            self.networkInfo = previousNetworkInfo
                            protectionTransitionInFlight = false
                            self.retireFailedRouteSuccess(nodeName, owner: routeOwner, generation: switchGeneration)
                            await ops.refreshProxy()
                            try checkSwitchCurrent()
                            LocalTrafficAudit.shared.recordEvent(
                                "node_switch_rolled_back",
                                details: [
                                    "requested_exit": nodeName,
                                    "restored_exit": rollbackName,
                                    "error": switchError.localizedDescription,
                                ]
                            )
                            self.errorMessage = String(
                                localized: "Could not switch to \(nodeName); kept your connection on \(rollbackName)."
                            )
                            return
                        } catch is CancellationError {
                            throw CancellationError()
                        } catch {
                            throw rollbackArmFailed ? error : switchError
                        }
                    }
                    throw switchError
                }
                SingBoxDelayGate.prove()
                await ops.closeConnections(previousName)
                guard await self.connectionCoordinator.finishNodeSwitch(
                    generation: switchGeneration,
                    converge: { try await ops.armKillSwitch(nextEndpoints) },
                    commit: { ops.rememberNode(desiredNode, nodeName) },
                    recover: { error in
                        recoveryHandledSelection = true
                        self.retireFailedRouteSuccess(nodeName, owner: routeOwner, generation: switchGeneration)
                        self.recoverFailedNodeSwitch(desiredNode, name: nodeName, error: error,
                                                     releaseNetwork: releaseNetworkIfSwitchFails)
                    }
                ) else { return }
                protectionTransitionInFlight = false
                self.recordVerifiedRouteSuccess(nodeName, owner: routeOwner, generation: switchGeneration,
                                                catalogDigest: routeCatalogDigest)
                await ops.refreshProxy()
                try checkSwitchCurrent()
                ConnectionTelemetryBuffer.shared.record(
                    "switchOk",
                    elapsedMs: max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000)),
                    node: desiredNode?.id,
                    generation: Int(switchGeneration)
                )
                LocalTrafficAudit.shared.recordEvent(
                    "node_switch_succeeded",
                    details: [
                        "selected_exit": nodeName,
                        "duration_ms": String(
                            max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000))
                        ),
                    ]
                )
                networkInfoTask?.cancel()
                networkInfoTask = Task { [weak self] in
                    guard let self else { return }
                    // Re-probe the exit we just moved to. Without this the
                    // badge keeps showing the previous node's number under the
                    // new node's name until something else happens to measure.
                    _ = await self.proxyService.testLatency(name: nodeName)
                    guard !Task.isCancelled else { return }
                    await self.fetchNetworkInfo()
                }
            } catch is CancellationError {
                return
            } catch {
                // URLSession reports cancellation as URLError.cancelled rather
                // than CancellationError. An intentional disconnect must not
                // be converted into an automatic protected reconnect.
                guard !Task.isCancelled, !isDisconnecting,
                      self.connectionCoordinator.protectionOperationGeneration == switchGeneration else { return }
                self.retireFailedRouteSuccess(nodeName, owner: routeOwner, generation: switchGeneration)
                LocalTrafficAudit.shared.recordEvent(
                    "node_switch_failed",
                    details: [
                        "requested_exit": nodeName,
                        "duration_ms": String(
                            max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000))
                        ),
                        "error": error.localizedDescription,
                    ]
                )
                if protectionTransitionInFlight || isRecoveringProtectedConnection {
                    recoveryHandledSelection = true
                    recoverFailedNodeSwitch(
                        recoveryNode,
                        name: recoveryName,
                        error: error,
                        releaseNetwork: releaseNetworkIfSwitchFails
                    )
                } else {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func recoverFailedNodeSwitch(
        _ node: ProxyNode?,
        name: String,
        error: Error,
        releaseNetwork: Bool
    ) {
        // Preserve the requested intent, but never claim the transition completed. The existing
        // disconnect owner withdraws Connected synchronously and drains this switch task before
        // touching Core/PF. A user switch still holds PF and retries. A catalog
        // removal switch must not: the session could not move, and a non-strict
        // host goes back to its original network instead of bootstrap.
        let catalogRemovalPending = pendingRemovedCatalogExit
        if catalogRemovalPending {
            applyDefaultProxySelection(persist: true)
        } else {
            rememberSwitchedNode(node, name: name)
        }
        let release = (releaseNetwork || catalogRemovalPending) && ExhaustedFailureNetwork.afterFailure(
            strictKillSwitchExplicit: false,
            selectiveAiBlockReady: false
        ).releasesSystemNetwork
        disconnect(releaseKillSwitch: release, automaticFailureRelease: release)
        LocalTrafficAudit.shared.recordEvent(
            "node_switch_protection_convergence_failed",
            details: ["error": error.localizedDescription, "released": String(release)]
        )
        if release {
            errorMessage = String(
                localized: "The cloud server switch failed. This Mac is back on its normal internet."
            )
        } else {
            errorMessage = error.localizedDescription
            scheduleProtectedReconnect()
        }
    }

    private func rememberSwitchedNode(_ node: ProxyNode?, name: String) {
        selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
        activeNode = node
        proxyService.activeGroupName = ConfigPipeline.exitGroupName
        proxyService.activeNodeName = name
        persistProxySelection(name)
    }

    func selectProxyTarget(_ target: String, inGroup groupName: String) {
        guard isConnected else { return }
        if isMainProxyGroup(groupName) {
            selectNode(target)
            return
        }
        if isOwnedTonoMode {
            errorMessage = String(localized: "Managed sing-box routes change only through a protected configuration replacement.")
            return
        }

        networkInfoTask?.cancel()
        networkInfo = NetworkInfo()
        let isMainGroup = isMainProxyGroup(groupName)
        networkInfoTask = Task.detached { [weak self] in
            guard let appState = self else { return }
            await appState.proxyService.selectProxy(group: groupName, proxy: target)
            if isMainGroup {
                await MainActor.run {
                    appState.selectedNodeId = target
                    appState.activeNode = appState.localProxyNode(matching: target)
                    appState.proxyService.activeGroupName = groupName
                    appState.proxyService.activeNodeName = target
                    appState.persistProxySelection(target)
                }
            }
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await appState.fetchNetworkInfo()
        }
    }

    func toggleRegion(_ regionId: String) {
        if let idx = proxyRegions.firstIndex(where: { $0.id == regionId }) {
            proxyRegions[idx].isExpanded.toggle()
        }
    }

    // MARK: - Mode

    func setProxyMode(_ mode: ProxyMode) {
        guard !isOwnedTonoMode || mode == .rule else {
            errorMessage = String(localized: "Tono keeps Rule mode locked so traffic cannot bypass the protected cloud route.")
            return
        }
        proxyMode = mode
        if isConnected, let api = coreController {
            Task {
                try? await api.updateMode(mode.rawValue.lowercased())
                await MainActor.run { self.networkInfo = NetworkInfo() }
                await fetchNetworkInfo()
            }
        }
    }

    // MARK: - Node Management

    func addNode(_ node: ProxyNode) {
        let flag = node.flag.isEmpty ? "🌐" : node.flag
        var nodeWithFlag = node
        nodeWithFlag.flag = flag
        do {
            _ = try ConfigPipeline.validatedOwnedNodes(importedExitNodes + [nodeWithFlag])
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        let regionId = "custom"
        if let idx = proxyRegions.firstIndex(where: { $0.id == regionId }) {
            proxyRegions[idx].nodes.append(nodeWithFlag)
        } else {
            let region = ProxyRegion(id: regionId, name: "CUSTOM NODES", nodes: [nodeWithFlag])
            proxyRegions.append(region)
        }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func updateNode(_ node: ProxyNode) {
        let candidates = importedExitNodes.map { $0.id == node.id ? node : $0 }
        do {
            _ = try ConfigPipeline.validatedOwnedNodes(candidates)
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        for i in proxyRegions.indices {
            if let j = proxyRegions[i].nodes.firstIndex(where: { $0.id == node.id }) {
                proxyRegions[i].nodes[j] = node
                if selectedNodeId == node.id {
                    activeNode = node
                    proxyService.activeNodeName = node.name
                    persistProxySelection(node.name)
                }
                saveState()
                if isConnected { reloadCoreConfig() }
                return
            }
        }
    }

    func deleteNode(_ nodeId: String) {
        for i in proxyRegions.indices {
            proxyRegions[i].nodes.removeAll { $0.id == nodeId }
        }
        proxyRegions.removeAll { $0.nodes.isEmpty }
        if selectedNodeId == nodeId || activeNode?.id == nodeId {
            restoreProxySelection(persistFallback: true)
        }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func clearAllNodes() {
        proxyRegions.removeAll()
        selectedNodeId = nil
        activeNode = nil
        proxyService.activeNodeName = nil
        persistProxySelection(nil)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    // MARK: - Rules

    func addRule(_ rule: RuleItem) {
        rules.append(rule)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func deleteRule(_ ruleId: String) {
        rules.removeAll { $0.id == ruleId }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func moveRule(from source: IndexSet, to destination: Int) {
        rules.move(fromOffsets: source, toOffset: destination)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    /// I/O boundaries for the config-reload transaction. Tests can model a
    /// successful helper replacement followed by a controller-readiness error
    /// without changing the host's Core, tunnel, or PF state.
    struct ConfigReloadOperations {
        var sync: (String, String) async throws -> String = { directory, digest in
            try await PrivilegedRuntimeCoordinator.shared.syncCoreConfig(
                configDirectory: directory, configSHA256: digest
            )
        }
        var reload: (CoreControllerClient, String) async throws -> Void = { api, path in
            try await api.reloadConfig(path: path)
        }
        var waitUntilReady: (CoreControllerClient) async throws -> Void = { api in
            try await api.waitUntilReady()
        }
        var waitForTunnel: () async -> Bool = {
            await AppState.waitForOwnedTunnelInterface()
        }
        var waitForLocalDNS: (() async -> Bool)? = nil
    }

    /// Whether a failed `/core/sync` may still have replaced the Core. The
    /// helper replaces it before it replies, so a request written whole whose
    /// reply was lost (empty or invalid response) proves nothing about which
    /// document is running. A socket or connect failure never arrived, and
    /// after an answered refusal the new document is not the one running.
    /// Unknown errors count as lost.
    static func syncReplyWasLost(_ error: Error) -> Bool {
        guard let ipcError = error as? HelperIPCError else { return true }
        switch ipcError {
        case .emptyResponse, .invalidResponse:
            return true
        default:
            return false
        }
    }

    /// Rewrite config on disk and tell mihomo to reload it.
    ///
    /// `applyingDirectPolicy` switches the transaction into a lightweight
    /// pins-only refresh: the pending policy is armed and written instead of
    /// `activeDirectPolicy`, established connections are left alone (no
    /// close-all, no exit health gate), and the pending policy is committed
    /// only after the helper installs the new runtime. Controller readiness
    /// is advisory for this refresh: the owned tunnel and exact PF convergence
    /// must restore the DIRECT permit withheld during the replacement even
    /// when the controller cannot answer. Earlier preparation failures keep
    /// the session up for the next monitor retry.
    func reloadCoreConfig(
        applyingDirectPolicy pendingDirectPolicy:
            ConfigPipeline.ManagedDirectRuntimePolicy? = nil,
        operations: ConfigReloadOperations = ConfigReloadOperations()
    ) {
        if isConnected, coreRuntime.routingMode == "three-tier" {
            return
        }
        // Do not cancel a mutation after PF or Mihomo may already have accepted
        // part of it. Coalesce behind the active transaction instead; the most
        // recent pin set wins, while a requested full rewrite is preserved.
        if connectionCoordinator.configReloadTask != nil || switchingNodeId != nil {
            if let pendingDirectPolicy {
                pendingDirectPolicyReload = pendingDirectPolicy
            } else {
                pendingFullConfigReload = true
            }
            return
        }
        let localNetwork = LocalNetworkDevicesSync.desired
        // A29: this reload is applying a local network generation PF or the
        // Core does not hold yet. If it fails, the session holds in the
        // protected fault instead of taking the exhausted-failure release.
        let appliesLocalNetworkGeneration = LocalNetworkDevicesSync.pfApplied != nil
            && LocalNetworkDevicesSync.coreApplied != nil
            && !LocalNetworkDevicesSync.converged
        let overlay = ConfigPipeline.OverlayConfig(
            mixedPort: config.mixedPort,
            externalController: config.externalController,
            secret: config.secret,
            mode: config.mode,
            logLevel: config.logLevel,
            allowLan: config.allowLan,
            tunEnabled: config.tunEnabled,
            selectedNodeName: selectedExitNode()?.name ?? ConfigPipeline.homeNodeName,
            tonoTransport: tonoTransport,
            claudeHomeNodeName: managedCatalogRouting?.homeProxy,
            defaultNodeName: managedCatalogRouting?.defaultProxy,
            claudeHomeSocks5: managedCatalogRouting?.homeSocks5,
            allowLocalNetworkDevices: localNetwork.allow,
            localNetworkDevicesGeneration: localNetwork.generation
        )
        let selectedExit = selectedExitNode()
        let selectedExitName = selectedExit?.name
        let runtimeNodes = importedExitNodes
        let transport = tonoTransport
        let api = coreController
        let ownedRuntime = isOwnedTonoMode
        let installedDigest = loadedRuntimeConfigDigest
        connectionCoordinator.configReloadRequestID += 1
        let requestID = connectionCoordinator.configReloadRequestID
        let pinsOnlyRefresh = pendingDirectPolicy != nil
        connectionCoordinator.configReloadTask = Task { [weak self] in
            guard let self else { return }
            let effectiveDirectPolicy = pendingDirectPolicy ?? activeDirectPolicy
            var pinsRuntimeCommitted = false
            do {
                // During a pins-only refresh, arm the union of old and new
                // endpoints: the old config keeps dialing old pins until the
                // reload lands, and a mid-transaction failure must leave every
                // in-force pin PF-permitted. The next full arm converges back
                // to the exact set.
                let sessionEndpoints: [ConfigPipeline.DirectEndpoint]
                let sessionTCPAddresses: [String]
                if pinsOnlyRefresh {
                    sessionEndpoints = Array(Set(
                        (effectiveDirectPolicy?.sessionEndpoints ?? [])
                            + (self.activeDirectPolicy?.sessionEndpoints ?? [])
                    )).sorted {
                        ($0.transport, $0.port, $0.address)
                            < ($1.transport, $1.port, $1.address)
                    }
                    sessionTCPAddresses = Array(Set(
                        (effectiveDirectPolicy?.tcpDirectAddresses ?? [])
                            + (self.activeDirectPolicy?.tcpDirectAddresses ?? [])
                    )).sorted()
                } else {
                    sessionEndpoints = effectiveDirectPolicy?.sessionEndpoints ?? []
                    sessionTCPAddresses = effectiveDirectPolicy?.tcpDirectAddresses ?? []
                }
                let tunnelArmed = KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface)
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    tunnelInterfaces: tunnelArmed
                        ? [ConfigPipeline.tonoTunInterface]
                        : [],
                    proxyEndpoints: (try ConfigPipeline.dialEndpoints(for: selectedExit))
                        + self.claudeHomeDialEndpoints(excluding: selectedExit),
                    sessionDirectEndpoints: sessionEndpoints,
                    sessionDirectTCPAddresses: sessionTCPAddresses,
                    tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && transport != nil,
                    reviewedBundleDirect:
                        effectiveDirectPolicy?.requiresAddressFreeDirectPermit == true
                )
                try Task.checkCancellation()
                // The writer already hashes what it wrote. Carrying its return
                // value to the sync below keeps the two describing the same
                // bytes even while another mutation is queued behind this one.
                let digest = try await coreRuntime.writeRuntimeConfig(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: effectiveDirectPolicy,
                    installed: installedDigest,
                    keepsInstalled: !pinsOnlyRefresh
                )
                try Task.checkCancellation()
                guard let api else {
                    finishConfigReloadRequest(requestID)
                    return
                }
                if !pinsOnlyRefresh, let installedDigest, digest == installedDigest {
                    // Identical bytes: the running core is already this config,
                    // so the reload and the connection close below would cost
                    // the session every open connection for no change at all.
                    LocalTrafficAudit.shared.recordEvent(
                        "core_config_reload_skipped_unchanged"
                    )
                    // The running Core already holds these bytes, so it holds
                    // the generation they were just written for (D7).
                    LocalNetworkDevicesSync.documentInstalled(digest: digest)
                    finishConfigReloadRequest(requestID)
                    return
                }
                let runtimeConfigPath: String
                do {
                    runtimeConfigPath = try await operations.sync(
                        coreRuntime.configDirectory.path, digest
                    )
                } catch {
                    // The Core may already be the new document. A kept
                    // session must not compare later reloads against the old
                    // one and skip them as unchanged.
                    if Self.syncReplyWasLost(error) { loadedRuntimeConfigDigest = nil }
                    throw error
                }
                try Task.checkCancellation()
                self.loadedRuntimeConfigDigest = digest
                if !pinsOnlyRefresh {
                    try await operations.reload(api, runtimeConfigPath)
                }
                self.commitResidentialRouteAuditContext(
                    overlay: overlay,
                    nodes: runtimeNodes,
                    digest: digest
                )
                // /core/sync withheld the reviewed-bundle permit while the
                // Core restarted without its utun (#608). It returns only
                // through an arm with the flag once the new tunnel exists.
                // The pins-only branch below already sends that arm.
                if !pinsOnlyRefresh, tunnelArmed,
                   effectiveDirectPolicy?.requiresAddressFreeDirectPermit == true {
                    try Task.checkCancellation()
                    guard await operations.waitForTunnel() else {
                        throw KillSwitchService.Error.commandFailed(
                            "Mihomo did not recreate the owned \(ConfigPipeline.tonoTunInterface) interface."
                        )
                    }
                    try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                        tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                        proxyEndpoints: (try ConfigPipeline.dialEndpoints(for: selectedExit))
                            + self.claudeHomeDialEndpoints(excluding: selectedExit),
                        sessionDirectEndpoints: sessionEndpoints,
                        sessionDirectTCPAddresses: sessionTCPAddresses,
                        tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && transport != nil,
                        reviewedBundleDirect: true
                    )
                }

                if let pendingDirectPolicy {
                    // /core/sync has installed the new pins, so they are now the
                    // authoritative in-memory policy even if a later PF call
                    // fails. Do not honor cancellation between this commit and
                    // exact PF convergence: disconnect is the only safe exit.
                    self.activeDirectPolicy = pendingDirectPolicy
                    pinsRuntimeCommitted = true
                    // /core/sync above restarted the Core; like the full
                    // reload (#608) the controller answers before the new
                    // process recreates the owned utun. Wait for it before
                    // the convergence arm names it, or a routine pins refresh
                    // fails validateTunnels and lands in the fatal catch.
                    // An unstructured Task does not inherit cancellation, so a
                    // cancelled refresh still waits instead of returning false
                    // at once (this window must not honor cancellation).
                    guard await Task(operation: { await operations.waitForTunnel() }).value else {
                        throw KillSwitchService.Error.commandFailed(
                            "Mihomo did not recreate the owned \(ConfigPipeline.tonoTunInterface) interface."
                        )
                    }
                    // The pre-reload arm intentionally allowed old ∪ new so
                    // the old runtime could keep dialing during the swap. Once
                    // Mihomo commits the new config, immediately remove the old
                    // tuples rather than leaving a growing root PF allowlist.
                    try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                        tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                        proxyEndpoints: (try ConfigPipeline.dialEndpoints(
                            for: selectedExit
                        )) + self.claudeHomeDialEndpoints(excluding: selectedExit),
                        sessionDirectEndpoints:
                            pendingDirectPolicy.sessionEndpoints,
                        sessionDirectTCPAddresses:
                            pendingDirectPolicy.tcpDirectAddresses,
                        tailscaleBootstrapEnabled:
                            AppProfile.homeExitEnabled && transport != nil,
                        // The convergence arm rewrites the whole ruleset, so
                        // omitting this drops the reviewed-bundle permit while
                        // the rule engine still routes that bundle direct —
                        // those packets then hit `block drop out quick all` and
                        // the app silently black-holes until the next full arm.
                        reviewedBundleDirect:
                            pendingDirectPolicy.requiresAddressFreeDirectPermit
                    )
                    // Let the controller answer before the connection
                    // close below asks it anything.
                    try? await operations.waitUntilReady(api)
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pins_refreshed",
                        details: [
                            "domains": String(pendingDirectPolicy.domainPins.count),
                            "web_domains": String(
                                pendingDirectPolicy.webDomainPins.count
                            ),
                            "endpoints": String(
                                pendingDirectPolicy.sessionEndpoints.count
                            ),
                        ]
                    )
                }
                try Task.checkCancellation()
                if ownedRuntime, selectedExitName != nil, !pinsOnlyRefresh {
                    try await api.closeAllConnections()
                    try Task.checkCancellation()
                    guard await operations.waitForTunnel() else {
                        throw CoreControllerError.protectionFailed(
                            "Updated cloud server health check failed"
                        )
                    }
                    try Task.checkCancellation()
                    if let waitForLocalDNS = operations.waitForLocalDNS {
                        guard await waitForLocalDNS() else {
                            throw CoreControllerError.protectionFailed(
                                "Updated cloud server health check failed"
                            )
                        }
                    } else {
                        _ = await self.testLocalProtectedDNS(timeout: 2)
                    }
                    try Task.checkCancellation()
                    // `/delay` is advisory. A 504 after reload must not tear
                    // a tunnel the real TUN probe still proves.
                    let tun = await ProtectedConnectivityVerifier.raceSystemTUNProbes(
                        timeoutSeconds: 8
                    )
                    try Task.checkCancellation()
                    if case .lost = tun {
                        throw CoreControllerError.protectionFailed(
                            "Updated cloud server health check failed"
                        )
                    }
                    await proxyService.refresh()
                    networkInfoTask?.cancel()
                    networkInfoTask = Task { [weak self] in
                        await self?.fetchNetworkInfo()
                    }
                }
                finishConfigReloadRequest(requestID)
            } catch is CancellationError {
                guard pinsRuntimeCommitted, !isDisconnecting,
                      connectionCoordinator.configReloadRequestID == requestID else { return }
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_pf_convergence_cancelled"
                )
                finishConfigReloadRequest(requestID, startPending: false)
                await applyExhaustedArmedFailure(
                    message: ConnectionFailurePresentation.userFacingMessage(
                        classified: lastClassifiedFailure
                    ),
                    resumeWhenReachable: true
                )
            } catch {
                if pendingRemovedCatalogExit, !Task.isCancelled, !isDisconnecting,
                   connectionCoordinator.configReloadRequestID == requestID {
                    // A failed old owner cannot retry its retired exit or keep
                    // bootstrap PF while the catalog replacement is pending.
                    applyDefaultProxySelection(persist: true)
                    finishConfigReloadRequest(requestID, startPending: false)
                    disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
                    return
                }
                // A current owner that installed new pins must retire the
                // temporary PF union even when cancelled. A newer disconnect
                // or update owner already owns that cleanup.
                if pinsOnlyRefresh, pinsRuntimeCommitted {
                    guard !isDisconnecting,
                          connectionCoordinator.configReloadRequestID == requestID else { return }
                    // The core is already using the new exact pins but PF could
                    // not converge from old ∪ new to the new set. Retire this
                    // owner and stop the core before selectively releasing PF;
                    // neither stale DIRECT permits nor bootstrap protection
                    // may remain while ordinary internet waits for recovery.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pf_convergence_failed",
                        details: ["error": String(describing: error)]
                    )
                    finishConfigReloadRequest(requestID, startPending: false)
                    await applyExhaustedArmedFailure(
                        message: ConnectionFailurePresentation.userFacingMessage(
                            classified: lastClassifiedFailure
                        ),
                        resumeWhenReachable: true
                    )
                    return
                }
                guard !Task.isCancelled, !isDisconnecting else { return }
                guard connectionCoordinator.configReloadRequestID == requestID else { return }
                if pinsOnlyRefresh {
                    // A background pin refresh must never take the session
                    // down. The armed endpoint set is a superset of the
                    // active one, the old config is still in force, and the
                    // next monitor cycle will retry. This is not an explicit
                    // strict kill switch: disconnecting here holds PF in
                    // bootstrap and cuts ordinary internet.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_refresh_failed",
                        details: ["error": String(describing: error)]
                    )
                    finishConfigReloadRequest(requestID)
                } else if ownedRuntime {
                    finishConfigReloadRequest(requestID, startPending: false)
                    // The helper also checks the ports after a sync stop: the
                    // same named refusal, and no automatic retry.
                    let portConflict = CorePortConflict.matches(error)
                    if portConflict {
                        lastClassifiedFailure = Self.corePortConflictFailure(
                            error,
                            generation: connectionCoordinator.protectionOperationGeneration
                        )
                    }
                    // D7: a local network devices fault is the error to show,
                    // not a generic connection failure, and it holds.
                    if appliesLocalNetworkGeneration, LocalNetworkDevicesSync.fault == nil {
                        LocalNetworkDevicesSync.recordFault(.reArmFailed(error.localizedDescription))
                    }
                    showLocalNetworkDevicesFault()
                    await applyExhaustedArmedFailure(
                        message: LocalNetworkDevicesSync.faultMessage
                            ?? ConnectionFailurePresentation.userFacingMessage(
                                classified: lastClassifiedFailure
                            ),
                        resumeWhenReachable: !portConflict
                    )
                } else {
                    finishConfigReloadRequest(requestID)
                    errorMessage = String(
                        localized: "Failed to apply the updated core configuration: \(error.localizedDescription)"
                    )
                }
            }
        }
    }

    /// Completes one serialized runtime mutation and starts the newest queued
    /// request. Accepted authorization takes precedence over pin snapshots;
    /// a full rewrite then includes the newly committed exact direct policy.
    func finishConfigReloadRequest(
        _ requestID: Int,
        startPending: Bool = true
    ) {
        guard connectionCoordinator.configReloadRequestID == requestID else { return }
        connectionCoordinator.configReloadTask = nil
        guard startPending, isConnected, !isDisconnecting else {
            if !startPending {
                pendingOptionalPolicyReload = false
                pendingRemovedCatalogExit = false
                pendingDirectPolicyReload = nil
                pendingFullConfigReload = false
            }
            return
        }
        startPendingConfigReloadIfPossible()
    }

    private func startPendingConfigReloadIfPossible() {
        guard connectionCoordinator.configReloadTask == nil, switchingNodeId == nil,
              isConnected, !isDisconnecting else { return }
        if pendingRemovedCatalogExit {
            pendingRemovedCatalogExit = false
            // The catalog switch writes the complete latest configuration,
            // including full rewrites queued while the old owner was busy.
            pendingFullConfigReload = false
            settleRemovedCatalogExit(wasConnected: true)
            if connectionCoordinator.configReloadTask == nil, switchingNodeId == nil {
                startPendingConfigReloadIfPossible()
            }
        } else if pendingOptionalPolicyReload {
            scheduleBackgroundOptionalPolicy()
            // An empty document with no active grants needs no replacement,
            // but any queued full rewrite must still drain.
            if connectionCoordinator.configReloadTask == nil {
                startPendingConfigReloadIfPossible()
            }
        } else if let policy = pendingDirectPolicyReload {
            pendingDirectPolicyReload = nil
            reloadCoreConfig(applyingDirectPolicy: policy)
        } else if pendingFullConfigReload {
            pendingFullConfigReload = false
            reloadCoreConfig()
        }
    }

    // MARK: - Connection Management

    func closeConnection(_ connectionId: String) async {
        guard let api = coreController else { return }
        do {
            try await api.closeConnection(id: connectionId)
            await MainActor.run {
                connections.removeAll { $0.id == connectionId }
            }
        } catch {
            errorMessage = String(
                localized: "Could not close the connection: \(error.localizedDescription)"
            )
        }
    }

    func clearLogs() {
        logEntries.removeAll()
    }

    func closeAllConnections() async {
        guard let api = coreController else { return }
        do {
            try await api.closeAllConnections()
            await MainActor.run {
                connections.removeAll()
                trafficStats.activeConnections = 0
            }
        } catch {
            errorMessage = String(
                localized: "Could not close active connections: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Latency Testing

    func testNodeLatency(_ name: String) async {
        guard isOwnedTonoMode, coreController != nil else { return }
        guard proxyTarget(name, matches: proxyService.activeNodeName ?? "") else { return }
        _ = await proxyService.testLatency(name: proxyService.activeNodeName ?? name)
    }

    /// Probes the selected exit only.
    ///
    /// Not a catalog sweep: with the kill switch armed, PF permits just the
    /// endpoints of the exit in use, so probing every node would mean opening
    /// all of them — that is the fail-closed guarantee, not an oversight.
    func testSelectedExitLatency() async {
        guard isOwnedTonoMode, coreController != nil else { return }
        guard let selected = proxyService.activeNodeName else { return }
        _ = await proxyService.testLatency(name: selected)
    }


}
