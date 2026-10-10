import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt
import Security

let helperVersion = HelperProtocolVersion.current
let socketDirectory = "/var/run/tono-core"
let socketPath = "\(socketDirectory)/service.sock"
let runtimeDirectory = "\(socketDirectory)/runtime"
let runtimeConfigPath = "\(runtimeDirectory)/config.json"
let pidPath = "\(socketDirectory)/sing-box.pid"
let allowedUIDPath = "/Library/PrivilegedHelperTools/tono.allowed-uid"
let mihomoPath = "/Library/PrivilegedHelperTools/tono-sing-box"
let maximumRequestBytes = 48 * 1024
let maximumHeaderBytes = 8 * 1024
let maximumDiagnosticBytes = 32 * 1024
var helperShutdownRequested: sig_atomic_t = 0
// IOKit power-message macros are not imported into Swift because they expand
// through unsupported C macros. These are the stable public IOMessage values.
let tonoIOMessageCanSystemSleep: UInt32 = 0xe000_0270
let tonoIOMessageSystemWillSleep: UInt32 = 0xe000_0280
let tonoIOMessageSystemHasPoweredOn: UInt32 = 0xe000_0300
let tonoIOMessageSystemWillPowerOn: UInt32 = 0xe000_0320
let killSwitchArmFields = Set([
    "apiHosts",
    "exitHints",
    "tunnelInterfaces",
    "proxyEndpoints",
    "sessionDirectEndpoints",
    "tailscaleBootstrapEnabled",
    "allowSystemResolution",
    "bootstrapPins",
    "reviewedBundleDirect",
])

enum HelperFailure: Error {
    case invalid(String)
    case system(String)
    /// A shutdown signal for this helper interrupted the operation. Distinct
    /// from `.system` because startup must not arm fail-closed state for it:
    /// the request came from this helper's own update executor (bootout), so
    /// there is nothing wrong with the machine's evidence.
    case stopping(String)
    /// A refusal the caller can act on programmatically.
    ///
    /// Everything else is prose, which is right for a message a person reads and
    /// wrong for a decision a program makes: the app needs to tell "another
    /// protection change superseded this one, retry" apart from "this request
    /// was malformed", and matching on English text to do it is how a later
    /// wording change becomes a behaviour change.
    case coded(code: String, message: String)

    var message: String {
        switch self {
        case .invalid(let message), .system(let message), .stopping(let message): message
        case .coded(_, let message): message
        }
    }

    var code: String? {
        switch self {
        case .coded(let code, _): code
        default: nil
        }
    }
}

func validateKillSwitchArmFields(_ object: [String: Any]) throws {
    guard Set(object.keys).isSubset(of: killSwitchArmFields) else {
        throw HelperFailure.invalid("Invalid Kill Switch arm request.")
    }
}

func runRequestContractSelfTests() -> Bool {
    do {
        try validateKillSwitchArmFields([
            "apiHosts": [],
            "exitHints": [],
            "tunnelInterfaces": [],
            "proxyEndpoints": [],
            "sessionDirectEndpoints": [],
            "tailscaleBootstrapEnabled": false,
            "allowSystemResolution": false,
            "bootstrapPins": ["api.example.com": ["1.1.1.1"]],
        ])
        do {
            try validateKillSwitchArmFields(["unexpected": []])
            return false
        } catch {
            return true
        }
    } catch {
        return false
    }
}

struct OwnedProcessIdentity {
    let pid: Int32
    let executablePath: String
    let uid: uid_t
}

func staleOwnedCorePIDs(
    in processes: [OwnedProcessIdentity],
    expectedExecutablePath: String = mihomoPath
) -> [Int32] {
    processes.compactMap {
        guard $0.pid > 1, $0.uid == 0,
              $0.executablePath == expectedExecutablePath
                || (expectedExecutablePath == mihomoPath
                    && $0.executablePath == "/Library/PrivilegedHelperTools/tono-mihomo") else { return nil }
        return $0.pid
    }.sorted()
}

/// A signal is still aimed at the core only when the pid's path and uid are
/// the ones captured before the wait. `kill(pid, 0)` stays true after the pid
/// is reused.
func maySignalOwnedCore(path: String, uid: uid_t, expectedPath: String) -> Bool {
    uid == 0 && path == expectedPath
}

func runCoreLifecyclePolicySelfTests() -> Bool {
    staleOwnedCorePIDs(in: [
        .init(pid: 31, executablePath: mihomoPath, uid: 0),
        .init(pid: 32, executablePath: mihomoPath, uid: 501),
        .init(pid: 33, executablePath: "/tmp/tono-mihomo", uid: 0),
        .init(pid: 34, executablePath: "/Library/PrivilegedHelperTools/tono-mihomo", uid: 0),
    ]) == [31, 34]
        && maySignalOwnedCore(path: mihomoPath, uid: 0, expectedPath: mihomoPath)
        && !maySignalOwnedCore(path: "/usr/libexec/rosetta/runtime", uid: 0, expectedPath: mihomoPath)
        && !maySignalOwnedCore(path: mihomoPath, uid: 501, expectedPath: mihomoPath)
}

/// Folds an object key the way Go's JSON decoder matches it to a struct field
/// (`bytes.EqualFold`). Every option name the core knows is ASCII, and the only
/// non-ASCII letters whose simple fold reaches ASCII are U+017F (s) and U+212A (k).
func goFoldedJSONKey(_ key: String) -> String {
    var folded = String.UnicodeScalarView()
    for scalar in key.unicodeScalars {
        switch scalar.value {
        case 0x41...0x5A: folded.append(Unicode.Scalar(UInt8(scalar.value + 0x20)))
        case 0x017F: folded.append("s")
        case 0x212A: folded.append("k")
        default: folded.append(scalar)
        }
    }
    return String(folded)
}

/// Foundation keeps the first of a repeated object key; the core's Go decoder
/// keeps the last and also binds case-folded spellings to the same option.
/// Refuse any object whose decoded keys collide after that folding, so the
/// allowlist below and the core always read the same value. The input has
/// already been accepted by `JSONSerialization`, so only strings and container
/// punctuation need to be tracked here.
///
/// Deliberately stricter than Go: this folds the keys of every object,
/// including map-typed ones (such as a hosts DNS server's `predefined`),
/// whose keys Go matches exactly and never folds. The app's own config never
/// has keys that differ only in case (option names are fixed lowercase ASCII,
/// and the predefined host names are lowercased and deduplicated before
/// writing), so nothing it generates is refused. A future map with such keys
/// would be.
func jsonObjectKeysAreUnambiguous(_ contents: String) -> Bool {
    let bytes = Array(contents.utf8)
    func hex4(_ start: Int) -> UInt32? {
        guard start + 4 <= bytes.count else { return nil }
        var value: UInt32 = 0
        for byte in bytes[start..<start + 4] {
            guard let digit = Character(Unicode.Scalar(byte)).hexDigitValue else { return nil }
            value = value << 4 | UInt32(digit)
        }
        return value
    }
    // Decodes the string whose opening quote is at `start`, returning its value
    // and the index after the closing quote. Lone surrogates decode to U+FFFD,
    // as they do in Go.
    func decodeString(_ start: Int) -> (String, Int)? {
        var decoded: [UInt8] = []
        var index = start + 1
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\"") { return (String(decoding: decoded, as: UTF8.self), index + 1) }
            guard byte == UInt8(ascii: "\\") else {
                decoded.append(byte)
                index += 1
                continue
            }
            guard index + 1 < bytes.count else { return nil }
            let escape = bytes[index + 1]
            index += 2
            switch escape {
            case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): decoded.append(escape)
            case UInt8(ascii: "b"): decoded.append(0x08)
            case UInt8(ascii: "f"): decoded.append(0x0C)
            case UInt8(ascii: "n"): decoded.append(0x0A)
            case UInt8(ascii: "r"): decoded.append(0x0D)
            case UInt8(ascii: "t"): decoded.append(0x09)
            case UInt8(ascii: "u"):
                guard var value = hex4(index) else { return nil }
                index += 4
                if (0xD800...0xDBFF).contains(value), index + 6 <= bytes.count,
                   bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u"),
                   let low = hex4(index + 2), (0xDC00...0xDFFF).contains(low) {
                    value = 0x10000 + ((value - 0xD800) << 10) + (low - 0xDC00)
                    index += 6
                }
                let scalar = Unicode.Scalar(value) ?? "\u{FFFD}"
                decoded.append(contentsOf: String(Character(scalar)).utf8)
            default: return nil
            }
        }
        return nil
    }
    // One frame per open container: nil for an array, the folded keys seen so
    // far for an object.
    var frames: [Set<String>?] = []
    var nextStringIsKey = false
    var index = 0
    while index < bytes.count {
        switch bytes[index] {
        case UInt8(ascii: "{"):
            frames.append(Set<String>())
            nextStringIsKey = true
            index += 1
        case UInt8(ascii: "["):
            frames.append(nil)
            nextStringIsKey = false
            index += 1
        case UInt8(ascii: "}"), UInt8(ascii: "]"):
            guard frames.popLast() != nil else { return false }
            nextStringIsKey = false
            index += 1
        case UInt8(ascii: ","):
            nextStringIsKey = frames.last.map { $0 != nil } ?? false
            index += 1
        case UInt8(ascii: "\""):
            guard let string = decodeString(index) else { return false }
            if nextStringIsKey {
                guard var keys = frames.last ?? nil,
                      keys.insert(goFoldedJSONKey(string.0)).inserted else { return false }
                frames[frames.count - 1] = keys
                nextStringIsKey = false
            }
            index = string.1
        default:
            index += 1
        }
    }
    return frames.isEmpty
}

/// The parsed document with every object key folded as the core folds it.
/// Returns nil on a collision, which `jsonObjectKeysAreUnambiguous` has
/// already refused; the helper never traps on its input.
func goFoldedJSONKeys(_ value: Any) -> Any? {
    if let dictionary = value as? [String: Any] {
        var folded: [String: Any] = [:]
        for (key, child) in dictionary {
            guard let child = goFoldedJSONKeys(child),
                  folded.updateValue(child, forKey: goFoldedJSONKey(key)) == nil else { return nil }
        }
        return folded
    }
    if let array = value as? [Any] {
        var folded: [Any] = []
        for child in array {
            guard let child = goFoldedJSONKeys(child) else { return nil }
            folded.append(child)
        }
        return folded
    }
    return value
}

