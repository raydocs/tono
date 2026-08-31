import XCTest
@testable import Tono

/// The managed catalog's body is issued per account — the control plane writes
/// each user's own client identity into the exits it publishes — while its
/// revision is a fleet-wide counter. Ownership, not the revision, is therefore
/// the only thing keeping one account's exits out of the next account's
/// session, which is what a shared Mac depends on.
///
/// The binding is process-global and `adopt`/`purge` reach `ConfigStorage`, so
/// every test here ends signed out — the one resting state that refuses
/// everything — and running them removes this machine's cached catalog file.
/// Nothing else in this target installs a catalog, and the app refetches on the
/// next signed-in launch.
@MainActor
final class ManagedExitCatalogOwnershipTests: XCTestCase {
    private func cache(owner: String?) -> ManagedExitCatalogCache {
        ManagedExitCatalogCache(
            revision: 7,
            yaml: "proxies: []",
            sha256: "digest",
            updatedAt: nil,
            routing: nil,
            owner: owner
        )
    }

    func testACacheWrittenBeforeOwnersWereRecordedStillDecodes() throws {
        let legacy = Data(#"{"revision":7,"yaml":"proxies: []","sha256":"digest"}"#.utf8)
        let decoded = try JSONDecoder().decode(
            ManagedExitCatalogCache.self,
            from: legacy
        )
        XCTAssertEqual(decoded.revision, 7)
        XCTAssertNil(decoded.owner, "an absent owner must load, not fail to decode")
    }

    func testTheOwnerSurvivesAnEncodeDecodeRound() throws {
        let data = try JSONEncoder().encode(cache(owner: "user-a"))
        let decoded = try JSONDecoder().decode(
            ManagedExitCatalogCache.self,
            from: data
        )
        XCTAssertEqual(decoded.owner, "user-a")
    }

    func testSignInDiscardsACatalogIssuedToAnotherAccount() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-b")
        XCTAssertEqual(
            discarded, 1,
            "user-a's exits must not still be selectable in user-b's session"
        )
        XCTAssertFalse(
            ManagedExitCatalogOwnership.accepts("user-a"),
            "user-a's catalog must not install once user-b is signed in"
        )
        XCTAssertTrue(ManagedExitCatalogOwnership.accepts("user-b"))
        XCTAssertEqual(ManagedExitCatalogOwnership.currentAccount, "user-b")
        ManagedExitCatalogOwnership.purge()
    }

    func testSignInKeepsTheSameAccountsCachedCatalog() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-a")
        XCTAssertEqual(
            discarded, 0,
            "a fail-closed launch must keep its own last verified cache"
        )
        ManagedExitCatalogOwnership.purge()
    }

    func testACatalogWithNoRecordedOwnerIsDiscardedOnSignIn() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: nil) {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-a")
        XCTAssertEqual(
            discarded, 1,
            "a cache whose account cannot be established belongs to nobody"
        )
        ManagedExitCatalogOwnership.purge()
    }

    func testSignOutRefusesEveryCatalogUntilAnAccountIsKnown() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.purge()
        XCTAssertEqual(discarded, 1)
        XCTAssertNil(ManagedExitCatalogOwnership.currentAccount)
        // A refresh already in flight when the user signed out must not land.
        XCTAssertFalse(ManagedExitCatalogOwnership.accepts("user-a"))
        XCTAssertFalse(ManagedExitCatalogOwnership.accepts(nil))
    }

    func testAnEntitlementFailureIsNotReportedAsAnExpiredSession() {
        let blocked = TonoAPIClient.APIError.entitlementBlocked(
            code: "ACCOUNT_EXPIRED",
            message: "Session is no longer active"
        )
        XCTAssertNotEqual(blocked, .unauthorized)
        XCTAssertNotEqual(
            blocked.errorDescription,
            TonoAPIClient.APIError.unauthorized.errorDescription,
            "expiry must not be presented as an expired sign-in session"
        )
        XCTAssertNotEqual(
            blocked.errorDescription,
            TonoAPIClient.APIError.entitlementBlocked(
                code: "QUOTA_EXCEEDED", message: nil
            ).errorDescription,
            "expiry and an exhausted allowance are different answers"
        )
    }
}
