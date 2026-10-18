import Foundation
import TonoKit

/// The shared connection status in the App Group (`StatusSnapshot`), for the app, the packet
/// tunnel and the widget extension. Unlike `SharedFiles` this never traps: a process without the
/// App Group (an unsigned simulator build) simply reads "unavailable" and writes nothing.
enum StatusStore {
    static var appGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "TonoAppGroup") as? String ?? "group.com.raydocs.tono.ios"
    }

    static var url: URL? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = container.appendingPathComponent("Tono", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("status.json")
    }

    static func load() -> StatusSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return StatusSnapshot.decode(data)
    }

    static func reading(now: Date = Date()) -> StatusReading { StatusReading.read(load(), now: now) }

    /// Writes the snapshot when it says something new (state, line, session, reason) or the last one
    /// is at least a minute old; returns whether it wrote.
    @discardableResult
    static func save(_ snapshot: StatusSnapshot) -> Bool {
        guard let url else { return false }
        if let old = load(), old.state == snapshot.state, old.exit == snapshot.exit, old.since == snapshot.since,
           old.reason == snapshot.reason, snapshot.updatedAt.timeIntervalSince(old.updatedAt) < 60 {
            return false
        }
        // Readable after first unlock, so a Lock Screen widget can read it on a locked phone.
        return (try? snapshot.encoded().write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
