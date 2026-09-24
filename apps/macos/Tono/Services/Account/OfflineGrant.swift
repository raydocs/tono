import CryptoKit
import Foundation

// MARK: - Offline connection admission (#582)
//
// A launch that cannot reach the control plane may still reach Ready on a
// positive, account-bound grant (`offline-grant.json`) that the last verified
// online session left, when it matches what is installed in memory now. The
// grant is written only from a catalog the server just confirmed, after the
// keychain acknowledged the refresh token it binds. It is revoked by
// overwriting it with a verdict, never by deleting it. The server's answers
// reach it from `TonoAPIClient.sendData`; app code never infers a refusal from
// an error value. No client file is entitlement (the exit roster is), so there
// is no client-side offline age limit.

/// The server's answer about this session, classified once per exchange that
/// carried it: a request with this session's bearer, or `auth/refresh`.
/// Parity with the Windows `SessionVerdict`.
nonisolated enum TonoSessionVerdict: Equatable, Sendable {
    /// 2xx: the server accepted the session.
    case verified
    /// The server refused the session: its renewal, or a replay with a freshly
    /// renewed token, answered 401, or a request answered 401/403 with an
    /// entitlement code. A first attempt's bare 401 is only a stale token.
    case refused(code: String?)
    /// Any other 403: this request was not allowed; the session stands.
    case forbidden
}

/// What Connect dials from memory: the installed catalog's digest and its
/// routing token.
nonisolated struct InstalledCatalogDigests: Equatable, Sendable {
    let catalogSha256: String
    let routingSha256: String
}

/// What the last verified online session proved: bound to its refresh token
/// and to the exact catalog the server confirmed. Never holds the token.
nonisolated struct OfflineGrant: Equatable, Sendable {
    /// Display only: offline there is no `me()` to confirm it.
    let accountId: String?
    /// `OfflineGrantGate.tokenDigest` of the refresh token the keychain acknowledged.
    let tokenSha256: String
    /// `sha256` of the server response that installed or confirmed the catalog.
    let catalogSha256: String
    /// Routing token of that same response.
    let routingSha256: String
    /// Epoch milliseconds of that server confirmation.
    let verifiedAt: Int64
}

/// Restore's offline answer.
nonisolated enum OfflineAdmission: Equatable, Sendable {
    /// Ready on the grant, which Tono verified online at this time.
    case admitted(verifiedAt: Date)
    /// The grant records a refusal: the account is suspended.
    case revoked(reason: String)
    /// No positive grant matching memory: restore keeps its ordinary answer.
    case refused(String)
}

/// `offline-grant.json`: `{"verdict":"granted",...}` or
/// `{"verdict":"revoked","reason":..,"at":..}`. Anything else — a missing
/// file, a torn write, an unknown verdict — is unreadable, and unreadable
/// refuses.
nonisolated private struct OfflineGrantRecord: Codable {
    var verdict: String
    var accountId: String?
    var tokenSha256: String?
    var catalogSha256: String?
    var routingSha256: String?
    var verifiedAt: Int64?
    var reason: String?
    var at: Int64?

    init(granted grant: OfflineGrant) {
        verdict = "granted"
        accountId = grant.accountId
        tokenSha256 = grant.tokenSha256
        catalogSha256 = grant.catalogSha256
        routingSha256 = grant.routingSha256
        verifiedAt = grant.verifiedAt
    }
}

/// Offline eligibility of this process's session, and the one writer of
/// `offline-grant.json`.
nonisolated final class OfflineGrantGate: @unchecked Sendable {
    static let fileName = "offline-grant.json"

    let fileURL: URL
    private let lock = NSLock()

    init(directory: URL) {
        fileURL = directory.appendingPathComponent(Self.fileName)
    }

    /// SHA-256 of a refresh token, lowercase hex. The grant never holds the token.
    static func tokenDigest(_ refreshToken: String) -> String {
        SHA256.hash(data: Data(refreshToken.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    /// Record a server-verified session.
    @discardableResult
    func writeGrant(_ grant: OfflineGrant) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return (try? writeLocked(OfflineGrantRecord(granted: grant))) != nil
    }

    /// Offline admission. Not implemented yet: every launch keeps its error.
    func admit(tokenSha256: String?, installed: InstalledCatalogDigests?) -> OfflineAdmission {
        .refused("offline admission is not implemented")
    }

    /// Connect's account gate. Not implemented yet: nothing is refused here.
    func connectRefusal(catalogDigest: String?, routingToken: String?) -> String? {
        nil
    }

    /// The verdict sink. Not implemented yet: answers change nothing.
    func report(_ verdict: TonoSessionVerdict, readScope: UInt64) {}

    private func writeLocked(_ record: OfflineGrantRecord) throws {
        try ConfigStorage.shared.writeSensitive(JSONEncoder().encode(record), to: fileURL)
    }
}