func ownedRuntimeConfigIsSafe(_ contents: String) -> Bool {
    guard jsonObjectKeysAreUnambiguous(contents),
          let parsed = try? JSONSerialization.jsonObject(with: Data(contents.utf8)),
          let object = goFoldedJSONKeys(parsed) as? [String: Any],
          Set(object.keys).isSubset(of: ["log", "dns", "inbounds", "outbounds", "route", "experimental"]),
          let route = object["route"] as? [String: Any], route["final"] as? String == "Tono-Exit",
          route["rule_set"] == nil,
          let experimental = object["experimental"] as? [String: Any],
          Set(experimental.keys).isSubset(of: ["clash_api", "cache_file"]),
          let api = experimental["clash_api"] as? [String: Any],
          let controller = api["external_controller"] as? String,
          controller.hasPrefix("127.0.0.1:"),
          let secret = api["secret"] as? String, !secret.isEmpty,
          api["external_ui"] == nil, api["external_ui_download_url"] == nil,
          api["default_mode"] as? String == "rule",
          let cache = experimental["cache_file"] as? [String: Any], cache["enabled"] as? Bool == false,
          let inbounds = object["inbounds"] as? [[String: Any]], !inbounds.isEmpty,
          inbounds.contains(where: {
              $0["type"] as? String == "direct" && $0["tag"] as? String == "Tono-DNS"
                  && $0["listen"] as? String == ProtectedDNSContract.server
                  && $0["listen_port"] as? Int == ProtectedDNSContract.port
          }),
          let dns = object["dns"] as? [String: Any], dns["strategy"] as? String == "ipv4_only",
          let servers = dns["servers"] as? [[String: Any]],
          let outbounds = object["outbounds"] as? [[String: Any]] else { return false }
    for inbound in inbounds {
        switch inbound["type"] as? String {
        case "tun":
            guard inbound["interface_name"] as? String == "utun199",
                  inbound["dns_mode"] as? String == "disabled", inbound["stack"] == nil,
                  inbound["address"] as? [String] == ["198.18.0.1/30"],
                  inbound["auto_route"] as? Bool == true,
                  inbound["strict_route"] as? Bool == false else { return false }
        case "direct", "mixed":
            guard inbound["listen"] as? String == "127.0.0.1" else { return false }
        default: return false
        }
    }
    for server in servers {
        guard ["fakeip", "https", "hosts"].contains(server["type"] as? String ?? ""),
              server["path"] == nil || server["type"] as? String == "https" else { return false }
    }
    for outbound in outbounds {
        guard ["vless", "hysteria2", "socks", "direct", "selector"].contains(outbound["type"] as? String ?? "") else { return false }
    }
    // No user-controlled files, arbitrary process execution, insecure TLS or
    // additional remote resource loader may be passed to the privileged core.
    func safe(_ value: Any) -> Bool {
        if let dictionary = value as? [String: Any] {
            let forbidden: Set<String> = ["certificate_path", "client_certificate_path", "client_key_path",
                "key_path", "external_ui", "output", "rule_set", "insecure", "default_mark", "routing_mark"]
            return !dictionary.keys.contains(where: { forbidden.contains($0) })
                && dictionary.values.allSatisfy(safe)
        }
        if let array = value as? [Any] { return array.allSatisfy(safe) }
        return true
    }
    return safe(object)
}

/// The refusal matrix that keeps an unprivileged user from getting root to run a
/// document of their choosing.
///
/// `secureMetadata` and `atomicCopy` are the two primitives every privileged
/// entry point funnels through, and until now neither had a test. The composed
/// path above them — `validateConfigDirectory` — cannot be tested without
/// building conditions inside the real `~/Library/Application Support/Tono/config`,
/// which on a developer's machine is the live configuration. Adding an injectable
/// home to reach it would put a seam in privileged code pointing at where
/// "trusted" lives, which is the one thing that must not be movable. So the
/// primitives are tested directly, on paths owned by this test.
///
/// Root only: it has to chown files to another user to prove ownership is
/// actually enforced, and a check that cannot construct the failing case proves
/// nothing about it.
/// Start, refuse, stop — exercised against the real `CoreManager`, the installed
/// core binary, and a real config staged through the real digest check.
///
/// This is the coverage Windows has as `test_start_and_stop`,
/// `test_start_and_parse` and `test_start_permissions`, and its absence here is
/// why every one of those behaviours was only ever confirmed by connecting and
/// watching. It uses `Tono-Dev`, which `validateConfigDirectory` already accepts
/// alongside `Tono` — so nothing needs a new seam, and the live configuration is
/// never touched.
///
/// Root only, and it refuses if a session is running: it starts a core that
/// binds the protected DNS port, and two of those cannot coexist.
func runCoreLifecycleSelfTests() -> Bool {
    guard geteuid() == 0 else {
        FileHandle.standardError.write(Data("""
        core lifecycle self-test needs root: it starts the privileged core.
          sudo <helper> --core-lifecycle-self-test
        It stages into Tono-Dev, never the live configuration.

        """.utf8))
        return false
    }
    // Prefer the installed daemon's trusted user, so a developer machine exercises
    // the same identity production does. Where nothing is installed — a fresh CI
    // runner — fall back to whoever invoked sudo: this needs *a* trusted uid, not
    // an installation, and refusing here made the check unrunnable in the one
    // place it runs unattended.
    //
    // Scoped to this self-test on purpose. `readAllowedUID` is what the daemon
    // itself uses and keeps demanding a root-owned file; a fallback there would be
    // a way to talk it into trusting somebody else.
    let allowedUID: uid_t
    if let installed = try? readAllowedUID() {
        allowedUID = installed
    } else if let invoking = ProcessInfo.processInfo.environment["SUDO_UID"],
              let parsed = uid_t(invoking), parsed > 0 {
        allowedUID = parsed
    } else {
        FileHandle.standardError.write(Data("""
        core lifecycle self-test needs a trusted user: either an installed daemon
        to read one from, or SUDO_UID from having been run through sudo.

        """.utf8))
        return false
    }
    guard let home = try? homeDirectory(for: allowedUID) else { return false }
    let configDirectory = "\(home)/Library/Application Support/Tono-Dev/config"
    let configPath = "\(configDirectory)/config.json"

    // A core already running would own the DNS port this one needs.
    let probe = Process()
    probe.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    // `-x` matches the process name, not the whole command line: with `-f` this
    // matched any shell whose arguments happened to mention the core, including
    // the one running this test.
    probe.arguments = ["-x", "tono-sing-box"]
    probe.standardOutput = FileHandle.nullDevice
    probe.standardError = FileHandle.nullDevice
    try? probe.run()
    probe.waitUntilExit()
    if probe.terminationStatus == 0 {
        FileHandle.standardError.write(Data(
            "a core is already running; disconnect before running this\n".utf8
        ))
        return false
    }

    // Loopback-only fixture. No system DNS change, TUN or remote dial.
    let config = coreLifecycleTestJSON
    defer {
        try? FileManager.default.removeItem(
            atPath: "\(home)/Library/Application Support/Tono-Dev"
        )
    }
    guard (try? FileManager.default.createDirectory(
        atPath: configDirectory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o755]
    )) != nil else { return false }
    // Both the directory and the document must belong to the trusted user, or
    // the daemon is right to refuse them.
    chown("\(home)/Library/Application Support/Tono-Dev", allowedUID, gid_t(bitPattern: -1))
    chown(configDirectory, allowedUID, gid_t(bitPattern: -1))
    guard (try? config.write(toFile: configPath, atomically: true, encoding: .utf8)) != nil
    else { return false }
    chown(configPath, allowedUID, gid_t(bitPattern: -1))
    chmod(configPath, 0o644)

    guard let staged = FileManager.default.contents(atPath: configPath) else {
        FileHandle.standardError.write(Data("could not read the staged config\n".utf8))
        return false
    }
    let digest = SHA256.hash(data: staged)
        .map { String(format: "%02x", $0) }
        .joined()

    var failures: [String] = []
    func check(_ name: String, _ ok: Bool) { if !ok { failures.append(name) } }
    func refuses(_ name: String, _ body: () throws -> Void) {
        do { try body(); failures.append(name) } catch { }
    }

    // `--emergency-disarm` and `--emergency-reset` build a CoreManager for the
    // bound uid only to stop a stale core before PF is released. After that
    // macOS account is deleted the uid no longer resolves, and recovery must
    // still get past this step (H19-O-F4). Starting a core for it stays refused.
    if let missingUID = (uid_t(2_000_000_000)...uid_t(2_000_000_100))
        .first(where: { getpwuid($0) == nil }) {
        if let orphaned = try? CoreManager(allowedUID: missingUID) {
            refuses("deleted-user-start-refused") {
                try orphaned.start(configDirectory: configDirectory, configSHA256: digest)
            }
        } else {
            failures.append("deleted-user-recovery-constructs-core-manager")
        }
    } else {
        failures.append("no-unresolvable-uid-for-deleted-user-check")
    }

    guard let manager = try? CoreManager(allowedUID: allowedUID) else {
        FileHandle.standardError.write(Data("could not construct the core manager\n".utf8))
        return false
    }
    defer {
        try? manager.stop()
        // `manager.stop()` only knows about the child it is holding. A failing
        // build can leave another one behind — mutation-testing the
        // already-running refusal did exactly that, and the leaked core then
        // blocked every later run by holding the DNS port. Safe to be blunt
        // here: this test refuses to start when a core is already present, so
        // anything alive at this point was started by it.
        let sweep = Process()
        sweep.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        sweep.arguments = ["-x", "tono-sing-box"]
        sweep.standardOutput = FileHandle.nullDevice
        sweep.standardError = FileHandle.nullDevice
        try? sweep.run()
        sweep.waitUntilExit()
    }

    // A digest that does not match must be refused before anything is launched.
    // This is the check that stops a document swapped in after the app read it.
    refuses("mismatched-digest-refused") {
        try manager.start(
            configDirectory: configDirectory,
            configSHA256: String(repeating: "0", count: 64)
        )
    }
    check("nothing-started-after-a-refusal", manager.status().running == false)

    // A directory outside the two the daemon accepts must be refused whatever it
    // contains.
    refuses("foreign-config-directory-refused") {
        try manager.start(configDirectory: "/tmp", configSHA256: digest)
    }

    do {
        try manager.start(configDirectory: configDirectory, configSHA256: digest)
    } catch {
        FileHandle.standardError.write(Data(
            "the core did not start: \(error)\n".utf8
        ))
        return false
    }
    // launchd is not involved here; the process is a direct child, so it is
    // running by the time start returns or it threw.
    let started = manager.status()
    check("core-reports-running", started.running)
    check("core-reports-a-pid", (started.pid ?? 0) > 0)
    check("core-reports-no-failure", started.lastError == nil)

    // Starting twice must be refused rather than leaving two cores fighting over
    // the same listeners.
    refuses("second-start-refused") {
        try manager.start(configDirectory: configDirectory, configSHA256: digest)
    }
    check("still-the-same-core", manager.status().pid == started.pid)

    // A rejected replacement must not stop the live child. Once approved, a
    // user edit during beforeStop must not become the bytes launched afterward.
    let changedConfig = config.replacingOccurrences(of: "198.19.1.2", with: "198.19.1.3")
    var invalidReachedBeforeStop = false
    refuses("sync-invalid-prevalidation-refused") {
        _ = try manager.sync(
            configDirectory: configDirectory,
            configSHA256: String(repeating: "0", count: 64),
            beforeStop: { invalidReachedBeforeStop = true }
        )
    }
    check("sync-invalid-keeps-live-child", !invalidReachedBeforeStop &&
          manager.status().pid == started.pid && manager.status().running)
    do {
        let approvedPath = try manager.sync(
            configDirectory: configDirectory, configSHA256: digest,
            beforeStop: {
                try changedConfig.write(toFile: configPath, atomically: true, encoding: .utf8)
                guard chown(configPath, allowedUID, gid_t(bitPattern: -1)) == 0,
                      chmod(configPath, 0o644) == 0 else {
                    throw HelperFailure.system("Could not stage the changed test config.")
                }
            }
        )
        check("sync-runs-approved-snapshot", manager.status().running &&
              manager.status().pid != started.pid &&
              FileManager.default.contents(atPath: approvedPath) == staged &&
              FileManager.default.contents(atPath: configPath) != staged)
    } catch {
        failures.append("sync-runs-approved-snapshot")
    }
    do {
        try config.write(toFile: configPath, atomically: true, encoding: .utf8)
        guard chown(configPath, allowedUID, gid_t(bitPattern: -1)) == 0,
              chmod(configPath, 0o644) == 0 else {
            throw HelperFailure.system("Could not restore the test config.")
        }
    } catch {
        failures.append("restore-test-config-after-sync")
    }

    do {
        let beforeReload = manager.status().pid
        _ = try manager.sync(configDirectory: configDirectory, configSHA256: digest)
        check("reload-replaces-pid", manager.status().pid != beforeReload)
        check("reload-running", manager.status().running)
        refuses("reload-while-asleep-refused") {
            _ = try manager.sync(configDirectory: configDirectory, configSHA256: digest,
                                 startAllowed: { false })
        }
        check("failed-reload-does-not-fallback", !manager.status().running)
    } catch {
        failures.append("protected-replacement")
    }

    do {
        try manager.stop()
    } catch {
        FileHandle.standardError.write(Data("the core did not stop: \(error)\n".utf8))
        return false
    }
    let stopped = manager.status()
    check("core-reports-stopped", stopped.running == false)
    check("stopped-core-reports-no-pid", stopped.pid == nil)

    // And it must be startable again afterwards, or a reconnect would need a
    // daemon restart.
    do {
        try manager.start(configDirectory: configDirectory, configSHA256: digest)
        check("restartable-after-stop", manager.status().running)
        try manager.stop()
    } catch {
        failures.append("restartable-after-stop")
    }

    if failures.isEmpty { return true }
    FileHandle.standardError.write(Data(
        "core lifecycle self-test failed: \(Set(failures).sorted().joined(separator: ", "))\n".utf8
    ))
    return false
}

