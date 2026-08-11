import XCTest
@testable import Tono

/// Every change these tests allow costs a Mihomo config reload, and a reload
/// severs every long-lived connection in the session — the customer-visible
/// "connection closed mid-response". So the contract under test is not "pins
/// are fresh", it is "pins change only when they must".
final class ManagedDirectPinStabilityTests: XCTestCase {
    private func policy(
        _ pins: [ConfigPipeline.DirectDomainPin]
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: pins,
            webDomainPins: [],
            webDomainSuffixes: [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: []
        )
    }

    private func pin(
        _ host: String,
        _ addresses: [String]
    ) -> ConfigPipeline.DirectDomainPin {
        .init(host: host, addresses: addresses, ports: [443])
    }

    /// The regression that made this necessary: a CDN answer overlapping the
    /// committed set by exactly one address counted as stale under the previous
    /// "fewer than two survivors" rule, so most pins were rewritten every cycle
    /// and the session reloaded every few minutes with nothing actually broken.
    func testSingleSurvivingAddressKeepsPinUnchanged() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1", "2.2.2.2", "3.3.3.3"])])
        let resolved = policy([pin("cdn.example.com", ["3.3.3.3", "9.9.9.9", "8.8.8.8"])])
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: current, resolved: resolved),
            "one live address must be enough to leave a pin alone"
        )
    }

    func testFullyRotatedPinIsReplaced() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1", "2.2.2.2"])])
        let resolved = policy([pin("cdn.example.com", ["9.9.9.9", "8.8.8.8"])])
        let merged = AppState.mergedManagedDirectPolicy(
            current: current,
            resolved: resolved
        )
        XCTAssertEqual(
            merged?.domainPins.first?.addresses,
            ["8.8.8.8", "9.9.9.9"],
            "a pin with nothing left alive is the case that genuinely needs replacing"
        )
    }

    func testUnresolvedHostKeepsItsLastKnownGoodPins() {
        let current = policy([pin("dead.example.com", ["1.1.1.1"])])
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: current, resolved: policy([])),
            "a host that failed to resolve must not lose its committed pins"
        )
    }

    func testNewHostIsAdopted() {
        let merged = AppState.mergedManagedDirectPolicy(
            current: policy([]),
            resolved: policy([pin("new.example.com", ["1.1.1.1"])])
        )
        XCTAssertEqual(merged?.domainPins.map(\.host), ["new.example.com"])
    }

    /// Stability must not be bought by ignoring answers forever: once a pin is
    /// replaced it adopts the fresh addresses, so a genuinely moved host still
    /// converges within one cycle.
    func testReplacementIsIdempotent() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1"])])
        let resolved = policy([pin("cdn.example.com", ["9.9.9.9"])])
        guard let once = AppState.mergedManagedDirectPolicy(
            current: current,
            resolved: resolved
        ) else { return XCTFail("expected the fully rotated pin to be replaced") }
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: once, resolved: resolved),
            "a second identical answer must not produce another reload"
        )
    }
}
