import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

final class CoreManager {
    private let lock = NSLock()
    private let diagnosticLock = NSLock()
    private let allowedUID: uid_t
    private let allowedHome: String
    private var process: Process?
    private var diagnosticPipe: Pipe?
    private var diagnosticData = Data()
    private var lastFailure: String?

    init(allowedUID: uid_t) throws {
        self.allowedUID = allowedUID
        self.allowedHome = try homeDirectory(for: allowedUID)
        try ensureRootDirectory(runtimeDirectory, permissions: 0o700)
        try terminateStaleCore()
    }

    private func validateConfigDirectory(_ requested: String) throws -> String {
        guard let requestedPath = canonicalPath(requested) else {
            throw HelperFailure.invalid("Configuration directory does not exist.")
        }
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

    private func snapshot(_ requested: String, expectedSHA256: String) throws -> String {
        let source = try validateConfigDirectory(requested)
        // The owned Tono runtime has no GEOIP/GEOSITE/MMDB references. Never copy
        // user-owned parser inputs into a root process merely because legacy
        // versions left them in the config directory.
        try atomicCopy(
            source: "\(source)/config.yaml",
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
        return runtimeConfigPath
    }

    func start(
        configDirectory: String,
        configSHA256: String,
        startAllowed: () -> Bool = { true }
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        if process?.isRunning == true {
            // Coded, because the app's recovery for it — stop the orphaned core,
            // then start again so a force-killed GUI cannot leave mixed port,
            // 127.0.0.1:53 and utun199 owned by nothing the user can see — has
            // to key off something sturdier than this sentence.
            throw HelperFailure.coded(
                code: "CORE_ALREADY_RUNNING",
                message: "Mihomo is already running."
            )
        }
        _ = try secureMetadata(mihomoPath, type: mode_t(S_IFREG), owner: 0)
        let configPath = try snapshot(
            configDirectory,
            expectedSHA256: configSHA256
        )

        let child = Process()
        child.executableURL = URL(fileURLWithPath: mihomoPath)
        child.arguments = ["-d", runtimeDirectory, "-f", configPath]
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

    func sync(configDirectory: String, configSHA256: String) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        guard process?.isRunning == true else {
            throw HelperFailure.invalid("Mihomo is not running.")
        }
        return try snapshot(
            configDirectory,
            expectedSHA256: configSHA256
        )
    }

    func stop() throws {
        lock.lock()
        defer { lock.unlock() }
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
            throw HelperFailure.system("Mihomo did not stop.")
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
        let detail = Self.sanitizedDiagnostic(diagnosticData)
        let prefix = "Mihomo exited during startup (status \(child.terminationStatus))."
        let failure = detail.isEmpty ? prefix : "\(prefix) \(detail)"
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

    private func terminateOwnedCore(_ pid: Int32) throws {
        guard kill(pid, 0) == 0 else { return }
        _ = kill(pid, SIGTERM)
        for _ in 0..<30 where kill(pid, 0) == 0 { usleep(100_000) }
        if kill(pid, 0) == 0 { _ = kill(pid, SIGKILL) }
        for _ in 0..<20 where kill(pid, 0) == 0 { usleep(50_000) }
        guard kill(pid, 0) != 0 else {
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

        for pid in staleOwnedCorePIDs(in: identities) {
            try terminateOwnedCore(pid)
        }
        try? removePIDFile()
    }
}
