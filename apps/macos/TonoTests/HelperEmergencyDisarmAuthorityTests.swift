import XCTest
@testable import Tono

final class HelperEmergencyDisarmAuthorityTests: XCTestCase {
    func testRootEmergencyCanReleaseStrictOrUnreadableIntentWithoutStartupRearm() throws {
        XCTAssertFalse(HelperDisarmAuthority.rootEmergency.restoresAtLaunch,
                       "emergency recovery must not reinstall the block before releasing it")
        XCTAssertNoThrow(try HelperDisarmAuthority.rootEmergency.authorize(effectiveUID: 0, strictIntentActive: true))
        XCTAssertThrowsError(try HelperDisarmAuthority.rootEmergency.authorize(effectiveUID: 501, strictIntentActive: true))
        XCTAssertThrowsError(try HelperDisarmAuthority.runtime.authorize(effectiveUID: 0, strictIntentActive: true),
                             "a root helper serving GUI requests must still retain strict protection")
    }
}
