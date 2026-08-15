import XCTest
@testable import Tono

/// The PF session-endpoint ceiling is shared with the privileged helper, which
/// independently refuses more than it accepts and is only replaced by a
/// `HelperProtocolVersion` bump. So the ceiling is not negotiable, and the only
/// question is what happens on the way to it: `validatedManagedDirectPolicy`
/// refuses an over-budget policy outright, and its caller turns that refusal
/// into a session with no web pins at all. Trimming first is what stops one host
/// too many from costing every host.
final class ManagedDirectSessionBudgetTests: XCTestCase {
    /// Distinct, deterministic, and public. `hashValue` is seeded per process
    /// and 203.0.113.0/24 is rejected as non-public, so both would have made
    /// these assertions depend on something other than the budget.
    private func pin(
        _ index: Int,
        addresses: Int = 8,
        ports: [UInt16] = [443]
    ) -> ConfigPipeline.DirectDomainPin {
        ConfigPipeline.DirectDomainPin(
            host: "h\(index).example.com",
            addresses: (0..<addresses).map { "51.\(index).0.\($0 + 1)" },
            ports: ports
        )
    }

    private func policy(
        _ pins: [ConfigPipeline.DirectDomainPin]
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            webDomainPins: pins,
            webDomainSuffixes: [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: ["h0.example.com"],
            trusted: true
        )
    }

    func testEverythingFitsWhenItFits() {
        let pins = (0..<10).map { pin($0) }
        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(pins, seededBy: [])
        XCTAssertEqual(budgeted.kept.count, 10)
        XCTAssertTrue(budgeted.dropped.isEmpty)
    }

    /// The published maximum: 32 web domains at 8 addresses each is 256, and the
    /// two China DoH resolver endpoints every managed-direct session also
    /// permits carry it to 258. This is the case that used to discard the lot.
    func testControlPlaneMaximumTrimsInsteadOfDiscardingEverything() {
        let pins = (0..<32).map { pin($0) }
        XCTAssertEqual(policy(pins).sessionEndpoints.count, 258)
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(policy(pins)))

        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(
            pins,
            seededBy: ConfigPipeline.managedDirectResolverEndpoints
        )
        XCTAssertEqual(budgeted.kept.count, 31)
        XCTAssertEqual(budgeted.dropped, ["h31.example.com"])
        XCTAssertNoThrow(
            try ConfigPipeline.validatedManagedDirectPolicy(policy(budgeted.kept))
        )
    }

    func testResultIsAlwaysWithinTheCeilingTheValidatorEnforces() {
        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(
            (0..<40).map { pin($0) },
            seededBy: ConfigPipeline.managedDirectResolverEndpoints
        )
        XCTAssertLessThanOrEqual(
            policy(budgeted.kept).sessionEndpoints.count,
            ConfigPipeline.maximumSessionDirectEndpoints
        )
        XCTAssertNoThrow(
            try ConfigPipeline.validatedManagedDirectPolicy(policy(budgeted.kept))
        )
    }

    /// Counting must deduplicate the way `sessionEndpoints` does. CDN hosts that
    /// share addresses cost nothing extra, and a conservative count would drop
    /// pins that would have fitted.
    func testSharedAddressesDoNotConsumeBudgetTwice() {
        let shared = ConfigPipeline.DirectDomainPin(
            host: "a.example.com",
            addresses: ["51.1.0.1", "51.1.0.2"],
            ports: [443]
        )
        let alias = ConfigPipeline.DirectDomainPin(
            host: "b.example.com",
            addresses: ["51.1.0.1", "51.1.0.2"],
            ports: [443]
        )
        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(
            [shared, alias],
            seededBy: [],
            limit: 2
        )
        XCTAssertEqual(budgeted.kept.count, 2)
        XCTAssertTrue(budgeted.dropped.isEmpty)
    }

    /// A seed that already fills the budget must not admit a pin anyway.
    func testAFullSeedDropsEveryPin() {
        let seed = (0..<ConfigPipeline.maximumSessionDirectEndpoints).map {
            ConfigPipeline.DirectEndpoint(
                address: "51.200.\($0 / 254).\($0 % 254 + 1)",
                port: 443,
                transport: "tcp"
            )
        }
        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(
            [pin(1, addresses: 1)],
            seededBy: seed
        )
        XCTAssertTrue(budgeted.kept.isEmpty)
        XCTAssertEqual(budgeted.dropped, ["h1.example.com"])
    }

    /// Order decides who survives, so it must be the caller's stable order
    /// rather than an accident of set iteration.
    func testTrimmingKeepsTheGivenOrder() {
        let pins = (0..<40).map { pin($0) }
        let first = ConfigPipeline.pinsWithinSessionEndpointBudget(pins, seededBy: [])
        let second = ConfigPipeline.pinsWithinSessionEndpointBudget(pins, seededBy: [])
        XCTAssertEqual(first.kept.map(\.host), second.kept.map(\.host))
        XCTAssertEqual(
            first.kept.map(\.host),
            Array(pins.map(\.host).prefix(first.kept.count))
        )
    }
}
