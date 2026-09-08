import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

let helperVersion = HelperProtocolVersion.current
let socketDirectory = "/var/run/tono-core"
let socketPath = "\(socketDirectory)/service.sock"
let runtimeDirectory = "\(socketDirectory)/runtime"
let runtimeConfigPath = "\(runtimeDirectory)/config.yaml"
let pidPath = "\(socketDirectory)/mihomo.pid"
let allowedUIDPath = "/Library/PrivilegedHelperTools/tono.allowed-uid"
let mihomoPath = "/Library/PrivilegedHelperTools/tono-mihomo"
let maximumRequestBytes = 16 * 1024
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
        case .invalid(let message), .system(let message): message
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
              $0.executablePath == expectedExecutablePath else { return nil }
        return $0.pid
    }.sorted()
}

func runCoreLifecyclePolicySelfTests() -> Bool {
    staleOwnedCorePIDs(in: [
        .init(pid: 31, executablePath: mihomoPath, uid: 0),
        .init(pid: 32, executablePath: mihomoPath, uid: 501),
        .init(pid: 33, executablePath: "/tmp/tono-mihomo", uid: 0),
    ]) == [31]
}

func ownedRuntimeConfigIsSafe(_ contents: String) -> Bool {
    contents.hasPrefix("# Tono owned runtime")
        && contents.contains("\nallow-lan: false\n")
        && contents.contains("\nipv6: false\n")
        && contents.contains("\nmode: rule\n")
        && contents.contains("\nexternal-controller: '127.0.0.1:")
        && contents.contains("\n  listen: \(ProtectedDNSContract.listener)\n")
        && contents.contains("\n  enhanced-mode: fake-ip\n")
        && contents.contains("\n  device: utun199\n")
        && contents.contains("\n  - MATCH,Tono-Exit")
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
    let configPath = "\(configDirectory)/config.yaml"

    // A core already running would own the DNS port this one needs.
    let probe = Process()
    probe.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    // `-x` matches the process name, not the whole command line: with `-f` this
    // matched any shell whose arguments happened to mention the core, including
    // the one running this test.
    probe.arguments = ["-x", "tono-mihomo"]
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

    // Shaped to satisfy `ownedRuntimeConfigIsSafe` and to be accepted by the
    // core, with the tunnel switched off: the predicate requires the device to
    // be named, not to be created, and creating one would rearrange the routing
    // table of whatever machine this runs on.
    let config = """
    # Tono owned runtime
    allow-lan: false
    ipv6: false
    mode: rule
    log-level: warning
    external-controller: '127.0.0.1:29394'
    secret: 'core-lifecycle-self-test'
    dns:
      enable: true
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
      fake-ip-range: 198.18.0.1/16
      nameserver:
        - 223.5.5.5
    tun:
      enable: false
      device: utun199
      stack: gvisor
    proxies: []
    proxy-groups:
      - name: Tono-Exit
        type: select
        proxies:
          - DIRECT
    rules:
      - MATCH,Tono-Exit

    """
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
        sweep.arguments = ["-x", "tono-mihomo"]
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

    if failures.isEmpty { return true }
    FileHandle.standardError.write(Data(
        "staging self-test failed: \(Set(failures).sorted().joined(separator: ", "))\n".utf8
    ))
    return false
}

func runOwnedRuntimeContractSelfTests() -> Bool {
    let valid = """
    # Tono owned runtime
    allow-lan: false
    ipv6: false
    mode: rule
    external-controller: '127.0.0.1:9090'
    dns:
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
    tun:
      device: utun199
    rules:
      - MATCH,Tono-Exit
    """
    return ownedRuntimeConfigIsSafe(valid)
        && !ownedRuntimeConfigIsSafe(
            valid.replacingOccurrences(
                of: ProtectedDNSContract.listener,
                with: "198.18.0.2:53"
            )
        )
        && !ownedRuntimeConfigIsSafe(
            valid.replacingOccurrences(
                of: ProtectedDNSContract.listener,
                with: "0.0.0.0:53"
            )
        )
}

func requestHelperShutdown(_ signal: Int32) {
    _ = signal
    helperShutdownRequested = 1
}

/// Last-resort recovery for a machine whose GUI cannot reconnect or quit
/// normally. This path is intentionally unavailable over the user socket and
/// requires an administrator to execute the installed, signed helper as root.
func runEmergencyDisarm() -> Bool {
    guard geteuid() == 0 else {
        fputs("Tono emergency recovery must be run with sudo.\n", stderr)
        return false
    }
    do {
        let allowedUID = try readAllowedUID()
        // Initialization terminates a stale owned Mihomo process before PF is
        // opened, preventing a half-running privileged runtime after recovery.
        _ = try CoreManager(allowedUID: allowedUID)
        // Restore the user's DHCP/custom DNS before opening PF. If DNS recovery
        // fails, retain fail-closed protection instead of returning a machine
        // with direct egress but a dead resolver.
        _ = try ProtectedDNSManager().restore()
        let manager = try KillSwitchManager(allowedUID: allowedUID)
        _ = try manager.disarm()
        print("Tono network protection is disarmed.")
        return true
    } catch {
        fputs("Tono emergency recovery failed; PF remains fail-closed.\n", stderr)
        return false
    }
}

/// One-command recovery for a daemon that refuses its own GUI (a stale
/// incarnation, a mismatched allowed-uid record, or any Forbidden loop the
/// app cannot break over the socket). Disarms protection exactly like
/// --emergency-disarm, then removes this installation — daemon registration,
/// launchd plist, allowed-uid record, and the executables — so the next app
/// launch performs a clean authenticated reinstall.
func runEmergencyReset() -> Bool {
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

    guard runEmergencyDisarm() else {
        // Protection could not be released; removing the installation now
        // would strand the machine fail-closed with nothing able to enforce
        // or undo it. Put the daemon registration back and keep everything.
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
        fputs(
            "Tono emergency reset aborted: protection could not be released; "
            + "the installation was left in place.\n",
            stderr
        )
        return false
    }
    for path in [
        "/Library/LaunchDaemons/com.raydocs.tono.core-helper.plist",
        allowedUIDPath,
        mihomoPath,
        "/Library/PrivilegedHelperTools/tono-core-helper",
    ] {
        unlink(path)
    }
    print("Tono helper installation removed. Reopen Tono to reinstall it.")
    return true
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
    let sourceFD = open(source, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
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
if CommandLine.arguments.dropFirst() == ["--version"] {
    print(helperVersion)
    exit(0)
}
if CommandLine.arguments.dropFirst() == ["--core-lifecycle-self-test"] {
    exit(runCoreLifecycleSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--staging-self-test"] {
    exit(runStagingRefusalSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--lifecycle-self-test"] {
    exit(KillSwitchManager.runLifecycleSelfTests() ? 0 : 1)
}
if CommandLine.arguments.dropFirst() == ["--self-test"] {
    exit(
        KillSwitchManager.runSelfTests()
            && ProtectedDNSManager.runSelfTests()
            && TonoPeerAuthorizer.runSelfTests()
            && runRequestContractSelfTests()
            && runCoreLifecyclePolicySelfTests()
            && runOwnedRuntimeContractSelfTests()
            && PowerTransitionGate.runSelfTests()
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
    let server = try SocketServer()
    server.run()
} catch {
    exit(1)
}
