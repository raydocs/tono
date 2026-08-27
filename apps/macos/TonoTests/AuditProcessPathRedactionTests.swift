import XCTest
@testable import Tono

/// `process_path` is the only audit field that is an absolute path, and the
/// audit file is what the diagnostics log upload drains. Recorded verbatim it
/// carries the account's short name off the device on every connection a named
/// process opens, which is the one identifier the rest of the record is written
/// to avoid.
final class AuditProcessPathRedactionTests: XCTestCase {
    func testTheOwnerGoesAndTheRestOfThePathStays() {
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath(
                "/Users/marlowe/Applications/Claude.app/Contents/MacOS/Claude"
            ),
            "/Users/<redacted>/Applications/Claude.app/Contents/MacOS/Claude",
            "support reads the bundle and the executable, not who owns them"
        )
    }

    func testPathsOutsideAHomeDirectoryAreUntouched() {
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath(
                "/Applications/WeChat.app/Contents/MacOS/WeChat"
            ),
            "/Applications/WeChat.app/Contents/MacOS/WeChat"
        )
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath("/usr/libexec/trustd"),
            "/usr/libexec/trustd"
        )
    }

    func testABareHomeDirectoryKeepsNoName() {
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath("/Users/marlowe"),
            LocalTrafficAudit.redactedHomePrefix
        )
    }

    /// `/Users/Shared` is a location every account can write to, not an
    /// account. Rewriting it would both lose which subtree it was and claim an
    /// owner that does not exist.
    func testTheSharedDirectoryIsNotAnAccount() {
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath(
                "/Users/Shared/Logi/LogiPluginService"
            ),
            "/Users/Shared/Logi/LogiPluginService"
        )
    }

    func testAMissingPathKeepsTheUnknownVocabulary() {
        XCTAssertEqual(LocalTrafficAudit.displayProcessPath(nil), "unknown")
        XCTAssertEqual(LocalTrafficAudit.displayProcessPath(""), "unknown")
    }

    /// The rule is the path, not the running account, so it also covers the
    /// account this process happens to be. Homes outside `/Users` are left
    /// alone rather than rewritten into a shape they never had.
    func testTheRunningAccountsOwnHomeIsRedacted() throws {
        let home = NSHomeDirectory()
        guard home.hasPrefix("/Users/"), home != "/Users/Shared" else {
            throw XCTSkip("this account's home is not under /Users")
        }
        let suffix = "/Library/Application Support/Tono/Logs"
        XCTAssertEqual(
            LocalTrafficAudit.displayProcessPath(home + suffix),
            LocalTrafficAudit.redactedHomePrefix + suffix
        )
    }
}
