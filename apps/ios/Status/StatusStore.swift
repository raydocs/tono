import Foundation
import TonoKit

/// The shared connection status in the App Group (`SharedStatus`: the tunnel's report and the
/// app's note), for the app, the packet tunnel and the widget extension. Unlike `SharedFiles` this never traps: a process without the
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

    static func load() -> SharedStatus? { file?.load() }

    /// The one reading every surface states (`SharedStatus.reading`).
    static func reading(now: Date = Date()) -> StatusReading { load()?.reading(now: now) ?? .unavailable }

    /// `next` gets what is on disk and returns what to write (nil: leave it); written only when it
    /// differs. Returns whether it wrote.
    @discardableResult
    static func update(_ next: (SharedStatus?) -> SharedStatus?) -> Bool { file?.update(next) ?? false }

    static func clear() { file?.clear() }
}
