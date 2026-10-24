import Foundation

/// Chosen by the root CLI entry point, never decoded from a socket request.
nonisolated enum HelperDisarmAuthority {
    case runtime
    case rootEmergency

    enum Refusal: Error { case rootRequired, strictProtection }

    var restoresAtLaunch: Bool { true }

    func authorize(effectiveUID: UInt32, strictIntentActive: Bool) throws {
        if self == .rootEmergency && effectiveUID != 0 { throw Refusal.rootRequired }
        guard !strictIntentActive else { throw Refusal.strictProtection }
    }
}
