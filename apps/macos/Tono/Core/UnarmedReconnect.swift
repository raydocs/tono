import Foundation

/// Backoff for probes that must not install PF or a tunnel.
enum UnarmedReconnect {
    static let delays: [TimeInterval] = [2, 5, 15, 30, 60, 120]

    static func delaySeconds(attempt: Int) -> TimeInterval {
        delays[min(max(attempt, 0), delays.count - 1)]
    }

    /// TCP proofs cannot establish HY2 reachability. Retry the selected TCP node, then at most
    /// two same-region TCP alternatives, with the remembered repair first among alternatives.
    static func tcpCandidateNames(
        preferred: String, remembered: String?, candidates: [ExitHeal.Candidate]
    ) -> [String] {
        let region = ExitHeal.regionKey(preferred)
        let eligible = candidates.filter {
            $0.transport == .tcp && $0.region == region && !$0.server.isEmpty && $0.port > 0
        }
        let priorities = [preferred, ExitHeal.baseName(preferred)] + (remembered.map { [$0] } ?? [])
        var names: [String] = []
        for name in priorities + eligible.map(\.name) {
            if eligible.contains(where: { $0.name == name }), !names.contains(name) {
                names.append(name)
            }
        }
        return Array(names.prefix(3))
    }

    /// Proves every candidate in one concurrent window instead of one 2.5 s proof per
    /// candidate. The result keeps the preference order of `candidates`: the first name
    /// that proved reachable wins, not the first to answer.
    static func firstProvenName(
        among candidates: [String],
        prove: @escaping @Sendable (String) async -> Bool
    ) async -> String? {
        guard !candidates.isEmpty else { return nil }
        let results = await withTaskGroup(of: (String, Bool).self) { group in
            for name in candidates {
                group.addTask { (name, await prove(name)) }
            }
            var results: [String: Bool] = [:]
            for await (name, proven) in group { results[name] = proven }
            return results
        }
        return candidates.first { results[$0] == true }
    }

    /// Connect only after a TCP proof, and only while protection is down.
    static func shouldConnect(tcpReachable: Bool, protectionArmed: Bool) -> Bool {
        tcpReachable && !protectionArmed
    }
}
