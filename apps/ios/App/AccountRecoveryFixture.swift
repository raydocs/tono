#if DEBUG
import Foundation

/// UI-test dependencies only: real restore/cleanup/navigation, no real accounts,
/// Keychain, App Group preferences, system VPN manager or outbound requests.
@MainActor
enum AccountRecoveryFixture {
    static func makeModel() -> AppModel {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RejectFixtureNetwork.self]
        let directory = FileManager.default.temporaryDirectory.appending(path: "TonoAccountUITest-\(UUID().uuidString)")
        return AppModel(cloud: CloudClient(vault: CorruptFixtureVault(), configuration: config,
                                          logoutIntent: LogoutIntentStore(directory: directory)),
                        tunnel: FixtureTunnel(), preferences: nil, distribution: "production")
    }
}

@MainActor private final class CorruptFixtureVault: CredentialVault {
    private var session: Data? = Data("{}".utf8)
    private var failFirstDeletion = true
    func read(_ account: String) throws -> Data? { account == "session" ? session : nil }
    func write(_ data: Data, account: String) throws { throw Blocker.keychainUnavailable }
    func remove(_ account: String) throws {
        if failFirstDeletion {
            failFirstDeletion = false
            throw Blocker.keychainUnavailable
        }
        session = nil
    }
    func installationID() throws -> String { "isolated-ui-fixture" }
}

@MainActor private final class FixtureTunnel: TunnelControlling {
    func start(generation: UUID, onDemand: Bool) async throws { throw Blocker.coreUnavailable }
    func pause() async throws {}
}

private final class RejectFixtureNetwork: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
#endif
