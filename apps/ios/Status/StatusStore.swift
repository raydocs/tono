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

    /// The file, read and written under the lock `StatusFile` shares between the processes.
    static var file: StatusFile? {
        // Readable after first unlock, so a Lock Screen widget can read it on a locked phone.
        url.map { StatusFile(url: $0, options: .completeFileProtectionUntilFirstUserAuthentication) }
    }

    static func load() -> StatusSnapshot? { file?.load() }

    static func reading(now: Date = Date()) -> StatusReading { StatusReading.read(load(), now: now) }

    /// `next` gets what is on disk and returns what to write (nil: leave it); written only when it
    /// says something new or the last write is a minute old. Returns whether it wrote.
    @discardableResult
    static func update(_ next: (StatusSnapshot?) -> StatusSnapshot?) -> Bool { file?.update(next) ?? false }

    static func clear() { file?.clear() }
}
