import Foundation
import XCTest
@testable import TonoKit

final class RequestReplayTests: XCTestCase {
    func testWrittenPOSTWithLostResponseIsNotReplayedOnAnotherPath() async {
        var writes = 0
        let transport = ScriptedTransport { request, _ in
            request.transmission.preparing()
            request.transmission.willWrite()
            writes += 1 // The server may already have consumed a one-time code or rotated a token.
            throw Unreachable() // Response lost after the HTTP write.
        }
        do {
            _ = try await ControlPlaneClient(clientVersion: "1", transport: transport).post("auth/refresh", .obj(("refreshToken", "synthetic")))
            XCTFail("lost response must be reported")
        } catch { XCTAssertEqual(AccountErrors.reasonCode(error), "NETWORK") }
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(transport.attempts.count, 1)
    }

    func testPOSTEdgeFailureDoesNotReplayADeliveredRequest() async {
        let transport = ScriptedTransport { _, _ in HTTPResponse(status: 522, body: Data("<html>".utf8)) }
        do {
            _ = try await ControlPlaneClient(clientVersion: "1", transport: transport).post("auth/email/verify", nil)
            XCTFail("edge response is ambiguous")
        } catch { XCTAssertEqual(AccountErrors.reasonCode(error), "NETWORK") }
        XCTAssertEqual(transport.attempts.count, 1)
    }

    func testPOSTFailureBeforeFirstWriteCanUseTheNextPath() async throws {
        let transport = ScriptedTransport { request, route in
            request.transmission.preparing()
            if route == .systemDNS { throw Unreachable() }
            request.transmission.willWrite()
            return json(202, .obj(("challengeId", "next-path")))
        }
        let result = try await ControlPlaneClient(clientVersion: "1", transport: transport).post("auth/email/start", nil)
        XCTAssertEqual(result["challengeId"]?.string, "next-path")
        XCTAssertEqual(transport.attempts.count, 2)
    }

    func testGETResponseLossStillAllowsPathFallback() async throws {
        let transport = ScriptedTransport { request, route in
            request.transmission.willWrite()
            if route == .systemDNS { throw Unreachable() }
            return json(200, .obj(("ok", true)))
        }
        _ = try await ControlPlaneClient(clientVersion: "1", transport: transport).get("me", bearer: "synthetic")
        XCTAssertEqual(transport.attempts.count, 2)
    }
}
