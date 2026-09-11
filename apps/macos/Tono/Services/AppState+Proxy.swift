import SwiftUI

extension AppState {
    // MARK: - Proxy Management

    /// Select a node/group by name or id.
    func selectNode(_ nameOrId: String) {
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

        if isConnected,
           let current = proxyService.activeNodeName,
           proxyTarget(current, matches: nodeName) {
            selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
            activeNode = desiredNode
            persistProxySelection(nodeName)
            networkInfoTask?.cancel()
            networkInfoTask = Task { [weak self] in
                await self?.fetchNetworkInfo()
            }
            return
        }

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
                connect()
            }
            return
        }
        // Cancel previous IP detection
        networkInfoTask?.cancel()
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
        connectionCoordinator.nodeSwitchTask = Task { [weak self] in
            guard let self else { return }
            defer {
                self.switchingNodeId = nil
                self.startPendingConfigReloadIfPossible()
            }
            guard let api else { return }
            do {
                let previousName = self.proxyService.activeNodeName
                let previousNode = previousName.flatMap { self.localProxyNode(matching: $0) }
                let previousEndpoints = self.currentProxyEndpoints()
                let nextEndpoints = try ConfigPipeline.dialEndpoints(for: desiredNode)
                    + self.claudeHomeDialEndpoints(excluding: desiredNode)
                let transitionEndpoints = ConfigPipeline.uniqueDialEndpoints(
                    previousEndpoints + nextEndpoints
                )
                // Old ∪ new first. Arming only the new destination blocked the
                // still-selected old exit; a failed switch then rolled the
                // selector back without restoring that PF permit.
                try await self.armSwitchKillSwitch(proxyEndpoints: transitionEndpoints)
                try Task.checkCancellation()
                ConnectionTelemetryBuffer.shared.record(
                    "switchBegin",
                    node: desiredNode?.id,
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration)
                )
                try await api.selectProxy(
                    group: ConfigPipeline.exitGroupName,
                    proxy: nodeName
                )
                try Task.checkCancellation()
                // Prove the new exit before tearing leftover sockets on the
                // previous destination. Closing everything first dumped the
                // session onto an unverified node.
                let switchVerdict = await self.verifyProtectedConnection(
                    controllerTask: Task {
                        await self.advisoryControllerExitProbe(
                            api: api,
                            selectedExit: desiredNode
                        )
                    },
                    mixedPort: self.config.mixedPort,
                    generation: self.connectionCoordinator.protectionOperationGeneration,
                    rounds: 1
                )
                try Task.checkCancellation()
                if case .failed = switchVerdict, let previousName {
                    try await api.selectProxy(
                        group: ConfigPipeline.exitGroupName,
                        proxy: previousName
                    )
                    let rollback = await self.verifyProtectedConnection(
                        controllerTask: Task {
                            await self.advisoryControllerExitProbe(
                                api: api,
                                selectedExit: previousNode ?? self.selectedExitNode()
                            )
                        },
                        mixedPort: self.config.mixedPort,
                        generation: self.connectionCoordinator.protectionOperationGeneration,
                        rounds: 1
                    )
                    ConnectionTelemetryBuffer.shared.record(
                        "switchRollback",
                        node: desiredNode?.id,
                        generation: Int(self.connectionCoordinator.protectionOperationGeneration)
                    )
                    try await self.armSwitchKillSwitch(proxyEndpoints: previousEndpoints)
                    if case .failed(let failure) = rollback {
                        self.lastClassifiedFailure = failure
                        self.isRecoveringProtectedConnection = true
                        throw CoreControllerError.protectionFailed(failure.userMessage)
                    }
                    throw CoreControllerError.protectionFailed(
                        String(localized: "New server failed verification. Switched back to the previous one.")
                    )
                }
                if case .failed(let failure) = switchVerdict {
                    self.lastClassifiedFailure = failure
                    throw CoreControllerError.protectionFailed(failure.userMessage)
                }
                await self.closeConnectionsBoundToExit(previousName, using: api)
                try await self.armSwitchKillSwitch(proxyEndpoints: nextEndpoints)
                await proxyService.refresh()
                selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
                activeNode = desiredNode
                proxyService.activeGroupName = ConfigPipeline.exitGroupName
                proxyService.activeNodeName = nodeName
                persistProxySelection(nodeName)
                ConnectionTelemetryBuffer.shared.record(
                    "switchOk",
                    elapsedMs: max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000)),
                    node: desiredNode?.id,
                    generation: Int(self.connectionCoordinator.protectionOperationGeneration)
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
                guard !Task.isCancelled, !isDisconnecting else { return }
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
                if isRecoveringProtectedConnection {
                    disconnect(releaseKillSwitch: false)
                    errorMessage = lastClassifiedFailure?.userMessage
                        ?? error.localizedDescription
                    scheduleProtectedReconnect()
                } else {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func selectProxyTarget(_ target: String, inGroup groupName: String) {
        guard isConnected else { return }
        if isMainProxyGroup(groupName) {
            selectNode(target)
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

    /// Rewrite config on disk and tell mihomo to reload it.
    ///
    /// `applyingDirectPolicy` switches the transaction into a lightweight
    /// pins-only refresh: the pending policy is armed and written instead of
    /// `activeDirectPolicy`, established connections are left alone (no
    /// close-all, no exit health gate), the pending policy is committed only
    /// after a successful reload, and a failure keeps the session up instead
    /// of tearing it down fail-closed.
    func reloadCoreConfig(
        applyingDirectPolicy pendingDirectPolicy:
            ConfigPipeline.ManagedDirectRuntimePolicy? = nil
    ) {
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
            claudeHomeSocks5: managedCatalogRouting?.homeSocks5
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
                if pinsOnlyRefresh {
                    sessionEndpoints = Array(Set(
                        (effectiveDirectPolicy?.sessionEndpoints ?? [])
                            + (self.activeDirectPolicy?.sessionEndpoints ?? [])
                    )).sorted {
                        ($0.transport, $0.port, $0.address)
                            < ($1.transport, $1.port, $1.address)
                    }
                } else {
                    sessionEndpoints = effectiveDirectPolicy?.sessionEndpoints ?? []
                }
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    tunnelInterfaces: KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface)
                        ? [ConfigPipeline.tonoTunInterface]
                        : [],
                    proxyEndpoints: (try ConfigPipeline.dialEndpoints(for: selectedExit))
                        + self.claudeHomeDialEndpoints(excluding: selectedExit),
                    sessionDirectEndpoints: sessionEndpoints,
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
                    directPolicy: effectiveDirectPolicy
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
                    finishConfigReloadRequest(requestID)
                    return
                }
                let runtimeConfigPath = try await PrivilegedRuntimeCoordinator.shared.syncCoreConfig(
                    configDirectory: coreRuntime.configDirectory.path,
                    configSHA256: digest
                )
                try Task.checkCancellation()
                try await api.reloadConfig(path: runtimeConfigPath)
                self.loadedRuntimeConfigDigest = digest
                self.commitResidentialRouteAuditContext(
                    overlay: overlay,
                    nodes: runtimeNodes,
                    digest: digest
                )

                if let pendingDirectPolicy {
                    // Mihomo has accepted the new pins, so they are now the
                    // authoritative in-memory policy even if a later PF call
                    // fails. Do not honor cancellation between this commit and
                    // exact PF convergence: disconnect is the only safe exit.
                    self.activeDirectPolicy = pendingDirectPolicy
                    pinsRuntimeCommitted = true
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
                    try? await api.waitUntilReady()
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
                guard pinsRuntimeCommitted, !isDisconnecting else { return }
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_pf_convergence_cancelled"
                )
                disconnect(releaseKillSwitch: false)
                errorMessage = String(
                    localized: "Secure WeChat routing was interrupted while updating; Kill Switch is blocking traffic while Tono retries."
                )
                scheduleProtectedReconnect(immediate: true)
            } catch {
                // Once Mihomo accepted new pins, neither cancellation nor a
                // superseding reload may leave PF at the temporary union. This
                // branch must win over the ordinary stale-request guards.
                if pinsOnlyRefresh, pinsRuntimeCommitted {
                    guard !isDisconnecting else { return }
                    // The core is already using the new exact pins but PF could
                    // not converge from old ∪ new to the new set. Stop the core
                    // and return to bootstrap-only protection; treating this as
                    // a harmless background failure would retain stale direct
                    // permissions indefinitely.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pf_convergence_failed",
                        details: ["error": String(describing: error)]
                    )
                    disconnect(releaseKillSwitch: false)
                    errorMessage = String(
                        localized: "Secure WeChat routing could not finish updating; Kill Switch is blocking traffic while Tono retries."
                    )
                    scheduleProtectedReconnect(immediate: true)
                    return
                }
                guard !Task.isCancelled, !isDisconnecting else { return }
                guard connectionCoordinator.configReloadRequestID == requestID else { return }
                if pinsOnlyRefresh {
                    // A background pin refresh must never take the session
                    // down. The armed endpoint set is a superset of the
                    // active one, the old config is still in force, and the
                    // next monitor cycle will retry.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_refresh_failed",
                        details: ["error": String(describing: error)]
                    )
                    finishConfigReloadRequest(requestID)
                } else if ownedRuntime {
                    finishConfigReloadRequest(requestID, startPending: false)
                    disconnect(releaseKillSwitch: false)
                    errorMessage = String(
                        localized: "Updated cloud route failed; Kill Switch is blocking traffic while Tono retries. \(error.localizedDescription)"
                    )
                    scheduleProtectedReconnect()
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
    /// request. Pin changes take precedence because a full rewrite will then
    /// naturally include the newly committed exact direct policy.
    func finishConfigReloadRequest(
        _ requestID: Int,
        startPending: Bool = true
    ) {
        guard connectionCoordinator.configReloadRequestID == requestID else { return }
        connectionCoordinator.configReloadTask = nil
        guard startPending, isConnected, !isDisconnecting else {
            if !startPending {
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
        if let policy = pendingDirectPolicyReload {
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
