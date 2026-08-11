import Foundation
import Darwin
import Security

enum PeerAuthorizationError: Error {
    case requirement
}

/// Authenticates the process at the other end of a connected Unix-domain
/// socket. UID checks alone are not an application identity boundary: every
/// process owned by the interactive user shares that UID. LOCAL_PEERTOKEN is
/// supplied by the kernel and binds the Security.framework dynamic-code lookup
/// to the exact process incarnation (including the audit-token pid version).
struct TonoPeerAuthorizer {
    /// `get-task-allow` must be absent, and this clause carries as much weight as
    /// the identity clauses above it. Identity alone is not enough: a build that
    /// ships that entitlement can be attached to and injected into by any process
    /// running as the same user, so an attacker never has to satisfy the code
    /// requirement themselves — they borrow a process that already does, and with
    /// it the ability to arm and disarm PF and to start the privileged core.
    /// Apple Development certificates carry this team's OU exactly like Developer
    /// ID ones, so the OU clause cannot separate a debuggable local build from a
    /// shipped one; only the entitlement can.
    ///
    /// Consequence for development: a Debug-configured build is debuggable and is
    /// therefore refused by the helper. Build the Release configuration (hardened
    /// runtime, no `get-task-allow`) to exercise the privileged path. Tightening
    /// further to Developer ID only — `and certificate
    /// 1[field.1.2.840.113635.100.6.2.6] exists` — would also exclude
    /// Apple Development signatures altogether.
    static let clientRequirementText =
        #"anchor apple generic and identifier "com.raydocs.tono" and certificate leaf[subject.OU] = "YY57758GS7" and entitlement["com.apple.security.get-task-allow"] absent"#

    private let allowedUID: uid_t
    private let requirement: SecRequirement

    init(allowedUID: uid_t) throws {
        self.allowedUID = allowedUID
        var created: SecRequirement?
        guard SecRequirementCreateWithString(
            Self.clientRequirementText as CFString,
            SecCSFlags(rawValue: 0),
            &created
        ) == errSecSuccess, let created else {
            throw PeerAuthorizationError.requirement
        }
        requirement = created
    }

    func accepts(socket fd: Int32) -> Bool {
        var peerUID: uid_t = 0
        var peerGID: gid_t = 0
        var token = audit_token_t()
        var length = socklen_t(MemoryLayout<audit_token_t>.size)
        guard getpeereid(fd, &peerUID, &peerGID) == 0,
              peerUID == allowedUID,
              withUnsafeMutablePointer(to: &token, {
            getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, $0, &length)
        }) == 0, length == MemoryLayout<audit_token_t>.size else {
            return false
        }

        let tokenData = withUnsafeBytes(of: &token) { Data($0) }
        let attributes = [kSecGuestAttributeAudit: tokenData] as CFDictionary
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(
            nil,
            attributes,
            SecCSFlags(rawValue: 0),
            &code
        ) == errSecSuccess, let code else {
            return false
        }
        return SecCodeCheckValidity(
            code,
            SecCSFlags(rawValue: 0),
            requirement
        ) == errSecSuccess
    }

    /// A malformed requirement string makes `init` throw, which stops the helper
    /// from ever binding its socket — every client would see a connection
    /// failure with no explanation. The build script runs this so a typo in the
    /// requirement language cannot reach a signed helper.
    static func runSelfTests() -> Bool {
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            clientRequirementText as CFString,
            SecCSFlags(rawValue: 0),
            &requirement
        ) == errSecSuccess, let requirement else {
            return false
        }
        var canonical: CFString?
        guard SecRequirementCopyString(
            requirement,
            SecCSFlags(rawValue: 0),
            &canonical
        ) == errSecSuccess, let text = canonical as String? else {
            return false
        }
        // The clauses that make this an application identity boundary rather
        // than a UID check must all survive compilation.
        return text.contains("anchor apple generic")
            && text.contains("com.raydocs.tono")
            && text.contains("YY57758GS7")
            && text.contains("com.apple.security.get-task-allow")
            && text.contains("absent")
    }
}
