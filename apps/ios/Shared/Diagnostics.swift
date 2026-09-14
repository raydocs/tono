import Foundation

enum DiagnosticPolicy: String, Codable, CaseIterable {
    case comprehensive, minimal, off

    static func resolve(_ requested: Self?, distribution: String?) -> Self {
        if requested == .off { return .off }
        guard distribution == "testflight" else { return .minimal }
        return requested ?? .comprehensive
    }
}

/// All uploadable fields are closed enums, bounded counts, or rounded durations.
/// There is deliberately no raw message, URL, email, node name, config or log API.
struct DiagnosticEvent: Codable, Sendable {
    enum Kind: String, Codable { case stateChanged, admissionRefused, accountRequest, pauseRequested }
    let kind: Kind
    let state: ProtectionState
    let blocker: Blocker?
    let elapsedBucket: Int
    let observedAtMs: Int64

    init(kind: Kind, state: ProtectionState, blocker: Blocker? = nil, elapsedSeconds: Int = 0, now: Date = .now) {
        self.kind = kind
        self.state = state
        self.blocker = blocker
        elapsedBucket = min(max(elapsedSeconds, 0), 300) / 5 * 5
        observedAtMs = Int64(max(0, now.timeIntervalSince1970) / 60) * 60_000
    }
}

struct DiagnosticReport: Encodable {
    let schemaVersion = 1
    let platform = "ios"
    let policy: DiagnosticPolicy
    let events: [DiagnosticEvent]
    let dropped: Int
}

struct DiagnosticBuffer {
    private(set) var events: [DiagnosticEvent] = []
    private(set) var dropped = 0

    mutating func append(_ event: DiagnosticEvent, policy: DiagnosticPolicy) {
        guard policy != .off else { return }
        if events.count == 128 { events.removeFirst(); dropped += 1 }
        events.append(event)
    }

    func report(policy: DiagnosticPolicy) -> DiagnosticReport {
        let retained = policy == .comprehensive ? events : events.filter { $0.blocker != nil }
        return DiagnosticReport(policy: policy, events: policy == .off ? [] : retained, dropped: dropped)
    }

    mutating func clear() { events.removeAll(); dropped = 0 }
}
