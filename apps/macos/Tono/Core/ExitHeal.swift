import Foundation

/// Sticky self-heal that never touches PF, DNS, or the tunnel.
///
/// `DialBeforeArm` is applied only while protection is down. `FailOpen` means
/// one restore of the original network and no further tunnel. `HoldClosed` is
/// only for an explicit strict kill switch, and it keeps the same node.
/// This type is not called from the live connect path yet: wiring it into
/// `AppState` has to be proven on a device so a wrong PF release cannot
/// brick the Mac. The Windows connect path applies the same decisions.
enum ExitHeal {
    static let hysteresisMs: UInt64 = 45_000
    static let tcpFailFastMs: UInt64 = 2_500
    static let hy2Suffix = " · hy2"

    enum Transport: Equatable { case tcp, hy2 }
    enum Failure: Equatable { case dns, tcp, tls, quicHandshake, auth, other }
    enum Stance: Equatable { case ordinary, strict }
    enum Change: Equatable { case transport, port, sni, resolvedIp, sameRegion, returnPreferred }

    struct Candidate: Equatable {
        var name: String
        var region: String
        var server: String
        var port: UInt16
        var sni: String
        var transport: Transport
        var udpVendorBlocked: Bool
        var rttMs: UInt64?
    }

    struct Session: Equatable {
        var preferred: String
        var dial: String
        var residentialId: String
        var tried: Set<String>
        var pendingDial: String?
        var backupSinceMs: UInt64?
        var preferredHealthySinceMs: UInt64?
        var protectionArmed: Bool

        static func forPreferred(_ preferred: String, residentialId: String) -> Session {
            Session(
                preferred: preferred,
                dial: preferred,
                residentialId: residentialId,
                tried: [],
                pendingDial: nil,
                backupSinceMs: nil,
                preferredHealthySinceMs: nil,
                protectionArmed: false
            )
        }
    }

    enum Effect: Equatable {
        case untouched
        case dialBeforeArm(name: String, change: Change, dialerChanged: Bool)
        case failOpen(remember: String?, dialerChanged: Bool)
        /// General traffic released; AI destinations stay blocked.
        /// #706 owns the decision. Callers must not full-release.
        case selectiveAiHold(remember: String?)
        case holdClosed
    }

    /// Mirror of `network_disposition::exhausted_protection_using`.
    /// #706 owns that function. This copy is not wired to `AppState`.
    /// `selectiveReady` stays false on the live path until the PF hook lands.
    static func exhaustedEffect(
        strict: Bool,
        selectiveReady: Bool,
        remember: String?,
        dialerChanged: Bool
    ) -> Effect {
        if strict { return .holdClosed }
        if selectiveReady { return .selectiveAiHold(remember: remember) }
        return .failOpen(remember: remember, dialerChanged: dialerChanged)
    }

    static func baseName(_ name: String) -> String {
        name.hasSuffix(hy2Suffix) ? String(name.dropLast(hy2Suffix.count)) : name
    }

    static func udpVendorBlocked(_ name: String) -> Bool {
        guard name.hasSuffix(hy2Suffix) else { return false }
        let city = baseName(name).split(separator: "·", maxSplits: 1).first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? name
        return city.lowercased() == "tokyo"
    }

    static func regionKey(_ name: String) -> String {
        let base = baseName(name)
        let tokens = base.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        if tokens.contains(where: { $0.caseInsensitiveCompare("us") == .orderedSame }) { return "us" }
        if tokens.contains(where: { $0.caseInsensitiveCompare("jp") == .orderedSame }) { return "jp" }
        let city = base.split(separator: "·", maxSplits: 1).first
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
        switch city {
        case "los angeles", "salt lake city", "buffalo", "new york", "san jose", "seattle", "chicago", "dallas", "miami":
            return "us"
        case "tokyo", "osaka":
            return "jp"
        default:
            return "other"
        }
    }

    static func noteHealth(_ session: inout Session, name: String, ok: Bool, nowMs: UInt64) {
        guard name == session.preferred else { return }
        if ok {
            if session.preferredHealthySinceMs == nil { session.preferredHealthySinceMs = nowMs }
        } else {
            session.preferredHealthySinceMs = nil
        }
    }

    static func noteProtection(_ session: inout Session, armedAndVerified: Bool, nowMs: UInt64) {
        if session.protectionArmed && !armedAndVerified, let next = session.pendingDial {
            session.pendingDial = nil
            session.dial = next
            if session.dial != session.preferred && session.backupSinceMs == nil {
                session.backupSinceMs = nowMs
            }
        }
        session.protectionArmed = armedAndVerified
    }

