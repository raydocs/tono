import XCTest
@testable import TonoKit

/// The cross-platform state-intent rule on iOS: the user's explicit intent (switched off, signed out)
/// is never turned into "connection dropped" by a tunnel report that arrives after it, and a session
/// that came back up clears what stopped the one before. Each row plays one scenario through the
/// app's ledger (`TunnelIntentLedger` → `ConnectionState.derive`, what the app shows) and the shared
/// status (`SharedStatus.reading`, what the widgets, the control and the Live Activity show).
/// Whether a superseded start can still reach the system is `TunnelStartCoordinatorTests`.
final class StateIntentTests: XCTestCase {
    private enum Step {
        /// The user switched on; the start reaches the system.
        case connect
        /// The user switched on; a later switch superseded the start before it reached the system.
        case connectSuperseded
        case disconnect
        case signOut, signedOut
        /// Network Extension's status.
        case ne(TunnelStatus)
        /// The tunnel process records a failure in the App Group.
        case tunnelFails(String)
        /// The tunnel writes its report: session, running, failure on file.
        case report(session: String, running: Bool)
        case foreground
    }

    private struct Row {
        let name: String
        let steps: [Step]
        let app: Phase
        let widget: StatusSnapshot.State
    }

    private let rows: [Row] = [
        Row(name: "user disconnect: sing-box reports its stop after the user switched off",
            steps: [.connect, .ne(.connecting), .ne(.connected), .report(session: "s1", running: true),
                    .disconnect, .ne(.disconnecting), .ne(.disconnected),
                    .tunnelFails("CORE_STOPPED"), .report(session: "s1", running: false), .foreground],
            app: .idle, widget: .off),
        Row(name: "user disconnect from the widget, app not in the foreground: the late report stays behind the off note",
            steps: [.connect, .ne(.connecting), .ne(.connected), .report(session: "s1", running: true),
                    .disconnect, .ne(.disconnecting), .ne(.disconnected),
                    .tunnelFails("CORE_STOPPED"), .report(session: "s1", running: false)],
            app: .idle, widget: .off),
        Row(name: "sign-out while connected: the stopping tunnel writes after the signed-out note",
            steps: [.connect, .ne(.connected), .report(session: "s1", running: true),
                    .signOut, .ne(.disconnected), .report(session: "s1", running: false), .signedOut],
            app: .signedOut, widget: .signedOut),
        Row(name: "core crash: the tunnel stopped on its own",
            steps: [.connect, .ne(.connected), .report(session: "s1", running: true),
                    .tunnelFails("CORE_STOPPED"), .report(session: "s1", running: false), .ne(.disconnected)],
            app: .failed, widget: .failed),
        Row(name: "jetsam then On Demand recovery, then the user switches off",
            steps: [.connect, .ne(.connected), .report(session: "s1", running: true),
                    .ne(.disconnected), .ne(.connecting), .ne(.connected), .report(session: "s2", running: true),
                    .disconnect, .ne(.disconnecting), .ne(.disconnected), .report(session: "s2", running: false)],
            app: .idle, widget: .off),
        Row(name: "jetsam then On Demand recovery: up again with nothing stale",
            steps: [.connect, .ne(.connected), .report(session: "s1", running: true),
                    .ne(.disconnected), .ne(.connecting), .ne(.connected), .report(session: "s2", running: true)],
            app: .connected, widget: .on),
        Row(name: "after a user disconnect, a start from Control Center or Settings fails before connecting",
            steps: [.connect, .ne(.connected), .report(session: "s1", running: true),
                    .disconnect, .ne(.disconnecting), .ne(.disconnected),
                    .ne(.connecting), .tunnelFails("CORE_START"), .report(session: "s2", running: false), .ne(.disconnected)],
            app: .failed, widget: .failed),
        Row(name: "cancel before the start reached the system",
            steps: [.connectSuperseded, .disconnect, .ne(.disconnected)],
            app: .idle, widget: .off),
    ]

    func testEveryScenarioShowsTheUsersIntentOrTheRealFailure() {
        for row in rows {
            let (app, widget) = play(row.steps)
            XCTAssertEqual(app, row.app, "app: \(row.name)")
            XCTAssertEqual(widget, row.widget, "widget: \(row.name)")
        }
    }

    /// Plays `steps` on a fixed clock, one second apart. The app writes its note when its phase or
    /// reason changes (and on foreground), as `AppModel.publishStatus` does.
    private func play(_ steps: [Step]) -> (Phase, StatusSnapshot.State?) {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let graph = RouteSettings(mode: .threeTier, node: "tokyo-1")
        var ledger = TunnelIntentLedger()
        var signedIn = true
        var tunnel = TunnelStatus.disconnected
        var recorded: String?
        var shared = SharedStatus()
        var opened: [String: Date] = [:]
        var generation = 0
        var shown: (Phase, String?)?
        var now = t0

        func phase() -> (Phase, String?) {
            let up = tunnel == .connected
            let facts = ConnectionFacts(signedIn: signedIn, tunnel: tunnel, cloudProbe: ExitProbe(state: up ? .ok : .unknown),
                                        homeProbe: ExitProbe(state: up ? .ok : .unknown), failure: ledger.failure,
                                        routing: up ? .graph(graph) : .unknown)
            return ConnectionState.derive(facts)
        }
        func publish(force: Bool = false) {
            let next = phase()
            guard force || shown.map({ $0 != next }) ?? true else { return }
            shown = next
            let note = AppNote(next.0, reason: next.1, answer: nil, line: nil, now: now)
            shared = shared.writingApp(note) ?? shared
        }

        for step in steps {
            now = now.addingTimeInterval(1)
            switch step {
            case .connect:
                ledger.userWantsOn()
                recorded = nil
                ledger.starting()
            case .connectSuperseded:
                ledger.userWantsOn()
                ledger.starting()
                ledger.startEnded()
            case .disconnect:
                ledger.userStops(tunnel: tunnel)
            case .signOut:
                signedIn = false
                ledger.signingOut()
            case .signedOut:
                recorded = nil
                ledger.signedOut()
            case .ne(let status):
                let before = tunnel
                tunnel = status
                let down = status == .disconnected || status == .invalid
                ledger.tunnel(status, before: before, recordedFailure: down ? recorded : nil)
                // A new tunnel start clears the file (`PacketTunnelProvider.startTunnel`).
                if status == .connecting { recorded = nil }
            case .tunnelFails(let code):
                recorded = code
            case .report(let session, let running):
                if opened[session] == nil { opened[session] = now }
                generation += 1
                let report = TunnelReport(session: session, opened: opened[session]!, generation: generation, running: running,
                                          routing: running ? graph : nil, since: opened[session], failure: running ? nil : recorded,
                                          beatAt: now, catalog: "catalog-a")
                shared = shared.writingTunnel(report) ?? shared
                continue
            case .foreground:
                ledger.foreground(tunnel: tunnel, recordedFailure: recorded)
                publish(force: true)
                continue
            }
            publish()
        }
        return (phase().0, shared.reading(now: now).snapshot?.state)
    }
}
