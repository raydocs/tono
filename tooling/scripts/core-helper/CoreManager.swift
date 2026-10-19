import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

/// Ephemeral grants derived only from the admitted root snapshot, never IPC
/// endpoint lists or persisted tunnel names. PF's existing Core identity is root.
struct StrictRuntimeProof {
    let interface: String
    let exits: [KillSwitchEndpoint]
    let generation: UInt64
    let digest: String

    init(_ object: [String: Any], generation: UInt64, digest: String) throws {
        self.generation = generation
        self.digest = digest
        guard ThreeTierRoutingContract.admits(object),
              let outbounds = object["outbounds"] as? [[String: Any]],
              let direct = outbounds.first(where: { $0["type"] as? String == "direct" }),
              let interface = direct["bind_interface"] as? String,
              KillSwitchManager.physicalEgressInterfaces().contains(interface) else {
            throw HelperFailure.invalid("Strict runtime has no admitted physical interface.")
        }
        self.interface = interface
        exits = try outbounds.filter { ["vless", "hysteria2"].contains($0["type"] as? String ?? "") }.map {
            guard $0["type"] as? String == "vless",
                  let address = $0["server"] as? String, !address.contains(":"),
                  KillSwitchManager.canonicalPublicAddress(address) == address,
                  let port = $0["server_port"] as? Int, let bounded = UInt16(exactly: port), bounded > 0 else {
                throw HelperFailure.invalid("Initial strict graph requires public literal IPv4 TCP exits.")
            }
            return KillSwitchEndpoint(address: address, transport: "tcp", port: bounded)
        }
        guard !exits.isEmpty else { throw HelperFailure.invalid("Strict runtime has no exit.") }
    }
}

final class CoreManager {
    private let lock = NSLock()
    private let diagnosticLock = NSLock()
    private let allowedUID: uid_t
    private var process: Process?
    private var diagnosticPipe: Pipe?
    private var diagnosticData = Data()
    private var lastFailure: String?

    init(allowedUID: uid_t) throws {
        // No account lookup here. Recovery (`--emergency-disarm`, `--emergency-reset`,
        // executor recovery) constructs this only to stop a stale core before PF
        // is released, and it must still work after the bound macOS user was
        // deleted. The home directory is resolved where it is needed: when a
        // start or sync validates the user's config directory.
        self.allowedUID = allowedUID
        try ensureRootDirectory(runtimeDirectory, permissions: 0o700)
        try terminateStaleCore()
    }

    private func validateConfigDirectory(_ requested: String) throws -> String {
        guard let requestedPath = canonicalPath(requested) else {
            throw HelperFailure.invalid("Configuration directory does not exist.")
        }
        let allowedHome = try homeDirectory(for: allowedUID)
        let candidates = ["Tono", "Tono-Dev"].compactMap {
            canonicalPath("\(allowedHome)/Library/Application Support/\($0)/config")
        }
        guard candidates.contains(requestedPath) else {
            throw HelperFailure.invalid("Configuration directory is outside Tono.")
        }
        let metadata = try secureMetadata(
            requestedPath,
            type: mode_t(S_IFDIR),
            owner: allowedUID
        )
        guard metadata.st_mode & 0o022 == 0 else {
            throw HelperFailure.invalid("Configuration directory permissions are unsafe.")
        }
        return requestedPath
    }

    private func snapshot(_ requested: String, expectedSHA256: String, binding: Bool = false) throws -> String {
        let source = try validateConfigDirectory(requested)
        // The owned Tono runtime has no GEOIP/GEOSITE/MMDB references. Never copy
        // user-owned parser inputs into a root process merely because legacy
        // versions left them in the config directory.
        try atomicCopy(
            source: "\(source)/config.json",
            destination: runtimeConfigPath,
            expectedOwner: allowedUID,
            expectedSHA256: expectedSHA256,
            maximumBytes: 8 * 1024 * 1024,
            required: true
        )
        let contents = try String(contentsOfFile: runtimeConfigPath, encoding: .utf8)
        guard ownedRuntimeConfigIsSafe(contents) else {
            throw HelperFailure.invalid("Runtime config is not an owned Tono config.")
        }
        let parsed = try JSONSerialization.jsonObject(with: Data(contents.utf8))
        guard let object = goFoldedJSONKeys(parsed) as? [String: Any] else {
            throw HelperFailure.invalid("Invalid runtime object.")
        }
        if !binding {
            let record = try ReleaseAuthority().load()
            let strict = ThreeTierRoutingContract.isThreeTierRuntime(object)
            guard strict == (record.mode == .secured && record.strictRuntimeDigest != nil),
                  !strict || record.strictRuntimeDigest == expectedSHA256 else {
                throw HelperFailure.invalid("Runtime does not match the admitted strict session.")
            }
        }
        try checkConfiguration()
        return runtimeConfigPath
    }

