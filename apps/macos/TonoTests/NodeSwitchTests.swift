import XCTest
@testable import Tono

final class NodeSwitchTests: XCTestCase {
    func testUniqueDialEndpointsKeepOldThenNewAndDropDuplicates() {
        let old = ConfigPipeline.DialEndpoint(host: "203.0.113.10", port: 443, transport: "tcp")
        let extra = ConfigPipeline.DialEndpoint(host: "203.0.113.11", port: 443, transport: "tcp")
        let next = ConfigPipeline.DialEndpoint(host: "198.51.100.20", port: 443, transport: "tcp")
        let union = ConfigPipeline.uniqueDialEndpoints([old, extra, next, old, extra])
        XCTAssertEqual(union, [old, extra, next])
    }

    func testHy2AdmissionKeepsTcpAndUdpDialEndpointsOnTheSameHost() throws {
        let tcp = Fixture.realityNode(server: "203.0.114.7", port: 443)
        let hy2 = Fixture.hy2Node(server: "203.0.114.7", port: 443)
        let admitted = try ConfigPipeline.validatedOwnedNode(hy2)
        XCTAssertEqual(admitted.type, .hysteria2)
        XCTAssertEqual(admitted.tlsFingerprint, Fixture.hy2Fingerprint)
        XCTAssertEqual(
            try ConfigPipeline.ownedNodeYAML(hy2).contains("fingerprint:"),
            true
        )

        var skipped = hy2
        skipped.skipCertVerify = true
        XCTAssertThrowsInjectionError("unsafeNode(\(hy2.name))") {
            try ConfigPipeline.validatedOwnedNode(skipped)
        }

        let tcpDial = try ConfigPipeline.dialEndpoints(for: tcp)
        let udpDial = try ConfigPipeline.dialEndpoints(for: hy2)
        XCTAssertEqual(tcpDial.map(\.transport), ["tcp"])
        XCTAssertEqual(udpDial.map(\.transport), ["udp"])
        let union = ConfigPipeline.uniqueDialEndpoints(tcpDial + udpDial)
        XCTAssertEqual(union, [
            .init(host: "203.0.114.7", port: 443, transport: "tcp"),
            .init(host: "203.0.114.7", port: 443, transport: "udp"),
        ])
    }

    func testPreferredCloudExitSkipsHy2SiblingListedFirst() {
        let hy2 = Fixture.hy2Node()
        let tcp = Fixture.realityNode()
        let preferred = ConfigPipeline.preferredCloudExit(
            in: [hy2, tcp],
            named: "US-VLESS-Reality"
        )
        XCTAssertEqual(preferred?.name, "US-VLESS-Reality")
        XCTAssertEqual(preferred?.type, .vless)
    }

    func testDrainClosesOnlyConnectionsBoundToThePreviousExit() {
        let stale = fixtureConnection(
            id: "old-1",
            chains: ["Tono-Exit", "Los Angeles · Canyon"]
        )
        let alreadyMoved = fixtureConnection(
            id: "new-1",
            chains: ["Tono-Exit", "Salt Lake · Harbor"]
        )
        let chinaDirect = fixtureConnection(
            id: "direct-1",
            chains: ["Tono-China-App", "Tono-China-Direct"]
        )
        let bound = [stale, alreadyMoved, chinaDirect].filter {
            $0.isBoundToExit("Los Angeles · Canyon")
        }
        XCTAssertEqual(bound.map(\.id), ["old-1"])
        XCTAssertFalse(alreadyMoved.isBoundToExit("Los Angeles · Canyon"))
        XCTAssertFalse(chinaDirect.isBoundToExit("Los Angeles · Canyon"))
    }

    private func fixtureConnection(id: String, chains: [String]) -> APIConnection {
        APIConnection(
            id: id,
            metadata: APIConnectionMetadata(
                network: "tcp",
                type: "TCP",
                process: nil,
                processPath: nil,
                sourceIP: "198.18.0.1",
                destinationIP: "203.0.113.10",
                sourcePort: "1",
                destinationPort: "443",
                host: "example.com"
            ),
            upload: 0,
            download: 0,
            start: "0",
            chains: chains,
            rule: "Match",
            rulePayload: nil
        )
    }

    private enum TestApplyError: Error {
        case syncFailed
    }

