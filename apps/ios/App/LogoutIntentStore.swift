import Foundation

@MainActor
protocol LogoutIntentStoring: AnyObject {
    var processBlocked: Bool { get set }
    func isPending() throws -> Bool
    func mark() throws
    func clear() throws
}

/// Non-secret write-ahead logout intent. App-private, not App Group or Keychain:
/// a locked/unavailable Keychain must not prevent remembering a completed logout.
@MainActor
final class LogoutIntentStore: LogoutIntentStoring {
    let directory: URL
    // Survives client/store recreation, NOT process termination. If both durable
    // stores fail, callers must report incomplete cleanup rather than promise logout.
    private static var blockedFiles: Set<URL> = []

    init(directory: URL = URL.applicationSupportDirectory.appending(path: "Account", directoryHint: .isDirectory)) {
        self.directory = directory.standardizedFileURL
    }

    private var file: URL { directory.appending(path: "logout-pending") }

    var processBlocked: Bool {
        get { Self.blockedFiles.contains(file) }
        set {
            if newValue { Self.blockedFiles.insert(file) }
            else { Self.blockedFiles.remove(file) }
        }
    }

    func isPending() throws -> Bool {
        do {
            _ = try Data(contentsOf: file)
            return true // even an unfamiliar marker blocks restoration
        } catch CocoaError.fileReadNoSuchFile {
            return false
        } catch { throw Blocker.keychainUnavailable }
    }

    func mark() throws {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data([1]).write(to: file, options: .atomic)
        } catch { throw Blocker.keychainUnavailable }
    }

    func clear() throws {
        do { try FileManager.default.removeItem(at: file) }
        catch CocoaError.fileNoSuchFile { return }
        catch { throw Blocker.keychainUnavailable }
    }
}
