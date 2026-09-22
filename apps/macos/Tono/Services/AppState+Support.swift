import Foundation

extension AppState {
    /// Captures one immutable account/attempt observation. If either owner
    /// changes while local reads run, no mixed report is presented or uploaded.
    func collectLocalHealth(
        account: AccountSession?,
        probe: @Sendable () async -> SupportRuntimeEvidence = SupportRuntimeEvidence.collect
    ) async -> LocalHealthCheck? {
        let revision = account?.accountReadRevision
        let owner = account?.user?.id
        let generation = connectionCoordinator.protectionOperationGeneration
        let attempt = connectionCoordinator.connectAttemptID
        let snapshot = compactRemoteDiagnosticSnapshot()
        let catalogDigest = managedCatalogDigest
        let runtimeDigest = loadedRuntimeConfigDigest
        let durations = lastConnectionStageDurations
        let completed = completedConnectionStages
        let failure = lastConnectionFailure
        let errorCode = lastClassifiedFailure?.code.rawValue ?? snapshot.lastErrorCategory
        let runtime = await probe()
        guard !Task.isCancelled, revision == account?.accountReadRevision,
              owner == account?.user?.id,
              generation == connectionCoordinator.protectionOperationGeneration,
              attempt == connectionCoordinator.connectAttemptID,
              catalogDigest == managedCatalogDigest, runtimeDigest == loadedRuntimeConfigDigest,
              failure == lastConnectionFailure,
              snapshot.connected == isConnected, snapshot.connecting == isConnecting,
              snapshot.disconnecting == isDisconnecting,
              snapshot.protectionBlocked == isProtectionBlocked,
              snapshot.catalogRevision == managedCatalogVersion else { return nil }

        let now = Date()
        let ready = account?.isReady == true
        let catalogOwned = owner != nil && owner == ManagedExitCatalogOwnership.currentAccount
        let nodes = catalogOwned ? managedCatalogNodes : []
        let selected = nodes.first { $0.name == snapshot.selectedExit }?.name
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let osVersion = "macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
        #if arch(arm64)
        let arch = "arm64"
        #elseif arch(x86_64)
        let arch = "x86_64"
        #else
        let arch = "unknown"
        #endif
        let state = isDisconnecting ? "disconnecting" : isConnecting ? "connecting"
            : isProtectionBlocked ? "protectedOffline" : isConnected ? "connected" : "standby"
        let steps = durations.prefix(32).map {
            TonoSupportReport.Step(
                key: String($0.stage.rawValue.prefix(60)),
                state: failure?.stage == $0.stage ? "failed"
                    : completed.contains($0.stage) || snapshot.connected ? "completed" : "pending",
                elapsedMs: min(max($0.milliseconds, 0), 86_400_000)
            )
        }
        let report = TonoSupportReport(
            reportedAtMs: Int64(now.timeIntervalSince1970 * 1_000),
            appVersion: String(snapshot.appVersion.prefix(40)), osVersion: osVersion, osArch: arch,
            serviceProtocol: runtime.helperVersion.map { String($0.prefix(20)) }, serviceBuild: nil,
            uiState: state, accountState: ready ? "ready" : owner == nil ? "signedOut" : "notReady",
            selectedServer: selected.map { String($0.prefix(100)) },
            catalogRevision: catalogOwned ? snapshot.catalogRevision : nil,
            killSwitchMode: snapshot.killSwitchArmed ? "cachedArmed" : "cachedUnarmed",
            killSwitchWanted: snapshot.killSwitchArmed, killSwitchLive: nil,
            killSwitchLastError: nil, dnsEnabled: runtime.dnsConfigured, dnsLastError: nil,
            failedStage: failure.map { String($0.stage.rawValue.prefix(60)) },
            // Only stable categories/codes, never raw errors, paths or log text.
            error: errorCode,
            retryAttempt: snapshot.reconnectAttempt,
            totalElapsedMs: steps.isEmpty ? nil : min(steps.reduce(0) { $0 + ($1.elapsedMs ?? 0) }, 86_400_000),
            steps: steps, virtualAdapters: [], auditLogPath: "", serviceLogPath: ""
        )
        let findings: [LocalHealthCheck.Finding] = [
            .init(id: "account", title: String(localized: "Account"), status: ready ? .observed : .attention,
                  detail: ready ? String(localized: "Account is ready locally. Server entitlement was not rechecked.")
                    : String(localized: "Open Account to sign in or review the account status.")),
            .init(id: "catalog", title: String(localized: "Server catalog"), status: nodes.isEmpty ? .unknown : .observed,
                  detail: nodes.isEmpty ? String(localized: "No account-owned catalog is available. Open Nodes and refresh the catalog.")
                    : String(localized: "Using the accepted account catalog. Availability at the server was not rechecked.")),
            .init(id: "helper", title: String(localized: "Network helper"),
                  status: runtime.helperVersion == nil ? .attention : .observed,
                  detail: runtime.helperVersion == nil
                    ? String(localized: "Helper authorization is unavailable. Use a signed Tono app in Applications; choose Repair and reconnect and approve the macOS administrator prompt. This check never prompts or repairs.")
                    : String(localized: "The helper answered. This is protocol evidence, not binary attestation.")),
            .init(id: "core", title: String(localized: "Core engine"),
                  status: runtime.coreRunning == nil ? .unknown : runtime.coreRunning == false && isConnected ? .attention : .observed,
                  detail: runtime.coreRunning == nil ? String(localized: "Core state is unknown because the helper did not answer. Open Support after helper authorization.")
                    : runtime.coreRunning == true ? String(localized: "The helper reports a running Core. Its binary build identity is unverified.")
                    : String(localized: "The helper reports Core stopped. Connect only when you want protection.")),
            .init(id: "protection", title: String(localized: "Protection"), status: .unknown,
                  detail: String(localized: "Protection intent is cached. Live PF rules were not rechecked because the helper status operation can repair them; this check never changes the network.")),
            .init(id: "dns", title: String(localized: "Protected DNS"),
                  status: runtime.dnsConfigured == nil ? .unknown : runtime.dnsConfigured == false && isConnected ? .attention : .observed,
                  detail: runtime.dnsConfigured == nil ? String(localized: "DNS ownership is unknown. Authorize the helper and check again; no resolver query was sent.")
                    : runtime.dnsConfigured == true ? String(localized: "The helper read back protected DNS settings. DNS resolution and browser Secure DNS were not tested.")
                    : String(localized: "Protected DNS is not configured. If recovery is blocked, use Retry now; this check does not reconnect.")),
            .init(id: "connection", title: String(localized: "Connection"), status: .unknown,
                  detail: String(localized: "Connection state and the last attempt are local evidence, not a new reachability test. Retry only when needed; a healthy exit is left unchanged.")),
        ]
        let identity = [
            "App: \(snapshot.appVersion) (\(snapshot.build))",
            "Build source: \(AppBuildSource.read()?.description ?? "unknown")",
            "Signing / notarization / release channel: unverified",
            "Helper observed protocol: \(runtime.helperVersion ?? "unknown")",
            "Helper required protocol: \(HelperProtocolVersion.current)",
            "Helper binary identity: unknown",
            "Core PID: \(runtime.corePID.map(String.init) ?? "unknown"); binary identity: unknown",
            "Catalog accepted revision: \(snapshot.catalogRevision.map(String.init) ?? "unknown")",
            "Catalog accepted digest: \(catalogDigest ?? "unknown")",
            "Runtime config submitted digest: \(runtimeDigest ?? "unknown") (not live attestation)",
            "Attempt: \(attempt?.uuidString ?? "unknown"); generation: \(generation)",
        ].joined(separator: "\n")
        return LocalHealthCheck(
            observedAt: now, accountRevision: revision, owner: owner, generation: generation,
            attempt: attempt, snapshot: snapshot, runtime: runtime, findings: findings,
            request: TonoSupportReportRequest(report: report), localIdentity: identity
        )
    }
}