    /// The runtime as admission and start read it: keys folded the way the
    /// core matches them, so a `DNS` or `OUTBOUNDS` key cannot hide the mode.
    static func foldedRuntime(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)).flatMap(goFoldedJSONKeys) as? [String: Any]
    }

    /// Validate the root snapshot before binding any intent or PF grants.
    func bindRuntime(configDirectory: String, digest: String, generation: UInt64?, mode: String?) throws -> StrictRuntimeProof? {
        lock.lock(); defer { lock.unlock() }
        guard mode != "three-tier" || process?.isRunning != true else {
            throw HelperFailure.invalid("Stop the running Core before binding strict routing.")
        }
        let existing = try ReleaseAuthority().load()
        guard !existing.strictIntent || existing.strictRuntimeDigest == digest else {
            throw HelperFailure.invalid("Strict runtime is immutable. Explicitly disconnect before changing it.")
        }
        _ = try snapshot(configDirectory, expectedSHA256: digest, binding: true)
        let data = try Data(contentsOf: URL(fileURLWithPath: runtimeConfigPath))
        guard let object = Self.foldedRuntime(data) else {
            throw HelperFailure.invalid("Invalid runtime.")
        }
        guard let runtimeMode = ThreeTierRoutingContract.routingMode(of: object),
              mode == nil || mode == runtimeMode else {
            throw HelperFailure.invalid("Routing mode/runtime mismatch.")
        }
        let strict = runtimeMode == "three-tier"
        // Headerless /core/sync cannot bind a strict graph to the stable child
        // it would replace. A proof is minted only with no live Core; start
        // then verifies this digest before launching the sole owned child.
        guard !strict || process?.isRunning != true else {
            throw HelperFailure.invalid("Stop the running Core before binding strict routing.")
        }
        guard let generation else {
            let record = try ReleaseAuthority().load()
            guard !strict, !record.strictIntent, record.mode == .secured else {
                throw HelperFailure.invalid("Strict runtime binding requires an admitted generation.")
            }
            return nil // Preserve the legacy stable/headerless path.
        }
        let proof = strict ? try StrictRuntimeProof(object, generation: generation, digest: digest) : nil
        try ReleaseAuthority().bindRuntime(generation: generation, digest: digest,
            runtimeMode: runtimeMode, requestedMode: mode)
        return proof
    }

    /// Parsing is bounded and runs against the root snapshot, never the
    /// user-writable input. Do not expose raw parser output containing secrets.
    private func checkConfiguration() throws {
        _ = try secureMetadata(mihomoPath, type: mode_t(S_IFREG), owner: 0)
        let checker = Process()
        checker.executableURL = URL(fileURLWithPath: mihomoPath)
        checker.arguments = ["check", "-D", runtimeDirectory, "-c", runtimeConfigPath]
        checker.currentDirectoryURL = URL(fileURLWithPath: runtimeDirectory)
        checker.environment = ["HOME": runtimeDirectory, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        checker.standardOutput = FileHandle.nullDevice
        checker.standardError = FileHandle.nullDevice
        try checker.run()
        for _ in 0..<100 where checker.isRunning { usleep(50_000) }
        if checker.isRunning {
            checker.terminate()
            for _ in 0..<10 where checker.isRunning { usleep(50_000) }
            if checker.isRunning { kill(checker.processIdentifier, SIGKILL) }
            checker.waitUntilExit()
            throw HelperFailure.coded(code: "CORE_CONFIG_TIMEOUT", message: "sing-box check timed out.")
        }
        guard checker.terminationStatus == 0 else {
            throw HelperFailure.coded(code: "CORE_CONFIG_REJECTED", message: "sing-box rejected the runtime configuration.")
        }
    }

    func start(
        configDirectory: String,
        configSHA256: String,
        startAllowed: () -> Bool = { true }
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        try startLocked(configDirectory: configDirectory, configSHA256: configSHA256,
                        startAllowed: startAllowed)
    }

    private func startLocked(
        configDirectory: String,
        configSHA256: String,
        startAllowed: () -> Bool
    ) throws {
        if process?.isRunning == true {
            // Coded, because the app's recovery for it — stop the orphaned core,
            // then start again so a force-killed GUI cannot leave mixed port,
            // 127.0.0.1:53 and utun199 owned by nothing the user can see — has
            // to key off something sturdier than this sentence.
            throw HelperFailure.coded(
                code: "CORE_ALREADY_RUNNING",
                message: "sing-box is already running."
            )
        }
        _ = try secureMetadata(mihomoPath, type: mode_t(S_IFREG), owner: 0)
        let configPath = try snapshot(
            configDirectory,
            expectedSHA256: configSHA256
        )
        try launchValidatedSnapshotLocked(configPath: configPath, startAllowed: startAllowed)
    }

    private func launchValidatedSnapshotLocked(configPath: String, startAllowed: () -> Bool) throws {
        // Recheck the root-owned binary at launch, including after a sync stop.
        _ = try secureMetadata(mihomoPath, type: mode_t(S_IFREG), owner: 0)
        // After a sync stop too: the old core has exited, so anything still on
        // these ports belongs to another program and the core would only exit.
        try CoreListenPreflight.check(configPath: configPath)
        let child = Process()
        child.executableURL = URL(fileURLWithPath: mihomoPath)
        child.arguments = ["run", "-D", runtimeDirectory, "-c", configPath]
        child.currentDirectoryURL = URL(fileURLWithPath: runtimeDirectory, isDirectory: true)
        child.environment = [
            // Never give a root process a user-writable HOME. Mihomo receives
            // all required inputs through its root-owned -d/-f paths.
            "HOME": runtimeDirectory,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        ]
        resetDiagnostics()
        startDiagnosticCapture(for: child)
        do {
            guard startAllowed() else {
                stopDiagnosticCapture()
                throw HelperFailure.invalid(
                    "The system is entering sleep; network protection remains fail-closed."
                )
            }
            try child.run()
        } catch {
            stopDiagnosticCapture()
            throw error
        }
        process = child
        do {
            try writePID(child.processIdentifier)
        } catch {
            child.terminate()
            for _ in 0..<20 where child.isRunning { usleep(50_000) }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            process = nil
            stopDiagnosticCapture()
            throw error
        }

        // Most configuration/port failures terminate immediately. Catch them
        // here so the first start request returns a useful bounded diagnostic
        // instead of making the GUI poll an absent controller for seconds.
        for _ in 0..<3 where child.isRunning { usleep(50_000) }
        guard child.isRunning else {
            let failure = recordUnexpectedExit(child)
            process = nil
            try? removePIDFile()
            stopDiagnosticCapture()
            throw HelperFailure.system(failure)
        }
    }

    /// Serialized protected replacement. The caller keeps PF and system DNS
    /// armed throughout; failure never restarts an older configuration.
    func sync(configDirectory: String, configSHA256: String,
              startAllowed: () -> Bool = { true },
              beforeStop: () throws -> Void = {}) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        guard process?.isRunning == true else {
            throw HelperFailure.invalid("sing-box is not running.")
        }
        // Refuse malformed or swapped bytes before disrupting the live child.
        let configPath = try snapshot(configDirectory, expectedSHA256: configSHA256)
        try beforeStop()
        try stopLocked()
        try launchValidatedSnapshotLocked(configPath: configPath, startAllowed: startAllowed)
        return runtimeConfigPath
    }

    func stop() throws {
        lock.lock()
        defer { lock.unlock() }
        try stopLocked()
    }

    private func stopLocked() throws {
        guard let child = process, child.isRunning else {
            process = nil
            try? removePIDFile()
            stopDiagnosticCapture()
            return
        }
        diagnosticLock.lock()
        lastFailure = nil
        diagnosticLock.unlock()
        child.terminate()
        for _ in 0..<30 where child.isRunning { usleep(100_000) }
        if child.isRunning {
            kill(child.processIdentifier, SIGKILL)
            for _ in 0..<20 where child.isRunning { usleep(50_000) }
        }
        guard !child.isRunning else {
            throw HelperFailure.system("sing-box did not stop.")
        }
        process = nil
        try removePIDFile()
        stopDiagnosticCapture()
    }

    func status() -> (running: Bool, pid: Int32?, lastError: String?) {
        lock.lock()
        defer { lock.unlock() }
        guard let child = process else {
            return (false, nil, currentFailure())
        }
        guard child.isRunning else {
            let failure = recordUnexpectedExit(child)
            process = nil
            try? removePIDFile()
            stopDiagnosticCapture()
            return (false, nil, failure)
        }
        return (true, child.processIdentifier, nil)
    }

    private func resetDiagnostics() {
        diagnosticLock.lock()
        diagnosticData.removeAll(keepingCapacity: true)
        lastFailure = nil
        diagnosticLock.unlock()
    }

    private func startDiagnosticCapture(for child: Process) {
        let pipe = Pipe()
        diagnosticPipe = pipe
        child.standardOutput = pipe
        child.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            self?.appendDiagnostic(data)
        }
    }

    private func stopDiagnosticCapture() {
        guard let pipe = diagnosticPipe else { return }
        pipe.fileHandleForReading.readabilityHandler = nil
        try? pipe.fileHandleForReading.close()
        try? pipe.fileHandleForWriting.close()
        diagnosticPipe = nil
    }

    private func appendDiagnostic(_ data: Data) {
        diagnosticLock.lock()
        defer { diagnosticLock.unlock() }
        if data.count >= maximumDiagnosticBytes {
            diagnosticData = Data(data.suffix(maximumDiagnosticBytes))
            return
        }
        let overflow = diagnosticData.count + data.count - maximumDiagnosticBytes
        if overflow > 0 {
            diagnosticData.removeFirst(overflow)
        }
        diagnosticData.append(data)
    }

    private func recordUnexpectedExit(_ child: Process) -> String {
        diagnosticLock.lock()
        defer { diagnosticLock.unlock() }
        if let lastFailure { return lastFailure }
        // Endpoint, username and credential formats are extensible upstream.
        // Regex scrubbing is not a safe boundary for arbitrary core logs.
        let failure = "sing-box exited (status \(child.terminationStatus))."
        lastFailure = failure
        return failure
    }

    private func currentFailure() -> String? {
        diagnosticLock.lock()
        defer { diagnosticLock.unlock() }
        return lastFailure
    }

    private static func sanitizedDiagnostic(_ data: Data) -> String {
        var text = String(decoding: data, as: UTF8.self)
        text = text.replacingOccurrences(of: "127.0.0.1", with: "<loopback>")
        text = text.replacingOccurrences(
            of: #"\b(?:\d{1,3}\.){3}\d{1,3}\b"#,
            with: "<ip>",
            options: .regularExpression
        )
        text = text.replacingOccurrences(of: "<loopback>", with: "127.0.0.1")
        text = text.replacingOccurrences(
            of: #"(?i)(vless|vmess|trojan|ss)://\S+"#,
            with: "$1://<redacted>",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"(?i)(uuid|password|token|secret|public-key|short-id)(\s*[:=]\s*)\S+"#,
            with: "$1$2<redacted>",
            options: .regularExpression
        )
        let lines = text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .suffix(6)
        return String(lines.joined(separator: " | ").prefix(600))
    }

    private func writePID(_ pid: Int32) throws {
        let data = Data("\(pid)\n".utf8)
        let temporary = "\(pidPath).new"
        let fd = open(temporary, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw HelperFailure.system("Could not persist Mihomo state.") }
        defer { close(fd) }
        try data.withUnsafeBytes {
            guard let base = $0.baseAddress else { return }
            try writeAll(fd, bytes: base, count: $0.count)
        }
        guard fsync(fd) == 0, fchown(fd, 0, 0) == 0, fchmod(fd, 0o600) == 0,
              rename(temporary, pidPath) == 0 else {
            unlink(temporary)
            throw HelperFailure.system("Could not persist Mihomo state.")
        }
    }

    private func removePIDFile() throws {
        var metadata = stat()
        guard lstat(pidPath, &metadata) == 0 else {
            if errno == ENOENT { return }
            throw HelperFailure.system("Could not inspect Mihomo state.")
        }
        guard fileType(metadata) == mode_t(S_IFREG), metadata.st_uid == 0,
              unlink(pidPath) == 0 else {
            throw HelperFailure.invalid("Mihomo state file is unsafe.")
        }
    }

    private func processIdentity(_ pid: Int32) -> OwnedProcessIdentity? {
        var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) * 4)
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }

        var info = proc_bsdinfo()
        let infoSize = withUnsafeMutablePointer(to: &info) {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                $0,
                Int32(MemoryLayout<proc_bsdinfo>.size)
            )
        }
        guard infoSize == MemoryLayout<proc_bsdinfo>.size else { return nil }
        return .init(
            pid: pid,
            executablePath: String(cString: buffer),
            uid: info.pbi_uid
        )
    }

    private func runningProcessIdentities() -> [OwnedProcessIdentity] {
        let capacity = proc_listallpids(nil, 0)
        guard capacity > 0 else { return [] }
        var pids = [Int32](repeating: 0, count: Int(capacity) + 32)
        let count = pids.withUnsafeMutableBytes {
            proc_listallpids($0.baseAddress, Int32($0.count))
        }
        guard count > 0 else { return [] }
        return pids.prefix(Int(count)).compactMap(processIdentity)
    }

    private func terminateOwnedCore(_ pid: Int32, expectedPath: String) throws {
        func stillOwned() -> Bool {
            guard let identity = processIdentity(pid) else { return false }
            return maySignalOwnedCore(
                path: identity.executablePath,
                uid: identity.uid,
                expectedPath: expectedPath
            )
        }
        guard stillOwned() else { return }
        if kill(pid, SIGTERM) != 0 {
            if errno == ESRCH { return }
            throw HelperFailure.system("A stale Mihomo process could not be stopped.")
        }
        for _ in 0..<30 {
            if !stillOwned() { return }
            usleep(100_000)
        }
        guard stillOwned() else { return }
        if kill(pid, SIGKILL) != 0 {
            if errno == ESRCH { return }
            throw HelperFailure.system("A stale Mihomo process could not be stopped.")
        }
        for _ in 0..<20 {
            if !stillOwned() { return }
            usleep(50_000)
        }
        guard !stillOwned() else {
            throw HelperFailure.system("A stale Mihomo process could not be stopped.")
        }
    }

    private func terminateStaleCore() throws {
        var identities = runningProcessIdentities()
        if let raw = try? String(contentsOfFile: pidPath, encoding: .utf8),
           let recordedPID = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           let recordedIdentity = processIdentity(recordedPID),
           !identities.contains(where: { $0.pid == recordedPID }) {
            identities.append(recordedIdentity)
        }

        for identity in identities where staleOwnedCorePIDs(in: [identity]) == [identity.pid] {
            try terminateOwnedCore(identity.pid, expectedPath: identity.executablePath)
        }
        try? removePIDFile()
    }
}

