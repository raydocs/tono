import XCTest
import NetworkExtension
@testable import Tono

final class ProtectionTests: XCTestCase {
    func testStoredWatermarkCannotTreatCorruptionAsFirstUse() throws {
        XCTAssertEqual(try TunnelVault.decodeWatermark(nil), "")
        XCTAssertThrowsError(try TunnelVault.decodeWatermark(Data()))
        XCTAssertThrowsError(try TunnelVault.decodeWatermark(Data([0xff])))
        XCTAssertThrowsError(try TunnelVault.decodeWatermark(Data(repeating: 32, count: 4097)))
        let bytes = Data("{\"catalog\":{\"number\":7}}".utf8)
        // Preserve bytes for Go's strict semantic admission; Swift never repairs them.
        XCTAssertEqual(try TunnelVault.decodeWatermark(bytes), String(data: bytes, encoding: .utf8))
    }

    func testPersistedAttemptRequiresFreshExtensionEvidenceAfterRelaunch() {
        var machine = ProtectionMachine()
        let generation = UUID()
        XCTAssertTrue(machine.observeExisting(generation))
        XCTAssertEqual(machine.state, .recovering)
        machine.receive(.init(version: 1, generation: UUID(), observedAt: .now, state: .protected,
            blocker: nil, routesInstalled: true, dnsInstalled: true, coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .recovering)
        machine.receive(.init(version: 1, generation: generation, observedAt: .now, state: .protected,
            blocker: nil, routesInstalled: true, dnsInstalled: true, coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .protected)
        let replacement = UUID()
        XCTAssertTrue(machine.observeExisting(replacement))
        XCTAssertFalse(machine.observeExisting(generation))
        XCTAssertEqual(machine.generation, replacement)
        XCTAssertEqual(machine.state, .recovering)
    }

    func testLateProtectedReceiptCannotUndoPause() {
        var machine = ProtectionMachine()
        let generation = machine.begin()
        let receipt = TunnelReceipt(version: 1, generation: generation, observedAt: .now,
                                    state: .protected, blocker: nil, routesInstalled: true,
                                    dnsInstalled: true, coreRunning: true, probeSucceeded: true)
        machine.receive(receipt)
        XCTAssertEqual(machine.state, .protected)
        machine.pause()
        XCTAssertFalse(machine.observeExisting(generation))
        machine.receive(receipt)
        XCTAssertEqual(machine.state, .paused)
    }

    func testFailedGenerationCannotBeRevivedByLateProtectedReceipt() {
        var machine = ProtectionMachine()
        let failedGeneration = machine.begin()
        machine.fail(.invalidPolicy)
        XCTAssertNotEqual(machine.generation, failedGeneration)
        XCTAssertFalse(machine.observeExisting(failedGeneration))
        machine.receive(.init(version: 1, generation: failedGeneration, observedAt: .now, state: .protected,
                              blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .actionRequired)
        XCTAssertEqual(machine.blocker, .invalidPolicy)
        let retry = machine.begin()
        XCTAssertFalse(machine.observeExisting(failedGeneration))
        XCTAssertEqual(machine.generation, retry)
        machine.receive(.init(version: 1, generation: retry, observedAt: .now, state: .protected,
                              blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .protected) // rejecting all receipts would be wrong too
        machine.receive(.init(version: 1, generation: retry, observedAt: .now, state: .actionRequired,
                              blocker: .invalidPolicy, routesInstalled: false, dnsInstalled: false,
                              coreRunning: false, probeSucceeded: false))
        machine.receive(.init(version: 1, generation: retry, observedAt: .now, state: .protected,
                              blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .actionRequired)
        XCTAssertEqual(machine.blocker, .invalidPolicy)
    }

    func testConnectedWithoutDNSReceiptIsNotProtected() {
        var machine = ProtectionMachine()
        let generation = machine.begin()
        machine.receive(.init(version: 1, generation: generation, observedAt: .now, state: .protected,
                              blocker: nil, routesInstalled: true, dnsInstalled: false,
                              coreRunning: true, probeSucceeded: true))
        XCTAssertEqual(machine.state, .actionRequired)
    }

    func testStaleReceiptDoesNotPromoteConnecting() {
        var machine = ProtectionMachine()
        let generation = machine.begin()
        let now = Date(timeIntervalSince1970: 100)
        machine.receive(.init(version: 1, generation: generation, observedAt: now.addingTimeInterval(-11),
                              state: .protected, blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true), now: now)
        XCTAssertEqual(machine.state, .connecting)
    }

    func testForegroundExpiryWithdrawsHealthButFreshObservationCanReattach() {
        var machine = ProtectionMachine()
        let generation = machine.begin()
        let now = Date(timeIntervalSince1970: 100)
        let receipt = TunnelReceipt(version: 1, generation: generation, observedAt: now,
                                    state: .protected, blocker: nil, routesInstalled: true,
                                    dnsInstalled: true, coreRunning: true, probeSucceeded: true)
        machine.receive(receipt, now: now)
        machine.receive(receipt, now: now.addingTimeInterval(9))
        machine.expire(now: now.addingTimeInterval(10))
        XCTAssertEqual(machine.state, .protected)
        machine.expire(now: now.addingTimeInterval(10.001))
        XCTAssertEqual(machine.state, .recovering)
        XCTAssertEqual(machine.generation, generation)
        XCTAssertTrue(machine.observeExisting(generation))
        XCTAssertEqual(machine.blocker, .tunnelUnavailable)
        machine.receive(receipt, now: now.addingTimeInterval(11))
        XCTAssertEqual(machine.state, .recovering) // replay cannot refresh evidence
        machine.receive(.init(version: 1, generation: generation, observedAt: now.addingTimeInterval(11),
                              state: .protected, blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true), now: now.addingTimeInterval(11))
        XCTAssertEqual(machine.state, .protected) // same authorized tunnel after foreground
        let retry = machine.begin()
        machine.receive(.init(version: 1, generation: retry, observedAt: now, state: .protected,
                              blocker: nil, routesInstalled: true, dnsInstalled: true,
                              coreRunning: true, probeSucceeded: true), now: now)
        machine.expire(now: now.addingTimeInterval(-1))
        XCTAssertEqual(machine.state, .recovering) // clock rollback withdraws trust
    }

    func testAutomaticKeepsOrderedBackupAndRequiredHomeBlocksEntry() {
        var plan = ResidentialRoutePlan(selection: .automatic, orderedHomes: ["home-b", "home-a"],
                                        allowsEntryFallback: true, requiresHome: true)
        XCTAssertEqual(plan.current, .residential("home-b"))
        plan.failed()
        XCTAssertEqual(plan.current, .residential("home-a"))
        XCTAssertEqual(plan.current, .residential("home-a"))
        plan.failed()
        XCTAssertEqual(plan.current, .blocked)
    }

    func testEntryFallbackRequiresExplicitPermissionAndManualPinNeverMoves() {
        var automatic = ResidentialRoutePlan(selection: .automatic, orderedHomes: ["home-b"],
                                             allowsEntryFallback: true, requiresHome: false)
        automatic.failed()
        XCTAssertEqual(automatic.current, .entry)
        var pinned = ResidentialRoutePlan(selection: .pinned("home-b"), orderedHomes: ["home-a", "home-b"],
                                          allowsEntryFallback: true, requiresHome: false)
        XCTAssertEqual(pinned.current, .residential("home-b"))
        pinned.failed()
        XCTAssertEqual(pinned.current, .blocked)
        let denied = ResidentialRoutePlan(selection: .automatic, orderedHomes: [],
                                          allowsEntryFallback: false, requiresHome: false)
        XCTAssertEqual(denied.current, .blocked)
    }

    @MainActor func testOnDemandProfileHasNoLocalBypass() throws {
        let manager = TunnelController.configuration(onDemand: true)
        let proto = try XCTUnwrap(manager.protocolConfiguration as? NETunnelProviderProtocol)
        XCTAssertTrue(manager.isOnDemandEnabled)
        XCTAssertEqual(manager.onDemandRules?.count, 1)
        XCTAssertTrue(manager.onDemandRules?.first is NEOnDemandRuleConnect)
        XCTAssertTrue(proto.includeAllNetworks)
        XCTAssertFalse(proto.excludeLocalNetworks)
        XCTAssertFalse(proto.excludeAPNs)
        XCTAssertFalse(proto.excludeCellularServices)
        XCTAssertFalse(proto.enforceRoutes) // applies only when includeAllNetworks is false
        XCTAssertFalse(proto.disconnectOnSleep)
        XCTAssertEqual(proto.providerBundleIdentifier, "com.ninx.tono.PacketTunnel")
    }

    #if canImport(Tonomobile)
    func testLinkedCoreMatchesBundledBuildIdentity() {
        XCTAssertNoThrow(try SingBoxIdentity.requireEmbeddedCore())
    }
    #else
    @MainActor func testMissingCoreRefusesBeforeInstallingProfile() async {
        do {
            try await TunnelController().start(generation: UUID(), onDemand: true)
            XCTFail("Missing core must not start")
        } catch { XCTAssertEqual(error as? Blocker, .coreUnavailable) }
    }
    #endif
}