func runStagingRefusalSelfTests() -> Bool {
    guard geteuid() == 0 else {
        FileHandle.standardError.write(Data("""
        staging self-test needs root: proving ownership is enforced requires
        creating a file owned by somebody else.
          sudo <helper> --staging-self-test
        It works only inside its own temporary directory.

        """.utf8))
        return false
    }
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("tono-staging-self-test-\(getpid())").path
    defer { try? FileManager.default.removeItem(atPath: root) }
    guard (try? FileManager.default.createDirectory(
        atPath: root, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )) != nil else { return false }

    var failures: [String] = []
    func expectRefusal(_ name: String, _ body: () throws -> Void) {
        do {
            try body()
            failures.append(name)
        } catch {
            // Refusing is the pass condition.
        }
    }
    func expectAcceptance(_ name: String, _ body: () throws -> Void) {
        do { try body() } catch { failures.append(name) }
    }

    let payload = "# Tono owned runtime\n"
    let digest = "0000000000000000000000000000000000000000000000000000000000000000"

    func write(_ name: String, permissions: Int, owner: uid_t) -> String {
        let path = "\(root)/\(name)"
        FileManager.default.createFile(atPath: path, contents: Data(payload.utf8),
                                       attributes: [.posixPermissions: permissions])
        if owner != 0 { chown(path, owner, gid_t(bitPattern: -1)) }
        return path
    }

    // A file the daemon must trust: root-owned, not writable by anyone else.
    let trusted = write("trusted", permissions: 0o600, owner: 0)
    expectAcceptance("root-owned-file-accepted") {
        _ = try secureMetadata(trusted, type: mode_t(S_IFREG), owner: 0)
    }

    // Owned by somebody else. This is the escalation case: if ownership were not
    // enforced, any user could place a document where the daemon reads one.
    let foreign = write("foreign", permissions: 0o600, owner: 1)
    expectRefusal("foreign-owner-refused") {
        _ = try secureMetadata(foreign, type: mode_t(S_IFREG), owner: 0)
    }

    // Root-owned but group or world writable, which makes the owner irrelevant.
    let loose = write("loose", permissions: 0o666, owner: 0)
    expectRefusal("group-writable-refused") {
        _ = try secureMetadata(loose, type: mode_t(S_IFREG), owner: 0)
    }
    // The same file is acceptable only where the caller explicitly opts out of
    // that check, so the default cannot be silently permissive.
    expectAcceptance("permission-check-is-opt-out-not-default") {
        _ = try secureMetadata(loose, type: mode_t(S_IFREG), owner: 0,
                               rejectWritableByGroupOrWorld: false)
    }

    // A symlink is not a regular file. `lstat` is deliberate: resolving it here
    // would let a link planted by anyone redirect a privileged read.
    let link = "\(root)/link"
    symlink(trusted, link)
    expectRefusal("symlink-refused-as-regular-file") {
        _ = try secureMetadata(link, type: mode_t(S_IFREG), owner: 0)
    }

    // A directory where a file is required, and the reverse.
    expectRefusal("directory-refused-as-regular-file") {
        _ = try secureMetadata(root, type: mode_t(S_IFREG), owner: 0)
    }
    expectRefusal("file-refused-as-directory") {
        _ = try secureMetadata(trusted, type: mode_t(S_IFDIR), owner: 0)
    }

    expectRefusal("absent-path-refused") {
        _ = try secureMetadata("\(root)/does-not-exist", type: mode_t(S_IFREG), owner: 0)
    }

    // A digest that is not 64 hex characters must be refused before any file is
    // read, so a caller cannot smuggle anything through the digest argument.
    for malformed in ["", "abc", digest + "0", digest.replacingOccurrences(of: "0", with: "g")] {
        expectRefusal("malformed-digest-refused") {
            try atomicCopy(
                source: trusted, destination: "\(root)/out",
                expectedOwner: 0, expectedSHA256: malformed,
                maximumBytes: 1024, required: true
            )
        }
    }

    // A well-formed digest that does not match the content must also be refused.
    expectRefusal("digest-mismatch-refused") {
        try atomicCopy(
            source: trusted, destination: "\(root)/out",
            expectedOwner: 0, expectedSHA256: digest,
            maximumBytes: 1024, required: true
        )
    }

    // And a size cap below the input, so a large document cannot be staged into
    // a privileged location by exhausting memory first.
    expectRefusal("oversize-input-refused") {
        try atomicCopy(
            source: trusted, destination: "\(root)/out",
            expectedOwner: 0, expectedSHA256: digest,
            maximumBytes: 1, required: true
        )
    }

    // A FIFO swapped in for a user-writable runtime input must be refused
    // without blocking. Without O_NONBLOCK on the source open this call hangs
    // the helper's single request thread with PF armed instead of refusing;
    // with it, a writerless FIFO opens at once and the regular-file check
    // refuses it. A build without the fix hangs here rather than failing.
    let fifo = "\(root)/fifo"
    guard mkfifo(fifo, 0o600) == 0 else {
        FileHandle.standardError.write(Data("could not create the FIFO fixture\n".utf8))
        return false
    }
    expectRefusal("fifo-refused-without-blocking") {
        try atomicCopy(
            source: fifo, destination: "\(root)/out",
            expectedOwner: 0, expectedSHA256: digest,
            maximumBytes: 1024, required: true
        )
    }

    if failures.isEmpty { return true }
    FileHandle.standardError.write(Data(
        "staging self-test failed: \(Set(failures).sorted().joined(separator: ", "))\n".utf8
    ))
    return false
}

let coreLifecycleTestJSON = #"""
{"log":{"level":"warn"},
 "dns":{"strategy":"ipv4_only","servers":[{"type":"hosts","tag":"local","predefined":{"probe.invalid":["198.19.1.2"]}}],"final":"local"},
 "inbounds":[{"type":"direct","tag":"Tono-DNS","listen":"127.0.0.1","listen_port":53}],
 "outbounds":[{"type":"direct","tag":"Tono-Exit"}],
 "route":{"final":"Tono-Exit","rules":[{"inbound":["Tono-DNS"],"action":"hijack-dns"}]},
 "experimental":{"cache_file":{"enabled":false},"clash_api":{"external_controller":"127.0.0.1:29394","secret":"core-lifecycle-self-test","default_mode":"rule"}}}
