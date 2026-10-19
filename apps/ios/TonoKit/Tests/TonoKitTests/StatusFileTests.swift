import Foundation
import XCTest
@testable import TonoKit

/// The shared status file on a real disk, written by an "app" and a "tunnel" the way the two
/// processes do: the tunnel's newer word on routing is not overwritten by an app that has not heard
/// it, in either direction, and a write that read before the other wrote waits for it.
final class StatusFileTests: XCTestCase {
    private var dir: URL!
    private var file: StatusFile!
    private let t0 = Date()

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("tono-status-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        file = StatusFile(url: dir.appendingPathComponent("status.json"))
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    private func appWrites(_ phase: Phase, reason: String? = nil, knownAt: Date?, now: Date) {
        let app = StatusSnapshot.fromApp(phase, reason: reason, exit: "Tokyo · Dawn", since: t0, now: now)
        file.update { StatusSnapshot.admitFromApp(app, knownAt: knownAt, over: $0, now: now) }
    }

    private func tunnelBeats(routing: Bool, now: Date) {
        file.update { StatusSnapshot.fromTunnel(running: true, routing: routing, since: self.t0, failure: nil, previous: $0, now: now) }
    }

    /// The app comes to the foreground with the phase it had before the graph stopped and publishes
    /// it before it asks the tunnel: the heartbeat's ROUTES_STOPPED stays. Once the app has asked
    /// (and still says connected, because the tunnel answered with a graph) it writes again.
    func testForegroundAppWithOlderKnowledgeDoesNotHideRoutesStopped() {
        appWrites(.connected, knownAt: t0, now: t0)
        tunnelBeats(routing: false, now: t0.addingTimeInterval(300))
        appWrites(.connected, knownAt: t0, now: t0.addingTimeInterval(301))
        XCTAssertEqual(file.load()?.reason, "ROUTES_STOPPED")
        XCTAssertEqual(file.load()?.writer, .tunnel)

        appWrites(.connected, knownAt: t0.addingTimeInterval(302), now: t0.addingTimeInterval(302))
        XCTAssertEqual(file.load()?.state, .on)
        XCTAssertEqual(file.load()?.writer, .app)
    }

    /// The other direction: the app learnt ROUTES_STOPPED, then the tunnel's graph came back and its
    /// heartbeat said on. A later app write from the old knowledge does not turn it back to failed.
    func testAppRoutesStoppedFromOlderKnowledgeDoesNotHideARestoredGraph() {
        appWrites(.failed, reason: "ROUTES_STOPPED", knownAt: t0, now: t0)
        tunnelBeats(routing: true, now: t0.addingTimeInterval(300))
        XCTAssertEqual(file.load()?.state, .on)
        appWrites(.failed, reason: "ROUTES_STOPPED", knownAt: t0, now: t0.addingTimeInterval(301))
        XCTAssertEqual(file.load()?.state, .on)
        XCTAssertEqual(file.load()?.writer, .tunnel)
    }

    /// Two threads, each with its own descriptor (as two processes have): the app reads the file
    /// while it still says on, and the tunnel's ROUTES_STOPPED lands while the app decides. Without
    /// the lock the app's write overwrites it with on.
    func testAppDecidingWhileTheTunnelWritesDoesNotOverwriteIt() {
        tunnelBeats(routing: true, now: t0)
        let appRead = DispatchSemaphore(value: 0)
        let done = DispatchGroup()
        let app = StatusSnapshot.fromApp(.connected, reason: nil, exit: "Tokyo · Dawn", since: t0, now: t0.addingTimeInterval(301))
        DispatchQueue.global().async(group: done) {
            self.file.update { current in
                appRead.signal()
                Thread.sleep(forTimeInterval: 0.4)
                return StatusSnapshot.admitFromApp(app, knownAt: self.t0, over: current, now: self.t0.addingTimeInterval(301))
            }
        }
        appRead.wait()
        DispatchQueue.global().async(group: done) { self.tunnelBeats(routing: false, now: self.t0.addingTimeInterval(300)) }
        XCTAssertEqual(done.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(file.load()?.reason, "ROUTES_STOPPED")
    }

    /// Another process holding the lock (python3 `fcntl.flock`, as the packet tunnel would) makes
    /// the write wait until it lets go.
    func testWriteWaitsWhileAnotherProcessHoldsTheLock() throws {
        let holder = Process()
        holder.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        holder.arguments = ["python3", "-c", """
            import fcntl, sys, time
            f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); print("locked", flush=True); time.sleep(0.8)
            """, file.lockURL.path]
        let out = Pipe()
        holder.standardOutput = out
        try holder.run()
        defer { holder.waitUntilExit() }
        XCTAssertEqual(String(decoding: out.fileHandleForReading.availableData, as: UTF8.self), "locked\n")
        let started = Date()
        tunnelBeats(routing: false, now: t0)
        XCTAssertGreaterThan(Date().timeIntervalSince(started), 0.5, "wrote while another process held the lock")
        XCTAssertEqual(file.load()?.reason, "ROUTES_STOPPED")
    }
}
