import Darwin
import Foundation

// MARK: - Public Summary

/// A crash breadcrumb recovered from a previous launch.
///
/// Every field is either a fixed vocabulary token or bounded platform
/// metadata. Nothing here identifies the user, the account, the exit node, a
/// destination, a token, or a path inside the user's home directory: the
/// breadcrumb is written from an async-signal-safe context that has no access
/// to that state, and the exception path sanitizes what little text it keeps.
nonisolated struct CrashSummary: Codable, Sendable, Equatable {
    static let signalKind = "signal"
    static let exceptionKind = "exception"

    /// Whitelisted crash labels. Only these values may reach the consent-gated
    /// diagnostics snapshot.
    static let labels: Set<String> = [
        "SIGABRT", "SIGILL", "SIGSEGV", "SIGBUS", "SIGFPE", "SIGTRAP",
        "signal", "exception",
    ]

    let occurredAt: Date
    /// `CrashSummary.signalKind` or `CrashSummary.exceptionKind`.
    let kind: String
    /// One of `CrashSummary.labels`.
    let label: String
    /// POSIX signal number for `signalKind`, `nil` for `exceptionKind`.
    let signalNumber: Int?
    /// Sanitized `NSException` class name, `nil` for `signalKind`.
    let exceptionName: String?
    /// Local-only sanitized exception text with path-like and address-like
    /// tokens removed. Never uploaded.
    let exceptionDetail: String?
    let appVersion: String
    let build: String
    /// macOS `major.minor`.
    let osVersion: String
    /// Number of recorded return addresses. Addresses themselves stay in the
    /// on-disk audit log.
    let frameCount: Int

    var localizedSummary: String {
        let when = occurredAt.formatted(date: .abbreviated, time: .shortened)
        return String(
            localized: "Tono quit unexpectedly on \(when) · \(label) · build \(build)"
        )
    }
}

// MARK: - Async-Signal-Safe Storage

/// Every buffer a signal handler touches is allocated, filled, and paired with
/// its length here, at install time. The handler itself performs no allocation,
/// no Foundation work, no JSON encoding, and no `os_log`: it copies precomputed
/// bytes into a preallocated line buffer, formats two integers by hand, and
/// issues one `write(2)`.
nonisolated private enum CrashTrap {
    static let lineCapacity = 8_192
    static let frameCapacity: Int32 = 64
    static let trappedSignals: [(number: Int32, name: String)] = [
        (SIGABRT, "SIGABRT"),
        (SIGILL, "SIGILL"),
        (SIGSEGV, "SIGSEGV"),
        (SIGBUS, "SIGBUS"),
        (SIGFPE, "SIGFPE"),
        (SIGTRAP, "SIGTRAP"),
    ]

    nonisolated(unsafe) static var fileDescriptor: Int32 = -1
    nonisolated(unsafe) static var count: Int = 0
    nonisolated(unsafe) static var signalNumbers: UnsafeMutablePointer<Int32>?
    nonisolated(unsafe) static var prefixes:
        UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
    nonisolated(unsafe) static var prefixLengths: UnsafeMutablePointer<Int>?
    nonisolated(unsafe) static var previousHandlers:
        UnsafeMutablePointer<UnsafeMutableRawPointer?>?
    nonisolated(unsafe) static var line: UnsafeMutablePointer<CChar>?
    nonisolated(unsafe) static var frames:
        UnsafeMutablePointer<UnsafeMutableRawPointer?>?
    nonisolated(unsafe) static var framesLabel: UnsafeMutablePointer<CChar>?
    nonisolated(unsafe) static var framesLabelLength: Int = 0
    nonisolated(unsafe) static var entered: sig_atomic_t = 0
    nonisolated(unsafe) static var breadcrumbWritten: sig_atomic_t = 0
    nonisolated(unsafe) static var previousExceptionHandler:
        (@convention(c) (NSException) -> Void)?
}

nonisolated private func crashAppendBytes(
    _ destination: UnsafeMutablePointer<CChar>,
    _ offset: inout Int,
    _ source: UnsafePointer<CChar>,
    _ length: Int
) {
    guard length > 0, offset >= 0, offset + length <= CrashTrap.lineCapacity else {
        return
    }
    memcpy(destination.advanced(by: offset), source, length)
    offset += length
}

