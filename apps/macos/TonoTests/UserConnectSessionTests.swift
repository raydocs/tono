import XCTest
@testable import Tono

/// A13 / decision 084: after an administrator's `--emergency-disarm` the
/// helper refuses every arm until a new helper session begins, and only the
/// user's explicit Connect (or Retry) begins one. Automatic reconnects and
/// heal re-arms reuse the current session, so they can never end the release;
/// the helper's refusal stops the automatic loops instead.
final class UserConnectSessionTests: XCTestCase {

    func testOnlyTheUserConnectBeginsAHelperSession() throws {
        let savedSession = KillSwitchService.sessionIPC
        let savedArm = KillSwitchService.armIPC
        KillSwitchService.isArmed = false
        defer {
            KillSwitchService.sessionIPC = savedSession
            KillSwitchService.armIPC = savedArm
            KillSwitchService.isArmed = false
        }
        var begun = 0
        KillSwitchService.sessionIPC.begin = {
            begun += 1
            return 9
        }

        let app = AppState()
        // An automatic reconnect enters through connect(): no intent.
        app.connect()
        XCTAssertFalse(app.userConnectIntent.consume())
        // The user's Connect leaves a single-use intent for its perform step.
        app.connectFromUser()
        XCTAssertTrue(app.userConnectIntent.consume())
        XCTAssertFalse(app.userConnectIntent.consume(), "the intent is single use")
        var stale = UserConnectIntent()
        stale.mark(now: Date(timeIntervalSince1970: 0))
        XCTAssertFalse(
            stale.consume(now: Date(timeIntervalSince1970: UserConnectIntent.lifetime + 1)),
            "a later automatic connect cannot inherit an old click"
        )
        KillSwitchService.beginSession()
        XCTAssertEqual(begun, 1, "the perform step of a user Connect begins one session")

        // A heal or automatic re-arm goes straight to the arm: no new session.
        KillSwitchService.armIPC.deliver = { _ in
            (armed: true, wanted: true, live: true, healed: false, flushedStates: false, killedHosts: 0)
        }
        try KillSwitchService.arm(helperPrepared: true, reviewedBundleDirect: false)
        XCTAssertEqual(begun, 1)

        // While the release holds, the helper's refusal is one the automatic
        // loops stop on, carrying the helper's own sentence.
        KillSwitchService.armIPC.deliver = { _ in
            throw HelperIPCError.commandFailed("An administrator released Tono's network protection.", code: "OPERATOR_RELEASED")
        }
        KillSwitchService.armIPC.status = { (armed: false, wanted: false, live: false, healed: false) }
        XCTAssertThrowsError(try KillSwitchService.arm(helperPrepared: true, reviewedBundleDirect: false)) { error in
            guard case KillSwitchService.Error.operatorReleased(let message) = error else {
                return XCTFail("unexpected \(error)")
            }
            XCTAssertEqual(message, "An administrator released Tono's network protection.")
            XCTAssertTrue(AppState.failureRequiresUserAction(error))
        }
        XCTAssertEqual(begun, 1)
    }
}
