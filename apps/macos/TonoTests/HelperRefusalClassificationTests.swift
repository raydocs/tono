import XCTest
@testable import Tono

/// Two helper refusals reached the connect card as the generic failure and the
/// telemetry as UNKNOWN_CLASSIFIED_FAILURE: macOS could not name the DNS
/// service to point at the protected resolver, and the connection engine
/// exited right after it started. The helper sends both as plain text with no
/// code, so the app names them from the text.
final class HelperRefusalClassificationTests: XCTestCase {
    private let dnsSentence = "The selected DNS service cannot be identified."

    func testTheUnidentifiedDNSServiceIsProtectedDnsNotReady() {
        let error = HelperIPCError.commandFailed(dnsSentence, code: nil)
        let failure = AppState.helperRefusalFailure(error, stage: "securingDNS", generation: 4)
        XCTAssertEqual(failure?.code, .protectedDnsNotReady)
        XCTAssertEqual(failure?.code.rawValue, "PROTECTED_DNS_NOT_READY")
        XCTAssertEqual(failure?.stage, "securingDNS")
        XCTAssertEqual(failure?.userMessage, ProtectedFailureCode.protectedDnsNotReady.userMessage)
        XCTAssertTrue(failure?.detail.contains(dnsSentence) == true)
    }

    func testTheDNSSentenceIsMatchedIgnoringCaseAndWrapping() {
        let shouting = HelperIPCError.commandFailed(dnsSentence.uppercased(), code: nil)
        XCTAssertEqual(
            AppState.helperRefusalFailure(shouting, stage: "securingDNS", generation: 1)?.code,
            .protectedDnsNotReady
        )
        let wrapped = CoreControllerError.protectionFailed("Helper said: \(dnsSentence)")
        XCTAssertEqual(
            AppState.helperRefusalFailure(wrapped, stage: "securingDNS", generation: 1)?.code,
            .protectedDnsNotReady
        )
    }

    func testTheEngineExitingAtStartHasItsOwnCode() {
        let error = HelperIPCError.commandFailed("sing-box exited (status 1).", code: nil)
        let failure = AppState.helperRefusalFailure(error, stage: "startingTunnel", generation: 7)
        XCTAssertEqual(failure?.code, .coreExited)
        XCTAssertEqual(failure?.code.rawValue, "TONO_CORE_EXITED")
        XCTAssertEqual(
            failure?.userMessage,
            String(localized: "The connection engine stopped right after starting. Connect again; if it happens again, send diagnostics.")
        )
        // The status is diagnostics detail, never part of the sentence.
        XCTAssertFalse(failure?.userMessage.contains("status") == true)
        XCTAssertFalse(failure?.userMessage.contains("sing-box") == true)
        XCTAssertTrue(failure?.detail.contains("engine exit status 1") == true)
        XCTAssertTrue(failure?.copyableDetail.contains("code=TONO_CORE_EXITED") == true)

        let signalled = HelperIPCError.commandFailed("sing-box exited (status 9).", code: nil)
        XCTAssertTrue(
            AppState.helperRefusalFailure(signalled, stage: "startingTunnel", generation: 7)?
                .detail.contains("engine exit status 9") == true
        )
    }

    func testOtherErrorsStayUnclassified() {
        let others: [Error] = [
            HelperIPCError.commandFailed("Could not lock network preferences.", code: nil),
            HelperIPCError.commandFailed(
                "Port 53 (UDP) on 127.0.0.1 is already in use by another program.",
                code: "CORE_PORT_IN_USE"
            ),
            HelperIPCError.emptyResponse,
        ]
        for error in others {
            XCTAssertNil(AppState.helperRefusalFailure(error, stage: "startingTunnel", generation: 1), "\(error)")
        }
    }
}
