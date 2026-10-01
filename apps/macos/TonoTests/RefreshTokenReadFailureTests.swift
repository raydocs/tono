import Security
import XCTest
@testable import Tono

/// Records every request and fails it, so a test can see whether the client
/// went to the network at all.
nonisolated private final class RecordingRefusalProtocol: URLProtocol, @unchecked Sendable {
    final class Registry: @unchecked Sendable {
        let lock = NSLock()
        var paths: [String: [String]] = [:]
    }
    static let registry = Registry()
    static func paths(for host: String) -> [String] {
        registry.lock.lock(); defer { registry.lock.unlock() }
        return registry.paths[host] ?? []
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.registry.lock.lock()
        Self.registry.paths[request.url?.host ?? "", default: []].append(request.url?.path ?? "")
        Self.registry.lock.unlock()
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}

@MainActor
final class RefreshTokenReadFailureTests: XCTestCase {
    /// H18-O-F3. The refresh token is in the keychain, but the keychain will
    /// not hand it over (locked after a long sleep, or interaction not
    /// allowed). The server never refused this session, so the account must
    /// not be suspended and no refresh may be sent without a token.
    func testUnreadableRefreshTokenDoesNotSuspendTheAccount() async throws {
        let host = "\(UUID().uuidString.lowercased()).invalid"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RecordingRefusalProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel() }
        let keychain = KeychainStore(
            service: "app.tono.tests.keychain-read.\(host)",
            copyMatching: { _, _ in errSecInteractionNotAllowed }
        )
        let api = TonoAPIClient(baseURL: URL(string: "https://\(host)")!, keychain: keychain, session: transport)
        let account = AccountSession(
            api: api, keychain: keychain, sidecar: TonoSidecarService(),
            descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {}
        )
        account.user = try JSONDecoder().decode(
            TonoUser.self, from: Data(#"{"id":"keychain-read","email":"keychain-read@example.test"}"#.utf8)
        )
        account.state = .ready

        // No access token in memory, so `me()` has to renew it first.
        await account.refreshAccount()

        XCTAssertEqual(account.state, .ready)
        XCTAssertEqual(RecordingRefusalProtocol.paths(for: host), [])
    }
}
