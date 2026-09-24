import Foundation
import Observation

extension AccountSession {
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
        earlyTelemetryTask?.cancel(); earlyTelemetryTask = nil
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

    func updateRemoteDiagnosticsPolling() {
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
    func updateDiagnosticsLogUploading() {
        let enabled = SettingsKey.isNetworkLogUploadEnabled()
        guard state == .ready, !systemSleeping, user != nil, enabled else {
            if let uploader = diagnosticsLogUploader {
                Task { await uploader.stop() }
            }
            return
        }
        guard let user,
              let scope = DiagnosticsLogOwnership.shared.activate(owner: user.id) else { return }
        if diagnosticsLogUploader?.scopeID != scope {
            if let previous = diagnosticsLogUploader { Task { await previous.stop() } }
            let api = self.api
            diagnosticsLogUploader = DiagnosticsLogUploader(
                scopeID: scope,
                ownership: .shared,
                isEnabled: { DiagnosticsLogOwnership.shared.isCurrent(scope) },
                upload: { payload, sessionID, sequence, lineCount, clientVersion, osVersion in
                    _ = try await api.uploadDiagnosticsLogSegment(
                        payload: payload,
                        sessionID: sessionID,
                        sequence: sequence,
                        lineCount: lineCount,
                        clientVersion: clientVersion,
                        osVersion: osVersion,
                        requestIsCurrent: { DiagnosticsLogOwnership.shared.isCurrent(scope) }
                    )
                }
            )
        }
        if let uploader = diagnosticsLogUploader {
            Task { await uploader.start() }
        }
    }

    func abandonDiagnosticsLogUploader() async {
        DiagnosticsLogOwnership.shared.abandon()
        guard let uploader = diagnosticsLogUploader else { return }
        await uploader.abandonUnsentForAccountSwitch()
        diagnosticsLogUploader = nil
    }

    func networkLogUploadSettingChanged() {
        DiagnosticsLogOwnership.shared.consentChanged()
        updateDiagnosticsLogUploading()
    }

    func periodicTelemetrySettingChanged() {
        routeTelemetryCursor.reset(to: routeSplitConsumer())
        _ = ConnectionTelemetryBuffer.shared.drain()
        updatePeriodicTelemetry()
    }

    /// Ops "online" is derived from `POST telemetry/windows`. Windows already
    /// sends this; without it a signed-in Mac never appears on the dashboard.
    ///
    /// Gated on its own switch, like the Windows client's: the window carries
    /// the connection event ring and the whole protection state, which is more
    /// than "this device is online" and more than any other Privacy row on the
    /// Settings screen describes.
    func updatePeriodicTelemetry() {
        routeTelemetryCursor.setEnabled(
            state == .ready && user != nil && Self.isPeriodicTelemetryEnabled,
            current: routeSplitConsumer()
        )
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

    func uploadPeriodicTelemetryWindow() async {
        // The switch can be turned off while this task is parked on its sleep,
        // and the cancellation only lands at the next suspension point.
        guard periodicTelemetryConsent() else { return }
        // A sleep cancels the timer and a wake starts a fresh one, so the task
        // being new is not evidence that a window is due. Hold the cadence
        // across restarts rather than spending the hourly budget on them.
        let now = Date()
        let afterFailure = lastConnectFailureAt.map {
            now.timeIntervalSince($0) < Self.telemetryFailureFollowUpWindow
        } ?? false
        let spacing = afterFailure
            ? Self.telemetrySpacingAfterFailure
            : Self.periodicTelemetryMinimumSpacing
        if let last = lastPeriodicTelemetryAt, now.timeIntervalSince(last) < spacing {
            return
        }
        lastPeriodicTelemetryAt = now
        let pendingEvents = ConnectionTelemetryBuffer.shared.snapshot()
        let snapshot = diagnosticSnapshotConsumer()
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
        let osArch = Self.osArch
        let path = pathLatencyConsumer()
        // Snapshotted before the post, not read again after it: the ledger
        // keeps moving while the request is in flight, and advancing the
        // baseline to a later value than the one that was actually reported
        // would drop whatever arrived in between.
        let routeSplit = routeSplitConsumer()
        let nowMs = Int64(Date().timeIntervalSince1970 * 1_000)
        let routeInterval = routeTelemetryCursor.interval(endingAt: nowMs)
        let routeEpoch = routeTelemetryCursor.epoch
        let accountRevision = accountReadRevision
        let bytesByRoute = routeInterval.map { _ in
            AppTrafficLedger.windowDelta(from: routeTelemetryCursor.baseline, to: routeSplit)
        }
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
            // Omit both until the Worker advertises interval support. Old
            // Workers reject unknown keys; their heartbeat must keep working.
            bytesByRoute: bytesByRoute,
            routeBytesInterval: routeInterval,
            eventCount: pendingEvents.events.count,
            eventsDropped: pendingEvents.dropped,
            events: pendingEvents.events
        )
        do {
            let receipt = try await api.uploadTelemetryWindow(window)
            guard !Task.isCancelled, accountReadRevision == accountRevision,
                  periodicTelemetryConsent(),
                  !receipt.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            ConnectionTelemetryBuffer.shared.acknowledge(pendingEvents)
            routeTelemetryCursor.acknowledge(
                routeSplit, epoch: routeEpoch, interval: routeInterval,
                intervalVersion: receipt.routeBytesIntervalVersion
            )
        } catch TonoAPIClient.APIError.server(status: 400, message: _) {
            guard !Task.isCancelled, accountReadRevision == accountRevision,
                  periodicTelemetryConsent(), routeInterval != nil else { return }
            routeTelemetryCursor.forgetIntervalSupport(epoch: routeEpoch)
        } catch TonoAPIClient.APIError.unauthorized {
            guard !Task.isCancelled, accountReadRevision == accountRevision else { return }
            // Final: the client's own token renewal was refused too. The Worker
            // answers an expired plan, a used-up allowance, a disabled account
            // and a revoked device this way, so suspend as `refreshAccount`
            // does, protection left as it is. Settled here, not by a further
            // request whose transient failure would drop the refusal.
            enterEntitlementBlock(detail: nil)
        } catch {
            // The next cadence retries. This path must not drop protection.
        }
    }

    nonisolated static var osArch: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "unknown"
        #endif
    }

