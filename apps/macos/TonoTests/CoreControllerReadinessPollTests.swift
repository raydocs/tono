import XCTest
@testable import Tono

/// MAC-CONTROLLER-READY-SAMPLING: the dense readiness sampling stopped after
/// half a second of sleep, so a controller that bound at 600 ms was noticed
/// only at the next 250 ms tick (750 ms) on every such connect.
final class CoreControllerReadinessPollTests: XCTestCase {

    func testControllerBindingAfterHalfASecondIsNoticedWithinOneFastStep() {
        let intervalMs: UInt64 = 250
        let budgetMs = UInt64(40 - 1) * intervalMs
        let bindsAtMs: UInt64 = 600
        var sleptMs: UInt64 = 0
        while sleptMs < bindsAtMs {
            sleptMs += CoreControllerClient.readinessPollStep(
                sleptMs: sleptMs,
                budgetMs: budgetMs,
                intervalMs: intervalMs
            )
        }
        XCTAssertLessThanOrEqual(sleptMs, bindsAtMs + 50)
    }
}
