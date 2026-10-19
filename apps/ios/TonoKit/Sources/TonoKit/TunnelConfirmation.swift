import Foundation

/// The packet tunnel's word on what it runs, stamped by the tunnel itself: which start (`session`),
/// which graph within it (`generation`), the routes in use (nil: no graph runs) and when it said so.
/// Sent with every status and rebuild reply; the shared status file carries the same facts
/// (`TunnelReport`). It is the only routing fact any screen, widget, control or Live Activity may
/// state as current. The app can ask for one and decorate it; it cannot make one, and nothing the
/// app writes moves `at`.
public struct TunnelAnswer: Equatable, Sendable {
    public var session: String
    public var generation: Int
    public var routing: RouteSettings?
    /// When the tunnel came up in this session.
    public var since: Date?
    /// When the tunnel answered (the phone's clock, read in the tunnel process).
    public var at: Date

    public init(session: String, generation: Int, routing: RouteSettings?, since: Date?, at: Date) {
        self.session = session
        self.generation = generation
        self.routing = routing
        self.since = since
        self.at = at
    }

    public var json: JSON {
        JSON.obj(("session", .string(session)), ("generation", .int(generation)), ("routing", routing?.json ?? .null),
                 ("since", since.map { JSON.number($0.timeIntervalSince1970) } ?? .null),
                 ("at", .number(at.timeIntervalSince1970)))
    }

    /// The `tunnel` field of a status or rebuild reply. nil when there is no reply, no field or an
    /// unreadable one: a reply without the tunnel's stamp is not an answer.
    public static func decode(_ data: Data?) -> TunnelAnswer? {
        guard let data, let json = try? JSON.parse(data) else { return nil }
        return decode(json: json["tunnel"])
    }

    static func decode(json: JSON?) -> TunnelAnswer? {
        guard let json, let session = json["session"]?.string, !session.isEmpty, let generation = json["generation"]?.int,
              case .number(let at)? = json["at"], let routingJSON = json["routing"] else { return nil }
        let routing = RouteSettings(routingJSON)
        guard routing != nil || routingJSON == .null else { return nil }
        var since: Date?
        if case .number(let s)? = json["since"] { since = Date(timeIntervalSince1970: s) }
        return TunnelAnswer(session: session, generation: generation, routing: routing, since: since,
                            at: Date(timeIntervalSince1970: at))
    }
}

/// What the app may say about the routes in use while Network Extension reports the tunnel up.
public enum RoutingConfirmation: Equatable, Sendable {
    /// The tunnel has not answered in this session, its answer is older than
    /// `StatusSnapshot.freshFor`, or the last question went unanswered: nothing is claimed.
    case unknown
    /// The tunnel confirmed this graph runs.
    case graph(RouteSettings)
    /// The tunnel confirmed no graph runs (a refused rebuild whose restore failed too).
    case noGraph
}

/// The app's copy of the tunnel's last word, scoped to one Network Extension session as the app
/// sees it (status and connected date). Anything that ends or changes that session (a stop, a
/// reconnect, a relaunch of the app) clears it and turns away replies to questions asked before.
/// The word comes from the tunnel's replies and from its own report in the shared status
/// (`observed`), the same report the widgets read, but only from the tunnel start that answered in
/// this session. A late reply about an older graph, or to a question older than the one that
/// settled what is held, is turned away. What it holds counts for `StatusSnapshot.freshFor` from
/// the tunnel's own `at`: asking again without an answer, or publishing, never keeps a confirmation
/// alive.
public struct ConfirmationTracker: Equatable, Sendable {
    /// Taken before a question to the tunnel; the reply is accepted only with a ticket of the same
    /// session, newer than the question that settled what is held.
    public struct Ticket: Equatable, Sendable {
        fileprivate let epoch: Int
        fileprivate let question: Int
        fileprivate let askedAt: Date
    }

    public private(set) var answer: TunnelAnswer?
    /// The tunnel start (and its last graph) that answered in this session, kept after an unanswered
    /// question cleared `answer`: only that start's own report is taken from the shared status, and
    /// the app's note names it.
    public var heard: (session: String, generation: Int)? { heardSession.map { ($0, heardGeneration) } }
    private var heardSession: String?
    private var heardGeneration = 0
    private var lastWord: TunnelAnswer?
    private var epoch = 0
    private var asked = 0
    /// The question whose reply set `answer` (or cleared it).
    private var settledBy = 0
    /// When the latest question that went unanswered was asked: a report the tunnel wrote before
    /// then does not undo the silence.
    private var silentSince: Date?