    /// Wires the buffer's failure notices to the immediate report. Installed
    /// once at construction; consent and state are re-checked on every notice.
    func installConnectFailureReporting() {
        ConnectionTelemetryBuffer.shared.setFailureSink { [weak self] notice in
            Task { @MainActor in await self?.reportConnectFailure(notice) }
        }
    }

    /// The failure travels on its own, the moment it happens. It rides the same
    /// consent as the protection snapshot — it is a slice of the same event
    /// ring — and the Worker keeps a separate budget for it, so a bad evening
    /// of retries cannot starve the heartbeat that would show the recovery.
    /// An internal build also sends the classified fields without that consent,
    /// until the user turns that off in Settings.
    func reportConnectFailure(_ notice: ConnectFailureNotice) async {
        let internalBuild = Self.isInternalBuild()
        guard state == .ready, !systemSleeping, user != nil,
              let scope = Self.failureReportScope(
                  internalBuild: internalBuild,
                  snapshotOptedIn: Self.isPeriodicTelemetryEnabled,
                  internalOptedOut: Self.isInternalFailureReportsOptedOut
              ) else { return }
        let full = scope == .full
        let snapshot = diagnosticSnapshotConsumer()
        // A failure before any node was chosen has nothing to pin to a machine;
        // the window still carries it, so nothing is lost by not sending now.
        let selected = snapshot.selectedExit == "unknown" ? nil : snapshot.selectedExit
        guard let node = notice.node ?? selected, !node.isEmpty else { return }
        let path = pathLatencyConsumer()
        let report = TonoConnectFailureReport(
            ts: notice.ts,
            stage: notice.stage,
            code: notice.code,
            error: full ? notice.error : nil,
            node: String(node.prefix(120)),
            appVersion: String(snapshot.appVersion.prefix(40)),
            osVersion: String(
                DiagnosticsLogUploader.compactOperatingSystemVersion().prefix(80)
            ),
            osArch: Self.osArch,
            coreErrors: full && !notice.coreErrors.isEmpty ? notice.coreErrors : nil,
            tcpDelayMs: path.tcpDelayMs,
            exitDelayMs: path.exitDelayMs,
            transport: notice.transport
        )
        lastConnectFailureAt = Date()
        do {
            // Consent is re-read before each attempt, not only here: a token
            // refresh or retry can wait while the user turns the switch off.
            _ = try await api.reportConnectFailure(report, requestIsCurrent: {
                AccountSession.failureReportStillAllowed(builtAs: scope, internalBuild: internalBuild)
            })
        } catch {
            // Best effort: the window still carries the event, and a report
            // that did not land must never touch protection or the sign-in.
        }
        scheduleEarlyTelemetryWindow()
    }

