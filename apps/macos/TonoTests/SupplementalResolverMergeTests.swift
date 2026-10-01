import XCTest
@testable import Tono

/// One unreadable `/etc/resolver` file used to collapse the whole supplemental
/// list to nil, including split-DNS rules already read from the dynamic store.
/// The connected audit then withheld and stayed up, so those names kept
/// resolving off this Mac. An empty store plus an unreadable directory must
/// stay nil so the audit withholds instead of calling the resolver intact.
final class SupplementalResolverMergeTests: XCTestCase {
    func testUnreadableResolverDirectoryKeepsDynamicStoreConflicts() {
        let vpn = SystemNetworkObservation.SupplementalResolver(
            source: "State:/Network/Service/VPN/DNS",
            domains: ["example.com"],
            servers: ["10.1.2.3"]
        )
        XCTAssertEqual(
            SystemNetworkObservation.mergedConflictingResolvers(
                dynamicStore: [vpn],
                resolverFiles: nil
            ),
            [vpn]
        )
        XCTAssertNil(
            SystemNetworkObservation.mergedConflictingResolvers(
                dynamicStore: [],
                resolverFiles: nil
            )
        )
    }
}