"""#

func runOwnedRuntimeContractSelfTests() -> Bool {
    let valid = coreLifecycleTestJSON
    return ownedRuntimeConfigIsSafe(valid)
        && !ownedRuntimeConfigIsSafe(
            valid.replacingOccurrences(
                of: #""listen":"127.0.0.1""#,
                with: #""listen":"198.18.0.2""#
            )
        )
        && !ownedRuntimeConfigIsSafe(
            valid.replacingOccurrences(
                of: #""listen":"127.0.0.1""#,
                with: #""listen":"0.0.0.0""#
            )
        )
        // Foundation keeps the first repeated key and the core keeps the last.
        && !ownedRuntimeConfigIsSafe(
            valid.replacingOccurrences(
                of: #""route":{"final":"Tono-Exit""#,
                with: #""route":{"final":"Tono-Exit","final":"direct""#
            )
        )
}

/// Daemon startup after executor recovery.
///
/// After a boot, macOS loads /etc/pf.conf with PF disabled. That file only
/// declares the Tono anchor; it does not load the rule file, so Safe Mode
/// (where this LaunchDaemon does not run) cannot reinstall a block from it.
/// This daemon does not re-arm on startup. Once the socket is listening, a
/// Core that is not running releases any leftover kill switch. A failure
/// before that release clears a saved kill switch instead of installing a
/// block. A stop request is a clean stop, as in `UpdateExecutor.startup`:
/// the executor's own bootout must not change PF.
func startHelperDaemon<KillSwitch, Server>(
    readUID: () throws -> uid_t = {
        guard geteuid() == 0 else {
            throw HelperFailure.invalid("The helper must run as root.")
        }
        return try readAllowedUID()
    },
    restoreProtection: (uid_t) throws -> KillSwitch,
    startServer: (uid_t, KillSwitch) throws -> Server,
    secureFailedStartup: () -> Void,
    stopRequested: () -> Bool = { helperShutdownRequested != 0 }
) -> Server? {
    do {
        let allowedUID = try readUID()
        let killSwitch = try restoreProtection(allowedUID)
        return try startServer(allowedUID, killSwitch)
    } catch {
        if !stopRequested() { secureFailedStartup() }
        return nil
    }
}

func runUpgradeSourceSelfTest() -> Bool {
    let directory = FileManager.default.temporaryDirectory.path
    let fifo = directory + "/tono-upgrade-fifo-\(getpid())"
    let file = directory + "/tono-upgrade-file-\(getpid())"
    let dest = directory + "/tono-upgrade-dest-\(getpid())"
    let stopped = dest + ".stop"
    unlink(fifo)
    unlink(file)
    unlink(dest)
    unlink(stopped)
    defer {
        unlink(fifo)
        unlink(file)
        unlink(dest)
        unlink(stopped)
    }
    guard mkfifo(fifo, 0o644) == 0 else { return false }
    let started = Date()
    var rejectedFIFO = false
    do { close(try openUpgradeSource(fifo)) } catch { rejectedFIFO = true }
    guard rejectedFIFO, Date().timeIntervalSince(started) < 2 else { return false }
    let payload = Data("tono-upgrade\n".utf8)
    do {
        try payload.write(to: URL(fileURLWithPath: file), options: .atomic)
        let fd = try openUpgradeSource(file)
        defer { close(fd) }
        try copyUpgradeSource(from: fd, to: dest) { true }
        guard (try? Data(contentsOf: URL(fileURLWithPath: dest))) == payload else { return false }
        var aborted = false
        do {
            try copyUpgradeSource(from: fd, to: stopped) { false }
        } catch {
            aborted = true
        }
        return aborted && access(stopped, F_OK) != 0
    } catch {
        return false
    }
}

/// Cancelling a silent copy must leave an administrator installer's staging
/// files intact, including files it replaces while the copy is in progress.
func runSilentUpgradeStagingSelfTest() -> Bool {
    let parent = FileManager.default.temporaryDirectory.path
        + "/tono-upgrade-isolation-\(UUID().uuidString)"
    do {
        try FileManager.default.createDirectory(atPath: parent, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(atPath: parent) }
        let staging = try SilentUpgradeStaging(parent: parent)
        defer { staging.remove() }
        let other = try SilentUpgradeStaging(parent: parent)
        defer { other.remove() }
        guard staging.directory != other.directory else { return false }
        let otherPayload = Data("other-upgrade\n".utf8)
        try otherPayload.write(to: URL(fileURLWithPath: other.helperPath))
        let source = parent + "/source"
        let installerHelper = parent + "/tono-core-helper.new"
        let installerCore = parent + "/tono-sing-box.new"
        let sentinel = Data("administrator-install\n".utf8)
        try Data("silent-upgrade\n".utf8).write(to: URL(fileURLWithPath: source))
        let fd = try openUpgradeSource(source)
        defer { close(fd) }
        var checks = 0
        var aborted = false
        do {
            try copyUpgradeSource(from: fd, to: staging.helperPath) {
                checks += 1
                if checks == 2 {
                    do {
                        try sentinel.write(to: URL(fileURLWithPath: installerHelper), options: .atomic)
                        try sentinel.write(to: URL(fileURLWithPath: installerCore), options: .atomic)
                    } catch { return false }
                    return false
                }
                return true
            }
        } catch { aborted = true }
        staging.remove()
        return aborted && checks == 2
            && (try? Data(contentsOf: URL(fileURLWithPath: installerHelper))) == sentinel
            && (try? Data(contentsOf: URL(fileURLWithPath: installerCore))) == sentinel
            && (try? Data(contentsOf: URL(fileURLWithPath: other.helperPath))) == otherPayload
            && access(staging.helperPath, F_OK) != 0
    } catch { return false }
}

/// The authorization check and binary replacement share the actual durable
/// lock; another installer cannot enter between them.
func runSilentUpgradeCommitSelfTest() -> Bool {
    guard geteuid() == 0 else { return false }
    let root = FileManager.default.temporaryDirectory.path
        + "/tono-upgrade-commit-\(UUID().uuidString)"
    defer { try? FileManager.default.removeItem(atPath: root) }
    do {
        let storage = try UpdateStorage(root: root)
        let staging = try SilentUpgradeStaging(parent: root)
        defer { staging.remove() }
        let helperDestination = root + "/helper"
        let coreDestination = root + "/core"
        let helperBytes = Data("new-helper\n".utf8)
        let coreBytes = Data("new-core\n".utf8)
        try helperBytes.write(to: URL(fileURLWithPath: staging.helperPath))
        try coreBytes.write(to: URL(fileURLWithPath: staging.corePath))
        let contender = open(root + "/lock", O_RDWR | O_CLOEXEC)
        guard contender >= 0 else { return false }
        defer { close(contender) }
        var replaced = false
        try replaceSilentUpgradeCopies(
            staging: staging,
            helperDestination: helperDestination,
            coreDestination: coreDestination
        ) { replace in
            try storage.locked {
                guard flock(contender, LOCK_EX | LOCK_NB) != 0,
                      errno == EWOULDBLOCK else {
                    throw HelperFailure.system("Upgrade replacement did not hold the update lock.")
                }
                try replace()
                guard (try? Data(contentsOf: URL(fileURLWithPath: helperDestination))) == helperBytes,
                      (try? Data(contentsOf: URL(fileURLWithPath: coreDestination))) == coreBytes else {
                    throw HelperFailure.system("Upgrade copies were not replaced inside the update lock.")
                }
                replaced = true
            }
        }
        guard replaced, flock(contender, LOCK_EX | LOCK_NB) == 0 else { return false }
        flock(contender, LOCK_UN)
        return true
    } catch { return false }
}

func runBuildSourceSealSelfTest() -> Bool {
    let json = Data(
        #"{"commit":"0123456789abcdef0123456789abcdef01234567","releaseSequence":3}"#.utf8
    )
    guard (try? UpdatePackage.buildSource(matching: json, and: json))?.releaseSequence == 3 else {
        return false
    }
    do {
        _ = try UpdatePackage.buildSource(matching: json, and: Data(#"{"commit":"0123456789abcdef0123456789abcdef01234567","releaseSequence":2}"#.utf8))
        return false
    } catch {}
    do {
        _ = try UpdatePackage.buildSource(from: Data(count: 4096))
        return false
    } catch {}
    let fifo = FileManager.default.temporaryDirectory.path + "/tono-build-source-fifo-\(getpid())"
    unlink(fifo)
    defer { unlink(fifo) }
    guard mkfifo(fifo, 0o644) == 0 else { return false }
    let started = Date()
    do {
        _ = try UpdatePackage.readBoundedRegularFile(fifo, maximum: 4096)
        return false
    } catch {
        return Date().timeIntervalSince(started) < 2
    }
}

func runPFTokenForgetSelfTest() -> Bool {
    !KillSwitchManager.shouldKeepPFEnableRecord(releaseStatus: 0, stillListed: true)
        && KillSwitchManager.shouldKeepPFEnableRecord(releaseStatus: 1, stillListed: true)
        && !KillSwitchManager.shouldKeepPFEnableRecord(releaseStatus: 1, stillListed: false)
}

func runLanDNSScopeSelfTest() -> Bool {
    let scoped = #"block drop out quick on { en0, en5 } inet proto { tcp, udp } port { 53, 853 } label "tono-lan-dns""#
    let unscoped = #"block drop out quick inet proto { tcp, udp } port { 53, 853 } label "tono-lan-dns""#
    // Kernel output expands the renderer's interface/protocol/port lists.
    let expanded = #"block drop out quick on en5 inet proto udp from any to 10.0.0.0/8 port = 53 label "tono-lan-dns""#
        + "\n" + #"block drop out quick on en0 inet proto tcp from any to 10.0.0.0/8 port = 853 label "tono-lan-dns""#
        + "\n" + #"block drop out quick on en0 inet6 proto udp from any to fc00::/7 port = 53 label "tono-lan-dns""#
    return KillSwitchManager.lanDNSInterfaces(in: scoped) == ["en0", "en5"]
        && KillSwitchManager.lanDNSInterfaces(in: expanded) == ["en0", "en5"]
        && KillSwitchManager.lanDNSScopeNeedsReload(
            loaded: KillSwitchManager.lanDNSInterfaces(in: expanded),
            current: ["en0", "en5", "en7"]
        )
        && KillSwitchManager.lanDNSInterfaces(in: expanded + "\n" + unscoped) == []
        && KillSwitchManager.lanDNSInterfaces(in: unscoped) == []
        && KillSwitchManager.lanDNSInterfaces(in: "pass out all\n") == nil
        && KillSwitchManager.lanDNSScopeNeedsReload(loaded: ["en0"], current: ["en0", "en7"])
        && !KillSwitchManager.lanDNSScopeNeedsReload(loaded: ["en0", "en7"], current: ["en0"])
        && !KillSwitchManager.lanDNSScopeNeedsReload(loaded: ["en0"], current: [])
        && !KillSwitchManager.lanDNSScopeNeedsReload(loaded: [], current: ["en0"])
        && !KillSwitchManager.lanDNSScopeNeedsReload(loaded: nil, current: ["en0"])
}

func runLANScopePreservationSelfTest() -> Bool {
    let state = KillSwitchState(
        armed: true, tailscaleBootstrapEnabled: false,
        apiHosts: [], exitHints: [], tunnelInterfaces: ["utun199"],
        resolvedHosts: [:], pinnedHosts: [:], derpEndpoints: [],
        cachedDERPEndpoints: [], proxyTargets: [],
        sessionDirectEndpoints: [.init(address: "203.0.113.50", transport: "tcp", port: 443)],
        reviewedBundleDirectEnabled: true
    )
    let source = KillSwitchManager.renderRules(
        state: state, allowedUID: 501, physicalInterfaces: ["en0"]
    )
    let baseline = KillSwitchManager.passRules(in: source)
    guard source.contains("203.0.113.50"), source.contains(KillSwitchManager.reviewedBundleLabel),
          let widened = KillSwitchManager.widenLANScope(
            in: source, current: ["en5"], baseline: baseline
          ),
          KillSwitchManager.lanDNSInterfaces(in: widened) == ["en0", "en5"],
          KillSwitchManager.passRules(in: widened) == baseline,
          source.split(separator: "\n").filter({ !$0.contains("\"tono-lan-dns\"") })
            == widened.split(separator: "\n").filter({ !$0.contains("\"tono-lan-dns\"") }),
          KillSwitchManager.stateDisposal(replacing: baseline, with: KillSwitchManager.passRules(in: widened)) == .keep,
          KillSwitchManager.widenLANScope(in: source, current: ["en5"], baseline: nil) == nil,
          KillSwitchManager.widenLANScope(in: source, current: ["en5"], baseline: []) == nil,
          case .withhold(let withheld, _, _) = KillSwitchManager.reviewedBundleWithholding(
            loaded: source, baseline: baseline
          ) else { return false }
    // A transient withhold must never be reconstructed from persisted state
    // or mistaken for the full baseline while the Core is being replaced.
    return KillSwitchManager.widenLANScope(in: withheld, current: ["en5"], baseline: baseline) == nil
}

func runReadRequestBoundSelfTest() -> Bool {
    func withPipe(_ body: (Int32, Int32) throws -> Bool) -> Bool {
        var ends = [Int32](repeating: -1, count: 2)
        guard pipe(&ends) == 0 else { return false }
        defer {
            if ends[0] >= 0 { close(ends[0]) }
            if ends[1] >= 0 { close(ends[1]) }
        }
        return (try? body(ends[0], ends[1])) == true
    }
    let accepted = withPipe { readEnd, writeEnd in
        let bytes = Data("GET /version HTTP/1.1\r\nContent-Length: 0\r\n\r\n".utf8)
        let wrote = bytes.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return Darwin.write(writeEnd, base, bytes.count)
        }
        guard wrote == bytes.count else { return false }
        let request = try readRequest(readEnd)
        return request.method == "GET" && request.path == "/version" && request.body.isEmpty
    }
    let rejected = withPipe { readEnd, writeEnd in
        var header = Data("POST /helper/upgrade HTTP/1.1\r\nX: ".utf8)
        header.append(Data(repeating: 0x61, count: maximumHeaderBytes))
        let wrote = header.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return Darwin.write(writeEnd, base, header.count)
        }
        guard wrote == header.count else { return false }
        do {
            _ = try readRequest(readEnd)
            return false
        } catch {
            return true
        }
    }
    return accepted && rejected
}

/// The manager is constructed before the server. A server failure runs the
/// startup release, and a requested stop does not (H12-F2).
func runStartupOrderSelfTest() -> Bool {
    struct StartupFailed: Error {}
    var events: [String] = []
    func start(stopRequested: Bool) -> Int? {
        startHelperDaemon(
            readUID: { 501 },
            restoreProtection: { (_: uid_t) in events.append("restore") },
            startServer: { (_: uid_t, _: Void) throws -> Int in
                events.append("server")
                throw StartupFailed()
            },
            secureFailedStartup: { events.append("secure") },
            stopRequested: { stopRequested }
        )
    }
    guard start(stopRequested: false) == nil,
          events == ["restore", "server", "secure"] else {
        FileHandle.standardError.write(Data("startup order: \(events)\n".utf8))
        return false
    }
    events = []
    guard start(stopRequested: true) == nil, events == ["restore", "server"] else {
        FileHandle.standardError.write(Data("startup stop: \(events)\n".utf8))
        return false
    }
    return true
}

func requestHelperShutdown(_ signal: Int32) {
    _ = signal
    helperShutdownRequested = 1
}

/// The production `secureFailedStartup`: after the saved kill switch is
/// cleared, a saved protected-DNS snapshot is restored best-effort. Startup
/// can fail before the server builds its DNS manager — the bound user was
/// deleted and `allowedGroup` refuses — and launchd's KeepAlive restarts
/// would repeat that failure forever with the system resolver still on
/// 127.0.0.1 and no listener left (MAC-STARTUP-FAIL-DNS). Never throws and
/// never installs a block: this already is a failure path.
func secureFailedStartupRestoringDNS(
    releaseBlock: () -> Void,
    restoreDNS: () throws -> Void
) {
    releaseBlock()
    do {
        try restoreDNS()
    } catch {
        fputs("Tono helper startup recovery could not restore saved DNS: \(error)\n", stderr)
    }
}

/// Failure of the startup recovery itself must stay contained: the DNS
/// restore runs after the PF release, and a restore failure is logged
/// instead of escaping into a crash loop launchd keeps restarting into.
func runStartupDNSRecoverySelfTest() -> Bool {
    var events: [String] = []
    func secure(_ restoreDNS: () throws -> Void) {
        secureFailedStartupRestoringDNS(
            releaseBlock: { events.append("pf") },
            restoreDNS: restoreDNS
        )
    }
    secure { events.append("dns") }
    guard events == ["pf", "dns"] else {
        FileHandle.standardError.write(Data("startup DNS recovery order: \(events)\n".utf8))
        return false
    }
    events = []
    enum RestoreFailure: Error { case injected }
    secure {
        events.append("dns")
        throw RestoreFailure.injected
    }
    guard events == ["pf", "dns"] else {
        FileHandle.standardError.write(Data("startup DNS recovery failure: \(events)\n".utf8))
        return false
    }
    return true
}

/// A corrupt or unreadable update ledger is not a strict kill switch.
/// Recovery still releases the network. It does not delete the ledger.
func emergencyReleaseDespiteUnreadableLedger(strictKillSwitchEnabled: Bool) -> Bool {
    !strictKillSwitchEnabled
}

/// A stale core that survives even SIGKILL is not a strict kill switch either.
/// Recovery still releases the network and only warns about the survivor:
/// `--emergency-disarm` is the last outlet left to a machine whose GUI cannot
/// reconnect, and aborting it over an unstoppable process keeps PF armed with
/// nowhere left to go (MAC-EMERGENCY-STALE-CORE).
func emergencyReleaseDespiteStaleCore(strictKillSwitchEnabled: Bool) -> Bool {
    !strictKillSwitchEnabled
}

/// What an emergency release achieved. PF is open in both released cases.
/// `dnsRestoreFailed` keeps an owned DNS snapshot that can still point at the
/// stopped resolver; only a helper that stays installed retries it (#1165).
/// `coreStillRunning`: DNS is restored, but a Core survived SIGKILL. Only an
/// installed helper retries the stop or sees its TUN go (#1251).
enum EmergencyReleaseOutcome: Equatable {
    case refused
    case dnsRestoreFailed
    case coreStillRunning
    case released
}

func emergencyReleaseOutcome(dnsRestored: Bool, coreSurvived: Bool) -> EmergencyReleaseOutcome {
    if !dnsRestored { return .dnsRestoreFailed }
    return coreSurvived ? .coreStillRunning : .released
}

/// PF and DNS release with no ledger access. Used when the store cannot be
/// opened. Does not remove the installation or rewrite update files.
func releaseNetworkWithoutLedger() -> EmergencyReleaseOutcome {
    do {
        let allowedUID = try readAllowedUID()
        var coreSurvived = false
        do {
            _ = try CoreManager(allowedUID: allowedUID)
        } catch {
            // A stale core that even SIGKILL could not stop must not keep PF
            // armed on this release of last resort either: the DNS restore and
            // disarm below need no core (MAC-EMERGENCY-STALE-CORE).
            guard emergencyReleaseDespiteStaleCore(strictKillSwitchEnabled: false) else {
                throw error
            }
            fputs(
                "Tono emergency recovery could not stop a stale Mihomo process; it may still be running. Releasing PF anyway: \(error)\n",
                stderr
            )
            coreSurvived = true
        }
        let dns = try ProtectedDNSManager()
        let manager = try KillSwitchManager(allowedUID: allowedUID)
        var dnsRestored = true
        do {
            _ = try dns.restore(deferringLossNotice: true)
        } catch {
            dnsRestored = false
            fputs("Tono emergency recovery could not restore DNS; releasing PF anyway: \(error)\n", stderr)
        }
        _ = try manager.disarm()
        print("Tono network protection is disarmed. Update evidence was not modified.")
        return emergencyReleaseOutcome(dnsRestored: dnsRestored, coreSurvived: coreSurvived)
    } catch {
        fputs("Tono emergency recovery could not release PF: \(error)\n", stderr)
        return .refused
    }
}

/// Last-resort recovery for a machine whose GUI cannot reconnect or quit
/// normally. This path is intentionally unavailable over the user socket and
/// requires an administrator to execute the installed, signed helper as root.
/// An unreadable ledger does not refuse the release. This is not #691: it
/// does not boot out unrelated processes, does not require DNS verification
/// before opening PF, and does not record a flag that stops later starts.
func runEmergencyDisarm(underLock suppliedStorage: UpdateStorage? = nil) -> Bool {
    emergencyRelease(underLock: suppliedStorage) != .refused
}

/// `runEmergencyDisarm` with the DNS result kept apart, for the callers that
/// remove the installation afterwards.
func emergencyRelease(underLock suppliedStorage: UpdateStorage? = nil) -> EmergencyReleaseOutcome {
    guard geteuid() == 0 else {
        fputs("Tono emergency recovery must be run with sudo.\n", stderr)
        return .refused
    }
    do {
        let storage = try suppliedStorage ?? UpdateStorage()
        let disarm = { () throws -> EmergencyReleaseOutcome in
        var dnsRestored = true
        var ledger: UpdateStorage.Ledger?
        var pending = false
        do {
            var loaded = try storage.load()
            pending = loaded.attempt != nil && loaded.attempt?.receipt.phase != .committed
            if pending {
                loaded.attempt?.disconnectRequested = true
                try storage.save(loaded)
            }
            ledger = loaded
        } catch {
            fputs(
                "Tono emergency recovery could not read update evidence; releasing the network and keeping the files: \(error)\n",
                stderr
            )
            guard emergencyReleaseDespiteUnreadableLedger(strictKillSwitchEnabled: false) else {
                throw error
            }
            pending = false
        }
        let allowedUID = try readAllowedUID()
        // Initialization terminates a stale owned Mihomo process before PF is
        // opened, preventing a half-running privileged runtime after recovery.
        // A process that survives even SIGKILL must not abort the release: this
        // command is the last outlet of a machine that is already offline, so
        // the plain DNS restore + disarm path below runs without a core and the
        // update evidence is kept untouched, like the disconnect failure below
        // (MAC-EMERGENCY-STALE-CORE).
        var core: CoreManager?
        var coreSurvived = false
        do {
            core = try CoreManager(allowedUID: allowedUID)
        } catch {
            guard emergencyReleaseDespiteStaleCore(strictKillSwitchEnabled: false) else {
                throw error
            }
            fputs(
                "Tono emergency recovery could not stop a stale Mihomo process; it may still be running. Releasing PF anyway: \(error)\n",
                stderr
            )
            coreSurvived = true
        }
        // Restore DNS, then release PF. A DNS failure must not keep the block:
        // the host would stay offline with a dead resolver.
        let dns = try ProtectedDNSManager()
        let manager = try KillSwitchManager(allowedUID: allowedUID)
        if pending, var ledger, let core {
            let runtime = UpdateRuntime(core: core, firewall: manager, dns: dns, power: PowerTransitionGate())
            do {
                try runtime.disconnect()
            } catch {
                fputs(
                    "Tono emergency recovery could not finish the update disconnect; releasing PF anyway: \(error)\n",
                    stderr
                )
                do {
                    _ = try dns.restore(deferringLossNotice: true)
                } catch {
                    dnsRestored = false
                    fputs("Tono emergency recovery could not restore DNS; releasing PF anyway: \(error)\n", stderr)
                }
                _ = try manager.disarm()
                print("Tono network protection is disarmed. Update evidence was kept.")
                return emergencyReleaseOutcome(dnsRestored: dnsRestored, coreSurvived: coreSurvived)
            }
            ledger.attempt?.disconnectVerified = true
            try storage.save(ledger)
            // The verified release above is the abandon intent this command
            // exists to express. An attempt that is provably resolved on disk
            // — rolled back to (or never moved from) the captured original
            // components, or a fully replaced installation the user gave up
            // on — now has a sanctioned terminal archive; take it so this
            // documented last-resort exit also ends the transaction instead
            // of leaving a permanently pending ledger that no product
            // surface can resolve. Unmet predicates change nothing: evidence
            // is archived, not erased, and the consumed high-water stays.
            do { try UpdateTransaction.live(storage: storage, runtime: runtime).retire(peer: nil) }
            catch {
                fputs("Tono emergency recovery disarmed PF but could not archive the resolved update attempt: \(error)\n", stderr)
            }
        } else {
            do {
                _ = try dns.restore(deferringLossNotice: true)
            } catch {
                dnsRestored = false
                fputs(
                    "Tono emergency recovery could not restore DNS; releasing PF anyway: \(error)\n",
                    stderr
                )
            }
            _ = try manager.disarm()
        }
        print("Tono network protection is disarmed.")
        if ProtectedDNSManager.originalLossRecorded {
            // Either branch above; the record stays for the app's next restore.
            print(
                "Tono did not restore the saved DNS settings because the network service was removed "
                    + "or its DNS settings changed. Any newer DNS settings were kept. Check "
                    + "System Settings > Network if DNS needs adjustment."
            )
        }
        return emergencyReleaseOutcome(dnsRestored: dnsRestored, coreSurvived: coreSurvived)
        }
        return try suppliedStorage == nil ? storage.locked(disarm) : disarm()
    } catch {
        fputs(
            "Tono emergency recovery could not use update evidence (\(error)). Releasing the network.\n",
            stderr
        )
        guard emergencyReleaseDespiteUnreadableLedger(strictKillSwitchEnabled: false) else {
            return .refused
        }
        return releaseNetworkWithoutLedger()
    }
}

/// One-command recovery for a daemon that refuses its own GUI (a stale
/// incarnation, a mismatched allowed-uid record, or any Forbidden loop the
/// app cannot break over the socket). Disarms protection exactly like
/// --emergency-disarm, then removes this installation — daemon registration,
/// launchd plist, allowed-uid record, and the executables — so the next app
/// launch performs a clean authenticated reinstall.
func runEmergencyReset() -> Bool {
    guard geteuid() == 0 else { return false }
    do {
        let storage = try UpdateStorage()
        return try storage.locked {
            let attempt = try storage.load().attempt
            guard attempt == nil || attempt?.receipt.phase == .committed else {
                throw HelperFailure.invalid("Pending update evidence prevents helper reset. Use explicit emergency-disarm, not removal.")
            }
            return runEmergencyResetLocked(storage)
        }
    } catch {
        fputs(
            "Helper removal refused (\(error)). Update evidence kept. Releasing the network.\n",
            stderr
        )
        return runEmergencyDisarm()
    }
}

private func runEmergencyResetLocked(_ storage: UpdateStorage) -> Bool {
    // Stop the daemon FIRST: with KeepAlive it can otherwise service a
    // concurrent GUI arm between this tool's disarm and the removal below,
    // re-writing PF state that then survives with no helper left installed —
    // a fail-closed machine with no owner.
    let bootout = Process()
    bootout.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    bootout.arguments = ["bootout", "system/com.raydocs.tono.core-helper"]
    bootout.standardOutput = FileHandle.nullDevice
    bootout.standardError = FileHandle.nullDevice
    // A daemon that is not currently bootstrapped makes bootout fail; the
    // reset continues either way.
    try? bootout.run()
    bootout.waitUntilExit()

    switch emergencyRelease(underLock: storage) {
    case .released, .coreStillRunning:
        // The administrator asked for removal; the survivor was reported.
        break
    case .refused:
        // Protection could not be released; removing the installation now
        // would strand the machine fail-closed with nothing able to enforce
        // or undo it. Put the daemon registration back and keep everything.
        bootstrapHelperDaemon()
        fputs(
            "Tono emergency reset aborted: protection could not be released; "
            + "the installation was left in place.\n",
            stderr
        )
        return false
    case .dnsRestoreFailed:
        // PF is open, but DNS may still point at the stopped resolver.
        // The daemon retries that restore while the Core is down; removing
        // it would leave nothing to retry (#1165).
        bootstrapHelperDaemon()
        fputs(
            "Tono emergency reset released protection but could not restore DNS; "
            + "the helper was kept to retry it. Run the reset again later.\n",
            stderr
        )
        return false
    }
    removeHelperInstallation()
    print("Tono helper installation removed. Reopen Tono to reinstall it.")
    return true
}

private func bootstrapHelperDaemon() {
    let restore = Process()
    restore.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    restore.arguments = [
        "bootstrap", "system",
        "/Library/LaunchDaemons/com.raydocs.tono.core-helper.plist",
    ]
    restore.standardOutput = FileHandle.nullDevice
    restore.standardError = FileHandle.nullDevice
    try? restore.run()
    restore.waitUntilExit()
}

/// Removal after a verified release. Callers have released PF first.
private func removeHelperInstallation() {
    // PF is released. Take Tono's hook back out of /etc/pf.conf and delete the
    // backups written before its first edits. A hook left behind only loads the
    // disarmed placeholder anchor, so a failure is reported, not fatal.
    do {
        try KillSwitchManager.removeMainHookAndBackups()
    } catch {
        fputs("Tono emergency reset left its /etc/pf.conf hook in place: \(error)\n", stderr)
    }
    // The socket goes too: it is still owned by the account this helper
    // served, and another account's app reads that owner as "bound to them".
    for path in [
        "/Library/LaunchDaemons/com.raydocs.tono.core-helper.plist",
        allowedUIDPath,
        mihomoPath,
        "/Library/PrivilegedHelperTools/tono-core-helper",
        socketPath,
    ] {
        unlink(path)
    }
}

/// Whether a Tono app that can use this helper is still on this Mac: a Tono
/// client process is running (wherever its bundle now is), or a Tono app sits
/// in /Applications or the bound user's ~/Applications — as Tono.app or as a
/// renamed copy declaring Tono's bundle identifier. Anything that cannot be
/// read counts as present, so doubt keeps protection.
func tonoAppPresent(
    applicationsDirectory: String = "/Applications",
    userApplicationsDirectory: String? = boundUserApplicationsDirectory(),
    clientRunning: () -> Bool = tonoClientProcessRunning
) -> Bool {
    if tonoAppIn(applicationsDirectory) { return true }
    if let userApplicationsDirectory {
        var metadata = stat()
        // No ~/Applications folder is no app there; any other failure is doubt.
        if lstat(userApplicationsDirectory, &metadata) == 0 {
            if tonoAppIn(userApplicationsDirectory) { return true }
        } else if errno != ENOENT {
            return true
        }
    }
    return clientRunning()
}

private func tonoAppIn(_ applicationsDirectory: String) -> Bool {
    var metadata = stat()
    if lstat("\(applicationsDirectory)/Tono.app", &metadata) == 0 { return true }
    guard errno == ENOENT,
          let entries = try? FileManager.default.contentsOfDirectory(atPath: applicationsDirectory)
    else { return true }
    for entry in entries where entry.hasSuffix(".app") {
        // An iPhone or iPad app on Apple silicon has no Contents folder
        // (`WrappedBundle -> Wrapper/<name>.app`) and cannot be a runnable
        // Tono; counting it as present kept every removed Tono's protection
        // (BRICK-M3). Only a missing Contents skips; any other doubt below
        // still counts as present.
        var contents = stat()
        if lstat("\(applicationsDirectory)/\(entry)/Contents", &contents) != 0 {
            let failure = errno
            if failure == ENOENT || failure == ENOTDIR { continue }
        }
        let infoPath = "\(applicationsDirectory)/\(entry)/Contents/Info.plist"
        // Bounded and regular-file only: this runs as root at every start. A
        // bundle whose Info.plist is missing or unreadable may be a renamed
        // Tono mid-copy, so it counts as present too.
        let fd = open(infoPath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if fd < 0 { return true }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, fileType(info) == mode_t(S_IFREG),
              info.st_size <= 1024 * 1024,
              let data = try? handle.readToEnd(),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil)
                as? [String: Any]
        else { return true }
        if plist["CFBundleIdentifier"] as? String == "com.raydocs.tono" { return true }
    }
    return false
}

/// The bound user's ~/Applications, or nil when no bound user resolves (no
/// allowed-uid file, or the account was deleted).
func boundUserApplicationsDirectory() -> String? {
    guard let uid = try? readAllowedUID(), let account = getpwuid(uid),
          let home = account.pointee.pw_dir else { return nil }
    let path = String(cString: home)
    return path.hasPrefix("/") ? path + "/Applications" : nil
}

/// Whether any running process is a Tono client this helper would accept: an
/// executable at `<bundle>.app/Contents/MacOS/Tono` that satisfies
/// `TonoPeerAuthorizer.clientRequirementText`. The name filter keeps this to a
/// few Security lookups; renaming the executable breaks the signature anyway.
/// A pid listing that fails counts as running.
func tonoClientProcessRunning() -> Bool {
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString(
        TonoPeerAuthorizer.clientRequirementText as CFString, SecCSFlags(rawValue: 0), &requirement
    ) == errSecSuccess, let requirement else { return true }
    let capacity = proc_listallpids(nil, 0)
    guard capacity > 0 else { return true }
    var pids = [Int32](repeating: 0, count: Int(capacity) + 32)
    let count = pids.withUnsafeMutableBytes {
        proc_listallpids($0.baseAddress, Int32($0.count))
    }
    guard count > 0 else { return true }
    return tonoClientAmong(Array(pids.prefix(Int(count))), name: processShortName,
                           path: processExecutablePath, live: processLiveness) { pid in
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(
            nil, [kSecGuestAttributePid: pid] as CFDictionary, SecCSFlags(rawValue: 0), &code
        ) == errSecSuccess, let code else { return nil }
        switch SecCodeCheckValidity(code, SecCSFlags(rawValue: 0), requirement) {
        case errSecSuccess: return true
        // Only a definite requirement mismatch is "not Tono". Unsigned,
        // invalidated or unreadable code is unknown, not a mismatch.
        case errSecCSReqFailed: return false
        default: return nil
        }
    }
}

/// The decision over one pid listing. Only a candidate — a process whose BSD
/// short name is Tono's executable name, which exec sets from the file and a
/// deleted bundle does not change — is looked at further; every other process
/// is skipped even when its lookups fail, or any Mac with one unreadable
/// process would keep the helper forever. A name lookup that fails also skips
/// the pid. `path` and `signed` return nil when the lookup fails; `live`
/// returns false only for a pid that has definitely exited, and nil when that
/// cannot be told. A candidate whose lookup failed counts as a Tono client
/// unless it has definitely exited: doubt keeps protection.
func tonoClientAmong(
    _ pids: [Int32],
    name: (Int32) -> String?,
    path: (Int32) -> String?,
    live: (Int32) -> Bool?,
    signed: (Int32) -> Bool?
) -> Bool {
    let executableName = String(UpdatePackage.appExecutable.split(separator: "/").last ?? "")
    for pid in pids where pid > 0 {
        guard name(pid) == executableName else { continue }
        guard let executable = path(pid) else {
            if live(pid) != false { return true }
            continue
        }
        guard executable.hasSuffix(".app" + UpdatePackage.appExecutable) else { continue }
        switch signed(pid) {
        case .some(true): return true
        case .some(false): continue
        case .none: if live(pid) != false { return true }
        }
    }
    return false
}

/// The kernel's short name for `pid` (p_name, else p_comm), or nil.
private func processShortName(_ pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: 64)
    guard proc_name(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
}

private func processExecutablePath(_ pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) * 4)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
}

/// true: live, not a zombie. false: definitely exited (a zombie, or no such
/// process). nil: the lookup failed some other way.
private func processLiveness(_ pid: Int32) -> Bool? {
    var info = proc_bsdinfo()
    let (size, lookupError) = withUnsafeMutablePointer(to: &info) { pointer -> (Int32, Int32) in
        let size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        return (size, errno)
    }
    if size == MemoryLayout<proc_bsdinfo>.size { return info.pbi_status != UInt32(SZOMB) }
    if size <= 0, lookupError == ESRCH { return false }
    if kill(pid, 0) == -1, errno == ESRCH { return false }
    return nil
}

/// At every helper start, after executor recovery (H19-O-F1). Dragging
/// Tono.app to the Trash is the only way to remove Tono from a Mac, and it
/// left this KeepAlive daemon re-arming PF at every boot with no app that could
/// release it and no instructions outside the deleted app. The barrier stays
/// while a Tono app can still use it (`tonoAppPresent`: running, or in
/// /Applications or ~/Applications), or an unfinished update attempt may be
/// putting one back. When a start finds neither, release exactly as
/// `--emergency-reset` does and remove this installation. Only at a start,
/// never mid-session.
func releaseIfTonoWasRemoved(
    storage suppliedStorage: UpdateStorage? = nil,
    applicationsDirectory: String = "/Applications",
    userApplicationsDirectory: String? = boundUserApplicationsDirectory(),
    clientRunning: () -> Bool = tonoClientProcessRunning,
    release: (UpdateStorage) -> Bool = { releaseRemovedInstallationLocked($0) }
) -> Bool {
    guard !tonoAppPresent(applicationsDirectory: applicationsDirectory,
                          userApplicationsDirectory: userApplicationsDirectory,
                          clientRunning: clientRunning) else { return false }
    do {
        let storage = try suppliedStorage ?? UpdateStorage()
        return try storage.locked {
            let attempt = try storage.load().attempt
            guard attempt == nil || attempt?.receipt.phase == .committed,
                  !tonoAppPresent(applicationsDirectory: applicationsDirectory,
                                  userApplicationsDirectory: userApplicationsDirectory,
                                  clientRunning: clientRunning) else { return false }
            return release(storage)
        }
    } catch {
        return false
    }
}

/// Nothing is removed unless the stale core stops, DNS is restored and PF is
/// disarmed (`runEmergencyDisarm`); otherwise startup continues and
/// `SocketServer.run` releases a leftover kill switch when the Core is not
/// running. The daemon has not opened its socket yet, so no GUI arm can
/// interleave, unlike the `--emergency-reset` tool.
///
/// A DNS restore failure still opens PF but keeps the installation: this
/// daemon's DNS recovery and the next removal check retry it (#1165). So
/// does a Core that survived SIGKILL: the next removal check stops it again
/// (#1251). So does an AI layer (sinkhole resolver or blackhole route) not
/// proven gone, including one that cannot be read: only this helper's start
/// and watchdog retry its removal, and without them the `/etc/resolver`
/// sinkhole outlives Tono. That is read
/// from the system, not the recovery record: a full disk can lose the record
/// while the layer stays, and a corrupt receipt can keep the record pending
/// after the layer is gone. With the record lost, start-time recovery has
/// nothing to retry, so this check removes what it finds before deciding.
func releaseRemovedInstallationLocked(
    _ storage: UpdateStorage,
    release: (UpdateStorage) -> EmergencyReleaseOutcome = { emergencyRelease(underLock: $0) },
    clearSelectiveLayer: () -> Bool = {
        if !SelectiveFailOpenInstaller.layerProvenAbsent() { SelectiveFailOpenInstaller.removeBestEffort() }
        return SelectiveFailOpenInstaller.layerProvenAbsent()
    },
    removeInstallation: () -> Void = { removeHelperInstallation(); bootoutRemovedHelper() }
) -> Bool {
    switch release(storage) {
    case .released:
        if !clearSelectiveLayer() {
            fputs("tono: removal kept the helper because the AI-service layer was not removed; retrying later\n", stderr)
            return false
        }
        removeInstallation()
        return true
    case .refused:
        return false
    case .dnsRestoreFailed:
        fputs("tono: removal kept the helper because DNS was not restored; retrying later\n", stderr)
        return false
    case .coreStillRunning:
        fputs("tono: removal kept the helper because a stale Core is still running; retrying later\n", stderr)
        return false
    }
}

func bootoutRemovedHelper() {
    // Unload this job last. launchd ends it with SIGTERM, which must now stop
    // the process instead of setting the shutdown flag. If the bootout does
    // not happen, the plist and executable are already gone, so nothing loads
    // it at the next boot.
    signal(SIGTERM, SIG_DFL)
    let bootout = Process()
    bootout.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    bootout.arguments = ["bootout", "system/com.raydocs.tono.core-helper"]
    bootout.standardOutput = FileHandle.nullDevice
    bootout.standardError = FileHandle.nullDevice
    try? bootout.run()
    bootout.waitUntilExit()
}

func fileType(_ value: stat) -> mode_t {
    value.st_mode & mode_t(S_IFMT)
}

func secureMetadata(
    _ path: String,
    type: mode_t,
    owner: uid_t,
    allowOwner: uid_t? = nil,
    rejectWritableByGroupOrWorld: Bool = true
) throws -> stat {
    var metadata = stat()
    guard lstat(path, &metadata) == 0 else {
        throw HelperFailure.system("Required helper file is unavailable.")
    }
    guard fileType(metadata) == type,
          metadata.st_uid == owner || metadata.st_uid == allowOwner else {
        throw HelperFailure.invalid("Helper file ownership or type is invalid.")
    }
    if rejectWritableByGroupOrWorld, metadata.st_mode & 0o022 != 0 {
        throw HelperFailure.invalid("Helper file permissions are unsafe.")
    }
    return metadata
}

func readAllowedUID() throws -> uid_t {
    _ = try secureMetadata(allowedUIDPath, type: mode_t(S_IFREG), owner: 0)
    let value = try String(contentsOfFile: allowedUIDPath, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let parsed = UInt32(value), parsed > 0 else {
        throw HelperFailure.invalid("Allowed user configuration is invalid.")
    }
    return uid_t(parsed)
}

func canonicalPath(_ path: String) -> String? {
    guard !path.utf8.contains(0), path.utf8.count < Int(PATH_MAX) else { return nil }
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
    return path.withCString { source in
        guard realpath(source, &buffer) != nil else { return nil }
        return String(cString: buffer)
    }
}

func homeDirectory(for uid: uid_t) throws -> String {
    guard let record = getpwuid(uid), let directory = record.pointee.pw_dir else {
        throw HelperFailure.invalid("Allowed user has no home directory.")
    }
    return String(cString: directory)
}

func allowedGroup(for uid: uid_t) throws -> gid_t {
    guard let record = getpwuid(uid) else {
        throw HelperFailure.invalid("Allowed user is unavailable.")
    }
    return record.pointee.pw_gid
}

func ensureRootDirectory(_ path: String, permissions: mode_t) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        guard errno == ENOENT, mkdir(path, permissions) == 0 else {
            throw HelperFailure.system("Could not create helper runtime directory.")
        }
    } else {
        guard fileType(metadata) == mode_t(S_IFDIR), metadata.st_uid == 0,
              metadata.st_mode & 0o022 == 0 else {
            throw HelperFailure.invalid("Helper runtime directory is unsafe.")
        }
    }
    guard chown(path, 0, 0) == 0, chmod(path, permissions) == 0 else {
        throw HelperFailure.system("Could not secure helper runtime directory.")
    }
}

func removeIfPresent(_ path: String, requiredType: mode_t, allowedOwner: uid_t) throws {
    var metadata = stat()
    guard lstat(path, &metadata) == 0 else {
        if errno == ENOENT { return }
        throw HelperFailure.system("Could not inspect stale helper state.")
    }
    guard fileType(metadata) == requiredType,
          metadata.st_uid == 0 || metadata.st_uid == allowedOwner else {
        throw HelperFailure.invalid("Refusing to replace unsafe helper state.")
    }
    guard unlink(path) == 0 else {
        throw HelperFailure.system("Could not remove stale helper state.")
    }
}

func writeAll(_ fd: Int32, bytes: UnsafeRawPointer, count: Int) throws {
    var offset = 0
    while offset < count {
        let written = Darwin.write(fd, bytes.advanced(by: offset), count - offset)
        if written < 0 {
            if errno == EINTR { continue }
            throw HelperFailure.system("Write failed.")
        }
        guard written > 0 else { throw HelperFailure.system("Write failed.") }
        offset += written
    }
}

func atomicCopy(
    source: String,
    destination: String,
    expectedOwner: uid_t,
    expectedSHA256: String,
    maximumBytes: Int64,
    required: Bool
) throws {
    guard expectedSHA256.range(
        of: #"^[0-9a-f]{64}$"#,
        options: .regularExpression
    ).map({ $0 == expectedSHA256.startIndex..<expectedSHA256.endIndex }) == true else {
        throw HelperFailure.invalid("Runtime input digest is invalid.")
    }
    // O_NONBLOCK: the source is a document a same-user process can swap for a
    // FIFO with no writer, and without it this open hangs the helper's single
    // request thread (and the watchdog behind it) with PF armed. A writerless
    // FIFO returns at once and the regular-file check below refuses it;
    // regular-file reads are unaffected (MAC-HELPER-CONFIG-FIFO).
    let sourceFD = open(source, O_RDONLY | O_CLOEXEC | O_NONBLOCK | O_NOFOLLOW)
    if sourceFD < 0 {
        if !required, errno == ENOENT {
            var existing = stat()
            if lstat(destination, &existing) == 0 {
                guard fileType(existing) == mode_t(S_IFREG), existing.st_uid == 0,
                      unlink(destination) == 0 else {
                    throw HelperFailure.invalid("Could not remove a stale runtime file.")
                }
            }
            return
        }
        throw HelperFailure.invalid("Required Tono runtime input is unavailable.")
    }
    defer { close(sourceFD) }

    var metadata = stat()
    guard fstat(sourceFD, &metadata) == 0,
          fileType(metadata) == mode_t(S_IFREG),
          metadata.st_uid == expectedOwner,
          metadata.st_mode & 0o022 == 0,
          metadata.st_size >= 0,
          metadata.st_size <= maximumBytes else {
        throw HelperFailure.invalid("Tono runtime input failed ownership, type, or size checks.")
    }

    let temporary = "\(destination).new.\(UUID().uuidString)"
    let destinationFD = open(
        temporary,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
        0o600
    )
    guard destinationFD >= 0 else {
        throw HelperFailure.system("Could not create a runtime snapshot.")
    }
    var completed = false
    defer {
        close(destinationFD)
        if !completed { unlink(temporary) }
    }

    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    var copiedBytes: Int64 = 0
    var digest = SHA256()
    while true {
        let count = Darwin.read(sourceFD, &buffer, buffer.count)
        if count == 0 { break }
        if count < 0 {
            if errno == EINTR { continue }
            throw HelperFailure.system("Could not read a runtime input.")
        }
        copiedBytes += Int64(count)
        guard copiedBytes <= maximumBytes else {
            throw HelperFailure.invalid("Tono runtime input grew beyond its size limit.")
        }
        try buffer.withUnsafeBytes {
            guard let base = $0.baseAddress else { return }
            try writeAll(destinationFD, bytes: base, count: count)
            digest.update(bufferPointer: UnsafeRawBufferPointer(
                start: base,
                count: count
            ))
        }
    }
    let actualSHA256 = digest.finalize().map {
        String(format: "%02x", $0)
    }.joined()
    guard actualSHA256 == expectedSHA256 else {
        throw HelperFailure.invalid("Runtime input changed before its secure snapshot.")
    }
    guard fsync(destinationFD) == 0,
          fchown(destinationFD, 0, 0) == 0,
          fchmod(destinationFD, 0o600) == 0,
          rename(temporary, destination) == 0 else {
        throw HelperFailure.system("Could not commit the runtime snapshot.")
    }
    completed = true
}


signal(SIGPIPE, SIG_IGN)
signal(SIGTERM, requestHelperShutdown)
signal(SIGINT, requestHelperShutdown)
umask(0o077)
func updateAllowsOrdinaryInstall() -> Bool {
    guard geteuid() == 0 else { return false }
    do {
        let storage = try UpdateStorage()
        return try storage.locked {
            let attempt = try storage.load().attempt
            return UpdateExecutor.allowsOrdinaryInstall(attempt)
        }
    } catch { return false }
}

if CommandLine.arguments.dropFirst() == ["--update-install-allowed"] {
    exit(updateAllowsOrdinaryInstall() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--update-install-guard"] {
    guard geteuid() == 0 else { exit(1) }
    do {
        let storage = try UpdateStorage()
        let status = try storage.locked { () throws -> Int32 in
            let attempt = try storage.load().attempt
            guard UpdateExecutor.allowsOrdinaryInstall(attempt) else {
                throw HelperFailure.invalid("Pending update prevents helper repair.")
            }
            let installer = Process()
            installer.executableURL = URL(fileURLWithPath: "/bin/sh")
            installer.standardInput = FileHandle.standardInput
            try installer.run()
            installer.waitUntilExit()
            return installer.terminationStatus
        }
        exit(status)
    } catch { exit(1) }
}
if CommandLine.arguments.dropFirst() == ["--update-executor"] {
    exit(UpdateExecutor.run() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--update-self-test"] {
    exit(runUpdateSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--update-install-policy-self-test"] {
    let components = UpdateContractV1.Components(
        appSha256: String(repeating: "a", count: 64),
        coreSha256: String(repeating: "b", count: 64),
        privilegedSha256: String(repeating: "c", count: 64))
    let manifest = UpdateContractV1.ReleaseManifest(
        appVersion: "0.0.75", buildCommit: String(repeating: "d", count: 40),
        kind: "tonoUpdateManifest", protocolVersion: 1, releaseId: "install-policy-test",
        releaseSequence: 14, targets: [
            .init(artifactSha256: String(repeating: "e", count: 64), artifactSizeBytes: 3,
                  components: components, id: .macosArm64),
            .init(artifactSha256: String(repeating: "f", count: 64), artifactSizeBytes: 3,
                  components: components, id: .windowsX86_64)])
    guard let manifestBytes = try? UpdateContractV1.canonical(manifest),
          let manifestHash = try? manifest.sha256() else { exit(1) }
    func witness(_ execution: UpdateStorage.Execution,
                 _ phase: UpdateContractV1.Phase) -> UpdateStorage.Attempt {
        let receipt = UpdateContractV1.Receipt(
            attemptId: String(repeating: "a", count: 64), blockedReason: nil,
            createdAtUnix: 1, expiresAtUnix: 172_801, initiatingGeneration: 1,
            installedLocationSha256: UpdateTransaction.location, kind: "tonoUpdateReceipt",
            manifestSha256: manifestHash, owner: "uid:501:YY57758GS7:com.raydocs.tono",
            phase: phase, protocolVersion: 1, requiredRecovery: .unprotected,
            successorGeneration: [.installedIdentityVerified, .recoveryVerified, .committed].contains(phase) ? 2 : nil,
            targetId: .macosArm64, updatedAtUnix: 1)
        return UpdateStorage.Attempt(
            manifest: manifestBytes, signature: Data(repeating: 0, count: 64), receipt: receipt,
            initiatingToken: Data("initiator".utf8), initiatingBoot: "test",
            successorToken: phase == .installedIdentityVerified || phase == .committed ? Data("successor".utf8) : nil,
            successorBoot: phase == .installedIdentityVerified || phase == .committed ? "test" : nil,
            execution: execution, originalComponents: components,
            requiresTUN: false, disconnectRequested: false, disconnectVerified: false)
    }
    var blocked = witness(.consumed, .installationAuthorized)
    blocked.receipt.blockedReason = .installationUncertain
    var requested = witness(.consumed, .installationAuthorized)
    requested.disconnectRequested = true
    var verified = requested
    verified.disconnectVerified = true
    let allowed = UpdateExecutor.allowsOrdinaryInstall(nil)
        && UpdateExecutor.allowsOrdinaryInstall(witness(.replaced, .committed))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.reserved, .preparing))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.staged, .preparing))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.consumed, .installationAuthorized))
        && !UpdateExecutor.allowsOrdinaryInstall(blocked)
        && !UpdateExecutor.allowsOrdinaryInstall(requested)
        && !UpdateExecutor.allowsOrdinaryInstall(verified)
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.replacing, .installationAuthorized))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.rollingBack, .installationAuthorized))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.rolledBack, .installationAuthorized))
        && !UpdateExecutor.allowsOrdinaryInstall(witness(.replaced, .installedIdentityVerified))
    if allowed { print("PASS update ordinary-install policy") }
    exit(allowed ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--quit-ai-hold-self-test"] {
    let armed = KillSwitchManager.quitPreservesAIHold(broadProtection: true, disposition: nil, removalPending: false)
    let retained = KillSwitchManager.quitPreservesAIHold(broadProtection: false, disposition: true, removalPending: false)
    let idle = KillSwitchManager.quitPreservesAIHold(broadProtection: false, disposition: nil, removalPending: false)
    let restored = KillSwitchManager.quitPreservesAIHold(broadProtection: false, disposition: false, removalPending: false)
    let removing = KillSwitchManager.quitPreservesAIHold(broadProtection: true, disposition: true, removalPending: true)
    let passed = armed && retained && !idle && !restored && !removing
    if passed { print("PASS ordinary Quit selective AI disposition") }
    exit(passed ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--version"] {
    print(helperVersion)
    exit(0)
}
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--runtime-contract-check" {
    let contents = try? String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
    exit(contents.map(ownedRuntimeConfigIsSafe) == true ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--core-lifecycle-self-test"] {
    exit(runCoreLifecycleSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--staging-self-test"] {
    exit(runStagingRefusalSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--lifecycle-self-test"] {
    let pfPassed = KillSwitchManager.runLifecycleSelfTests()
        && KillSwitchManager.runInterruptedSelectiveReleaseSelfTest()
        && KillSwitchManager.runInterruptedExplicitRemovalSelfTest()
        && KillSwitchManager.runFailedSelectiveRemovalRetrySelfTest()
        && SelectiveFailOpenInstaller.runResolverOwnershipSelfTest()
    let dnsPassed = ProtectedDNSManager.runRestoreReadFailureSelfTest()
        && ProtectedDNSManager.runRepeatedOwnedRestoreSelfTest()
        && ProtectedDNSManager.runPreferencesContentionSelfTest()
        && ProtectedDNSManager.runStatusUnreadableServiceSelfTest()
        && ProtectedDNSManager.runCorruptSnapshotSelfTest()
        && ProtectedDNSManager.runRenamedServiceRestoreSelfTest()
        && ProtectedDNSManager.runDeferredOriginalLossSelfTest()
    let selectiveRoutesPassed = SelectiveFailOpen.runRouteGatewaySelfTest()
    let upgradeCommitPassed = runSilentUpgradeCommitSelfTest()
    exit(pfPassed && dnsPassed && selectiveRoutesPassed && upgradeCommitPassed ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--self-test"] {
    exit(
        KillSwitchManager.runSelfTests()
            && ProtectedDNSManager.runSelfTests()
            && TonoPeerAuthorizer.runSelfTests()
            && runRequestContractSelfTests()
            && runHelperUpgradeAdmissionSelfTest()
            && runUpgradeSourceSelfTest()
            && runSilentUpgradeStagingSelfTest()
            && runBuildSourceSealSelfTest()
            && runPFTokenForgetSelfTest()
            && runLanDNSScopeSelfTest()
            && runLANScopePreservationSelfTest()
            && runReadRequestBoundSelfTest()
            && ProtectionCheckSchedule.runClockStepSelfTest()
            && runCoreLifecyclePolicySelfTests()
            && runOwnedRuntimeContractSelfTests()
            && PowerTransitionGate.runSelfTests()
            && runStartupOrderSelfTest()
            && runStartupDNSRecoverySelfTest()
            && KillSwitchManager.runFailedCommitReleaseSelfTest()
            && KillSwitchManager.runFailedBarrierSelectiveReleaseSelfTest()
            && KillSwitchManager.runFailedBarrierUnreleasedSelfTest()
            && SocketServer.runOrphanedBootstrapSelectiveReleaseSelfTest()
            && KillSwitchManager.runUnprovenHealthSelfTest()
            && KillSwitchManager.runControlRelayPermitSelfTest()
            && emergencyReleaseDespiteUnreadableLedger(strictKillSwitchEnabled: false)
            && !emergencyReleaseDespiteUnreadableLedger(strictKillSwitchEnabled: true)
            && emergencyReleaseDespiteStaleCore(strictKillSwitchEnabled: false)
            && !emergencyReleaseDespiteStaleCore(strictKillSwitchEnabled: true)
            && SelectiveFailOpen.runSelfTests()
            ? 0 : 1
    )
}
if CommandLine.arguments.dropFirst() == ["--network-self-test"] {
    exit(KillSwitchManager.runNetworkSelfTest() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--emergency-disarm"] {
    exit(runEmergencyDisarm() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--emergency-reset"] {
    exit(runEmergencyReset() ? 0 : 1)
}
do {
    // Executor recovery must precede CoreManager's stale-child cleanup.
    // startup() does not install a PF block, including when the ledger is
    // corrupt (BRICK-M1). It returns a clean stop when the executor's own
    // bootout interrupts this daemon behind the update lock — in that window
    // the executor owns the flow and no PF action is ours to take.
    if try UpdateExecutor.startup() { exit(0) }
    if releaseIfTonoWasRemoved() { exit(0) }
} catch {
    exit(1)
}
if let server = startHelperDaemon(
    restoreProtection: { uid in try KillSwitchManager(allowedUID: uid) },
    startServer: { uid, killSwitch in try SocketServer(allowedUID: uid, killSwitch: killSwitch) },
    secureFailedStartup: {
        secureFailedStartupRestoringDNS(
            releaseBlock: KillSwitchManager.secureFailedStartup,
            restoreDNS: { _ = try ProtectedDNSManager().restore(deferringLossNotice: true) }
        )
    }
) {
    server.run()
} else {
    exit(1)
}