    @MainActor
    func testFailedSwitchRollsBackInPlaceWithoutDisconnecting() async throws {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let delayWasProven = SingBoxDelayGate.isProven
        defer {
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        let app = AppState()
        let previous = Fixture.realityNode(
            name: "Tokyo-1", id: "tokyo-1", server: "203.0.113.10", port: 443
        )
        let next = Fixture.realityNode(
            name: "Singapore-2", id: "singapore-2", server: "198.51.100.20", port: 443
        )
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, next])
        ]
        app.selectedNodeId = previous.id
        app.activeNode = previous
        app.proxyService.activeNodeName = previous.name
        app.isConnected = true
        app.networkInfo = NetworkInfo(ip: "203.0.113.10", org: "AS64512", location: "JP")
        app.lastClassifiedFailure = nil

        var armedEndpointSets: [[ConfigPipeline.DialEndpoint]] = []
        var appliedOverlays: [String?] = []
        var events: [String] = []
        let ops = AppState.NodeSwitchOperations(
            armKillSwitch: { endpoints in
                armedEndpointSets.append(endpoints)
                events.append("arm:\(endpoints.map(\.host).joined(separator: ","))")
            },
            applyRuntimeConfig: { overlay in
                appliedOverlays.append(overlay.selectedNodeName)
                events.append("reload:\(overlay.selectedNodeName ?? "nil")")
            },
            waitForTunnel: {
                events.append("waitForTunnel")
                return true
            },
            verify: { selectedExit in
                events.append("verify:\(selectedExit?.name ?? "home")")
                if selectedExit?.name == next.name {
                    return .failed(
                        ProtectedConnectivity.failure(
                            .coreExitUnreachable,
                            stage: "verifyingTraffic",
                            attempt: 1,
                            generation: 0,
                            detail: "test exit unreachable"
                        )
                    )
                }
                return .connected(controllerAdvisory: nil)
            },
            closeConnections: { exitName in
                events.append("close:\(exitName ?? "nil")")
            },
            rememberNode: { node, name in
                app.selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
                app.activeNode = node
                app.proxyService.activeNodeName = name
                events.append("remember:\(name)")
            },
            refreshProxy: {
                events.append("refresh")
            }
        )

        app.selectNode(next.name, operations: ops)
        await app.connectionCoordinator.nodeSwitchTask?.value

        XCTAssertTrue(app.isConnected, "failed switch rollback should keep the active session connected")
        XCTAssertEqual(app.proxyService.activeNodeName, previous.name)
        XCTAssertEqual(app.activeNode?.id, previous.id)
        XCTAssertEqual(app.networkInfo.ip, "203.0.113.10")
        XCTAssertEqual(app.networkInfo.org, "AS64512")
        XCTAssertEqual(app.networkInfo.location, "JP")
        XCTAssertNil(app.lastClassifiedFailure)
        XCTAssertEqual(appliedOverlays, [next.name, previous.name])
        XCTAssertEqual(armedEndpointSets.count, 2)
        XCTAssertEqual(armedEndpointSets[0].map(\.host), ["203.0.113.10", "198.51.100.20"])
        XCTAssertEqual(armedEndpointSets[1].map(\.host), ["203.0.113.10"])
        XCTAssertTrue(events.contains("close:\(next.name)"))
        XCTAssertNotNil(app.errorMessage)
    }

    @MainActor
    func testSwitchWaitsForTunnelBeforeVerifyingAndAbortsToRollbackWhenMissing() async {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let delayWasProven = SingBoxDelayGate.isProven
        defer {
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        let app = AppState()
        let previous = Fixture.realityNode(
            name: "Tokyo-1", id: "tokyo-1", server: "203.0.113.10", port: 443
        )
        let next = Fixture.realityNode(
            name: "Singapore-2", id: "singapore-2", server: "198.51.100.20", port: 443
        )
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, next])
        ]
        app.selectedNodeId = previous.id
        app.activeNode = previous
        app.proxyService.activeNodeName = previous.name
        app.isConnected = true

        var tunnelCalls = 0
        var verifiedExits: [String?] = []
        let ops = AppState.NodeSwitchOperations(
            armKillSwitch: { _ in },
            applyRuntimeConfig: { _ in },
            waitForTunnel: {
                tunnelCalls += 1
                return tunnelCalls > 1
            },
            verify: { selectedExit in
                verifiedExits.append(selectedExit?.name)
                return .connected(controllerAdvisory: nil)
            },
            closeConnections: { _ in },
            rememberNode: { node, name in
                app.selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
                app.activeNode = node
                app.proxyService.activeNodeName = name
            },
            refreshProxy: {}
        )

        app.selectNode(next.name, operations: ops)
        await app.connectionCoordinator.nodeSwitchTask?.value

        XCTAssertEqual(tunnelCalls, 2)
        XCTAssertEqual(verifiedExits, [previous.name])
        XCTAssertTrue(app.isConnected)
        XCTAssertEqual(app.proxyService.activeNodeName, previous.name)
    }

    @MainActor
    func testApplyRuntimeConfigFailureRollsBackToPreviousExit() async {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let delayWasProven = SingBoxDelayGate.isProven
        defer {
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        let app = AppState()
        let previous = Fixture.realityNode(
            name: "Tokyo-1", id: "tokyo-1", server: "203.0.113.10", port: 443
        )
        let next = Fixture.realityNode(
            name: "Singapore-2", id: "singapore-2", server: "198.51.100.20", port: 443
        )
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, next])
        ]
        app.selectedNodeId = previous.id
        app.activeNode = previous
        app.proxyService.activeNodeName = previous.name
        app.isConnected = true

        var armedEndpointSets: [[ConfigPipeline.DialEndpoint]] = []
        var appliedOverlays: [String?] = []
        let ops = AppState.NodeSwitchOperations(
            armKillSwitch: { endpoints in armedEndpointSets.append(endpoints) },
            applyRuntimeConfig: { overlay in
                if overlay.selectedNodeName == next.name {
                    throw TestApplyError.syncFailed
                }
                appliedOverlays.append(overlay.selectedNodeName)
            },
            waitForTunnel: { true },
            verify: { _ in .connected(controllerAdvisory: nil) },
            closeConnections: { _ in },
            rememberNode: { node, name in
                app.selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
                app.activeNode = node
                app.proxyService.activeNodeName = name
            },
            refreshProxy: {}
        )

        app.selectNode(next.name, operations: ops)
        await app.connectionCoordinator.nodeSwitchTask?.value

        XCTAssertTrue(app.isConnected)
        XCTAssertEqual(app.proxyService.activeNodeName, previous.name)
        XCTAssertEqual(appliedOverlays, [previous.name])
        XCTAssertEqual(armedEndpointSets.count, 2)
        XCTAssertEqual(armedEndpointSets[0].map(\.host), ["203.0.113.10", "198.51.100.20"])
        XCTAssertEqual(armedEndpointSets[1].map(\.host), ["203.0.113.10"])
    }

    @MainActor
    func testMidSwitchCatalogRemovalDoesNotRollBackToRemovedExit() async {
        let armed = KillSwitchService.isArmed
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let delayWasProven = SingBoxDelayGate.isProven
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        defer {
            KillSwitchService.isArmed = armed
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
            app.connectionCoordinator.cancelReconnectTasks()
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        let previous = Fixture.realityNode(
            name: "Tokyo-1", id: "tokyo-1", server: "203.0.113.10", port: 443
        )
        let next = Fixture.realityNode(
            name: "Singapore-2", id: "singapore-2", server: "198.51.100.20", port: 443
        )
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, next])
        ]
        app.selectedNodeId = previous.id
        app.activeNode = previous
        app.proxyService.activeNodeName = previous.name
        app.isConnected = true
        KillSwitchService.isArmed = true

        var appliedOverlays: [String?] = []
        let ops = AppState.NodeSwitchOperations(
            armKillSwitch: { _ in },
            applyRuntimeConfig: { overlay in appliedOverlays.append(overlay.selectedNodeName) },
            waitForTunnel: { true },
            verify: { selectedExit in
                if selectedExit?.name == next.name {
                    app.pendingRemovedCatalogExit = true
                    app.proxyRegions = [
                        ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [next])
                    ]
                    return .failed(
                        ProtectedConnectivity.failure(
                            .coreExitUnreachable,
                            stage: "verifyingTraffic",
                            attempt: 1,
                            generation: 0,
                            detail: "test exit unreachable"
                        )
                    )
                }
                return .connected(controllerAdvisory: nil)
            },
            closeConnections: { _ in },
            rememberNode: { node, name in
                app.selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
                app.activeNode = node
                app.proxyService.activeNodeName = name
            },
            refreshProxy: {}
        )

        app.selectNode(next.name, operations: ops)
        await app.connectionCoordinator.nodeSwitchTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(appliedOverlays, [next.name])
        XCTAssertFalse(app.isConnected)
    }
}
