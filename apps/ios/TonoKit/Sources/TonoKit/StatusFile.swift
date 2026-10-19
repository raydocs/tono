import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// The shared status file the app and the packet tunnel both write. Each write reads what is on
/// disk, decides and writes under one `flock` on a sibling lock file, so a writer that read before
/// the other wrote cannot overwrite it blind (two processes, or two threads of one).
public struct StatusFile: Sendable {
    public let url: URL
    private let options: Data.WritingOptions

    /// `options` adds file protection on iOS; the write is always atomic.
    public init(url: URL, options: Data.WritingOptions = []) {
        self.url = url
        self.options = options.union(.atomic)
    }

    public var lockURL: URL { url.deletingPathExtension().appendingPathExtension("lock") }

    public func load() -> StatusSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return StatusSnapshot.decode(data)
    }

    /// `next` gets what is on disk now and returns what to write, or nil to leave it. Returns
    /// whether it wrote. Without the lock file (no App Group) nothing is written.
    @discardableResult
    public func update(_ next: (StatusSnapshot?) -> StatusSnapshot?) -> Bool {
        locked {
            let current = load()
            guard let snapshot = next(current), StatusSnapshot.worthWriting(snapshot, over: current) else { return false }
            return (try? snapshot.encoded().write(to: url, options: options)) != nil
        } ?? false
    }

    public func clear() {
        _ = locked { try? FileManager.default.removeItem(at: url) }
    }

    private func locked<T>(_ body: () -> T) -> T? {
        let fd = open(lockURL.path, O_RDWR | O_CREAT, 0o644)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        while flock(fd, LOCK_EX) != 0 {
            guard errno == EINTR else { return nil }
        }
        defer { flock(fd, LOCK_UN) }
        return body()
    }
}

extension StatusSnapshot {
    /// Something new (state, line, session, reason), or the last write is a minute old.
    public static func worthWriting(_ snapshot: StatusSnapshot, over old: StatusSnapshot?) -> Bool {
        guard let old else { return true }
        return !(old.state == snapshot.state && old.exit == snapshot.exit && old.since == snapshot.since
                 && old.reason == snapshot.reason && snapshot.updatedAt.timeIntervalSince(old.updatedAt) < 60)
    }

    /// Whether the graph runs, as this snapshot claims it: nil when it makes no claim about routing.
    var claimsRouting: Bool? {
        if state == .failed, reason == "ROUTES_STOPPED" { return false }
        return state.switchOn ? true : nil
    }

    /// The app's write, unless the tunnel has since said otherwise about routing. The tunnel is the
    /// one that knows whether a graph runs; `knownAt` is when the app last heard that from it. A
    /// fresh tunnel write newer than that, which contradicts the app (the app says connected, the
    /// tunnel ROUTES_STOPPED, or the other way round), is kept: nil means "do not write".
    public static func admitFromApp(_ app: StatusSnapshot, knownAt: Date?, over current: StatusSnapshot?,
                                    now: Date) -> StatusSnapshot? {
        guard let current, current.writer == .tunnel, case .fresh = StatusReading.read(current, now: now),
              current.updatedAt > (knownAt ?? .distantPast),
              let tunnelSays = current.claimsRouting, let appSays = app.claimsRouting, tunnelSays != appSays else { return app }
        return nil
    }
}
