import XCTest
@testable import Tono

/// A13 / decision 084: after an administrator's `--emergency-disarm` the
/// helper refuses every arm until a new helper session begins, and only the
/// user's explicit Connect (or Retry) begins one, through an intent bound to
/// the attempt it started. Automatic reconnects, server picks and heal
/// re-arms can never consume it, so they can never end the release; the
/// helper's refusal stops the automatic loops instead.
final class UserConnectSessionTests: XCTestCase {

    func testOnlyTheUserConnectAttemptBeginsAHelperSession() throws {
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
        XCTAssertNil(app.userConnectIntent.id)
        // The user's Connect mints an intent for its own attempt only.
        app.connectFromUser()
        let minted = try XCTUnwrap(app.userConnectIntent.id)
        XCTAssertFalse(app.userConnectIntent.consume(nil), "an automatic attempt carries no intent")
        XCTAssertFalse(app.userConnectIntent.consume(UUID()), "a server pick's attempt cannot consume it")
        XCTAssertTrue(app.userConnectIntent.consume(minted), "the attempt that minted it consumes it")
        XCTAssertFalse(app.userConnectIntent.consume(minted), "single use")
        // An observed release drops a pending click.
        let dropped = app.userConnectIntent.mint()
        app.userConnectIntent.invalidate()
        XCTAssertFalse(app.userConnectIntent.consume(dropped))
        var stale = UserConnectIntent()
        let old = stale.mint(now: Date(timeIntervalSince1970: 0))
        XCTAssertFalse(
            stale.consume(old, now: Date(timeIntervalSince1970: UserConnectIntent.lifetime + 1)),
            "an old click expires"
        )
        try KillSwitchService.beginSession()
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
        // An unwritable target fails the user's Connect with a concrete
        // message instead of being swallowed.
        KillSwitchService.sessionIPC.begin = {
            throw HelperIPCError.commandFailed("Free some disk space.", code: "TARGET_STATE_UNWRITABLE")
        }
        XCTAssertThrowsError(try KillSwitchService.beginSession()) { error in
            guard case KillSwitchService.Error.operatorReleased(let message) = error else {
                return XCTFail("unexpected \(error)")
            }
            XCTAssertEqual(message, "Free some disk space.")
        }
        XCTAssertEqual(begun, 1)
    }
}
