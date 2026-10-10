import Foundation
import Network
import XCTest
@testable import Tono

@MainActor
final class NativeUpdateDownloadTests: XCTestCase {
    func testMetadataDeadlineExpiresWhileTheResponseKeepsMakingProgress() async throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let queue = DispatchQueue(label: "net.tono.tests.update-metadata")
        let ready = expectation(description: "loopback metadata fixture is ready")
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.fulfill() }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            Self.receiveRequest(on: connection, queue: queue)
        }
        defer {
            listener.stateUpdateHandler = nil
            listener.newConnectionHandler = nil
            listener.cancel()
        }
        listener.start(queue: queue)
        await fulfillment(of: [ready], timeout: 3)
        let port = try XCTUnwrap(listener.port)
        // The unqualified localhost name permits this HTTP-only loopback
        // fixture without adding an ATS exception to the product.
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port.rawValue)/manifest.json"))
        do {
            _ = try await NativeUpdateDownload.bounded(url, maximum: 80, timeoutInterval: 1)
            XCTFail("a progressing transfer must still meet the whole-resource deadline")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        }
    }

    /// Backlog A2 (decision 077): a metadata GET whose direct path dies
    /// before any response goes to the pinned addresses, then the relay, and
    /// the relay's answer is the metadata. The release host's own fallback is
    /// the relays: it has no pinned addresses.
    func testDeadDirectPathHandsTheMetadataGetToTheRelay() async throws {
        // Nothing listens on loopback port 1: refused before any response.
        let url = try XCTUnwrap(URL(string: "http://localhost:1/desktop/v1/latest/manifest.json"))
        let attempts = UpdatePathLog()
        let data = try await NativeUpdateDownload.bounded(url, maximum: 80, timeoutInterval: 5, fallbacks: [
            ControlPlanePath(label: "pinned") { request, _ in
                attempts.record("pinned \(request.httpMethod ?? "-") \(request.url?.absoluteString ?? "-")")
                // No pin reached TLS: nothing was sent.
                throw URLError(.cannotConnectToHost)
            },
            ControlPlanePath(label: "relay") { request, maximumResponseBytes in
                attempts.record("relay \(request.httpMethod ?? "-") \(request.url?.absoluteString ?? "-")")
                XCTAssertEqual(maximumResponseBytes, 80, "the relay is held to the same cap")
                return ControlPlaneAnswer(status: 200, body: Data("signed-manifest".utf8), bodyFailure: nil)
            },
        ])

        XCTAssertEqual(data, Data("signed-manifest".utf8))
        XCTAssertEqual(attempts.entries, ["pinned GET \(url.absoluteString)", "relay GET \(url.absoluteString)"])
        let production = try XCTUnwrap(URL(string: NativeUpdateDownload.origin + "latest/manifest.json"))
        XCTAssertEqual(NativeUpdateDownload.fallbacks(for: production).map(\.label), ["relay"])
    }

    private nonisolated static func receiveRequest(
        on connection: NWConnection, queue: DispatchQueue, received: Data = Data()
    ) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4_096) { data, _, complete, error in
            guard error == nil, let data, !data.isEmpty, received.count + data.count <= 8_192 else {
                connection.cancel()
                return
            }
            var request = received
            request.append(data)
            guard request.range(of: Data("\r\n\r\n".utf8)) != nil else {
                if complete { connection.cancel() }
                else { receiveRequest(on: connection, queue: queue, received: request) }
                return
            }
            let headers = Data("HTTP/1.1 200 OK\r\nContent-Length: 80\r\nConnection: close\r\n\r\n".utf8)
            connection.send(content: headers, completion: .contentProcessed { error in
                guard error == nil else { connection.cancel(); return }
                sendByte(on: connection, queue: queue, remaining: 80)
            })
        }
    }

    private nonisolated static func sendByte(
        on connection: NWConnection, queue: DispatchQueue, remaining: Int
    ) {
        // Each byte resets the old one-second idle timeout; all 80 bytes
        // complete in about four seconds, bounding the unfixed test too.
        connection.send(content: Data([0x78]), completion: .contentProcessed { error in
            guard error == nil else { connection.cancel(); return }
            if remaining > 1 {
                queue.asyncAfter(deadline: .now() + 0.05) {
                    sendByte(on: connection, queue: queue, remaining: remaining - 1)
                }
            } else {
                connection.send(content: nil, contentContext: .finalMessage, isComplete: true,
                                completion: .contentProcessed { _ in connection.cancel() })
            }
        })
    }
}

/// The paths an update GET entered, in order.
nonisolated private final class UpdatePathLog: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    func record(_ entry: String) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(entry)
    }
    var entries: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
}
