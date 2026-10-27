import XCTest
@testable import Tono

/// Two helper refusals reached the connect card as the generic failure and the
/// telemetry as UNKNOWN_CLASSIFIED_FAILURE: macOS could not name the DNS
/// service to point at the protected resolver, and the connection engine
/// exited right after it started. The helper sends both as plain text with no
/// code, so the app names them from the text. The release and stale-generation
/// refusals do carry a typed code and get stable codes of their own.
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

    func testTypedReleaseAndStaleRefusalsGetStableCodes() {
        let cases: [(helper: String, code: ProtectedFailureCode, wire: String)] = [
            ("RELEASE_IN_PROGRESS", .releaseInProgress, "TONO_RELEASE_IN_PROGRESS"),
            ("RELEASE_UNFINISHED", .releaseUnfinished, "TONO_RELEASE_UNFINISHED"),
            ("RELEASE_RECORD_CORRUPT", .releaseUnfinished, "TONO_RELEASE_UNFINISHED"),
            ("STALE_GENERATION", .staleGeneration, "TONO_STALE_GENERATION"),
        ]
        for item in cases {
            let error = HelperIPCError.commandFailed("raw helper text", code: item.helper)
            let failure = AppState.helperRefusalFailure(error, stage: "securingDNS", generation: 9)
            XCTAssertEqual(failure?.code, item.code, item.helper)
            XCTAssertEqual(failure?.code.rawValue, item.wire, item.helper)
            XCTAssertEqual(failure?.stage, "securingDNS", item.helper)
            // The sentence the user already sees, never the helper's raw text.
            XCTAssertEqual(failure?.userMessage, error.localizedDescription, item.helper)
            XCTAssertNotEqual(failure?.userMessage, "raw helper text", item.helper)
            XCTAssertTrue(failure?.detail.contains("helper refused \(item.helper)") == true, item.helper)
        }
    }

    func testTheReleaseAndStaleCodesReuseTheExistingSentences() {
        XCTAssertEqual(
            ProtectedFailureCode.releaseInProgress.userMessage,
            HelperIPCError.commandFailed("", code: "RELEASE_IN_PROGRESS").localizedDescription
        )
        XCTAssertEqual(
            ProtectedFailureCode.releaseUnfinished.userMessage,
            HelperIPCError.commandFailed("", code: "RELEASE_UNFINISHED").localizedDescription
        )
        XCTAssertEqual(
            ProtectedFailureCode.staleGeneration.userMessage,
            HelperIPCError.commandFailed("", code: "STALE_GENERATION").localizedDescription
        )
    }

    func testACorruptReleaseRecordKeepsItsOwnSentence() {
        let error = HelperIPCError.commandFailed("raw", code: "RELEASE_RECORD_CORRUPT")
        let failure = AppState.helperRefusalFailure(error, stage: "securingDNS", generation: 2)
        XCTAssertEqual(failure?.code, .releaseUnfinished)
        XCTAssertEqual(
            failure?.userMessage,
            String(localized: "Tono's restore record could not be read. Choose Restore internet once, then connect.")
        )
        XCTAssertNotEqual(failure?.userMessage, ProtectedFailureCode.releaseUnfinished.userMessage)
    }

    func testOtherErrorsStayUnclassified() {
        let others: [Error] = [
            HelperIPCError.commandFailed("Could not lock network preferences.", code: nil),
            HelperIPCError.commandFailed(
                "Port 53 (UDP) on 127.0.0.1 is already in use by another program.",
                code: "CORE_PORT_IN_USE"
            ),
            HelperIPCError.commandFailed("Something else was refused.", code: "SOME_FUTURE_CODE"),
            HelperIPCError.emptyResponse,
        ]
        for error in others {
            XCTAssertNil(AppState.helperRefusalFailure(error, stage: "startingTunnel", generation: 1), "\(error)")
        }
    }
}