    /// One window five minutes after a failure, so the operator sees whether
    /// the retry worked before the regular cadence would say so.
    func scheduleEarlyTelemetryWindow() {
        earlyTelemetryTask?.cancel()
        earlyTelemetryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(Self.telemetrySpacingAfterFailure))
            } catch { return }
            guard let self, state == .ready, !systemSleeping else { return }
            await uploadPeriodicTelemetryWindow()
        }
    }

    /// Sends whatever is unsent right now, for the Support page's button, and
    /// reports what the sweep actually did. The three outcomes are materially
    /// different to the person waiting on them — a segment reached support, the
    /// log had not advanced, or the POST was refused — and collapsing them into
    /// "the run finished" left a failed upload indistinguishable from a sent one.
    @discardableResult
    func uploadDiagnosticsLogNow() async -> DiagnosticsLogUploader.SweepOutcome {
        guard state == .ready, !systemSleeping, user != nil,
              LocalTrafficAudit.isEnabled, SettingsKey.isNetworkLogUploadEnabled() else { return .disabled }
        updateDiagnosticsLogUploading()
        // `updateDiagnosticsLogUploading` only builds the uploader once the
        // account, sleep and consent preconditions hold. A nil one is therefore
        // a pipeline that cannot run, never an upload that found nothing.
        guard let uploader = diagnosticsLogUploader else { return .disabled }
        return await uploader.sweep()
    }

    func updateAppRoutingResearchUploading() {
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        guard state == .ready, !systemSleeping,
              AppRoutingResearch.isCollectionActive, user != nil else { return }
        appRoutingResearchTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, state == .ready, !systemSleeping,
                      AppRoutingResearch.isCollectionActive else { return }
                if let lease = await AppRoutingResearch.shared.readySnapshot() {
                    let revision = accountReadRevision
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
                        // As for the periodic window: a final refusal of this
                        // account suspends it; never sign out or release here.
                        guard !Task.isCancelled,
                              accountReadRevision == revision else { return }
                        enterEntitlementBlock(detail: nil)
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

    func pollDeviceActions() async {
        guard !systemSleeping, user != nil, !Task.isCancelled else { return }
        let revision = accountReadRevision
        do {
            for action in try await api.deviceActions().actions {
                guard !Task.isCancelled, !systemSleeping, accountReadRevision == revision else { return }
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
                guard !Task.isCancelled, accountReadRevision == revision else { return }
                try await api.submitDeviceActionResult(id: action.id, result: result)
            }
        } catch {
            // A transient control-plane failure is retried by the next pull;
            // delivered actions are replayed by the Worker until completion.
        }
    }

    func refreshDevicesInBackground() {
        deviceRefreshTask?.cancel()
        let revision = accountReadRevision
        deviceRefreshTask = Task { [weak self] in
            guard let self, accountReadRevision == revision else { return }
            do {
                let published = try await reloadDevices()
                guard published, !Task.isCancelled, accountReadRevision == revision else { return }
                device = devices.first(where: { $0.current == true })
            } catch {
                // Device management can be retried from account settings. A
                // transient inventory failure must not hold the dashboard.
            }
        }
    }

    func resumeOrEnrollRuntime() async {
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

    func fail(_ error: Error, signsOutOnUnauthorized: Bool = false) async {
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
        earlyTelemetryTask?.cancel()
        earlyTelemetryTask = nil
        await descriptorConsumer(nil)
        // No failure disarms, a refused session included: the Worker refuses an
        // expired plan, a used-up allowance, a disabled account and a revoked
        // device alike. Sign out with PF and DNS left as they are. While the
        // kill switch holds, the sign-in gate says so and offers Restore
        // internet; the kept resume intent reconnects at the next sign-in
        // unless the helper has confirmed a release by then.
        if accountLost {
            await sidecar.stop()
            let resumeProtection = shouldResumeProtection
            await api.logout(); clearAccount(); state = .signedOut
            shouldResumeProtection = resumeProtection
        } else {
            // Leave kill switch armed if it was armed — prevents IP leak on failed reconnect.
            state = .error((error as? LocalizedError)?.errorDescription ?? String(localized: "Something went wrong. Please try again."))
        }
    }

    func pauseAppRoutingResearch() {
        AppRoutingResearch.shared.pause()
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        appRoutingResearchActivationConsumer()
    }

    func deactivateAppRoutingResearch() {
        AppRoutingResearch.shared.deactivateAndPurge()
        appRoutingResearchTask?.cancel()
        appRoutingResearchTask = nil
        appRoutingResearchActivationConsumer()
    }

    func clearAccount() {
        DiagnosticsLogOwnership.shared.abandon()
        invalidateAccountReads()
        // Re-anchor on the way out: the ledger's counter outlives the account,
        // so without this the first window of the next account to sign in here
        // would carry the previous account's unreported tail.
        routeTelemetryCursor.setEnabled(false, current: routeSplitConsumer())
        routeTelemetryCursor.reset(to: routeSplitConsumer())
        _ = ConnectionTelemetryBuffer.shared.drain()
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
