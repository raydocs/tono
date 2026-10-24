import Foundation

/// Rejected network authority is not permission to delete the account or VPN configuration.
/// The app supplies a serialized, checked On Demand disarm + NE stop (never configuration removal).
public enum AccountNetworkRelease {
    public struct Receipt: Equatable, Sendable {
        public let source = "account"
        public let accountEpoch: UInt64
        public let at: Date
        public let reason: String
        /// A stop request is not proof that NE has finished disconnecting.
        public let releaseRequested: Bool
        public let releaseFailed: Bool
    }

    public static func requiresRelease(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return false }
        // 401 is ambiguous on older servers, but never authority to keep routing into a rejected
        // identity. Ordinary NETWORK/429/5xx errors do not withdraw existing network authority.
        return error.status == 401 || (error.status == 403 &&
            (AccountErrors.isRestriction(error) || ["DEVICE_REAUTH_REQUIRED", "USER_DISABLED"].contains(error.code)))
    }

    /// Stop NE even if saving/reading back On Demand fails. Preserve the error so the UI cannot
    /// claim automatic reconnect was disabled; no configuration-removal capability is passed in.
    @MainActor
    public static func checkedStop(disarm: () async throws -> Void, stop: () -> Void) async throws {
        defer { stop() }
        try await disarm()
    }

    @MainActor
    public static func handle(_ error: Error, accountEpoch: UInt64, at: Date = Date(),
                              release: () async throws -> Void) async -> Receipt? {
        guard requiresRelease(error) else { return nil }
        do {
            try await release()
            return Receipt(accountEpoch: accountEpoch, at: at, reason: AccountErrors.reasonCode(error),
                           releaseRequested: true, releaseFailed: false)
        } catch {
            return Receipt(accountEpoch: accountEpoch, at: at, reason: "ACCOUNT_RELEASE_FAILED",
                           releaseRequested: true, releaseFailed: true)
        }
    }
}
