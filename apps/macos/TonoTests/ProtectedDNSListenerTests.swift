import Darwin
import Network
import XCTest
@testable import Tono

@MainActor
final class ProtectedDNSListenerTests: XCTestCase {
    func testListenerCancellationBeforeRegistrationDrainsDisconnect() async {
        // A bound, silent loopback socket avoids ICMP port-unreachable ending
        // the old implementation early and hiding its lost cancellation.
        let socket = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard socket >= 0 else { return XCTFail("create loopback UDP fixture") }
        defer { Darwin.close(socket) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { return XCTFail("bind loopback UDP fixture") }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(socket, $0, &length)
            }
        }
        guard named == 0 else { return XCTFail("read loopback UDP fixture port") }
        let port = Int(UInt16(bigEndian: address.sin_port))
        let created = expectation(description: "cancel inside connection creation")
        let drained = expectation(description: "Disconnect drains without the DNS timeout")
        let coordinator = ConnectionCoordinator()
        var answers: [String]?
        let pending = Task {
            answers = await ProtectedDNSProbe.queryListener(
                server: "127.0.0.1", port: port, timeout: 2,
                makeConnection: { host, port in
                    // Precisely between cancellation-handler installation and
                    // connection registration; no scheduler/sleep race required.
                    withUnsafeCurrentTask { task in
                        XCTAssertNotNil(task)
                        task?.cancel()
                    }
                    created.fulfill()
                    return NWConnection(host: host, port: port, using: .udp)
                }
            )
        }
        coordinator.enqueueDisconnect(waitingFor: [pending]) { _ in drained.fulfill() }
        await fulfillment(of: [created, drained], timeout: 0.5)
        // The old implementation's own two-second timeout bounds test cleanup.
        await pending.value
        XCTAssertEqual(answers, [])
    }

    func testListenerReplyMustMatchSuccessfulQuestion() {
        let valid = response()
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(valid), ["198.19.1.2"])

        var wrongID = valid
        wrongID[1] = 0x4F
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(wrongID), [], "another transaction")
        var wrongQuestion = valid
        wrongQuestion[13] = 0x78
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(wrongQuestion), [], "another hostname")
        var serverFailure = valid
        serverFailure[3] = 0x82
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(serverFailure), [], "SERVFAIL is not proof")
        var truncated = valid
        truncated[2] = 0x83
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(truncated), [], "TC withdraws partial proof")
        var query = valid
        query[2] = 0x01
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(query), [], "a query is not a response")
        var wrongClass = valid
        wrongClass[32] = 0x03
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(wrongClass), [], "question must be IN")
    }

    func testMalformedTrailingAnswerCannotLeaveFakeIPProof() {
        var packet = response()
        packet[7] = 2
        // First A is valid, but the advertised second A is missing one byte.
        packet.append(contentsOf: [
            0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x3C, 0x00, 0x04, 203, 0, 113,
        ])
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(packet), [])
        packet.append(8)
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(packet), ["198.19.1.2", "203.0.113.8"])
    }

    private func response() -> Data {
        // Independent wire fixture: ID 0x544E, successful response, one IN A
        // question for www.gstatic.com and one compressed IN A fake-IP answer.
        Data([
            0x54, 0x4E, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x00,
            0x03, 0x77, 0x77, 0x77,
            0x07, 0x67, 0x73, 0x74, 0x61, 0x74, 0x69, 0x63,
            0x03, 0x63, 0x6F, 0x6D, 0x00,
            0x00, 0x01, 0x00, 0x01,
            0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x3C, 0x00, 0x04, 198, 19, 1, 2,
        ])
    }
}