/// A loopback socket the core binds when it starts.
struct CoreListenSocket: Hashable {
    let port: UInt16
    let udp: Bool
}

/// Finds a loopback port the core needs that another program already holds,
/// before the core starts. The core itself only exits with a status: a Docker
/// or dnsmasq resolver on port 53 then reads as an ordinary failed connection,
/// and the app retries something that can never succeed.
enum CoreListenPreflight {
    static let portInUseCode = "CORE_PORT_IN_USE"

    /// The sockets the validated runtime config binds: TCP for every direct
    /// and mixed inbound and for the controller, UDP as well for a direct
    /// inbound (Tono-DNS) whose network is not TCP only.
    static func sockets(inConfig bytes: Data) -> [CoreListenSocket] {
        guard let parsed = try? JSONSerialization.jsonObject(with: bytes),
              let object = goFoldedJSONKeys(parsed) as? [String: Any] else { return [] }
        var sockets: [CoreListenSocket] = []
        func add(_ port: Int, udp: Bool) {
            guard (1...65_535).contains(port) else { return }
            let socket = CoreListenSocket(port: UInt16(port), udp: udp)
            if !sockets.contains(socket) { sockets.append(socket) }
        }
        for inbound in object["inbounds"] as? [[String: Any]] ?? [] {
            guard let port = inbound["listen_port"] as? Int else { continue }
            switch inbound["type"] as? String {
            case "direct":
                let network = inbound["network"] as? String
                if network != "udp" { add(port, udp: false) }
                if network != "tcp" { add(port, udp: true) }
            case "mixed":
                add(port, udp: false)
            default:
                continue
            }
        }
        if let experimental = object["experimental"] as? [String: Any],
           let api = experimental["clash_api"] as? [String: Any],
           let controller = api["external_controller"] as? String,
           let port = controller.split(separator: ":").last.flatMap({ Int($0) }) {
            add(port, udp: false)
        }
        return sockets
    }