nonisolated private func crashAppendByte(
    _ destination: UnsafeMutablePointer<CChar>,
    _ offset: inout Int,
    _ byte: CChar
) {
    guard offset >= 0, offset < CrashTrap.lineCapacity else { return }
    destination[offset] = byte
    offset += 1
}

nonisolated private func crashAppendDecimal(
    _ destination: UnsafeMutablePointer<CChar>,
    _ offset: inout Int,
    _ value: UInt64
) {
    let start = offset
    var remaining = value
    repeat {
        guard offset < CrashTrap.lineCapacity else { return }
        destination[offset] = 48 + CChar(truncatingIfNeeded: remaining % 10)
        offset += 1
        remaining /= 10
    } while remaining > 0
    var low = start
    var high = offset - 1
    while low < high {
        let byte = destination[low]
        destination[low] = destination[high]
        destination[high] = byte
        low += 1
        high -= 1
    }
}

nonisolated private func crashAppendHex(
    _ destination: UnsafeMutablePointer<CChar>,
    _ offset: inout Int,
    _ value: UInt
) {
    crashAppendByte(destination, &offset, 48)
    crashAppendByte(destination, &offset, 120)
    guard value > 0 else {
        crashAppendByte(destination, &offset, 48)
        return
    }
    var shift = 60
    var leading = true
    while shift >= 0 {
        let nibble = (value >> UInt(shift)) & 0xF
        shift -= 4
        if leading {
            if nibble == 0 { continue }
            leading = false
        }
        let digit: CChar = nibble < 10
            ? 48 + CChar(truncatingIfNeeded: nibble)
            : 87 + CChar(truncatingIfNeeded: nibble)
        crashAppendByte(destination, &offset, digit)
    }
}

nonisolated private func crashWriteAll(
    _ descriptor: Int32,
    _ bytes: UnsafePointer<CChar>,
    _ length: Int
) {
    var written = 0
    while written < length {
        let result = write(descriptor, bytes.advanced(by: written), length - written)
        if result > 0 {
            written += result
            continue
        }
        if result < 0, errno == EINTR { continue }
        return
    }
}

nonisolated private func crashSignalIndex(_ number: Int32) -> Int {
    guard let numbers = CrashTrap.signalNumbers else { return -1 }
    var index = 0
    while index < CrashTrap.count {
        if numbers[index] == number { return index }
        index += 1
    }
    return -1
}

/// Signal-handler path. Only `memcpy`, `clock_gettime`, `backtrace`, `write`,
/// `fsync`, `signal`, and `raise` are called, all of which are async-signal
/// safe; `backtrace` is warmed at install time so its first-call lazy setup
/// never happens here.
nonisolated private func crashWriteSignalBreadcrumb(_ number: Int32) {
    guard CrashTrap.breadcrumbWritten == 0,
          CrashTrap.fileDescriptor >= 0,
          let line = CrashTrap.line,
          let frames = CrashTrap.frames,
          let prefixes = CrashTrap.prefixes,
          let prefixLengths = CrashTrap.prefixLengths,
          let framesLabel = CrashTrap.framesLabel else { return }
    let index = crashSignalIndex(number)
    guard index >= 0, let prefix = prefixes[index] else { return }

    var offset = 0
    crashAppendBytes(line, &offset, prefix, prefixLengths[index])

    var moment = timespec()
    clock_gettime(CLOCK_REALTIME, &moment)
    crashAppendDecimal(line, &offset, UInt64(max(0, moment.tv_sec)))

    crashAppendBytes(line, &offset, framesLabel, CrashTrap.framesLabelLength)
    let captured = backtrace(frames, CrashTrap.frameCapacity)
    var frame = 0
    while frame < Int(captured) {
        if frame > 0 { crashAppendByte(line, &offset, 44) }
        crashAppendHex(line, &offset, UInt(bitPattern: frames[frame]))
        frame += 1
    }
    crashAppendByte(line, &offset, 10)

    CrashTrap.breadcrumbWritten = 1
    crashWriteAll(CrashTrap.fileDescriptor, line, offset)
    fsync(CrashTrap.fileDescriptor)
}

