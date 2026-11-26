import XCTest
@testable import Tono

/// Preemptive Restore internet (PROPOSAL §10 v5): work an earlier session
/// issues after a Restore must not reach the helper as if it were current.
final class PreemptiveReleaseSessionTests: XCTestCase {

    /// A session retired by Restore that was never admitted cannot admit
    /// itself late: its arm and its teardown are both refused before any IPC.
    func testRetiredUnadmittedSessionIsRefusedBeforeTheHelper() throws {
        let retired = HelperSessionGeneration()
        retired.retire()
        try HelperSessionGeneration.$current.withValue(retired) {
            for (method, path) in [("POST", "/killswitch/arm"), ("POST", "/killswitch/disarm")] {
                XCTAssertThrowsError(try HelperManager.sessionGenerationHeader(method: method, path: path)) { error in
                    guard case HelperIPCError.commandFailed(_, let code) = error else {
                        return XCTFail("unexpected error \(error)")
                    }
                    XCTAssertEqual(code, "STALE_GENERATION")
                }
            }
        }
    }

    /// R-F3: an admission that finishes after Restore retired its box is
    /// not adopted, so the old session cannot carry the new generation.
    func testAdmissionFinishingAfterRetirementIsNotAdopted() {
        let box = HelperSessionGeneration()
        let admitted = box.admitIfNeeded {
            box.retire()
            return 42
        }
        XCTAssertFalse(admitted)
        XCTAssertNil(box.value)
    }

    /// R-F3: a wake or reconnect connect cannot admit a Mac that Restore
    /// released; only the user's own Connect can.
    func testOnlyTheUsersConnectAdmitsAReleasedMac() {
        let released = HelperManager.SessionStatus(released: true, generation: 7)
        XCTAssertFalse(HelperManager.mayAdmit(released, userInitiated: false))
        XCTAssertTrue(HelperManager.mayAdmit(released, userInitiated: true))
    }

    /// R-M1: a Tono system proxy still in place keeps Restore from reporting
    /// the internet as restored.
    func testRemainingTonoProxyMakesRestoredPartial() {
        let restored = HelperManager.ReleaseOutcome(
            outcome: "restored", generation: 9,
            components: [.init(name: "pf", readback: "restored", risk: "settled", detail: nil)],
            stuck: [], finished: true, detail: nil
        )
        let combined = restored.includingSystemProxy(tonoProxyRemains: true)
        XCTAssertEqual(combined.outcome, "partial")
        XCTAssertTrue(combined.components.contains { $0.name == "proxy" && $0.readback == "residual" })
    }

    /// On Macs with the separate release service (`tono-release`), Restore
    /// internet completes in `finishPreemptiveRelease` instead of the queued
    /// teardown path. A restored AI component must clear the stale yellow
    /// selective-AI-recovery notice; residual/busy/superseded outcomes keep it.
    @MainActor
    func testPreemptiveReleaseUpdatesSelectiveAIRecoveryPendingFromReadback() {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = false

        let app = AppState()
        app.selectiveAIRecoveryPending = true
        let restored = HelperManager.ReleaseOutcome(
            outcome: "restored", generation: 11,
            components: [
                .init(name: "pf", readback: "restored", risk: "settled", detail: nil),
                .init(name: "ai", readback: "restored", risk: "settled", detail: nil),
                .init(name: "dns", readback: "restored", risk: "settled", detail: nil),
                .init(name: "core", readback: "restored", risk: "settled", detail: nil),
            ],
            stuck: [], finished: true, detail: nil
        )
        app.finishPreemptiveRelease(.success(restored), updateWasPending: false, tonoProxyRemains: false)
        XCTAssertFalse(app.selectiveAIRecoveryPending)
        XCTAssertNil(app.gateProtectionNotice)

        // A partial outcome where AI is already restored clears the AI notice
        // even though another component (e.g. system proxy) keeps protection blocked.
        app.selectiveAIRecoveryPending = true
        app.finishPreemptiveRelease(.success(restored), updateWasPending: false, tonoProxyRemains: true)
        XCTAssertFalse(app.selectiveAIRecoveryPending)
        XCTAssertTrue(app.isProtectionBlocked)

        // A residual AI component keeps (or raises) the AI notice.
        app.selectiveAIRecoveryPending = false
        let residualAI = HelperManager.ReleaseOutcome(
            outcome: "partial", generation: 12,
            components: [
                .init(name: "pf", readback: "restored", risk: "settled", detail: nil),
                .init(name: "ai", readback: "residual", risk: "settled", detail: "AI service hold is retained."),
            ],
            stuck: [], finished: true, detail: nil
        )
        app.finishPreemptiveRelease(.success(residualAI), updateWasPending: false, tonoProxyRemains: false)
        XCTAssertTrue(app.selectiveAIRecoveryPending)

        // Busy / superseded outcomes prove nothing and leave the notice intact.
        let busy = HelperManager.ReleaseOutcome(
            outcome: "busy", generation: 12, components: [], stuck: [], finished: true, detail: nil
        )
        app.finishPreemptiveRelease(.success(busy), updateWasPending: false, tonoProxyRemains: false)
        XCTAssertTrue(app.selectiveAIRecoveryPending)
    }

    /// DashboardView must not stack two identical "Restore normal internet"
    /// buttons when the attention row, disconnect row, or primary action
    /// already offers Restore internet.
    @MainActor
    func testSelectiveAIRecoveryInlineButtonOnlyShowsWhenNoOtherRestoreActionIsVisible() {
        XCTAssertTrue(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: false, isDisconnecting: false,
            isProtectionBlocked: false, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: true, isConnecting: false, isDisconnecting: false,
            isProtectionBlocked: false, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: true, isDisconnecting: false,
            isProtectionBlocked: false, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: false, isDisconnecting: true,
            isProtectionBlocked: false, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: false, isDisconnecting: false,
            isProtectionBlocked: true, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: false, isDisconnecting: false,
            isProtectionBlocked: false, isProtectionUnconfirmed: true, isProtectionBlockUnreadable: false
        ))
        XCTAssertFalse(DashboardView.showsInlineSelectiveAIRecoveryButton(
            seaAttentionActions: false, isConnecting: false, isDisconnecting: false,
            isProtectionBlocked: false, isProtectionUnconfirmed: false, isProtectionBlockUnreadable: true
        ))
    }
}
