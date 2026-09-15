import Foundation

/// Extension gets only an access token. It cannot rotate an account refresh token.
/// Every start/renewal revalidates device authorization over pinned-origin HTTPS.
final class TunnelCloud: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }

    func fetch(_ grant: TunnelGrant) async throws -> (Data, Data) {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 25
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        func get(_ path: String, limit: Int) async throws -> Data {
            var request = URLRequest(url: URL(string: "https://api.afk.ccwu.cc/api/v1/" + path)!)
            request.setValue("Bearer " + grant.accessToken, forHTTPHeaderField: "Authorization")
            request.setValue("hy2", forHTTPHeaderField: "X-Tono-Accept")
            // Stream with a bound: checking size only after data(for:) can exhaust NE memory.
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw Blocker.serviceUnavailable }
            if http.statusCode == 401 || http.statusCode == 403 { throw Blocker.sessionExpired }
            guard http.statusCode == 200, response.expectedContentLength <= Int64(limit) else { throw Blocker.serviceUnavailable }
            var data = Data()
            for try await byte in bytes {
                guard data.count < limit else { throw Blocker.invalidPolicy }
                data.append(byte)
            }
            return data
        }
        let me = try JSONDecoder().decode(MeEnvelope.self, from: await get("me", limit: 65536))
        guard me.user.id == grant.accountID else { throw Blocker.sessionExpired }
        let devices = try JSONDecoder().decode(DevicesEnvelope.self, from: await get("devices", limit: 65536))
        guard devices.devices.contains(where: { $0.id == grant.deviceID && $0.current == true && $0.status != "revoked" }) else {
            throw Blocker.sessionExpired
        }
        let catalog = try await get("exit-catalog", limit: 10 << 20)
        let policy = try await get("traffic-policy", limit: 2 << 20)
        return (catalog, policy)
    }
}