    static func observe(
        _ session: inout Session,
        failure: Failure?,
        candidates: [Candidate],
        stance: Stance,
        nowMs: UInt64
    ) -> Effect {
        guard !session.preferred.isEmpty else { return .untouched }
        if let failure {
            return onFailure(&session, failure: failure, candidates: candidates, stance: stance)
        }
        return onQuiet(&session, candidates: candidates, nowMs: nowMs)
    }

    private static func onQuiet(_ session: inout Session, candidates: [Candidate], nowMs: UInt64) -> Effect {
        guard !session.protectionArmed, session.dial != session.preferred, readyToReturn(session, nowMs: nowMs) else {
            return .untouched
        }
        guard candidates.contains(where: { $0.name == session.preferred }) else { return .untouched }
        session.dial = session.preferred
        session.tried.removeAll()
        session.pendingDial = nil
        session.backupSinceMs = nil
        session.preferredHealthySinceMs = nil
        return .dialBeforeArm(name: session.dial, change: .returnPreferred, dialerChanged: false)
    }

    private static func onFailure(
        _ session: inout Session,
        failure: Failure,
        candidates: [Candidate],
        stance: Stance
    ) -> Effect {
        session.tried.insert(session.dial)
        session.preferredHealthySinceMs = nil
        let next = nextCandidate(session, failure: failure, candidates: candidates)
        if session.protectionArmed {
            session.pendingDial = next?.candidate.name
            let changed = next.map { baseName($0.candidate.name) != baseName(session.preferred) } ?? false
            // The Rust hook is not visible here. Ordinary stays a full release
            // until AppState is wired to the shared decision.
            return exhaustedEffect(
                strict: stance == .strict,
                selectiveReady: false,
                remember: session.pendingDial,
                dialerChanged: changed
            )
        }
        guard let next else { return .untouched }
        let changed = baseName(next.candidate.name) != baseName(session.preferred)
        session.dial = next.candidate.name
        session.pendingDial = nil
        return .dialBeforeArm(name: next.candidate.name, change: next.change, dialerChanged: changed)
    }

    private static func readyToReturn(_ session: Session, nowMs: UInt64) -> Bool {
        guard let healthy = session.preferredHealthySinceMs, let backup = session.backupSinceMs else { return false }
        let healthyFor = nowMs >= healthy ? nowMs - healthy : 0
        let backupFor = nowMs >= backup ? nowMs - backup : 0
        return healthyFor >= hysteresisMs && backupFor >= hysteresisMs
    }

    private struct Ranked {
        var rank: UInt8
        var rtt: UInt64
        var name: String
        var candidate: Candidate
        var change: Change
    }

    private static func nextCandidate(
        _ session: Session,
        failure: Failure,
        candidates: [Candidate]
    ) -> (candidate: Candidate, change: Change)? {
        let current = candidates.first { $0.name == session.dial }
        let region = current?.region ?? candidates.first { $0.name == session.preferred }?.region
        guard let region else { return nil }
        let ranked: [Ranked] = candidates.compactMap { candidate in
            guard candidate.region == region, !session.tried.contains(candidate.name), !hy2Blocked(candidate) else { return nil }
            guard let (rank, change) = repairRank(failure, current: current, candidate: candidate) else { return nil }
            return Ranked(rank: rank, rtt: candidate.rttMs ?? UInt64.max, name: candidate.name, candidate: candidate, change: change)
        }
        return ranked.sorted {
            if $0.rank != $1.rank { return $0.rank < $1.rank }
            if $0.rtt != $1.rtt { return $0.rtt < $1.rtt }
            return $0.name < $1.name
        }.first.map { ($0.candidate, $0.change) }
    }

    private static func hy2Blocked(_ candidate: Candidate) -> Bool {
        candidate.transport == .hy2 && (candidate.udpVendorBlocked || udpVendorBlocked(candidate.name))
    }

    private static func repairRank(
        _ failure: Failure,
        current: Candidate?,
        candidate: Candidate
    ) -> (UInt8, Change)? {
        let sameBase = current.map { baseName($0.name) == baseName(candidate.name) } ?? false
        if failure == .auth && sameBase { return nil }
        if sameBase, let current {
            if current.transport != candidate.transport && transportMatches(failure, candidate.transport) {
                return (0, .transport)
            }
            if current.port != candidate.port { return (1, .port) }
            if current.sni != candidate.sni { return (2, .sni) }
            if current.server != candidate.server { return (3, .resolvedIp) }
            return nil
        }
        if candidate.transport == .hy2 { return nil }
        return (4, .sameRegion)
    }

    private static func transportMatches(_ failure: Failure, _ transport: Transport) -> Bool {
        switch failure {
        case .quicHandshake: return transport == .tcp
        case .auth: return false
        default: return transport == .hy2
        }
    }
}