/// Chains to whatever handler was installed before Tono, then restores the
/// default disposition and re-raises so the kernel and Apple's crash reporter
/// still see an unhandled fatal signal.
nonisolated private func crashSignalHandler(_ number: Int32) {
    if CrashTrap.entered == 0 {
        CrashTrap.entered = 1
        crashWriteSignalBreadcrumb(number)
    }
    let index = crashSignalIndex(number)
    if index >= 0, let previous = CrashTrap.previousHandlers?[index] {
        let disposition = UInt(bitPattern: previous)
        if disposition != 0, disposition != 1, disposition != UInt.max {
            let handler = unsafeBitCast(
                previous,
                to: (@convention(c) (Int32) -> Void).self
            )
            handler(number)
        }
    }
    signal(number, SIG_DFL)
    raise(number)
}

nonisolated private func crashExceptionHandler(_ exception: NSException) {
    if CrashTrap.entered == 0 {
        CrashTrap.entered = 1
        CrashReporter.shared.writeExceptionBreadcrumb(exception)
    }
    CrashTrap.previousExceptionHandler?(exception)
}

// MARK: - Crash Reporter

/// Local-first crash breadcrumbs for a privacy-sensitive client.
///
/// A crash writes one bounded line next to the existing traffic audit log
/// (mode 0600, same 0700 `Logs` directory). The next launch folds that line
/// into `LocalTrafficAudit` so it appears in the app's own log surfaces, marks
/// it reported so it surfaces exactly once, and keeps a compact summary for a
/// Settings/Support surface. Nothing is ever uploaded from the crash path; the
/// only value that can leave the device is a whitelisted crash label carried by
/// the already consent-gated diagnostics snapshot.
nonisolated final class CrashReporter: @unchecked Sendable {
    static let shared = CrashReporter()

    static let breadcrumbFileName = "crash-breadcrumb.txt"
    private static let lastCrashKey = "crashReporterLastCrash"
    private static let crashCountKey = "crashReporterCrashCount"
    private static let maximumCrashCount = 1_000_000
    private static let maximumBreadcrumbBytes = 64 * 1_024
    private static let schema = "1"

    let breadcrumbFileURL: URL

    private let lock = NSLock()
    private var installed = false
    private var sessionCrashLabel: String?
    private var recoveredThisLaunch = false

    private init() {
        breadcrumbFileURL = LocalTrafficAudit.shared.logFileURL
            .deletingLastPathComponent()
            .appendingPathComponent(Self.breadcrumbFileName)
    }

    // MARK: Read API

    /// The most recent recovered crash, or `nil` when none was ever recorded.
    var lastCrash: CrashSummary? {
        guard let data = AppProfile.defaults.data(forKey: Self.lastCrashKey) else {
            return nil
        }
        return try? JSONDecoder().decode(CrashSummary.self, from: data)
    }

    /// Total number of crashes recovered on this device profile.
    var crashCount: Int {
        min(
            max(AppProfile.defaults.integer(forKey: Self.crashCountKey), 0),
            Self.maximumCrashCount
        )
    }

    /// `true` when this launch recovered a breadcrumb, meaning the previous run
    /// of the app ended in a crash.
    var didRecoverCrashOnThisLaunch: Bool {
        lock.lock()
        defer { lock.unlock() }
        return recoveredThisLaunch
    }

    /// Forgets the stored summary and counter. The on-disk audit entries are
    /// deliberately untouched: they are the durable local record.
    func clearHistory() {
        AppProfile.defaults.removeObject(forKey: Self.lastCrashKey)
        AppProfile.defaults.removeObject(forKey: Self.crashCountKey)
    }

    // MARK: Install

    /// Cheap enough for the app's `init`: one bounded read, one `open`, a
    /// handful of precomputed buffers, and seven handler registrations.
    func install() {
        lock.lock()
        guard !installed else {
            lock.unlock()
            return
        }
        installed = true
        lock.unlock()

        let pending = readAndClearBreadcrumb()
        prepareBreadcrumbFile()
        installHandlers()
        if let pending { ingest(pending) }
    }

    /// Reads any breadcrumb from the previous launch and removes it in the same
    /// step, so a crash can never be recorded twice even if the fresh file
    /// cannot be created afterwards.
    private func readAndClearBreadcrumb() -> Data? {
        var payload: Data?
        if let handle = try? FileHandle(forReadingFrom: breadcrumbFileURL) {
            payload = try? handle.read(upToCount: Self.maximumBreadcrumbBytes)
            try? handle.close()
        }
        try? FileManager.default.removeItem(at: breadcrumbFileURL)
        guard let payload, !payload.isEmpty else { return nil }
        return payload
    }

    private func prepareBreadcrumbFile() {
        var descriptor = breadcrumbFileURL.path.withCString { path in
            open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        }
        if descriptor < 0 {
            descriptor = breadcrumbFileURL.path.withCString { path in
                open(path, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o600)
            }
        }
        guard descriptor >= 0 else { return }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid() else {
            close(descriptor)
            return
        }
        if info.st_mode & 0o077 != 0 {
            guard fchmod(descriptor, 0o600) == 0 else {
                close(descriptor)
                return
            }
        }
        CrashTrap.fileDescriptor = descriptor
    }

    private func installHandlers() {
        let version = Self.appVersion
        let build = Self.appBuild
        let osVersion = Self.osVersion
        let signals = CrashTrap.trappedSignals
        let count = signals.count

        CrashTrap.count = 0
        CrashTrap.entered = 0
        CrashTrap.breadcrumbWritten = 0
        CrashTrap.line = UnsafeMutablePointer<CChar>.allocate(
            capacity: CrashTrap.lineCapacity
        )
        CrashTrap.line?.initialize(repeating: 0, count: CrashTrap.lineCapacity)
        CrashTrap.frames = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(
            capacity: Int(CrashTrap.frameCapacity)
        )
        CrashTrap.frames?.initialize(
            repeating: nil,
            count: Int(CrashTrap.frameCapacity)
        )
        let framesLabel = strdup(" frames=")
        CrashTrap.framesLabel = framesLabel
        CrashTrap.framesLabelLength = framesLabel.map { strlen($0) } ?? 0
        CrashTrap.signalNumbers = UnsafeMutablePointer<Int32>.allocate(
            capacity: count
        )
        CrashTrap.prefixes = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
            .allocate(capacity: count)
        CrashTrap.prefixLengths = UnsafeMutablePointer<Int>.allocate(
            capacity: count
        )
        CrashTrap.previousHandlers = UnsafeMutablePointer<UnsafeMutableRawPointer?>
            .allocate(capacity: count)

        for (index, entry) in signals.enumerated() {
            let prefix = "schema=\(Self.schema) kind=\(CrashSummary.signalKind)"
                + " name=\(entry.name) signal=\(entry.number)"
                + " app=\(version) build=\(build) os=\(osVersion) at="
            let bytes = strdup(prefix)
            CrashTrap.signalNumbers?[index] = entry.number
            CrashTrap.prefixes?[index] = bytes
            CrashTrap.prefixLengths?[index] = bytes.map { strlen($0) } ?? 0
            CrashTrap.previousHandlers?[index] = nil
        }
        CrashTrap.count = count

        // Force `backtrace`'s one-time lazy setup out of the signal path.
        if let frames = CrashTrap.frames {
            _ = backtrace(frames, CrashTrap.frameCapacity)
        }

        for (index, entry) in signals.enumerated() {
            let previous = signal(entry.number, crashSignalHandler)
            CrashTrap.previousHandlers?[index] = previous.map {
                unsafeBitCast($0, to: UnsafeMutableRawPointer.self)
            }
        }

        CrashTrap.previousExceptionHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler(crashExceptionHandler)
    }

    // MARK: Exception Path

    /// Runs on a live thread rather than in a signal handler, so bounded
    /// Foundation work is allowed here. The write still goes through the
    /// pre-opened descriptor because AppKit's `abort()` follows immediately.
    func writeExceptionBreadcrumb(_ exception: NSException) {
        guard CrashTrap.breadcrumbWritten == 0,
              CrashTrap.fileDescriptor >= 0 else { return }
        let name = Self.sanitizeToken(exception.name.rawValue, limit: 64)
        let addresses = exception.callStackReturnAddresses
            .prefix(Int(CrashTrap.frameCapacity))
            .map { "0x" + String($0.uintValue, radix: 16) }
            .joined(separator: ",")
        var line = "schema=\(Self.schema) kind=\(CrashSummary.exceptionKind)"
            + " name=\(name.isEmpty ? "NSException" : name) signal=0"
            + " app=\(Self.appVersion) build=\(Self.appBuild)"
            + " os=\(Self.osVersion) at=\(Int(Date().timeIntervalSince1970))"
            + " frames=\(addresses)"
        if let detail = Self.sanitizeDetail(exception.reason) {
            line += " detail=\(detail)"
        }
        line += "\n"
        CrashTrap.breadcrumbWritten = 1
        let bytes = Array(line.utf8.prefix(CrashTrap.lineCapacity))
        bytes.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            base.withMemoryRebound(to: CChar.self, capacity: buffer.count) { chars in
                crashWriteAll(CrashTrap.fileDescriptor, chars, buffer.count)
            }
        }
        fsync(CrashTrap.fileDescriptor)
    }

    // MARK: Recovery

    private func ingest(_ data: Data) {
        let fields = Self.parseFields(data)
        guard let summary = Self.summary(from: fields) else { return }
        let total = min(crashCount + 1, Self.maximumCrashCount)
        AppProfile.defaults.set(total, forKey: Self.crashCountKey)
        if let encoded = try? JSONEncoder().encode(summary) {
            AppProfile.defaults.set(encoded, forKey: Self.lastCrashKey)
        }
        lock.lock()
        recoveredThisLaunch = true
        sessionCrashLabel = summary.label
        lock.unlock()

        var details: [String: String] = [
            "crash_kind": summary.kind,
            "crash_label": summary.label,
            "crash_at": String(Int(summary.occurredAt.timeIntervalSince1970)),
            "crash_app_version": summary.appVersion,
            "crash_build": summary.build,
            "crash_os_version": summary.osVersion,
            "crash_frame_count": String(summary.frameCount),
            "crash_total_count": String(total),
        ]
        if let number = summary.signalNumber {
            details["crash_signal"] = String(number)
        }
        if let name = summary.exceptionName {
            details["crash_exception"] = name
        }
        if let detail = summary.exceptionDetail {
            details["crash_exception_detail"] = detail
        }
        if let frames = fields["frames"], !frames.isEmpty {
            details["crash_frames"] = String(frames.prefix(1_024))
        }
        LocalTrafficAudit.shared.recordEvent("app_crash_recovered", details: details)
    }

    // MARK: Consent-Gated Diagnostics

    /// Adds the whitelisted crash label to the snapshot the user already opted
    /// into, and only for the session that recovered the breadcrumb. The crash
    /// path itself never uploads, and this returns the snapshot untouched when
    /// remote diagnostics are off.
    ///
    /// The label rides in `connectionStage` rather than in a new field because
    /// the control plane rejects any unknown snapshot key outright, which would
    /// fail the whole consent-gated upload. A dedicated field needs a
    /// coordinated model plus Worker change.
    @MainActor
    func annotatedRemoteDiagnosticSnapshot(
        _ snapshot: TonoDiagnosticSnapshot
    ) -> TonoDiagnosticSnapshot {
        guard AppProfile.defaults.bool(forKey: SettingsKey.remoteDiagnosticsEnabled)
        else { return snapshot }
        lock.lock()
        let label = sessionCrashLabel
        lock.unlock()
        guard let label, CrashSummary.labels.contains(label) else { return snapshot }
        return TonoDiagnosticSnapshot(
            appVersion: snapshot.appVersion,
            build: snapshot.build,
            connected: snapshot.connected,
            connecting: snapshot.connecting,
            disconnecting: snapshot.disconnecting,
            protectionBlocked: snapshot.protectionBlocked,
            killSwitchArmed: snapshot.killSwitchArmed,
            utunPresent: snapshot.utunPresent,
            protectedDNSConfigured: snapshot.protectedDNSConfigured,
            selectedExit: snapshot.selectedExit,
            connectionStage: snapshot.connectionStage,
            reconnectAttempt: snapshot.reconnectAttempt,
            lastErrorCategory: snapshot.lastErrorCategory,
            lastCrashLabel: label
        )
    }

    // MARK: Parsing

    private static func parseFields(_ data: Data) -> [String: String] {
        let text = String(
            decoding: data.prefix(maximumBreadcrumbBytes),
            as: UTF8.self
        )
        guard let line = text.split(
            separator: "\n",
            omittingEmptySubsequences: true
        ).first else { return [:] }

        var fields: [String: String] = [:]
        var remainder = Substring(line)
        while !remainder.isEmpty {
            if remainder.hasPrefix("detail=") {
                fields["detail"] = String(remainder.dropFirst("detail=".count))
                break
            }
            let token: Substring
            if let space = remainder.firstIndex(of: " ") {
                token = remainder[remainder.startIndex..<space]
                remainder = remainder[remainder.index(after: space)...]
            } else {
                token = remainder
                remainder = Substring()
            }
            guard let separator = token.firstIndex(of: "=") else { continue }
            let key = String(token[token.startIndex..<separator])
            guard !key.isEmpty else { continue }
            fields[key] = String(token[token.index(after: separator)...])
        }
        return fields
    }

    private static func summary(from fields: [String: String]) -> CrashSummary? {
        guard fields["schema"] == schema,
              let kind = fields["kind"],
              kind == CrashSummary.signalKind || kind == CrashSummary.exceptionKind,
              let seconds = fields["at"].flatMap(Double.init),
              seconds > 0,
              seconds <= Date().timeIntervalSince1970 + 300 else { return nil }

        let name = sanitizeToken(fields["name"] ?? "", limit: 64)
        let number = fields["signal"].flatMap(Int.init)
        let label: String
        if kind == CrashSummary.signalKind {
            label = CrashSummary.labels.contains(name) ? name : "signal"
        } else {
            label = CrashSummary.exceptionKind
        }
        let frameCount = (fields["frames"] ?? "")
            .split(separator: ",", omittingEmptySubsequences: true)
            .count
        return CrashSummary(
            occurredAt: Date(timeIntervalSince1970: seconds),
            kind: kind,
            label: label,
            signalNumber: kind == CrashSummary.signalKind
                ? number.map { min(max($0, 0), 255) }
                : nil,
            exceptionName: kind == CrashSummary.exceptionKind
                ? (name.isEmpty ? "NSException" : name)
                : nil,
            exceptionDetail: sanitizeDetail(fields["detail"]),
            appVersion: sanitizeToken(fields["app"] ?? "", limit: 40),
            build: sanitizeToken(fields["build"] ?? "", limit: 20),
            osVersion: sanitizeToken(fields["os"] ?? "", limit: 12),
            frameCount: min(frameCount, Int(CrashTrap.frameCapacity))
        )
    }

    // MARK: Sanitizing

    private static func sanitizeToken(_ raw: String, limit: Int) -> String {
        var output = ""
        for scalar in raw.unicodeScalars {
            guard output.unicodeScalars.count < limit else { break }
            guard scalar.isASCII,
                  CharacterSet.alphanumerics.contains(scalar)
                    || scalar == "." || scalar == "_" || scalar == "-" else {
                continue
            }
            output.unicodeScalars.append(scalar)
        }
        return output
    }

    private static let detailRejectedScalars: Set<Unicode.Scalar> = [
        "/", "\\", "@", "~", "=", "?", "&", "%", "$", "\"", "'", "`",
    ]
    private static let detailRejectedSubstrings = [
        "token", "secret", "password", "passwd", "key", "cookie", "auth",
        "bearer", "sk-", "credential", "session",
    ]

    /// Exception reasons routinely embed absolute paths, hostnames, URLs,
    /// addresses, and credential text. Keep only whitespace-delimited words
    /// whose shape cannot carry them, so this local breadcrumb never becomes a
    /// user-data sink. Best effort by construction, which is why the value is
    /// local-only and never part of any upload.
    private static func sanitizeDetail(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let words = raw.split(whereSeparator: { $0.isWhitespace })
            .prefix(32)
            .filter { word in
                guard word.count <= 24,
                      word.unicodeScalars.allSatisfy({
                          $0.isASCII && $0.value >= 32 && $0.value < 127
                              && !detailRejectedScalars.contains($0)
                      }) else { return false }
                let hasLetter = word.contains { $0.isLetter }
                let hasDigit = word.contains { $0.isNumber }
                guard hasLetter else { return false }
                if hasDigit, word.contains(".") || word.contains(":") {
                    return false
                }
                if hasDigit, word.count > 8 { return false }
                let lowered = word.lowercased()
                return !detailRejectedSubstrings.contains {
                    lowered.contains($0)
                }
            }
        let detail = words.joined(separator: " ")
        guard !detail.isEmpty else { return nil }
        return String(detail.prefix(160))
    }

    // MARK: Platform Metadata

    private static var appVersion: String {
        sanitizeToken(
            Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
                as? String ?? "unknown",
            limit: 40
        )
    }

    private static var appBuild: String {
        sanitizeToken(
            Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")
                as? String ?? "unknown",
            limit: 20
        )
    }

    private static var osVersion: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion)"
    }
}
