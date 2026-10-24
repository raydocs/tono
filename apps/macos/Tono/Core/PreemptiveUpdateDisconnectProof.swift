import Foundation

/// Shared with the root release worker; requesting retry is not release proof.
nonisolated enum PreemptiveUpdateDisconnectProof {
    struct Component {
        let name: String
        let readback: String
        let risk: String
    }

    static func permits(outcome: String, components: [Component]) -> Bool {
        guard outcome == "restored" else { return false }
        return ["pf", "core", "dns"].allSatisfy { name in
            let readings = components.filter { $0.name == name }
            return readings.count == 1 && readings[0].readback == "restored" && readings[0].risk == "settled"
        }
    }
}