    /// Binds each socket the way the core's Go runtime does — SO_REUSEADDR on
    /// TCP listeners, none on UDP — so a port counts as taken exactly when the
    /// core's own bind would fail. Any error other than EADDRINUSE is left for
    /// the core to report.
    static func firstBusy(_ sockets: [CoreListenSocket]) -> CoreListenSocket? {
        sockets.first { socket in
            let fd = Darwin.socket(AF_INET, socket.udp ? SOCK_DGRAM : SOCK_STREAM, 0)
            guard fd >= 0 else { return false }
            defer { close(fd) }
            if !socket.udp {
                var one: Int32 = 1
                _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
            }
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = socket.port.bigEndian
            address.sin_addr.s_addr = inet_addr("127.0.0.1")
            let bound = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            return bound != 0 && errno == EADDRINUSE
        }
    }

    /// The process holding a local socket on this port and protocol (a TCP
    /// listener, or a bound UDP socket), as its short name and PID.
    static func holder(of socket: CoreListenSocket) -> (name: String, pid: Int32)? {
        let capacity = proc_listallpids(nil, 0)
        guard capacity > 0 else { return nil }
        var pids = [Int32](repeating: 0, count: Int(capacity) + 32)
        let count = pids.withUnsafeMutableBytes {
            proc_listallpids($0.baseAddress, Int32($0.count))
        }
        guard count > 0 else { return nil }
        for pid in pids.prefix(Int(count)) where pid > 0 && holds(pid: pid, socket) {
            var name = [CChar](repeating: 0, count: 256)
            guard proc_name(pid, &name, UInt32(name.count)) > 0 else { return ("", pid) }
            return (String(cString: name), pid)
        }
        return nil
    }

