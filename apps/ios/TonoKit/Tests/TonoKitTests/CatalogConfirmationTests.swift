import XCTest
@testable import TonoKit

/// Which catalog explains the routes in use: the one the running tunnel says it built (by digest),
/// never a newer download with the same mode and line. C1 has no Home (AI leaves through the cloud
/// line); C2 assigns a residential Home to the same line. Fixed clock, no libbox.
final class CatalogConfirmationTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let tokyo = RouteSettings(mode: .threeTier, node: "Tokyo · Dawn")
    private let c1Body = SampleCatalog.body(routing: nil).serialized()
    private let c2Body = SampleCatalog.body().serialized()
    private struct StartRefused: Error {}

    private func loaded(_ body: String) throws -> LoadedCatalog {
        LoadedCatalog(catalog: try CatalogAdmission.admit(JSON.parse(body)), body: body, fromCache: false)
    }

    private func inputs(_ body: String) -> TunnelInputs {
        TunnelInputs(catalogBody: body, mode: tokyo.mode, selectedNode: tokyo.node)
    }

    private func resolve(_ tracker: ConfirmationTracker, checks: ExitChecks = ExitChecks(), now: Date) -> AppStatus {
        AppStatus.resolve(ConnectionFacts(signedIn: true, tunnel: .connected), checks: checks, tracker: tracker, now: now)
    }

    private func aiRoute(_ catalog: LoadedCatalog?) -> RouteLabel? {
        guard let catalog else { return nil }
        let config = SingBoxConfig.build(ConfigInput(catalog: catalog.catalog, selectedCloudNode: tokyo.node, mode: tokyo.mode,
                                                     underlyingIPv6: true, cacheFilePath: nil))
        return RouteExplainer.answer(config: config, catalog: catalog.catalog, host: "claude.ai")?.tcp
    }

    func testASameModeAndLineCatalogWithHomeExplainsNothingUntilTheTunnelBuildsItAndSaysSo() throws {
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(inputs(c1Body), build: { $0.catalogBody }, start: { _ in })
        var tracker = ConfirmationTracker()
        // The tunnel's status reply, over the wire.
        let said = Data(JSON.obj(("running", tokyo.json), ("tunnel", graph.answer(since: t0, now: t0).json)).serialized().utf8)
        tracker.received(TunnelAnswer.decode(said), ticket: tracker.ask(at: t0))
        let c1Checks = ExitChecks(cloud: ExitProbe(state: .ok, location: "JP"), home: ExitProbe(state: .ok, location: "JP"),
                                  graph: tracker.stamp(now: t0))

        // The app had C1, then downloads C2 while C1 still runs.
        var ledger = CatalogLedger()
        ledger.admit(try loaded(c1Body))
        ledger.admit(try loaded(c2Body))
        XCTAssertEqual(ledger.admitted?.body, c2Body)
        let before = resolve(tracker, checks: c1Checks, now: t0.addingTimeInterval(1))
        XCTAssertEqual(before.routing, .graph(tokyo))
        XCTAssertEqual(before.catalog, TunnelInputs.catalogDigest(c1Body))
        XCTAssertNil(ledger.explaining(before)?.catalog.home)
        XCTAssertEqual(aiRoute(ledger.explaining(before)), .cloud)

        // A relaunched app that only has C2: same mode and line, but nothing to explain them from.
        var relaunched = CatalogLedger()
        relaunched.admit(try loaded(c2Body))
        XCTAssertNil(relaunched.explaining(before))
        XCTAssertNotNil(relaunched.explaining(routing: nil, catalog: nil), "C2 stays admitted for the next start")

        // The tunnel builds C2 and says so: now C2 explains, and C1's checks certify nothing about it.
        var file = inputs(c2Body)
        let reply = graph.reload(load: { file }, build: { $0.catalogBody }, start: { _ in }, persist: { file = $0 })
        XCTAssertEqual(reply, .applied(tokyo))
        tracker.received(TunnelAnswer.decode(reply.encoded(answer: graph.answer(since: t0, now: t0.addingTimeInterval(2)))),
                         ticket: tracker.ask(at: t0.addingTimeInterval(2)))
        let after = resolve(tracker, checks: c1Checks, now: t0.addingTimeInterval(3))
        XCTAssertEqual(after.routing, .graph(tokyo))
        XCTAssertEqual(after.catalog, TunnelInputs.catalogDigest(c2Body))
        XCTAssertEqual(ledger.explaining(after)?.catalog.home, SampleCatalog.catalog().home)
        XCTAssertEqual(aiRoute(ledger.explaining(after)), .home)
        XCTAssertEqual(after.home, ExitProbe())
        XCTAssertNotEqual(after.graph, c1Checks.graph)
    }

    func testAnAnswerOrReportWithoutACatalogDigestExplainsNothingWhileTheTunnelIsUp() throws {
        // A tunnel build from before the field: its stamp has no `catalogDigest`.
        let legacy = JSON.obj(("session", .string("s1")), ("generation", .int(1)), ("routing", tokyo.json), ("since", .number(t0.timeIntervalSince1970)),
                              ("at", .number(t0.timeIntervalSince1970)))
        let answer = try XCTUnwrap(TunnelAnswer.decode(Data(JSON.obj(("tunnel", legacy)).serialized().utf8)))
        XCTAssertNil(answer.catalog)
        var tracker = ConfirmationTracker()
        tracker.received(answer, ticket: tracker.ask(at: t0))
        var ledger = CatalogLedger()
        ledger.admit(try loaded(c1Body))
        let status = resolve(tracker, now: t0.addingTimeInterval(1))
        XCTAssertEqual(status.routing, .graph(tokyo))
        XCTAssertNil(status.catalog)
        XCTAssertNil(ledger.explaining(status), "even the catalog that may well run is not assumed")

        // The same in the shared status file: it reads, with no digest, and the app note names no line.
        let file = JSON.obj(("version", .int(SharedStatus.version)),
                            ("tunnel", JSON.obj(("session", .string("s1")), ("opened", .number(t0.timeIntervalSince1970)), ("generation", .int(1)),
                                                ("running", .bool(true)), ("routing", tokyo.json), ("since", .null), ("failure", .null),
                                                ("beatAt", .number(t0.timeIntervalSince1970)))))
        let shared = try XCTUnwrap(SharedStatus.decode(Data(file.serialized().utf8)))
        XCTAssertNil(shared.tunnel?.catalog)
        // A digest that is not a string makes the stamp unreadable, never "no catalog said".
        var bad = legacy.object ?? JSONObject()
        bad["catalogDigest"] = .int(1)
        XCTAssertNil(TunnelAnswer.decode(Data(JSON.obj(("tunnel", .object(bad))).serialized().utf8)))
    }

    func testTwoMissingCatalogIdentitiesNeverConfirmTheSharedExitName() {
        let report = TunnelReport(session: "s1", opened: t0, generation: 1, running: true,
                                  routing: tokyo, since: t0, failure: nil, beatAt: t0)
        let note = AppNote(state: .up, session: "s1", generation: 1, node: tokyo.node,
                           exit: "Tokyo", writtenAt: t0)
        XCTAssertNil(SharedStatus(tunnel: report, app: note).reading(now: t0).snapshot?.exit)
    }

    func testTheCatalogDigestRoundTripsThroughRepliesAndTheStatusFileAndNamesTheLineOnlyForItsCatalog() throws {
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(inputs(c1Body), build: { $0.catalogBody }, start: { _ in })
        let d1 = TunnelInputs.catalogDigest(c1Body)
        let answer = graph.answer(since: t0, now: t0)
        XCTAssertEqual(answer.catalog, d1)
        XCTAssertEqual(TunnelAnswer.decode(ReloadReply.applied(tokyo).encoded(answer: answer)), answer)

        let report = graph.report(process: true, since: t0, failure: nil, now: t0)
        XCTAssertEqual(report.catalog, d1)
        var tracker = ConfirmationTracker()
        tracker.received(answer, ticket: tracker.ask(at: t0))
        XCTAssertTrue(tracker.observed(graph.report(process: true, since: t0, failure: nil, now: t0.addingTimeInterval(300))))
        XCTAssertEqual(tracker.answer?.catalog, d1)
        XCTAssertEqual(tracker.stamp(now: t0.addingTimeInterval(301))?.catalog, d1)

        let ok = ExitProbe(state: .ok, location: "JP")
        let status = resolve(tracker, checks: ExitChecks(cloud: ok, home: ok, graph: tracker.stamp(now: t0.addingTimeInterval(301))),
                             now: t0.addingTimeInterval(301))
        XCTAssertEqual(status.phase, .connected)
        let note = status.note(line: (node: "Tokyo · Dawn", name: "Tokyo"), now: t0.addingTimeInterval(301))
        XCTAssertEqual(note.catalog, d1)
        let data = SharedStatus(tunnel: report, app: note).encoded()
        let shared = try XCTUnwrap(SharedStatus.decode(data))
        XCTAssertEqual(shared.tunnel, report)
        XCTAssertEqual(shared.app, note)
        XCTAssertEqual(shared.reading(now: t0.addingTimeInterval(302)).snapshot?.exit, "Tokyo")
        // The file the widgets read carries the digest only, never the catalog it names.
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains("catalogBody"))
        XCTAssertFalse(text.contains("reality"))

        // A name given from another catalog is not shown beside this graph, though the node matches.
        var other = note
        other.catalog = TunnelInputs.catalogDigest(c2Body)
        XCTAssertNil(SharedStatus(tunnel: report, app: other).reading(now: t0.addingTimeInterval(302)).snapshot?.exit)
    }

    func testARefusedRebuildKeepsTheRunningCatalogsIdentityAndAGraphLostToItNamesNone() throws {
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(inputs(c1Body), build: { $0.catalogBody }, start: { _ in })
        let d1 = TunnelInputs.catalogDigest(c1Body)
        var file = inputs(c2Body)

        // Admission of C2 fails before libbox is touched: C1 runs on, and says so.
        let refused = graph.reload(load: { file }, build: { if $0.catalogBody == self.c2Body { throw CatalogRejected("CATALOG", "bad") }; return $0.catalogBody },
                                   start: { _ in }, persist: { file = $0 })
        XCTAssertEqual(refused, .refused(code: "CATALOG", running: tokyo))
        XCTAssertEqual(graph.answer(since: t0, now: t0).catalog, d1)
        XCTAssertEqual(file, inputs(c1Body))

        // libbox refuses C2 after closing C1; C1 is brought back under its own identity.
        file = inputs(c2Body)
        let restored = graph.reload(load: { file }, build: { $0.catalogBody },
                                    start: { if $0 == self.c2Body { throw StartRefused() } }, persist: { file = $0 })
        XCTAssertEqual(restored, .refused(code: "CORE_START", running: tokyo))
        XCTAssertEqual(graph.answer(since: t0, now: t0).catalog, d1)
        XCTAssertEqual(graph.report(process: true, since: t0, failure: nil, now: t0).catalog, d1)

        // Neither starts: no graph, so no catalog is named for it.
        file = inputs(c2Body)
        _ = graph.reload(load: { file }, build: { $0.catalogBody }, start: { _ in throw StartRefused() }, persist: { file = $0 })
        XCTAssertNil(graph.answer(since: t0, now: t0).catalog)
        XCTAssertNil(graph.report(process: true, since: t0, failure: nil, now: t0).catalog)
        XCTAssertEqual(graph.catalogDigest, d1, "kept for the restore, never stated while nothing runs")
    }
}
