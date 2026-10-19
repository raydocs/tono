import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
import XCTest
@testable import TonoKit

/// The shared status file on a real disk, written by an "app" and a "tunnel" the way the two
/// processes do: each writes only its own part, the tunnel's newer word on routing is not hidden by
/// an app that has not heard it, and a write that read before the other wrote waits for it.
final class StatusFileTests: XCTestCase {
    private var dir: URL!
    private var file: StatusFile!
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("tono-status-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        file = StatusFile(url: dir.appendingPathComponent("status.json"))
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    /// The app's note about graph 1 of session s1, written at `now`.
    private func appNote(_ phase: Phase, now: Date) -> AppNote {
        let heard = TunnelAnswer(session: "s1", generation: 1, routing: RouteSettings(mode: .threeTier, node: "tokyo-1"), since: t0, at: t0)
        return AppNote(phase, reason: nil, answer: heard, line: (node: "tokyo-1", name: "Tokyo · Dawn"), now: now)
    }

    private func appWrites(_ phase: Phase, now: Date) {
        let note = appNote(phase, now: now)
        file.update { ($0 ?? SharedStatus()).writingApp(note) }
    }

    /// The tunnel's heartbeat for graph `generation` of session s1.
    private func tunnelReport(routing: Bool, generation: Int, now: Date) -> TunnelReport {
        TunnelReport(session: "s1", opened: t0, generation: generation, running: true,
                     routing: routing ? RouteSettings(mode: .threeTier, node: "tokyo-1") : nil, since: t0, failure: nil, beatAt: now)
    }

    private func tunnelBeats(routing: Bool, generation: Int = 2, now: Date) {
        let report = tunnelReport(routing: routing, generation: generation, now: now)
        file.update { ($0 ?? SharedStatus()).writingTunnel(report) }
    }

    /// The app comes to the foreground with the phase it had before the graph stopped and publishes
    /// it before it asks the tunnel: the heartbeat's ROUTES_STOPPED stays, and so does the tunnel's
    /// own record beside the app's note.
    func testForegroundAppWithOlderKnowledgeDoesNotHideRoutesStopped() {
        appWrites(.connected, now: t0)
        tunnelBeats(routing: false, now: t0.addingTimeInterval(300))
        appWrites(.connected, now: t0.addingTimeInterval(301))
        let reading = file.load()?.reading(now: t0.addingTimeInterval(302))
        XCTAssertEqual(reading?.snapshot?.reason, "ROUTES_STOPPED")
        XCTAssertEqual(reading?.snapshot?.writer, .tunnel)
        XCTAssertEqual(file.load()?.app?.writtenAt, t0.addingTimeInterval(301))
    }

    /// Two threads, each with its own descriptor (as two processes have). The app has read the file
    /// while it still says on; the tunnel's ROUTES_STOPPED write then finds the lock held and waits
    /// (`contended` is the barrier, not a timer) before the app decides and writes. Without the lock
    /// the app's write would overwrite it with on.
    func testAppDecidingWhileTheTunnelWritesDoesNotOverwriteIt() {
        tunnelBeats(routing: true, generation: 1, now: t0)
        let appRead = DispatchSemaphore(value: 0)
        let tunnelWaiting = DispatchSemaphore(value: 0)
        let done = DispatchGroup()
        let note = appNote(.connected, now: t0.addingTimeInterval(301))
        let report = tunnelReport(routing: false, generation: 2, now: t0.addingTimeInterval(300))
        let tunnelFile = StatusFile(url: file.url, contended: { tunnelWaiting.signal() })
        DispatchQueue.global().async(group: done) {
            self.file.update { current in
                appRead.signal()
                // The test fails (rather than hangs) if the tunnel's write never meets the held lock.
                guard tunnelWaiting.wait(timeout: .now() + 30) == .success else { return nil }
                return (current ?? SharedStatus()).writingApp(note)
            }
        }
        appRead.wait()
        DispatchQueue.global().async(group: done) { tunnelFile.update { ($0 ?? SharedStatus()).writingTunnel(report) } }
        XCTAssertEqual(done.wait(timeout: .now() + 60), .success)
        XCTAssertEqual(file.load()?.reading(now: t0.addingTimeInterval(302)).snapshot?.reason, "ROUTES_STOPPED")
        XCTAssertEqual(file.load()?.app, note)
    }

    /// Another process holding the lock (python3 `fcntl.flock`, as the packet tunnel would) makes the
    /// write wait until it lets go. The holder says when it holds and lets go only when told (stdin /
    /// stdout); a non-blocking attempt proves the lock is held across processes, and the write is
    /// seen meeting it and still not done, before the holder is told to release.
    func testWriteWaitsWhileAnotherProcessHoldsTheLock() throws {
        let holder = Process()
        holder.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        holder.arguments = ["python3", "-I", "-c", """
            import fcntl, sys
            f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); print("locked", flush=True)
            sys.stdin.readline()
            fcntl.flock(f, fcntl.LOCK_UN); print("released", flush=True)
            """, file.lockURL.path]
        let out = Pipe(), input = Pipe()
        holder.standardOutput = out
        holder.standardInput = input
        try holder.run()
        defer {
            try? input.fileHandleForWriting.close()
            holder.waitUntilExit()
        }
        XCTAssertEqual(Self.line(out.fileHandleForReading), "locked")

        let probe = open(file.lockURL.path, O_RDWR)
        XCTAssertGreaterThanOrEqual(probe, 0)
        let attempt = flock(probe, LOCK_EX | LOCK_NB), reason = errno
        close(probe)
        XCTAssertEqual(attempt, -1)
        XCTAssertEqual(reason, EWOULDBLOCK)

        let waiting = DispatchSemaphore(value: 0), wrote = DispatchSemaphore(value: 0)
        let tunnelFile = StatusFile(url: file.url, contended: { waiting.signal() })
        let report = tunnelReport(routing: false, generation: 2, now: t0)
        DispatchQueue.global().async {
            tunnelFile.update { ($0 ?? SharedStatus()).writingTunnel(report) }
            wrote.signal()
        }
        XCTAssertEqual(waiting.wait(timeout: .now() + 30), .success, "the write never met the held lock")
        XCTAssertEqual(wrote.wait(timeout: .now()), .timedOut, "wrote while another process held the lock")
        XCTAssertNil(file.load())

        input.fileHandleForWriting.write(Data("release\n".utf8))
        XCTAssertEqual(Self.line(out.fileHandleForReading), "released")
        XCTAssertEqual(wrote.wait(timeout: .now() + 30), .success)
        XCTAssertEqual(file.load()?.reading(now: t0).snapshot?.reason, "ROUTES_STOPPED")
    }

    /// One line from the holder, read byte by byte (blocking: the holder writes it when it acts).
    private static func line(_ handle: FileHandle) -> String {
        var bytes: [UInt8] = []
        while true {
            let chunk = handle.readData(ofLength: 1)
            guard let byte = chunk.first, byte != UInt8(ascii: "\n") else { break }
            bytes.append(byte)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
