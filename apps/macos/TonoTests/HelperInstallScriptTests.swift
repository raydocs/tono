import XCTest
@testable import Tono

/// The install runs as root. Everything it does is decided by one generated
/// string, and until now nothing asserted anything about it — including the
/// Developer ID requirement, which is the only thing between this daemon and an
/// arbitrary binary of someone else's choosing.
///
/// This is not a hypothetical gap. Build 42 shipped with the helper's
/// code-signing identifier derived from its filename rather than its bundle
/// identifier, so the requirement below could not be satisfied and every repair
/// on every machine failed. Nothing in the build or the suite noticed.
///
/// These assertions are about the script's text, which is weaker than executing
/// it. Executing it needs a Developer ID signature, so it cannot run in CI at
/// all — a limit worth stating plainly rather than papering over with a test
/// that proves less than its name suggests.
final class HelperInstallScriptTests: XCTestCase {
    private func script(uid: uid_t = 501) -> String {
        HelperManager.installScript(
            helperSource: "/Applications/Tono.app/Contents/Resources/liquidclash-helper",
            mihomoSource: "/Applications/Tono.app/Contents/Resources/mihomo",
            uid: uid
        )
    }

    /// Scoped to the one line that verifies this binary. A whole-document
    /// `contains` passed with the helper's own team pin deleted, because the
    /// mihomo requirement still carried one — an assertion that could not fail
    /// for the reason it was written.
    private func requirementLine(containing needle: String) -> String? {
        script().split(separator: "\n").map(String.init).first {
            $0.contains("codesign") && $0.contains(needle)
        }
    }

    func testHelperMustSatisfyTheDeveloperIDRequirement() {
        guard let line = requirementLine(
            containing: "identifier \"com.raydocs.tono.helper\""
        ) else {
            return XCTFail("no codesign requirement pins the helper's bundle identifier")
        }
        XCTAssertTrue(line.contains("anchor apple generic"))
        XCTAssertTrue(
            line.contains("certificate leaf[subject.OU] = \"YY57758GS7\""),
            "an unpinned team lets any Developer ID certificate satisfy this"
        )
        XCTAssertTrue(line.contains("--verify --strict --all-architectures"))
    }

    func testMihomoIsVerifiedTooAndNotJustTheHelper() {
        guard let line = requirementLine(containing: "identifier \"mihomo\"") else {
            return XCTFail("no codesign requirement pins mihomo")
        }
        XCTAssertTrue(line.contains("anchor apple generic"))
        XCTAssertTrue(line.contains("certificate leaf[subject.OU] = \"YY57758GS7\""))
    }

    /// Verification has to happen while the binary is still at its temporary
    /// path. Verifying after the move would leave a window where the installed
    /// path holds an unverified binary that launchd may already have started.
    func testEachBinaryIsVerifiedBeforeItIsMovedIntoPlace() {
        let text = script()
        for (verifyNeedle, moveNeedle) in [
            ("identifier \"com.raydocs.tono.helper\"", "mv -f '/Library/PrivilegedHelperTools/tono-core-helper.new'"),
            ("identifier \"mihomo\"", "mv -f '/Library/PrivilegedHelperTools/tono-mihomo.new'"),
        ] {
            guard let verify = text.range(of: verifyNeedle),
                  let move = text.range(of: moveNeedle) else {
                return XCTFail("expected both a verification and a move for \(verifyNeedle)")
            }
            XCTAssertLessThan(
                verify.lowerBound, move.lowerBound,
                "verification must precede the move for \(verifyNeedle)"
            )
        }
    }

    /// `set -e` is what makes the ordering above meaningful: without it a failed
    /// verification would print and the move would still run.
    func testTheScriptAbortsOnTheFirstFailure() {
        XCTAssertTrue(script().hasPrefix("set -e"))
    }

    /// The file naming the trusted user decides whose requests the daemon
    /// honours. Readable or writable by anyone else, that decision moves.
    func testTheAllowedUserFileIsRootOwnedAndPrivate() {
        let text = script()
        XCTAssertTrue(text.contains("chown root:wheel '/Library/PrivilegedHelperTools/tono.allowed-uid.new.501'"))
        XCTAssertTrue(text.contains("chmod 0600 '/Library/PrivilegedHelperTools/tono.allowed-uid.new.501'"))
    }

    func testTheHelperIsInstalledRootOwnedAndNotGroupWritable() {
        XCTAssertTrue(script().contains("install -o root -g wheel -m 0755"))
    }

    /// Refusing uid 0 is checked by the caller, so this pins the fact that the
    /// uid reaches the script as a value and lands in the trusted-user file.
    func testTheTrustedUserIsWrittenFromTheCallersUID() {
        XCTAssertTrue(script(uid: 502).contains("printf '%u\\n' 502"))
        XCTAssertFalse(script(uid: 502).contains("printf '%u\\n' 501"))
    }

    /// Earlier products left daemons behind under different labels. One still
    /// running would answer a socket this build no longer controls.
    func testLegacyDaemonsAreRemoved() {
        let text = script()
        for legacy in [
            "bootout system/liquidclash.helper",
            "bootout system/com.raydocs.tono.killswitch",
        ] {
            XCTAssertTrue(text.contains(legacy), "missing removal of \(legacy)")
        }
        for stale in [
            "/Library/PrivilegedHelperTools/liquidclash-helper",
            "/Library/PrivilegedHelperTools/tono-killswitch",
            "/tmp/liquidclash/service.sock",
        ] {
            XCTAssertTrue(text.contains(stale), "missing cleanup of \(stale)")
        }
    }

    /// The runtime socket directory must exist and be root-owned before the
    /// daemon starts, or the daemon creates it under whatever umask applies.
    func testTheSocketDirectoryIsPreparedRootOwned() {
        XCTAssertTrue(
            script().contains("install -d -o root -g wheel -m 0755 /var/run/tono-core")
        )
    }

    /// The plist is linted before it is moved: an invalid one bootstraps nothing
    /// and would leave the previous daemon booted out with no replacement.
    func testThePlistIsValidatedBeforeInstalling() {
        let text = script()
        guard let lint = text.range(of: "plutil -lint"),
              let move = text.range(of: "mv -f '/Library/LaunchDaemons/") else {
            return XCTFail("expected the plist to be linted and moved")
        }
        XCTAssertLessThan(lint.lowerBound, move.lowerBound)
    }

    /// Paths are interpolated into a shell command, so they must arrive escaped.
    func testSourcePathsAreShellEscaped() {
        let text = HelperManager.installScript(
            helperSource: "/tmp/a b'c/liquidclash-helper",
            mihomoSource: "/tmp/a b'c/mihomo",
            uid: 501
        )
        XCTAssertFalse(
            text.contains("/tmp/a b'c/liquidclash-helper "),
            "an unescaped space would split this into two arguments"
        )
        XCTAssertTrue(text.contains("\\'") || text.contains("'\\''"))
    }
}
