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
                    // Cancel at the creation/registration boundary. The old
                    // handler saw an empty holder here and lost cancellation.
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

    func testListenerAcceptsReplyToItsActualUDPQuery() async throws {
        let parameters = NWParameters.udp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let queue = DispatchQueue(label: "net.tono.tests.dns-listener")
        let ready = expectation(description: "loopback DNS fixture is ready")
        let sent = expectation(description: "fixture answered the actual query")
        let reply = response()
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.fulfill() }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            connection.receiveMessage { query, _, _, error in
                guard error == nil, let query, query.count == 33 else {
                    XCTFail("expected one complete loopback IN A query")
                    connection.cancel()
                    sent.fulfill()
                    return
                }
                var packet = reply
                // The server echoes the caller's unpredictable transaction ID.
                // The expected answer remains independently specified below.
                packet[0] = query[query.startIndex]
                packet[1] = query[query.startIndex + 1]
                connection.send(content: packet, completion: .contentProcessed { error in
                    XCTAssertNil(error)
                    connection.cancel()
                    sent.fulfill()
                })
            }
        }
        defer {
            listener.stateUpdateHandler = nil
            listener.newConnectionHandler = nil
            listener.cancel()
        }
        listener.start(queue: queue)
        await fulfillment(of: [ready], timeout: 1)
        let port = try XCTUnwrap(listener.port)
        let answers = await ProtectedDNSProbe.queryListener(
            server: "127.0.0.1", port: Int(port.rawValue), timeout: 1
        )
        await fulfillment(of: [sent], timeout: 1)
        XCTAssertEqual(answers, ["198.19.1.2"])
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

        var actualQuery = Data(valid.prefix(33))
        actualQuery[0] = 0x24
        actualQuery[1] = 0x68
        actualQuery[2] = 0x01
        actualQuery[3] = 0
        actualQuery[7] = 0
        var actualReply = valid
        actualReply[0] = 0x24
        actualReply[1] = 0x68
        actualReply[13] = 0x57 // DNS names compare case-insensitively.
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(actualReply, query: actualQuery), ["198.19.1.2"])
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(valid, query: actualQuery), [])
    }

    func testListenerAnswersFollowQuestionAliasNotUnrelatedOwners() {
        var unrelated = response()
        unrelated[34] = 0x10 // gstatic.com is not the question www.gstatic.com.
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(unrelated), [])
        var wrongClass = response()
        wrongClass[38] = 0x03
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(wrongClass), [])

        var alias = Data(response().prefix(33))
        alias[7] = 2
        alias.append(contentsOf: [
            0xC0, 0x0C, 0x00, 0x05, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x3C, 0x00, 0x08,
            0x05, 0x61, 0x6C, 0x69, 0x61, 0x73, 0xC0, 0x10,
            // A record owned by alias.gstatic.com, the preceding CNAME target.
            0xC0, 0x2D, 0x00, 0x01, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x3C, 0x00, 0x04, 198, 19, 1, 2,
        ])
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(alias), ["198.19.1.2"])
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
