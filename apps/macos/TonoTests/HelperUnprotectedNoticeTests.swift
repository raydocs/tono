import XCTest
@testable import Tono

/// After a restart only the helper enables PF. When launchd never started it,
/// recovery used to end in a generic repair error while the Mac was open; the
/// user has to be told plainly that it is not protected (H12-F2).
final class HelperUnprotectedNoticeTests: XCTestCase {
    func testAHelperLaunchdDoesNotRunSaysThisMacIsNotProtected() {
        let disabled = HelperManager.unprotectedNotice(for: .backgroundDisabled)
        let unloaded = HelperManager.unprotectedNotice(for: .notLoaded)
        XCTAssertTrue(disabled?.contains("not protected right now") == true)
        XCTAssertTrue(disabled?.contains("Allow in the Background") == true)
        XCTAssertTrue(unloaded?.contains("not protected right now") == true)
        // A loaded helper that does not answer keeps its PF rules in the kernel,
        // so it is no evidence that protection is off.
        XCTAssertNil(HelperManager.unprotectedNotice(for: .loadedOrUnknown))
    }
}