    public init() {}

    public mutating func ask(at now: Date = Date()) -> Ticket {
        asked += 1
        return Ticket(epoch: epoch, question: asked, askedAt: now)
    }

    /// The tunnel stopped, came up again or reconnected: nothing it said before is about what runs now.
    public mutating func sessionEnded() {
        epoch += 1
        answer = nil
        heardSession = nil
        lastWord = nil
        silentSince = nil
        settledBy = asked
    }

    /// The reply to the question asked with `ticket`. No answer (no reply, a timeout, or one without
    /// the tunnel's stamp) to the latest question clears what was held: a tunnel that does not answer
    /// confirms nothing, and a reply to an earlier question cannot undo that silence. Returns false
    /// when the reply was dropped as belonging to another session, to an older graph, or to a
    /// question older than the one that settled what is held by its silence (or, for no answer, by
    /// any reply).
    @discardableResult
    public mutating func received(_ reply: TunnelAnswer?, ticket: Ticket) -> Bool {
        guard ticket.epoch == epoch else { return false }
        guard let reply else {
            guard ticket.question > settledBy else { return false }
            answer = nil
            silentSince = ticket.askedAt
            settledBy = ticket.question
            return true
        }
        if silentSince != nil, ticket.question < settledBy { return false }
        guard isNewer(reply) else { return false }
        take(reply)
        settledBy = max(settledBy, ticket.question)
        return true
    }

    /// The tunnel's own report from the shared status, read on the app's events, foreground and the
    /// confirmation's expiry. Taken only from the start that answered in this session and only when
    /// it is newer than what is held and than the last unanswered question. A stopped report (or a
    /// live one without a graph) confirms that no graph runs.
    @discardableResult
    public mutating func observed(_ report: TunnelReport?) -> Bool {
        guard let report, report.session == heardSession else { return false }
        if let silentSince, report.beatAt <= silentSince { return false }
        let word = TunnelAnswer(session: report.session, generation: report.generation,
                                routing: report.running ? report.routing : nil, since: report.since, at: report.beatAt)
        guard isNewer(word) else { return false }
        take(word)
        return true
    }

    /// The outcome of a mode or line switch may change the routes only when the tunnel's part of it
    /// is about what runs now: a reply to a switch asked in a session that has since ended, about an
    /// older graph than one heard since, or one a later unanswered question overtook, leaves the
    /// routes, the pending change and the put-back as they are. A reply about the graph already held
    /// (the tunnel's report of the same rebuild was read first) counts. A switch the tunnel was not
    /// asked about (`ticket` nil, or a save that failed first) always counts.
    public mutating func settle(_ report: RouteApplyReport, ticket: Ticket?) -> Bool {
        guard let ticket else { return true }
        switch report.outcome {
        case .saved, .notApplied("SAVE_FAILED", _): return true
        default: break
        }
        guard ticket.epoch == epoch else { return false }
        if received(report.answer, ticket: ticket) { return true }
        guard let reply = report.answer, let held = answer else { return false }
        return reply.session == held.session && reply.generation == held.generation
    }

    public func permits(_ report: RouteApplyReport, ticket: Ticket?) -> Bool {
        var copy = self
        return copy.settle(report, ticket: ticket)
    }

    private func isNewer(_ word: TunnelAnswer) -> Bool {
        guard let held = lastWord else { return true }
        if held.session == word.session {
            return word.generation > held.generation || (word.generation == held.generation && word.at > held.at)
        }
        if let a = held.since, let b = word.since, b < a { return false }
        return true
    }

    private mutating func take(_ word: TunnelAnswer) {
        answer = word
        lastWord = word
        heardSession = word.session
        heardGeneration = word.generation
        silentSince = nil
    }

