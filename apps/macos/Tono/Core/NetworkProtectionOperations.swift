import Foundation

/// System boundary used by the disconnect owner and by the protected
/// reconnect loop's external-release reconciliation. Tests replace only
/// helper I/O, leaving admission, task draining, release decisions and UI
/// settlement intact.
@MainActor
struct NetworkProtectionOperations {
    var repairForRelease: () async throws -> Void = {
        try await PrivilegedRuntimeCoordinator.shared.repairHelperForExplicitReleaseIfNeeded()
    }
    var stopCore: (CoreRuntimeManager) async -> Bool = { await $0.stopAsync() }
    var coreStatus: () async -> (running: Bool, verified: Bool) = {
        let status = await PrivilegedRuntimeCoordinator.shared.coreStatus()
        return (status.running, status.verified)
    }
    var restoreDNS: () async throws -> Bool = {
        try await PrivilegedRuntimeCoordinator.shared.restoreProtectedDNSIfConfigured()
    }
    var disableSystemProxy: () async throws -> Void = {
        try await PrivilegedRuntimeCoordinator.shared.disableSystemProxyIfNeeded()
    }
    var disarm: () async throws -> Void = {
        try await PrivilegedRuntimeCoordinator.shared.disarmKillSwitch()
    }
    var restrictToBootstrap: () async throws -> Void = {
        try await PrivilegedRuntimeCoordinator.shared.restrictKillSwitchToBootstrap()
    }
    var refreshKillSwitchStatus:
        () async -> KillSwitchService.StatusObservation = {
            await PrivilegedRuntimeCoordinator.shared.refreshKillSwitchStatus()
        }
}

/// System boundary for the read-only audits a connected session runs: the
/// primary network service, the Protected DNS integrity read and the
/// helper's PF health. Production asks the privileged coordinator; tests
/// substitute the replies so one core monitor tick's DNS and PF audits run
/// without the helper.
@MainActor
struct ProtectionAuditOperations {
    var primaryNetworkService: () async -> String? = {
        await PrivilegedRuntimeCoordinator.shared.primaryNetworkService()
    }
    var protectedDNSIntegrity:
        (String) async -> PrivilegedRuntimeCoordinator.ProtectedDNSIntegrity = {
            await PrivilegedRuntimeCoordinator.shared.protectedDNSIntegrity(service: $0)
        }
    var killSwitchHealth:
        () async -> (wanted: Bool, live: Bool, repairedSinceArm: Bool)? = {
            await PrivilegedRuntimeCoordinator.shared.killSwitchHealth()
        }
}
