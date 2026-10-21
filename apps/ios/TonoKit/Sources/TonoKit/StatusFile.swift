import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// The shared status file the app and the packet tunnel both write, each its own part
/// (`SharedStatus`). Each write reads what is on disk, decides and writes under one `flock` on a
/// sibling lock file, so a writer that read before the other wrote cannot overwrite the other's
/// part blind (two processes, or two threads of one).
public struct StatusFile: Sendable {
    public let url: URL
    private let options: Data.WritingOptions
    /// Called when the lock is held elsewhere, just before this write waits for it (tests use it as
    /// the barrier that proves a write waited, instead of timing it).
    private let contended: (@Sendable () -> Void)?

    /// `options` adds file protection on iOS; the write is always atomic.
    public init(url: URL, options: Data.WritingOptions = []) {
        self.init(url: url, options: options, contended: nil)
    }

    init(url: URL, options: Data.WritingOptions = [], contended: (@Sendable () -> Void)?) {
        self.url = url
        self.options = options.union(.atomic)
        self.contended = contended
    }

    public var lockURL: URL { url.deletingPathExtension().appendingPathExtension("lock") }

    public func load() -> SharedStatus? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return SharedStatus.decode(data)
    }

    /// `next` gets what is on disk now and returns what to write, or nil to leave it. Returns
    /// whether it wrote. Without the lock file (no App Group) nothing is written.
    @discardableResult
    public func update(_ next: (SharedStatus?) -> SharedStatus?) -> Bool {
        locked {
            let current = load()
            guard let status = next(current), status != current else { return false }
            return (try? status.encoded().write(to: url, options: options)) != nil
        } ?? false
    }

    public func clear() {
        _ = locked { try? FileManager.default.removeItem(at: url) }
    }

    private func locked<T>(_ body: () -> T) -> T? {
        let fd = open(lockURL.path, O_RDWR | O_CREAT, 0o644)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else { return nil }
            contended?()
            while flock(fd, LOCK_EX) != 0 {
                guard errno == EINTR else { return nil }
            }
        }
        defer { flock(fd, LOCK_UN) }
        return body()
    }
}