    /// The answer while it still counts by the tunnel's clock.
    public func current(now: Date) -> TunnelAnswer? {
        guard let answer else { return nil }
        let age = now.timeIntervalSince(answer.at)
        // A clock that moved backwards (or an answer from the future) is not evidence of freshness.
        guard age >= -60, age <= StatusSnapshot.freshFor else { return nil }
        return answer
    }

    /// When what is held stops counting, whether or not any reply or report arrives by then.
    public var expiresAt: Date? { answer.map { $0.at.addingTimeInterval(StatusSnapshot.freshFor) } }

    public func confirmation(now: Date) -> RoutingConfirmation {
        guard let answer = current(now: now) else { return .unknown }
        return answer.routing.map(RoutingConfirmation.graph) ?? .noGraph
    }

    /// The confirmed graph exit checks may run against now; nil while none is confirmed.
    public func stamp(now: Date) -> GraphStamp? {
        guard let answer = current(now: now), answer.routing != nil else { return nil }
        return GraphStamp(epoch: epoch, session: answer.session, generation: answer.generation)
    }
}

/// One confirmed graph in one Network Extension session: what an exit check ran against. A heartbeat
/// of the same graph keeps it; a rebuild, a restart or a reconnect does not.
public struct GraphStamp: Equatable, Sendable {
    fileprivate let epoch: Int
    public let session: String
    public let generation: Int
}

/// The exit checks and the confirmed graph they ran against (nil: none was confirmed when they
/// started). Results for another graph certify nothing about the one confirmed now.
public struct ExitChecks: Equatable, Sendable {
    public var cloud: ExitProbe
    public var home: ExitProbe
    public var graph: GraphStamp?

    public init(cloud: ExitProbe = ExitProbe(), home: ExitProbe = ExitProbe(), graph: GraphStamp? = nil) {
        self.cloud = cloud
        self.home = home
        self.graph = graph
    }
}

/// What the app's screens show, resolved from Network Extension's status, the tunnel's word
/// (`ConfirmationTracker`, fed by its replies and by its own report in the shared status) and the
/// exit checks that ran against the confirmed graph. The app's note (`note`) carries the result to
/// the shared status, where `SharedStatus.reading` places it against the same report: Home and the
/// widgets, the control and the Live Activity say the same thing for the same facts.
public struct AppStatus: Equatable, Sendable {
    /// What the tunnel confirmed it runs; nil while Network Extension does not report the tunnel up
    /// (the saved choice is then only what the next start builds).
    public var routing: RoutingConfirmation?
    public var phase: Phase
    public var reason: String?
    /// The exit checks that ran against the graph confirmed now; unknown otherwise.
    public var cloud: ExitProbe
    public var home: ExitProbe
    /// The confirmed graph the exit checks have to run against; nil while none is confirmed.
    public var graph: GraphStamp?
    /// The tunnel start and graph the app last heard from in this session: the note is tied to them.
    public var session: String?
    public var generation: Int?

    /// `facts.routing`, `cloudProbe` and `homeProbe` are ignored: they come from `tracker` and `checks`.
    public static func resolve(_ facts: ConnectionFacts, checks: ExitChecks, tracker: ConfirmationTracker, now: Date) -> AppStatus {
        let up = facts.tunnel.isUp
        let routing = up ? tracker.confirmation(now: now) : nil
        let graph = up ? tracker.stamp(now: now) : nil
        let applies = graph != nil && checks.graph == graph
        var f = facts
        f.routing = routing ?? .unknown
        f.cloudProbe = applies ? checks.cloud : ExitProbe()
        f.homeProbe = applies ? checks.home : ExitProbe()
        let derived = ConnectionState.derive(f)
        let heard = up ? tracker.heard : nil
        return AppStatus(routing: routing, phase: derived.phase, reason: derived.reason, cloud: f.cloudProbe, home: f.homeProbe,
                         graph: graph, session: heard?.session, generation: heard?.generation)
    }

    /// The app's note for the shared status. `line` is the confirmed node and its display name (or
    /// the choice while the tunnel is down); nil while no graph is confirmed.
    public func note(line: (node: String, name: String)?, now: Date) -> AppNote {
        let state = AppNote.State(phase)
        return AppNote(state: state, reason: state == .off || state == .up ? nil : reason, session: session,
                       generation: generation, node: line?.node, exit: line?.name, writtenAt: now)
    }
}
