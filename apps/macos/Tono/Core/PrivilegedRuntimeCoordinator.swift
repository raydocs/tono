import Foundation

/// Serializes every blocking helper, PF, and system-network operation away
/// from the main actor. Besides keeping SwiftUI responsive, one queue prevents
/// a late "arm" reply from racing past an intentional disconnect/disarm.
actor PrivilegedRuntimeCoordinator {
    static let shared = PrivilegedRuntimeCoordinator()

    func verifyUpdateOffer(manifest: Data, signature: Data) throws -> Bool {
        guard HelperManager.currentVersion() == HelperProtocolVersion.current else {
            throw CoreRuntimeError.startFailed("Native updates require the current paired Tono candidate and helper. Legacy clients need manual replacement after Disconnect.")
        }
        return try HelperManager.updateOffer(manifest: manifest, signature: signature)
    }

    func stageUpdate(manifest: Data, signature: Data, package: URL) throws -> HelperManager.UpdateStatus {
        try HelperManager.updateRequest("stage", object: [
            "manifest": manifest.base64EncodedString(), "signature": signature.base64EncodedString(),
            "package": try HelperManager.updatePackagePath(package),
        ])
    }

    func nativeUpdate(_ operation: String) throws -> HelperManager.UpdateStatus {
        if operation == "prepare" || operation == "disconnect" {
            try disableSystemProxyIfNeeded()
        }
        return try HelperManager.updateRequest(operation)
    }

    /// Nil is allowed only for an absent/legacy helper. A v1 helper refusing
    /// or timing out never grants normal recovery/cleanup authority.
    func pendingNativeUpdate() throws -> HelperManager.UpdateStatus? {
        let version = HelperManager.currentVersion()
        if let version, version.compare("4.5.0", options: .numeric) == .orderedAscending { return nil }
        guard version != nil else {
            if HelperManager.hasInstalledHelperArtifact {
                // Query anyway: a restarting v1 helper must not be mistaken
                // for a legacy helper on a version-probe timeout.
                return try HelperManager.updateRequest("status")
            }
            return nil
        }
        return try HelperManager.updateRequest("status")
    }

    func prepareHelper() throws {
        try HelperManager.installIfNeeded()
    }

    func daemonRejectsClient() -> Bool {
        HelperManager.daemonRejectsClient()
    }

    /// Explicit user-requested release is the one safe place to prompt for a
    /// helper repair. The actor keeps the probe and possible install ordered
    /// before core stop, DNS restoration, and PF disarm.
    func repairHelperForExplicitReleaseIfNeeded() throws {
        guard HelperManager.explicitReleaseRequiresRepair() else { return }
        try KillSwitchService.installIfNeeded()
    }

    func installAndStartCore(
        configDirectory: String,
        configSHA256: String,
        helperPrepared: Bool = false
    ) throws {
        if !helperPrepared {
            try HelperManager.installIfNeeded()
        }
        try HelperManager.startCore(
            configDir: configDirectory,
            configSHA256: configSHA256
        )
    }

    func stopCore() throws {
        try HelperManager.stopCore()
    }

    /// One non-reentrant helper transaction: no new arm/start can interleave
    /// between the stop, DNS restore, and final protection observation.
    func prepareForSoftwareUpdate(keepKillSwitchArmed: Bool) throws {
        if keepKillSwitchArmed {
            try KillSwitchService.restrictToBootstrap()
        }
        try HelperManager.stopCore()
        let core = HelperManager.coreStatus()
        guard core.verified, !core.running else {
            throw CoreRuntimeError.startFailed("Update preparation could not prove that Core stopped.")
        }
        guard try HelperManager.restoreProtectedDNSIfConfigured() else {
            throw CoreRuntimeError.startFailed("Update preparation requires a helper with protected DNS recovery.")
        }
        try disableSystemProxyIfNeeded()
        let protection = try HelperManager.killSwitchStatus()
        guard UpdatePreparation.protectionMatches(
            keepKillSwitchArmed: keepKillSwitchArmed,
            armed: protection.armed, wanted: protection.wanted, live: protection.live
        ) else {
            throw CoreRuntimeError.startFailed("Update preparation could not verify the expected protection state.")
        }
    }

    func syncCoreConfig(configDirectory: String, configSHA256: String) throws -> String {
        try HelperManager.syncCoreConfig(
            configDir: configDirectory,
            configSHA256: configSHA256
        )
    }

    func coreStatus() -> (
        running: Bool,
        pid: Int?,
        lastError: String?,
        verified: Bool
    ) {
        HelperManager.coreStatus()
    }

    func armKillSwitch(
        apiHosts: [String]? = nil,
        exitNodeHints: [String]? = nil,
        tunnelInterfaces: [String]? = nil,
        proxyEndpoints: [ConfigPipeline.DialEndpoint]? = nil,
        sessionDirectEndpoints: [ConfigPipeline.DirectEndpoint]? = nil,
        tailscaleBootstrapEnabled: Bool? = nil,
        allowSystemResolution: Bool = false,
        helperPrepared: Bool = false,
        // Deliberately without a default. Arming rewrites the entire ruleset,
        // so a call that omits this silently revokes the reviewed-bundle
        // permit while the rule engine still routes that bundle direct — the
        // packets then hit `block drop out quick all` and the app hangs. That
        // shipped once, from a single omission in the pin-refresh convergence
        // arm. Make the compiler ask.
        reviewedBundleDirect: Bool
    ) throws {
        try KillSwitchService.arm(
            apiHosts: apiHosts,
            exitNodeHints: exitNodeHints,
            tunnelInterfaces: tunnelInterfaces,
            proxyEndpoints: proxyEndpoints,
            sessionDirectEndpoints: sessionDirectEndpoints,
            tailscaleBootstrapEnabled: tailscaleBootstrapEnabled,
            allowSystemResolution: allowSystemResolution,
            helperPrepared: helperPrepared,
            reviewedBundleDirect: reviewedBundleDirect
        )
    }

    func disarmKillSwitch() throws {
        try KillSwitchService.disarm()
    }

    func restrictKillSwitchToBootstrap() throws {
        try KillSwitchService.restrictToBootstrap()
    }

    func reassertKillSwitchIfNeeded() throws {
        try KillSwitchService.reassertIfNeeded()
    }

    func refreshKillSwitchStatus() -> KillSwitchService.StatusObservation {
        KillSwitchService.refreshStatus()
    }

    /// nil when the helper did not answer, which is evidence of nothing.
    func killSwitchHealth() -> (wanted: Bool, live: Bool, repairedSinceArm: Bool)? {
        try? HelperManager.killSwitchHealth()
    }

    func cleanupStaleSystemProxy() {
        SystemProxy.cleanupIfStale()
    }

    func primaryNetworkService() -> String? {
        SystemProxy.primaryNetworkService()
    }

    func primaryNetworkInterface() -> String? {
        SystemProxy.primaryNetworkInterface()
    }

    func enableProtectedDNS(service: String) throws {
        try HelperManager.enableProtectedDNS(service: service)
    }

    func restoreProtectedDNS() throws {
        try HelperManager.restoreProtectedDNS()
    }

    @discardableResult
    func restoreProtectedDNSIfConfigured() throws -> Bool {
        try HelperManager.restoreProtectedDNSIfConfigured()
    }

    /// Three-state on purpose. `protectedDNSStatus()` reports the same
    /// all-false tuple for a socket error, a receive timeout, a 403, and a
    /// malformed body as it does for an authenticated "not configured", so
    /// collapsing this to a Bool turned a 1-2 second helper restart into a
    /// verdict of "protected DNS is gone" and tore down a healthy session —
    /// every 60s of connected time, and again on every network change. PF is
    /// the leak boundary, so withholding a verdict until the next cycle is not
    /// fail-open.
    nonisolated enum ProtectedDNSIntegrity: Equatable {
        case intact
        case broken
        case unverifiable
        /// The default resolver is protected, but split-DNS rules (a
        /// corporate VPN, a profile, `/etc/resolver`) send matching names to
        /// servers off this Mac. Reconnecting cannot change that, so this is
        /// not `.broken`; and it is not `.intact` either.
        case supplementalConflict([SystemNetworkObservation.SupplementalResolver])
    }

    func protectedDNSIntegrity(service: String) -> ProtectedDNSIntegrity {
        let status = HelperManager.protectedDNSStatus()
        guard status.available else { return .unverifiable }
        guard status.configured && status.service == service else { return .broken }
        // The helper reads back only what is stored on `service`. That is
        // still "configured" when macOS resolves through a different
        // service, so the verdict also needs the resolver macOS actually
        // uses. A store that cannot be read is withheld, like the helper.
        guard let observation = SystemNetworkObservation.current() else {
            return .unverifiable
        }
        // The default resolver is only part of it: split-DNS rules answer
        // their domains without ever reaching the default resolver.
        if let conflicts = observation.conflictingSupplementalResolvers, !conflicts.isEmpty {
            return .supplementalConflict(conflicts)
        }
        guard observation.effectiveResolverIsProtected else { return .broken }
        return observation.conflictingSupplementalResolvers == nil ? .unverifiable : .intact
    }

    func protectedDNSStatus() -> (
        available: Bool,
        configured: Bool,
        snapshotPresent: Bool,
        service: String?
    ) {
        HelperManager.protectedDNSStatus()
    }

    func disableSystemProxyIfNeeded() throws {
        guard SystemProxy.didSetProxy else { return }
        try SystemProxy.disable()
    }

    func enableSystemProxy(httpPort: Int, socksPort: Int) throws {
        try SystemProxy.enable(httpPort: httpPort, socksPort: socksPort)
    }

    func replaceSystemProxy(httpPort: Int, socksPort: Int) throws {
        if SystemProxy.didSetProxy {
            try SystemProxy.disable()
        }
        try SystemProxy.enable(httpPort: httpPort, socksPort: socksPort)
    }

    func systemProxyIsIntact() -> Bool {
        SystemProxy.verifyProxyIntact()
    }

    func reapplySystemProxy() throws {
        try SystemProxy.reapply()
    }
}
