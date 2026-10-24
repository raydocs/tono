import XCTest
@testable import TonoKit

final class MissingCatalogTests: XCTestCase {
    private let previous = RouteSettings(mode: .threeTier, node: "Tokyo · Dawn")
    private let requested = RouteSettings(mode: .stable, node: "Tokyo · Dawn")

    func testRunningTunnelRefreshesMissingCatalogBeforeApplyingModeChange() async throws {
        let body = SampleCatalog.body().serialized()
        let loaded = LoadedCatalog(catalog: try CatalogAdmission.admit(JSON.parse(body)), body: body, fromCache: false)
        var refreshed = false
        var applied = false
        let report = await RouteApply.withCatalog(nil, requested: requested, previous: previous, tunnelUp: true,
                                                 refresh: { refreshed = true; return loaded },
                                                 apply: { catalog in
                                                     applied = true
                                                     XCTAssertTrue(refreshed)
                                                     XCTAssertEqual(catalog.body, body)
                                                     return RouteApplyReport(.applied(self.requested))
                                                 })
        XCTAssertTrue(refreshed)
        XCTAssertTrue(applied)
        XCTAssertEqual(report.outcome, .applied(requested))
    }

    func testRunningTunnelRetryWithoutCatalogReportsFailureNotSaved() async {
        var refreshed = false
        var applied = false
        let report = await RouteApply.withCatalog(nil, requested: previous, previous: previous, tunnelUp: true,
                                                 refresh: { refreshed = true; return nil },
                                                 apply: { _ in applied = true; return RouteApplyReport(.saved(self.previous)) })
        XCTAssertTrue(refreshed)
        XCTAssertFalse(applied)
        XCTAssertEqual(report.outcome, .notApplied(code: "HOME_UNAVAILABLE", inEffect: previous))
        XCTAssertFalse(report.wrote)
    }
}
