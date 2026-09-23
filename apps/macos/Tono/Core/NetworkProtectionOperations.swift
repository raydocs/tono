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