    private static func holds(pid: Int32, _ socket: CoreListenSocket) -> Bool {
        let fdSize = MemoryLayout<proc_fdinfo>.stride
        let needed = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
        guard needed > 0 else { return false }
        var fds = [proc_fdinfo](repeating: proc_fdinfo(), count: Int(needed) / fdSize + 16)
        let filled = fds.withUnsafeMutableBytes {
            proc_pidinfo(pid, PROC_PIDLISTFDS, 0, $0.baseAddress, Int32($0.count))
        }
        guard filled > 0 else { return false }
        for fd in fds.prefix(Int(filled) / fdSize) where fd.proc_fdtype == UInt32(PROX_FDTYPE_SOCKET) {
            var info = socket_fdinfo()
            let size = Int32(MemoryLayout<socket_fdinfo>.size)
            guard proc_pidfdinfo(pid, fd.proc_fd, PROC_PIDFDSOCKETINFO, &info, size) == size else { continue }
            let family = info.psi.soi_family
            guard family == AF_INET || family == AF_INET6 else { continue }
            let kind = info.psi.soi_kind
            let localPort: Int32
            if socket.udp {
                guard kind == Int32(SOCKINFO_IN), info.psi.soi_type == SOCK_DGRAM else { continue }
                localPort = info.psi.soi_proto.pri_in.insi_lport
            } else {
                guard kind == Int32(SOCKINFO_TCP),
                      info.psi.soi_proto.pri_tcp.tcpsi_state == TSI_S_LISTEN else { continue }
                localPort = info.psi.soi_proto.pri_tcp.tcpsi_ini.insi_lport
            }
            if UInt16(bigEndian: UInt16(truncatingIfNeeded: localPort)) == socket.port { return true }
        }
        return false
    }

    /// The coded refusal for a taken port. The message keeps one fixed shape
    /// because the app reads the port, protocol and holder back out of it.
    static func failure(for socket: CoreListenSocket, holder: (name: String, pid: Int32)?) -> HelperFailure {
        let proto = socket.udp ? "UDP" : "TCP"
        var message = "Port \(socket.port) (\(proto)) on 127.0.0.1 is already in use"
        if let holder {
            let name = String(holder.name.unicodeScalars.filter {
                $0.value >= 0x20 && $0.value != 0x7F && $0 != "(" && $0 != ")"
            }.prefix(64))
            message += " by \(name.isEmpty ? "another program" : name) (PID \(holder.pid))."
        } else {
            message += " by another program."
        }
        return .coded(code: portInUseCode, message: message)
    }

    /// Throws the coded refusal when a port the config at `configPath` needs is taken.
    static func check(configPath: String) throws {
        guard let bytes = FileManager.default.contents(atPath: configPath),
              let busy = firstBusy(sockets(inConfig: bytes)) else { return }
        throw failure(for: busy, holder: holder(of: busy))
    }
}
