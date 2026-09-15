import Foundation

/// Non-secret write-ahead logout intent. App-private, not App Group or Keychain:
/// a locked/unavailable Keychain must not prevent remembering a completed logout.
struct LogoutIntentStore {
    let directory: URL

    init(directory: URL = URL.applicationSupportDirectory.appending(path: "Account", directoryHint: .isDirectory)) {
        self.directory = directory
    }

    private var file: URL { directory.appending(path: "logout-pending") }

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
