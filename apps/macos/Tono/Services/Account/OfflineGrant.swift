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

/// One classified answer, tagged with the account read revision its request
/// started under: a refusal that belongs to a retired presentation must not
/// suspend the one that replaced it.
nonisolated struct SessionVerdictReport: Sendable {
    let verdict: TonoSessionVerdict
    let readScope: UInt64
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

    init(revokedFor reason: String, at: Int64) {
        verdict = "revoked"
        self.reason = reason
        self.at = at
    }

    var grant: OfflineGrant? {
        guard verdict == "granted", let tokenSha256, let catalogSha256,
              let routingSha256, let verifiedAt else { return nil }
        return OfflineGrant(
            accountId: accountId,
            tokenSha256: tokenSha256,
            catalogSha256: catalogSha256,
            routingSha256: routingSha256,
            verifiedAt: verifiedAt
        )
    }

    var revocationReason: String? {
        guard verdict == "revoked", at != nil else { return nil }
        return reason
    }
}

/// Offline eligibility of this process's session, and the one writer of
/// `offline-grant.json`. `TonoAPIClient` reports every classified server
/// answer here from its own actor; the account session and Connect read it on
/// the main actor. One lock guards all of it and the file is written under
/// that lock, so a grant whose revocation check passed can never land after
/// the tombstone of a revocation that came later.
nonisolated final class OfflineGrantGate: @unchecked Sendable {
    static let fileName = "offline-grant.json"

    /// Offline eligibility in memory, ordered by severity. A later `verified`
    /// answer lifts `forbidden`: the server accepted the session and refused
    /// only one request. `refused` lifts only when a sign-in adopts a new
    /// identity or `me()` accepts the account again (`readmit`).
    nonisolated private enum Revocation: Int, Comparable {
        case eligible, forbidden, refused

        static func < (lhs: Revocation, rhs: Revocation) -> Bool {
            lhs.rawValue < rhs.rawValue
        }
    }

    private static let refusedReason = "refused"
    /// A tombstone for another 403 revokes offline eligibility only; it never
    /// suspends the account.
    private static let forbiddenReason = "forbidden"
    private static let maximumFileBytes = 64 * 1024
    private static let tombstoneRetryInitial: Duration = .seconds(1)
    private static let tombstoneRetryMaximum: Duration = .seconds(30)

    let fileURL: URL
    private let lock = NSLock()
    /// Set synchronously when an answer is reported, so Connect refuses
    /// before any UI or disk catches up.
    private var revocation = Revocation.eligible
    /// The grant this session was admitted on while no server answer has
    /// arrived yet. Nil online.
    private var admittedGrant: OfflineGrant?
    /// The newest revocation the disk has not acknowledged.
    private var pendingTombstone: OfflineGrantRecord?
    private var tombstoneWriterRunning = false
    /// The account session's read revision, mirrored so each request carries
    /// the one it started under.
    private var accountReadScope: UInt64 = 0
    private var verdictHandler: (@Sendable (SessionVerdictReport) -> Void)?

    init(directory: URL) {
        fileURL = directory.appendingPathComponent(Self.fileName)
    }

    /// SHA-256 of a refresh token, lowercase hex. The grant never holds the token.
    static func tokenDigest(_ refreshToken: String) -> String {
        SHA256.hash(data: Data(refreshToken.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    // MARK: Account side

    var readScope: UInt64 {
        lock.lock(); defer { lock.unlock() }
        return accountReadScope
    }

    func noteReadScope(_ scope: UInt64) {
        lock.lock(); defer { lock.unlock() }
        accountReadScope = scope
    }

    /// Who hears each classified answer, after memory and disk took it. The
    /// account session installs it and carries a refusal into its state.
    func setVerdictHandler(_ handler: (@Sendable (SessionVerdictReport) -> Void)?) {
        lock.lock(); defer { lock.unlock() }
        verdictHandler = handler
    }

    /// When Tono verified the grant this session was admitted on, while no
    /// server answer has ended offline mode.
    var offlineVerifiedAt: Date? {
        lock.lock(); defer { lock.unlock() }
        return admittedGrant.map(Self.date(of:))
    }

    func leaveOffline() {
        lock.lock(); defer { lock.unlock() }
        admittedGrant = nil
    }

    /// A sign-in adopted a new identity: nothing the server told the previous
    /// one applies to it. A tombstone still waiting for the disk keeps
    /// retrying until the new identity's first grant supersedes it.
    func adoptNewIdentity() {
        lock.lock(); defer { lock.unlock() }
        revocation = .eligible
        admittedGrant = nil
    }

    /// `me()` accepted the account again (a launch, Check again): a refusal
    /// this process heard earlier no longer stands, nor does its tombstone
    /// still waiting for the disk, which must not land over a grant recorded
    /// after this.
    func readmit() {
        lock.lock(); defer { lock.unlock() }
        if revocation != .eligible { pendingTombstone = nil }
        revocation = .eligible
    }

    /// Offline admission (#582): compare the grant with what is in memory
    /// now — the hydrated refresh token and the catalog the launch installed.
    /// The catalog cache is never re-read here: memory is what Connect dials.
    /// Reading the grant file is the only I/O.
    func admit(tokenSha256: String?, installed: InstalledCatalogDigests?) -> OfflineAdmission {
        lock.lock(); defer { lock.unlock() }
        // A new restore decides afresh whether this launch runs offline.
        admittedGrant = nil
        switch revocation {
        case .eligible: break
        case .forbidden: return .refused("the server forbade this session")
        case .refused: return .revoked(reason: Self.refusedReason)
        }
        guard let record = readLocked() else { return .refused("no readable offline grant") }
        if let reason = record.revocationReason {
            return reason == Self.forbiddenReason
                ? .refused("the server forbade this session")
                : .revoked(reason: reason)
        }
        guard let grant = record.grant else { return .refused("no readable offline grant") }
        if let mismatch = Self.mismatch(grant, tokenSha256: tokenSha256, installed: installed) {
            return .refused(mismatch)
        }
        admittedGrant = grant
        return .admitted(verifiedAt: Self.date(of: grant))
    }

    /// Connect's account gate (#582 rule 5): a revoked session is refused in
    /// any state, and an offline session must still hold exactly the catalog
    /// its grant verified. The token is not compared again: offline nothing
    /// rotates it, and a renewal that could is a server answer that ended
    /// offline mode.
    func connectRefusal(catalogDigest: String?, routingToken: String?) -> String? {
        lock.lock(); defer { lock.unlock() }
        if revocation != .eligible {
            return String(localized: "Tono did not accept this session. Connect stays blocked until Tono verifies it again.")
        }
        guard let grant = admittedGrant else { return nil }
        guard grant.catalogSha256 == catalogDigest, grant.routingSha256 == routingToken else {
            return String(localized: "The cloud servers no longer match what Tono last verified. Connect again when Tono is reachable.")
        }
        return nil
    }

    /// Record a server-verified session (#582 rule 1). Skipped while this
    /// session is revoked. A grant that lands supersedes a tombstone still
    /// waiting from before this session became eligible: its writer must not
    /// land it over this grant.
    @discardableResult
    func writeGrant(_ grant: OfflineGrant) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard revocation == .eligible else { return false }
        guard (try? writeLocked(OfflineGrantRecord(granted: grant))) != nil else { return false }
        pendingTombstone = nil
        return true
    }

    // MARK: Sink side

    /// One classified answer for the current credentials, from
    /// `TonoAPIClient`'s actor. Memory first (Connect refuses from here on),
    /// then the durable overwrite, then the account session, which hears a
    /// refusal and the end of offline mode. Offline mode ends at the first
    /// server answer, whatever it says.
    func report(_ verdict: TonoSessionVerdict, readScope: UInt64) {
        lock.lock()
        var startWriter = false
        var refused = false
        switch verdict {
        case .verified:
            // The lifted 403's tombstone, if the disk has not taken it yet,
            // is stale: it must not land over a grant recorded after this.
            if revocation == .forbidden {
                revocation = .eligible
                pendingTombstone = nil
            }
        case .forbidden:
            startWriter = revokeLocked(.forbidden, reason: OfflineGrantGate.forbiddenReason)
        case let .refused(code):
            refused = true
            let reason = code.map { "\(OfflineGrantGate.refusedReason): \($0)" }
            startWriter = revokeLocked(.refused, reason: reason ?? OfflineGrantGate.refusedReason)
        }
        let leftOffline = admittedGrant != nil
        admittedGrant = nil
        let handler = refused || leftOffline ? verdictHandler : nil
        lock.unlock()
        if startWriter {
            Task.detached { [self] in await self.writeTombstoneUntilDurable() }
        }
        handler?(SessionVerdictReport(verdict: verdict, readScope: readScope))
    }

    /// #582 rule 3: overwrite the grant with the verdict, never delete it.
    /// Returns whether a retry writer has to start for a disk that refused.
    private func revokeLocked(_ level: Revocation, reason: String) -> Bool {
        let previous = revocation
        revocation = max(revocation, level)
        // Another 403 after a refusal must not record a lesser verdict.
        guard level >= previous else { return false }
        let tombstone = OfflineGrantRecord(revokedFor: reason, at: Self.nowMilliseconds())
        do {
            try writeLocked(tombstone)
            pendingTombstone = nil
            return false
        } catch {
            pendingTombstone = tombstone
            LocalTrafficAudit.shared.recordEvent(
                "offline_grant_revocation_not_durable",
                details: ["reason": reason, "error": String(describing: error)]
            )
            guard !tombstoneWriterRunning else { return false }
            tombstoneWriterRunning = true
            return true
        }
    }

    private func writeTombstoneUntilDurable() async {
        var delay = Self.tombstoneRetryInitial
        while true {
            try? await Task.sleep(for: delay)
            if writePendingTombstone() { return }
            delay = min(delay * 2, Self.tombstoneRetryMaximum)
        }
    }

    /// True once no revocation waits for the disk; the writer then stops.
    /// It writes the pending tombstone as it stands under the lock, so one a
    /// lift or a grant has since dropped is never written.
    private func writePendingTombstone() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if let tombstone = pendingTombstone {
            guard (try? writeLocked(tombstone)) != nil else { return false }
            pendingTombstone = nil
        }
        tombstoneWriterRunning = false
        return true
    }

    // MARK: File

    private func readLocked() -> OfflineGrantRecord? {
        guard let data = ConfigStorage.shared.readSensitive(
            at: fileURL,
            maximumBytes: Self.maximumFileBytes
        ) else { return nil }
        return try? JSONDecoder().decode(OfflineGrantRecord.self, from: data)
    }

    private func writeLocked(_ record: OfflineGrantRecord) throws {
        try ConfigStorage.shared.writeSensitive(JSONEncoder().encode(record), to: fileURL)
    }

    private static func mismatch(
        _ grant: OfflineGrant,
        tokenSha256: String?,
        installed: InstalledCatalogDigests?
    ) -> String? {
        guard let tokenSha256 else { return "no session token in memory" }
        guard tokenSha256 == grant.tokenSha256 else {
            return "the grant belongs to another session token"
        }
        guard let installed else { return "no installed exits" }
        guard installed.catalogSha256 == grant.catalogSha256,
              installed.routingSha256 == grant.routingSha256 else {
            return "the catalog in memory is not the one the grant verified"
        }
        return nil
    }

    private static func date(of grant: OfflineGrant) -> Date {
        Date(timeIntervalSince1970: TimeInterval(grant.verifiedAt) / 1_000)
    }

    private static func nowMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }
}
