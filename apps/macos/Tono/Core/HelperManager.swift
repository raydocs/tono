import Foundation
import Darwin
import Security
import ServiceManagement

/// Installs and talks to the narrowly scoped privileged Mihomo launcher.
///
/// The daemon authenticates the peer's kernel audit token and code-signing
/// identity, accepts only the current user's exact Tono config directory, and
/// snapshots inputs into a root-owned runtime folder. It also owns the
/// fail-closed PF state so Tono has one signed privileged trust boundary.
nonisolated struct HelperManager {
    static let socketPath = "/var/run/tono-core/service.sock"

    private static let helperVersion = HelperProtocolVersion.current
    private static let helperInstallPath = "/Library/PrivilegedHelperTools/tono-core-helper"
    private static let mihomoInstallPath = "/Library/PrivilegedHelperTools/tono-sing-box"
    private static let allowedUIDPath = "/Library/PrivilegedHelperTools/tono.allowed-uid"
    private static let plistInstallPath = "/Library/LaunchDaemons/com.raydocs.tono.core-helper.plist"
    private static let plistLabel = "com.raydocs.tono.core-helper"
    private static let maximumResponseBytes = 64 * 1024

    private struct Envelope: Decodable {
        let ok: Bool?
        let version: String?
        let running: Bool?
        let pid: Int?
        let configPath: String?
        let armed: Bool?
        let wantArmed: Bool?
        let live: Bool?
        let healed: Bool?
        /// Set by the helper's PF liveness supervisor after it had to reinstall
        /// the kill switch; cleared by the next arm. Absent before 4.16.0.
        let repairedSinceArm: Bool?
        let flushedStates: Bool?
        /// Addresses whose states were killed individually instead of flushing
        /// the machine. Absent from a pre-3.11.0 daemon, which only had the
        /// all-or-nothing choice.
        let killedHosts: Int?
        /// Machine-readable refusal code, for the refusals whose correct handling
        /// is a decision rather than a message. Absent from a pre-3.11.2 daemon.
        let code: String?
        let configured: Bool?
        let snapshotPresent: Bool?
        let service: String?
        /// `/dns/restore` only: `false` when the service that owned the
        /// snapshot no longer exists, so the recorded servers were archived
        /// instead of written back. A helper without service-ID snapshots
        /// never sends it.
        let originalDNSRestored: Bool?
        let lastError: String?
        let error: String?
    }

    // MARK: - Installation

    /// Installs or upgrades the daemon. The old unauthenticated `/tmp` helper is
    /// never considered current, even if it happens to answer `/version`.
    /// The privileged install, as a value. It runs as root through
    /// `osascript`, and until it was extracted here nothing tested any of it —
    /// including the Developer ID requirement that is the only thing standing
    /// between this daemon and an arbitrary binary. Build 42 shipped with the
    /// helper's code-signing identifier derived from its filename instead of
    /// its bundle id, which made every repair on every machine fail, and no
    /// check anywhere noticed.
    ///
    /// Pure so it can be asserted on without installing anything. What the
    /// string says is what root will run.
    static func installScript(
        helperSource: String,
        mihomoSource: String,
        uid: uid_t
    ) -> String {
        let helperSrc = helperSource.shellEscaped
        let mihomoSrc = mihomoSource.shellEscaped
        let plistB64 = Data(launchdPlistContents().utf8).base64EncodedString()
        let helperTemporaryPath = "\(helperInstallPath).new"
        let mihomoTemporaryPath = "\(mihomoInstallPath).new"
        let plistTemporaryPath = "\(plistInstallPath).new"
        let uidTempPath = "\(allowedUIDPath).new.\(uid)"
        return """
        set -e
        /usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools
        guard_dir=$(/usr/bin/mktemp -d /Library/PrivilegedHelperTools/tono-installer.XXXXXX)
        trap '/bin/rm -f "$guard_dir/guard"; /bin/rmdir "$guard_dir"' EXIT
        /usr/bin/install -o root -g wheel -m 0700 \(helperSrc) "$guard_dir/guard"
        /usr/bin/codesign --verify --strict --all-architectures -R='anchor apple generic and identifier "com.raydocs.tono.helper" and certificate leaf[subject.OU] = "YY57758GS7" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and entitlement["com.apple.security.get-task-allow"] absent' "$guard_dir/guard"
        "$guard_dir/guard" --update-install-guard <<'TONO_INSTALL_UNDER_ROOT_UPDATE_LOCK'
        set -e
        /usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools
        /usr/bin/install -d -o root -g wheel -m 0755 /var/run/tono-core
        /bin/rm -f '\(helperTemporaryPath)' '\(mihomoTemporaryPath)' '\(plistTemporaryPath)'
        /usr/bin/install -o root -g wheel -m 0755 \(helperSrc) '\(helperTemporaryPath)'
        /usr/bin/codesign --verify --strict --all-architectures -R='anchor apple generic and identifier "com.raydocs.tono.helper" and certificate leaf[subject.OU] = "YY57758GS7"' '\(helperTemporaryPath)'
        /usr/bin/install -o root -g wheel -m 0755 \(mihomoSrc) '\(mihomoTemporaryPath)'
        /usr/bin/codesign --verify --strict --all-architectures -R='anchor apple generic and identifier "sing-box" and certificate leaf[subject.OU] = "YY57758GS7"' '\(mihomoTemporaryPath)'
        /usr/bin/printf '%s' '\(plistB64)' | /usr/bin/base64 -D > '\(plistTemporaryPath)'
        /usr/sbin/chown root:wheel '\(plistTemporaryPath)'
        /bin/chmod 0644 '\(plistTemporaryPath)'
        /usr/bin/plutil -lint '\(plistTemporaryPath)' >/dev/null
        /usr/bin/printf '%u\\n' \(uid) > '\(uidTempPath)'
        /usr/sbin/chown root:wheel '\(uidTempPath)'
        /bin/chmod 0600 '\(uidTempPath)'
        /bin/launchctl bootout system/liquidclash.helper >/dev/null 2>&1 || true
        /bin/rm -f /Library/LaunchDaemons/liquidclash.helper.plist
        /bin/rm -f /Library/PrivilegedHelperTools/liquidclash-helper
        /bin/rm -f /Library/PrivilegedHelperTools/mihomo
        /bin/rm -f /tmp/liquidclash/service.sock
        /bin/launchctl bootout system/com.raydocs.tono.killswitch >/dev/null 2>&1 || true
        /bin/rm -f /Library/LaunchDaemons/com.raydocs.tono.killswitch.plist
        /bin/rm -f /Library/PrivilegedHelperTools/tono-killswitch
        /bin/rm -f /var/run/tono-killswitch.sock
        /bin/launchctl bootout system/\(plistLabel) >/dev/null 2>&1 || true
        /bin/mv -f '\(helperTemporaryPath)' '\(helperInstallPath)'
        /bin/mv -f '\(mihomoTemporaryPath)' '\(mihomoInstallPath)'
        /bin/mv -f '\(plistTemporaryPath)' '\(plistInstallPath)'
        /bin/mv -f '\(uidTempPath)' '\(allowedUIDPath)'
        # launchd can return EIO while replacing a daemon even though it has
        # accepted and started the new job. Treat bootstrap as a request; the
        # authenticated /version poll below is the authoritative result.
        /bin/launchctl bootstrap system '\(plistInstallPath)' || true
        TONO_INSTALL_UNDER_ROOT_UPDATE_LOCK
        """
    }

    static func installIfNeeded() throws {
        let preparationStartedAt = Date()
        LocalTrafficAudit.shared.recordEvent(
            "helper_preparation_started",
            details: [
                "expected_version": helperVersion,
                "installed_artifact_present": String(
                    hasInstalledHelperArtifact
                ),
            ]
        )
        var probe = probeDaemon()
        // A live helper can briefly miss one version probe while finishing a
        // bounded PF operation. Do not turn that transient timeout into a slow,
        // unnecessary administrator prompt and daemon replacement. A genuinely
        // clean install has no artifact, so it still reaches the prompt without
        // this retry delay. An explicit rejection is already definitive: a live
        // daemon answered and refused this app's identity.
        if probe == .unreachable, hasInstalledHelperArtifact {
            for _ in 0..<2 {
                usleep(150_000)
                probe = probeDaemon()
                if probe != .unreachable { break }
            }
        }
        let daemonRejected = probe == .rejected
        var installedVersion: String?
        if case .version(let value) = probe { installedVersion = value }
        if daemonRejected {
            // The daemon explicitly refused this app over the socket. Every
            // later IPC command would fail the same way, so the matching
            // artifact version must not short-circuit the reinstall below —
            // the authenticated install path is the only route that does not
            // depend on the socket and can replace the rejecting daemon.
            LocalTrafficAudit.shared.recordEvent(
                "helper_rejected_client_reinstall_required",
                details: [
                    "expected_version": helperVersion,
                    "installed_artifact_version":
                        installedArtifactVersion() ?? "unavailable",
                ]
            )
        } else {
            // The helper serves one authenticated request at a time. A bounded
            // arm operation can therefore make every socket version probe time
            // out even though the installed daemon is current. Query the
            // root-owned executable itself before deciding an administrator
            // reinstall is necessary; later helper operations still fail closed
            // and retry if launchd has not made the daemon responsive yet.
            if installedVersion == nil,
               installedArtifactVersion() == helperVersion {
                // A current artifact only proves the files are in place. If
                // launchd has no registration for the daemon (a bootstrap that
                // failed during a previous upgrade), no retry of the socket
                // will ever succeed and this early return would wedge every
                // connect forever — fall through to the full install instead.
                if daemonRegisteredWithLaunchd() {
                    LocalTrafficAudit.shared.recordEvent(
                        "helper_artifact_current",
                        details: [
                            "version": helperVersion,
                            "daemon_probe": "temporarily_unavailable",
                            "duration_ms": Self.durationMilliseconds(
                                since: preparationStartedAt
                            ),
                        ]
                    )
                    return
                }
                LocalTrafficAudit.shared.recordEvent(
                    "helper_daemon_unregistered_reinstall_required",
                    details: ["artifact_version": helperVersion]
                )
            }
            if installedVersion == helperVersion {
                LocalTrafficAudit.shared.recordEvent(
                    "helper_already_current",
                    details: [
                        "version": helperVersion,
                        "duration_ms": Self.durationMilliseconds(
                            since: preparationStartedAt
                        ),
                    ]
                )
                return
            }
        }
        LocalTrafficAudit.shared.recordEvent(
            "helper_upgrade_required",
            details: [
                "installed_version": installedVersion
                    ?? (daemonRejected ? "rejected_client" : "unavailable"),
                "expected_version": helperVersion,
            ]
        )

        // Recover DNS and stop Mihomo before launchd replaces an authenticated
        // older helper, but deliberately retain any live PF state. Disarming
        // here opened a direct-egress window for the entire administrator
        // prompt and left the host open if the user cancelled. The replacement
        // helper restores the persisted PF state at launch (or installs its
        // emergency block if the older state is no longer readable), and the
        // connect transaction tightens it with current metadata immediately
        // after this method returns.
        if installedVersion != nil {
            do {
                try prepareAuthenticatedHelperForReplacement(
                    restoreDNS: { _ = try restoreProtectedDNSIfConfigured() },
                    stopCore: stopCore,
                    killSwitchStatus: killSwitchStatus
                )
            } catch {
                LocalTrafficAudit.shared.recordEvent(
                    "helper_upgrade_preflight_failed",
                    details: ["error": error.localizedDescription]
                )
                throw HelperInstallError.installFailed(
                    "The previous network helper could not stop the core and "
                        + "retain firewall protection safely. "
                        + error.localizedDescription
                )
            }
        }

        guard let helperSource = Bundle.main.url(forResource: "tono-core-helper", withExtension: nil),
              let mihomoSource = Bundle.main.url(forResource: "sing-box", withExtension: nil) else {
            throw HelperInstallError.resourceNotFound
        }

        if installedVersion != nil, !daemonRejected {
            if attemptSilentUpgrade(
                helperSource: helperSource,
                mihomoSource: mihomoSource,
                preparationStartedAt: preparationStartedAt
            ) {
                return
            }
        }

        try verifyEmbeddedExecutable(
            helperSource,
            identifier: "com.raydocs.tono.helper"
        )
        try verifyEmbeddedExecutable(mihomoSource, identifier: "sing-box")

        let uid = getuid()
        guard uid > 0 else {
            throw HelperInstallError.installFailed(String(localized: "Refusing to bind the helper to root."))
        }

        let script = installScript(
            helperSource: helperSource.path,
            mihomoSource: mihomoSource.path,
            uid: uid
        )

        let prompt = "Tono needs to install its signed network helper."
        let appleScript = "do shell script \"\(script.appleScriptEscaped)\" with administrator privileges with prompt \"\(prompt.appleScriptEscaped)\""
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", appleScript]
        let errors = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errors
        LocalTrafficAudit.shared.recordEvent(
            "helper_administrator_approval_requested"
        )
        try process.run()
        // The credential dialog can sit unanswered indefinitely, and every
        // privileged coordinator call serializes behind this wait — an
        // abandoned prompt would wedge disconnect and the sleep-path PF work.
        // Bound it so walking away degrades to a denial instead.
        let promptDeadline = Date().addingTimeInterval(180)
        while process.isRunning, Date() < promptDeadline {
            usleep(200_000)
        }
        if process.isRunning {
            process.terminate()
            usleep(300_000)
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            process.waitUntilExit()
            LocalTrafficAudit.shared.recordEvent(
                "helper_administrator_prompt_timed_out"
            )
            throw HelperInstallError.userDenied
        }
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let data = errors.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: data, encoding: .utf8) ?? ""
            // AppleScript reports a dismissed credential dialog with the
            // localized "User canceled" text, so plain "cancel" matching both
            // misses non-English systems (zh-Hans emits "用户已取消") and
            // false-positives on installer stderr that merely contains
            // "cancelled". The stable signal is the -128 error code.
            if message.contains("-128")
                || message.localizedCaseInsensitiveContains("user canceled")
                || message.localizedCaseInsensitiveContains("user cancelled")
                || message.contains("已取消") {
                LocalTrafficAudit.shared.recordEvent(
                    "helper_administrator_approval_denied"
                )
                throw HelperInstallError.userDenied
            }
            LocalTrafficAudit.shared.recordEvent(
                "helper_installer_failed",
                details: ["error": String(message.prefix(500))]
            )
            throw HelperInstallError.installFailed(String(message.prefix(500)))
        }

        // A cold `launchctl bootstrap` of a freshly installed daemon has been
        // observed taking well over six seconds on a busy machine: the install
        // itself succeeded, the socket appeared moments later, and the app had
        // already surfaced a terminal "the authenticated helper did not start"
        // that only a manual retry could clear. Poll densely at first so the
        // common fast path stays immediate, then keep waiting far longer than
        // launchd realistically needs before calling it a failure.
        let startupDeadline = Date().addingTimeInterval(45)
        var probeIntervalMicroseconds: UInt32 = 100_000
        while true {
            if currentVersion() == helperVersion {
                LocalTrafficAudit.shared.recordEvent(
                    "helper_install_succeeded",
                    details: [
                        "version": helperVersion,
                        "duration_ms": Self.durationMilliseconds(
                            since: preparationStartedAt
                        ),
                    ]
                )
                return
            }
            guard Date() < startupDeadline else { break }
            usleep(probeIntervalMicroseconds)
            probeIntervalMicroseconds = min(
                probeIntervalMicroseconds * 2,
                1_000_000
            )
        }
        LocalTrafficAudit.shared.recordEvent(
            "helper_install_startup_timed_out",
            details: [
                "expected_version": helperVersion,
                "duration_ms": Self.durationMilliseconds(
                    since: preparationStartedAt
                ),
            ]
        )
        throw HelperInstallError.installFailed(String(localized: "The authenticated helper did not start."))
    }

    private static func durationMilliseconds(since start: Date) -> String {
        String(max(0, Int(Date().timeIntervalSince(start) * 1_000)))
    }

    private static func launchdPlistContents() -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
          "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(plistLabel)</string>
            <key>ProgramArguments</key>
            <array>
                <string>\(helperInstallPath)</string>
            </array>
            <key>AssociatedBundleIdentifiers</key>
            <array>
                <string>com.raydocs.tono</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>ProcessType</key>
            <string>Interactive</string>
            <key>Umask</key>
            <integer>63</integer>
            <key>StandardOutPath</key>
            <string>/dev/null</string>
            <key>StandardErrorPath</key>
            <string>/dev/null</string>
        </dict>
        </plist>
        """
    }

    /// Readies an authenticated older helper for replacement. Stopping the
    /// core and confirming that any wanted PF state is live are required: PF
    /// is the leak boundary while the daemon is swapped. DNS recovery is
    /// attempted but does not gate the swap. An older helper that cannot read
    /// its own DNS snapshot (corrupt, or naming a service that no longer
    /// exists) fails this step on every attempt, and the replacement helper
    /// is the component that can quarantine that snapshot and sweep the
    /// loopback resolver. Refusing the upgrade here left such a host in
    /// Protected Offline with no in-product way out.
    static func prepareAuthenticatedHelperForReplacement(
        restoreDNS: () throws -> Void,
        stopCore: () throws -> Void,
        killSwitchStatus: () throws -> (armed: Bool, wanted: Bool, live: Bool, healed: Bool)
    ) throws {
        do {
            try restoreDNS()
        } catch {
            LocalTrafficAudit.shared.recordEvent(
                "helper_upgrade_dns_restore_deferred",
                details: ["error": error.localizedDescription]
            )
        }
        try stopCore()
        let status = try killSwitchStatus()
        if status.armed || status.wanted, !status.live {
            throw HelperIPCError.commandFailed(
                "The previous helper could not keep PF fail-closed during its upgrade."
            )
        }
    }

    static func isHelperRunning() -> Bool {
        currentVersion() == helperVersion
    }

    /// Read-only launchd view of the helper, used to explain an unreachable
    /// helper while this Mac should be protected. Neither query needs
    /// privileges.
    enum LaunchState: Equatable {
        /// Turned off under Login Items › Allow in the Background. launchd will
        /// not start it, and no repair from the app works until it is back on.
        case backgroundDisabled
        /// launchd has no such job, so nothing restored PF after the last
        /// restart: macOS loads the PF rules at boot but leaves PF disabled.
        case notLoaded
        /// Loaded (an unreachable helper is then busy or restarting, and its PF
        /// rules stay in the kernel), or launchd could not say.
        case loadedOrUnknown
    }

    static func launchState() -> LaunchState {
        if SMAppService.statusForLegacyPlist(
            at: URL(fileURLWithPath: plistInstallPath)
        ) == .requiresApproval {
            return .backgroundDisabled
        }
        return daemonRegisteredWithLaunchd() ? .loadedOrUnknown : .notLoaded
    }

    /// What to tell the user instead of a generic repair error. nil when the
    /// launch state is no evidence that protection is off.
    static func unprotectedNotice(for state: LaunchState) -> String? {
        switch state {
        case .backgroundDisabled:
            String(localized: "Tono's network helper is turned off in System Settings > General > Login Items & Extensions, so this Mac is not protected right now. Turn Tono on under Allow in the Background, then click Retry.")
        case .notLoaded:
            String(localized: "Tono's network helper is not running, so this Mac is not protected right now. Click Retry and approve the administrator prompt to repair it.")
        case .loadedOrUnknown:
            nil
        }
    }

    static var hasInstalledHelperArtifact: Bool {
        FileManager.default.fileExists(atPath: helperInstallPath)
    }

    private enum DaemonProbe: Equatable {
        case version(String)
        /// A live daemon answered the socket and refused this app's identity.
        case rejected
        /// Transport failure, timeout, or a malformed reply.
        case unreachable
    }

    private static func probeDaemon() -> DaemonProbe {
        guard let result = try? sendRequest(method: "GET", path: "/version") else {
            return .unreachable
        }
        if result.status == 403 { return .rejected }
        guard result.status == 200,
              let envelope = try? JSONDecoder().decode(Envelope.self, from: result.body),
              envelope.ok == true,
              let version = envelope.version else {
            return .unreachable
        }
        return .version(version)
    }

    /// Whether a live daemon is refusing this app's identity outright. No IPC
    /// command can ever succeed against such a daemon; only the authenticated
    /// reinstall path (which does not use the socket) can replace it.
    static func daemonRejectsClient() -> Bool {
        probeDaemon() == .rejected
    }

    /// Whether an explicit user-requested release must repair the helper before
    /// its replies can be trusted to mean "core stopped" and "DNS restored".
    ///
    /// Rejection is the obvious case: no command can succeed. Version drift is
    /// the one that shipped as a fault. A 3.11.2 daemon answers a 3.12.0 GUI
    /// normally — nothing in the IPC negotiates a version — but it restores a
    /// missing DNS snapshot as success and never sweeps a leftover 127.0.0.1
    /// resolver. Releasing against it disarms PF while the system resolver
    /// still points at a Mihomo listener that has just been stopped, which is
    /// indistinguishable from "Restore Internet took my DNS away".
    ///
    /// An absent daemon is deliberately not repaired. A first-run user who
    /// cancelled the administrator prompt owns no PF rule, core, or snapshot,
    /// and prompting them again would put a credential dialog between them and
    /// the only control that releases the machine.
    static func explicitReleaseRequiresRepair() -> Bool {
        guard hasInstalledHelperArtifact else { return false }
        switch probeDaemon() {
        case .rejected:
            return true
        case .version(let installed):
            return installed != helperVersion
        case .unreachable:
            // launchd replaces the daemon in place on upgrade, so a probe can
            // land in the second where nothing is listening. Reinstalling on
            // that would prompt for credentials the user does not owe us.
            Thread.sleep(forTimeInterval: 0.7)
            switch probeDaemon() {
            case .rejected, .unreachable: return true
            case .version(let installed): return installed != helperVersion
            }
        }
    }

    /// The daemon's own reply, not the required or on-disk helper version.
    static func currentVersion() -> String? {
        guard case .version(let value) = probeDaemon() else { return nil }
        return value
    }

    private static func daemonRegisteredWithLaunchd() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["print", "system/\(plistLabel)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            // If launchctl itself cannot run, do not force a reinstall loop.
            return true
        }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }

    static func installedArtifactVersion() -> String? {
        guard hasInstalledHelperArtifact else { return nil }
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: helperInstallPath)
        process.arguments = ["--version"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        for _ in 0..<100 where process.isRunning { usleep(20_000) }
        if process.isRunning {
            process.terminate()
            for _ in 0..<10 where process.isRunning { usleep(20_000) }
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard data.count <= 100,
              let text = String(data: data, encoding: .utf8) else { return nil }
        let version = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return version.isEmpty ? nil : version
    }

    // MARK: - Core management

    static func startCore(configDir: String, configSHA256: String) throws {
        let result = try sendJSON(
            method: "POST",
            path: "/core/start",
            object: [
                "configDir": configDir,
                "configSHA256": configSHA256,
            ]
        )
        try requireSuccess(result, operation: "start")
    }

    /// Copies the latest user-owned config into the daemon's root-owned runtime
    /// directory. The returned path is the only path Mihomo may reload.
    static func syncCoreConfig(
        configDir: String,
        configSHA256: String
    ) throws -> String {
        let result = try sendJSON(
            method: "POST",
            path: "/core/sync",
            object: [
                "configDir": configDir,
                "configSHA256": configSHA256,
            ]
        )
        let envelope = try requireSuccess(result, operation: "sync")
        guard let path = envelope.configPath, path == "/var/run/tono-core/runtime/config.json" else {
            throw HelperIPCError.invalidResponse
        }
        return path
    }

    static func stopCore() throws {
        let result = try sendRequest(method: "DELETE", path: "/core/stop")
        _ = try requireSuccess(result, operation: "stop")
    }

    static func coreStatus() -> (
        running: Bool,
        pid: Int?,
        lastError: String?,
        verified: Bool
    ) {
        guard let result = try? sendRequest(method: "GET", path: "/core/status"),
              result.status == 200,
              let envelope = try? JSONDecoder().decode(Envelope.self, from: result.body),
              envelope.ok == true else {
            // An unreachable helper is not evidence that Mihomo exited. Treating
            // that as "stopped" made the next /core/start hit 409 while mixed
            // port, 127.0.0.1:53, and utun199 were still owned.
            return (true, nil, nil, false)
        }
        return (
            envelope.running == true,
            envelope.pid,
            envelope.lastError.map { String($0.prefix(600)) },
            true
        )
    }

    // MARK: - Kill Switch

    static func armKillSwitch(
        apiHosts: [String]? = nil,
        exitNodeHints: [String]? = nil,
        tunnelInterfaces: [String]? = nil,
        proxyEndpoints: [ConfigPipeline.DialEndpoint]? = nil,
        sessionDirectEndpoints: [ConfigPipeline.DirectEndpoint]? = nil,
        tailscaleBootstrapEnabled: Bool? = nil,
        allowSystemResolution: Bool = false,
        bootstrapPins: [String: [String]] = [:],
        // No default: an omitted value silently revokes the permit while the
        // rule engine still routes that bundle direct.
        reviewedBundleDirect: Bool
    ) throws -> (armed: Bool, wanted: Bool, live: Bool, healed: Bool, flushedStates: Bool, killedHosts: Int) {
        var object: [String: Any] = [:]
        if reviewedBundleDirect { object["reviewedBundleDirect"] = true }
        if let apiHosts { object["apiHosts"] = apiHosts }
        if let exitNodeHints { object["exitHints"] = exitNodeHints }
        if let tunnelInterfaces { object["tunnelInterfaces"] = tunnelInterfaces }
        if let proxyEndpoints {
            object["proxyEndpoints"] = proxyEndpoints.map {
                [
                    "host": $0.host,
                    "port": Int($0.port),
                    "transport": $0.transport,
                ]
            }
        }
        if let sessionDirectEndpoints {
            object["sessionDirectEndpoints"] = sessionDirectEndpoints.map {
                [
                    "address": $0.address,
                    "port": Int($0.port),
                    "transport": $0.transport,
                ]
            }
        }
        if let tailscaleBootstrapEnabled {
            object["tailscaleBootstrapEnabled"] = tailscaleBootstrapEnabled
        }
        object["allowSystemResolution"] = allowSystemResolution
        if !bootstrapPins.isEmpty {
            object["bootstrapPins"] = bootstrapPins
        }
        let result = try sendJSONObject(
            method: "POST",
            path: "/killswitch/arm",
            object: object
        )
        return try requireKillSwitchSuccess(result, operation: "arm")
    }

    static func disarmKillSwitch() throws {
        let result = try sendRequest(method: "POST", path: "/killswitch/disarm")
        _ = try requireKillSwitchSuccess(result, operation: "disarm")
    }

    static func killSwitchStatus() throws -> (
        armed: Bool, wanted: Bool, live: Bool, healed: Bool
    ) {
        let result = try sendRequest(method: "GET", path: "/killswitch/status")
        let reply = try requireKillSwitchSuccess(result, operation: "status")
        // A status query loads nothing, so it can never have flushed anything;
        // dropping the field here keeps callers from reading a stale "no" as a
        // statement about the last arm.
        return (reply.armed, reply.wanted, reply.live, reply.healed)
    }

    /// Read-only PF liveness for a connected session. Unlike
    /// `killSwitchStatus()`, the helper loads nothing and flushes nothing to
    /// answer it.
    static func killSwitchHealth() throws -> (
        wanted: Bool, live: Bool, repairedSinceArm: Bool
    ) {
        let result = try sendRequest(method: "GET", path: "/killswitch/health")
        let envelope = try requireSuccess(result, operation: "kill switch health")
        guard let wanted = envelope.wantArmed,
              let live = envelope.live,
              let repaired = envelope.repairedSinceArm else {
            throw HelperIPCError.invalidResponse
        }
        return (wanted, live, repaired)
    }

    /// Whether any daemon answered the socket at all, regardless of the reply's
    /// success. Distinguishes "helper busy or unhappy but present" from
    /// "nothing is listening" — only the latter justifies notInstalled.
    static func daemonAnswersSocket() -> Bool {
        (try? sendRequest(method: "GET", path: "/version")) != nil
    }

    // MARK: - Protected DNS

    static func enableProtectedDNS(service: String) throws {
        let result = try sendJSON(
            method: "POST",
            path: "/dns/enable",
            object: ["service": service]
        )
        let envelope = try requireSuccess(result, operation: "enable protected DNS")
        guard envelope.configured == true,
              envelope.snapshotPresent != false,
              envelope.service == service else {
            throw HelperIPCError.invalidResponse
        }
    }

    static func restoreProtectedDNS() throws {
        let result = try sendRequest(method: "POST", path: "/dns/restore")
        let envelope = try requireSuccess(result, operation: "restore protected DNS")
        guard envelope.configured == false,
              envelope.snapshotPresent != true else {
            throw HelperIPCError.invalidResponse
        }
        if protectedDNSRestoreNotice(restoreReply: result.body) != nil {
            // The helper archives that snapshot, so no later restore reports
            // it again. Keep the notice until a window has shown it: this
            // restore may run at launch, on Quit or in update preparation.
            AppProfile.defaults.set(true, forKey: protectedDNSOriginalLostKey)
            LocalTrafficAudit.shared.recordEvent(
                "protected_dns_original_service_missing",
                details: ["service": envelope.service ?? ""]
            )
        }
    }

    private static let protectedDNSOriginalLostKey = "Tono_protectedDNSOriginalLost"

    /// The user-facing notice for a successful `/dns/restore` reply, or nil
    /// when the original servers went back (or the helper predates the
    /// field). Success with `originalDNSRestored: false` means PF may be
    /// released, but the user's saved DNS servers were not restored.
    static func protectedDNSRestoreNotice(restoreReply body: Data) -> String? {
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: body),
              envelope.originalDNSRestored == false else { return nil }
        return protectedDNSOriginalLostNotice
    }

    private static var protectedDNSOriginalLostNotice: String {
        String(
            localized: "The network service whose DNS settings Tono saved has been deleted, so those DNS servers could not be put back. DNS is now obtained automatically. If your network needs manual DNS servers, set them again in System Settings > Network."
        )
    }

    /// Returns the pending original-DNS notice once and clears it.
    static func takeProtectedDNSRestoreNotice() -> String? {
        guard AppProfile.defaults.bool(forKey: protectedDNSOriginalLostKey) else {
            return nil
        }
        AppProfile.defaults.removeObject(forKey: protectedDNSOriginalLostKey)
        return protectedDNSOriginalLostNotice
    }

    /// Restore whenever the helper can inspect DNS. A missing snapshot used to
    /// mean "nothing to restore," which opened PF while 127.0.0.1:53 was still
    /// the system resolver and Mihomo was already gone. The helper now sweeps
    /// leftover loopback DNS even without a snapshot file.
    @discardableResult
    static func restoreProtectedDNSIfConfigured() throws -> Bool {
        let result = try sendRequest(method: "GET", path: "/dns/status")
        if result.status == 404 {
            return false
        }
        if result.status == 403 {
            throw HelperIPCError.forbidden
        }
        guard result.status == 200,
              let envelope = try? JSONDecoder().decode(
                Envelope.self,
                from: result.body
              ),
              let configured = envelope.configured else {
            throw HelperIPCError.invalidResponse
        }
        _ = configured
        // Build 16 did not expose snapshotPresent. Its status response still
        // included the service whenever a retained snapshot existed, including
        // the DNS-drift case where ok/configured were both false.
        let snapshotPresent =
            envelope.snapshotPresent ?? (envelope.service != nil)
        guard envelope.ok == true || snapshotPresent else {
            let message = envelope.error.map { String($0.prefix(300)) }
                ?? "Helper inspect protected DNS failed."
            throw HelperIPCError.commandFailed(message, code: envelope.code)
        }
        try restoreProtectedDNS()
        return true
    }

    static func protectedDNSStatus() -> (
        available: Bool,
        configured: Bool,
        snapshotPresent: Bool,
        service: String?
    ) {
        guard let result = try? sendRequest(method: "GET", path: "/dns/status"),
              result.status == 200,
              let envelope = try? JSONDecoder().decode(Envelope.self, from: result.body),
              let configured = envelope.configured else {
            return (false, false, false, nil)
        }
        let snapshotPresent =
            envelope.snapshotPresent ?? (envelope.service != nil)
        guard envelope.ok == true || snapshotPresent else {
            return (false, false, false, nil)
        }
        return (
            true,
            configured,
            snapshotPresent,
            envelope.service
        )
    }

    private static func sendJSON(
        method: String,
        path: String,
        object: [String: String]
    ) throws -> (status: Int, body: Data) {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try sendRequest(method: method, path: path, body: data)
    }

    private static func sendJSONObject(
        method: String,
        path: String,
        object: [String: Any]
    ) throws -> (status: Int, body: Data) {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw HelperIPCError.invalidResponse
        }
        let data = try JSONSerialization.data(withJSONObject: object)
        return try sendRequest(method: method, path: path, body: data)
    }

    @discardableResult
    private static func requireSuccess(
        _ result: (status: Int, body: Data),
        operation: String
    ) throws -> Envelope {
        // Peer rejection is an identity/UID repair condition, not a transient
        // command failure. Classify it from the authenticated HTTP boundary so
        // even an empty or malformed 403 body cannot turn into invalidResponse.
        if result.status == 403 {
            throw HelperIPCError.forbidden
        }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: result.body) else {
            throw HelperIPCError.invalidResponse
        }
        guard (200..<300).contains(result.status), envelope.ok == true else {
            let message = envelope.error.map { String($0.prefix(300)) } ?? "Helper \(operation) failed."
            throw HelperIPCError.commandFailed(message, code: envelope.code)
        }
        return envelope
    }

    private static func requireKillSwitchSuccess(
        _ result: (status: Int, body: Data),
        operation: String
    ) throws -> (armed: Bool, wanted: Bool, live: Bool, healed: Bool, flushedStates: Bool, killedHosts: Int) {
        let envelope = try requireSuccess(result, operation: operation)
        guard let armed = envelope.armed,
              let wanted = envelope.wantArmed,
              let live = envelope.live else {
            throw HelperIPCError.invalidResponse
        }
        // Pre-3.5.0 daemons do not report heals, and pre-3.9.0 daemons do not
        // report whether they flushed PF states. Absent means "did not", which
        // preserves old behaviour and, for the flush, errs toward not claiming an
        // event that may not have happened.
        return (
            armed, wanted, live, envelope.healed ?? false,
            envelope.flushedStates ?? false,
            envelope.killedHosts ?? 0
        )
    }

    private static func verifyEmbeddedExecutable(
        _ url: URL,
        identifier: String
    ) throws {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            url as CFURL,
            SecCSFlags(rawValue: 0),
            &code
        ) == errSecSuccess, let code else {
            throw HelperInstallError.installFailed(
                "An embedded helper has no valid code object."
            )
        }
        let text =
            #"anchor apple generic and identifier "\#(identifier)" and certificate leaf[subject.OU] = "YY57758GS7""#
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            text as CFString,
            SecCSFlags(rawValue: 0),
            &requirement
        ) == errSecSuccess, let requirement,
              SecStaticCodeCheckValidity(
                code,
                SecCSFlags(rawValue: 0),
                requirement
        ) == errSecSuccess else {
            throw HelperInstallError.installFailed(
                "This Tono build is not signed with the Tono Developer ID identity. "
                    + "Install a signed Tono package; an administrator repair "
                    + "cannot fix an unsigned app."
            )
        }
    }

    static let silentUpgradePollTimeout: TimeInterval = 45

    struct UpdateStatus: Decodable, Sendable {
        let pending: Bool
        let receipt: UpdateContractV1.Receipt?
        let execution: String?
        let disconnectVerified: Bool?
        let diagnostic: String?
    }

    static func updatePackagePath(_ package: URL) throws -> String {
        // Foundation resolvingSymlinksInPath strips /private on macOS and can
        // hand root a /var or /tmp symlink. Keep the POSIX spelling on the wire.
        // This is not a trust decision: root still walks every component with
        // openat(O_NOFOLLOW), verifies ownership, copies and hashes its input.
        let path = package.path
        guard package.isFileURL, !path.utf8.contains(0), path.utf8.count < Int(PATH_MAX) else {
            throw HelperIPCError.invalidResponse
        }
        var resolved = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(path, &resolved) != nil else {
            throw NativeUpdateDownload.failure("Downloaded update package path is unavailable.")
        }
        return String(cString: resolved)
    }

    static func updateRequest(_ operation: String, object: [String: Any]? = nil) throws -> UpdateStatus {
        let path = "/update/" + operation
        let result = try sendRequest(method: operation == "status" ? "GET" : "POST", path: path,
                                     body: object.map { try JSONSerialization.data(withJSONObject: $0) })
        _ = try requireSuccess(result, operation: "update " + operation)
        return try JSONDecoder().decode(UpdateStatus.self, from: result.body)
    }

    static func updateOffer(manifest: Data, signature: Data) throws -> Bool {
        let result = try sendJSONObject(method: "POST", path: "/update/offer", object: [
            "manifest": manifest.base64EncodedString(), "signature": signature.base64EncodedString(),
        ])
        _ = try requireSuccess(result, operation: "verify update offer")
        guard let object = try JSONSerialization.jsonObject(with: result.body) as? [String: Any],
              let available = object["available"] as? Bool else { throw HelperIPCError.invalidResponse }
        return available
    }

    static func receiveTimeout(for path: String) -> Int {
        switch path {
        case "/update/stage": return 600
        case "/update/prepare", "/update/commit", "/update/reconcile", "/update/disconnect", "/update/retire": return 45
        case "/update/offer", "/update/execute": return 30
        case "/killswitch/arm", "/helper/upgrade":
            return 30
        case "/core/stop":
            return 6
        case "/core/start", "/core/sync":
            return 20
        case "/version", "/core/status", "/killswitch/status":
            return 2
        default:
            return 6
        }
    }

    private static func attemptSilentUpgrade(
        helperSource: URL,
        mihomoSource: URL,
        preparationStartedAt: Date
    ) -> Bool {
        do {
            try HelperPathConfinement.validateUpgradePath(helperSource.path)
            try HelperPathConfinement.validateUpgradePath(mihomoSource.path)
            try verifyEmbeddedExecutable(
                helperSource,
                identifier: "com.raydocs.tono.helper"
            )
            try verifyEmbeddedExecutable(mihomoSource, identifier: "sing-box")

            let payload: [String: Any] = [
                "helperSource": helperSource.path,
                "mihomoSource": mihomoSource.path,
            ]
            let body = try JSONSerialization.data(withJSONObject: payload)
            let response = try? sendRequest(
                method: "POST",
                path: "/helper/upgrade",
                body: body
            )
            if let response, response.status != 200 {
                return false
            }

            let startupDeadline = Date().addingTimeInterval(silentUpgradePollTimeout)
            var pollIntervalMicroseconds: UInt32 = 100_000
            while Date() < startupDeadline {
                usleep(pollIntervalMicroseconds)
                if currentVersion() == helperVersion {
                    LocalTrafficAudit.shared.recordEvent(
                        "helper_silent_upgrade_succeeded",
                        details: [
                            "version": helperVersion,
                            "duration_ms": Self.durationMilliseconds(
                                since: preparationStartedAt
                            ),
                        ]
                    )
                    return true
                }
                pollIntervalMicroseconds = min(pollIntervalMicroseconds + 50_000, 300_000)
            }
            LocalTrafficAudit.shared.recordEvent(
                "helper_silent_upgrade_timed_out",
                details: [
                    "expected_version": helperVersion,
                    "duration_ms": Self.durationMilliseconds(
                        since: preparationStartedAt
                    ),
                ]
            )
            return false
        } catch {
            LocalTrafficAudit.shared.recordEvent(
                "helper_silent_upgrade_failed",
                details: ["error": error.localizedDescription]
            )
            return false
        }
    }

    // MARK: - Bounded Unix-socket HTTP client

    private static func sendRequest(
        method: String,
        path: String,
        body: Data? = nil
    ) throws -> (status: Int, body: Data) {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw HelperIPCError.socketFailed }
        defer { close(fd) }

        var sendTimeout = timeval(tv_sec: 3, tv_usec: 0)
        _ = withUnsafePointer(to: &sendTimeout) {
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        // Status/version probes are part of crash recovery during launch and
        // must fail fast if an old daemon is wedged. Only Kill Switch arm can
        // legitimately spend longer while resolving and committing its bounded
        // allowlist.
        let receiveTimeoutSeconds = receiveTimeout(for: path)
        var receiveTimeout = timeval(tv_sec: receiveTimeoutSeconds, tv_usec: 0)
        _ = withUnsafePointer(to: &receiveTimeout) {
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let copied = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuple in
                tuple.withMemoryRebound(to: CChar.self, capacity: 104) {
                    strlcpy($0, source, 104)
                }
            }
        }
        guard copied < 104 else { throw HelperIPCError.socketFailed }
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { throw HelperIPCError.connectFailed }

        let payload = body ?? Data()
        var request = Data(
            "\(method) \(path) HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: \(payload.count)\r\n\r\n".utf8
        )
        request.append(payload)
        try writeAll(fd: fd, data: request)

        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw HelperIPCError.emptyResponse
            }
            response.append(buffer, count: count)
            guard response.count <= maximumResponseBytes else {
                throw HelperIPCError.invalidResponse
            }
        }

        guard let split = response.range(of: Data("\r\n\r\n".utf8)),
              let header = String(data: response[..<split.lowerBound], encoding: .utf8),
              let statusLine = header.components(separatedBy: "\r\n").first else {
            throw HelperIPCError.invalidResponse
        }
        let fields = statusLine.split(separator: " ")
        guard fields.count >= 2, let status = Int(fields[1]) else {
            throw HelperIPCError.invalidResponse
        }
        let responseBody = Data(response[split.upperBound...])
        return (status, responseBody)
    }

    private static func writeAll(fd: Int32, data: Data) throws {
        try data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(fd, base.advanced(by: offset), raw.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw HelperIPCError.socketFailed
                }
                guard count > 0 else { throw HelperIPCError.socketFailed }
                offset += count
            }
        }
    }
}

enum HelperInstallError: LocalizedError {
    case resourceNotFound
    case userDenied
    case installFailed(String)

    var errorDescription: String? {
        switch self {
        case .resourceNotFound: String(localized: "Authenticated helper resources are missing.")
        case .userDenied: String(localized: "Administrator privileges were not granted.")
        case .installFailed(let message): String(localized: "Helper installation failed: \(message)")
        }
    }
}

enum HelperIPCError: LocalizedError {
    case socketFailed
    case connectFailed
    case emptyResponse
    case invalidResponse
    case forbidden
    case commandFailed(String, code: String? = nil)

    var errorDescription: String? {
        switch self {
        case .socketFailed: String(localized: "Could not communicate with the network helper.")
        case .connectFailed: String(localized: "The authenticated network helper is unavailable.")
        case .emptyResponse: String(localized: "The network helper closed the connection.")
        case .invalidResponse: String(localized: "The network helper returned an invalid response.")
        case .forbidden:
            String(localized: "The installed network helper rejected this copy of Tono.")
        // commandFailed carries helper-produced text verbatim; not a catalog key.
        case .commandFailed(let message, _): message
        }
    }
}

private extension String {
    nonisolated var shellEscaped: String {
        "'" + replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    nonisolated var appleScriptEscaped: String {
        replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}

// MARK: - Helper Path Confinement

enum HelperPathConfinement {
    enum Error: Swift.Error, Equatable {
        case notInAppBundle(String)
        case pathTraversal(String)
        case cannotSafelyOpen(String)
        case escapesBundle(String)
    }

    static func isBundleConfined(path: String, bundlePath: String = Bundle.main.bundlePath) -> Bool {
        guard !path.contains("..") else { return false }
        let allowedPrefix = bundlePath.hasSuffix("/") ? bundlePath + "Contents/" : bundlePath + "/Contents/"
        return path.hasPrefix(allowedPrefix)
    }

    static func validateUpgradePath(_ path: String, bundlePath: String = Bundle.main.bundlePath) throws {
        guard !path.contains("..") else {
            throw Error.pathTraversal(path)
        }
        guard isBundleConfined(path: path, bundlePath: bundlePath) else {
            throw Error.notInAppBundle(path)
        }
        var resolved = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(path, &resolved) != nil else {
            throw Error.cannotSafelyOpen(path)
        }
        let realPath = String(cString: resolved)

        var resolvedBundle = [CChar](repeating: 0, count: Int(PATH_MAX))
        let canonicalBundlePath: String
        if realpath(bundlePath, &resolvedBundle) != nil {
            canonicalBundlePath = String(cString: resolvedBundle)
        } else {
            canonicalBundlePath = bundlePath
        }

        let allowedPrefix = canonicalBundlePath.hasSuffix("/") ? canonicalBundlePath + "Contents/" : canonicalBundlePath + "/Contents/"
        guard realPath.hasPrefix(allowedPrefix) else {
            throw Error.escapesBundle(path)
        }

        let fd = open(realPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else {
            throw Error.cannotSafelyOpen(path)
        }
        close(fd)
    }
}
