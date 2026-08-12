import Foundation
import OSLog
import zlib

/// Uploads the local audit log to the control plane in gzip segments while the
/// test programme runs.
///
/// This is the one part of the client that sends unredacted routing data — the
/// same hostnames, process paths, rules and routes the Support page reveals.
/// It is therefore gated on its own setting (`SettingsKey.networkLogUploadEnabled`),
/// separate from the research toggles, whose payloads carry no hostnames at all;
/// letting one consent stand in for the other is exactly the mismatch this
/// pipeline was added to stop repeating.
///
/// The hard problem is not the upload, it is the cursor. `LocalTrafficAudit`
/// rotates at 10 MiB into `.1`/`.2`, so a byte offset alone is wrong twice over:
/// after a rotation it either re-uploads a whole file from zero (the new file is
/// smaller than the stored offset) or silently abandons the tail that was still
/// unsent. The cursor therefore records the file's inode alongside the offset,
/// and on a rotation it finishes reading the tail from the backup the old inode
/// moved to before continuing at zero in the new file.
actor DiagnosticsLogUploader {
    /// Wall-clock spacing between sweeps. The server's per-account budget is 80
    /// segments an hour, so a 120 s timer leaves room for the backup tail and a
    /// retry without ever approaching it.
    static let sweepIntervalSeconds: UInt64 = 120
    /// Raw bytes read per segment. Chosen so that ordinary JSONL — which gzips
    /// at roughly 8:1 here — lands far under the server's 2 MiB compressed cap,
    /// with `compressedLimitBytes` as the check that catches the exception.
    static let readChunkBytes = 4 * 1_024 * 1_024
    static let compressedLimitBytes = 2 * 1_024 * 1_024
    /// Enough unsent bytes to skip waiting for the next tick. A redial storm can
    /// produce megabytes in a minute, and that is precisely the window worth
    /// having promptly.
    static let eagerThresholdBytes = 256 * 1_024

    private let logger = Logger(subsystem: "com.raydocs.tono", category: "log-upload")
    private let fileManager = FileManager.default
    private let auditLogURL: URL
    private let cursorURL: URL
    private let clientVersion: String
    private let osVersion: String
    private let upload: @Sendable (
        _ payload: Data,
        _ sessionID: String,
        _ sequence: Int,
        _ lineCount: Int,
        _ clientVersion: String,
        _ osVersion: String
    ) async throws -> Void
    private let isEnabled: @Sendable () -> Bool

    /// Fresh per process. Server-side uniqueness is (account, session, sequence),
    /// so a relaunch starting over at sequence 0 under a new session can never
    /// collide with the previous run's segments.
    private let sessionID = UUID().uuidString
    private var sequence = 0
    private var cursor: Cursor
    private var sweepTask: Task<Void, Never>?
    private var consecutiveFailures = 0

    private struct Cursor: Codable {
        /// `nil` until the first sweep sees a log file at all.
        var inode: UInt64?
        var offset: UInt64
        static let empty = Cursor(inode: nil, offset: 0)
    }

    init(
        auditLogURL: URL = LocalTrafficAudit.shared.logFileURL,
        clientVersion: String = Bundle.main
            .object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
        osVersion: String = ProcessInfo.processInfo.operatingSystemVersionString,
        isEnabled: @escaping @Sendable () -> Bool = {
            AppProfile.defaults.object(forKey: SettingsKey.networkLogUploadEnabled) == nil
                ? true
                : AppProfile.defaults.bool(forKey: SettingsKey.networkLogUploadEnabled)
        },
        upload: @escaping @Sendable (Data, String, Int, Int, String, String) async throws -> Void
    ) {
        self.auditLogURL = auditLogURL
        self.cursorURL = auditLogURL
            .deletingLastPathComponent()
            .appendingPathComponent("upload-cursor.json")
        self.clientVersion = clientVersion
        // Bounded by the column CHECK on the server; a long system string is
        // truncated here rather than rejected there.
        self.osVersion = String(osVersion.prefix(80))
        self.isEnabled = isEnabled
        self.upload = upload
        self.cursor = Self.loadCursor(from: cursorURL) ?? .empty
    }

    func start() {
        guard sweepTask == nil else { return }
        sweepTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.sweep()
                guard let interval = await self?.sleepInterval() else { return }
                try? await Task.sleep(for: .seconds(interval))
            }
        }
    }

    func stop() {
        sweepTask?.cancel()
        sweepTask = nil
    }

    /// Backoff that tops out rather than growing without bound: a device offline
    /// for a day should still upload promptly when it comes back, and the log
    /// keeps rotating whether or not we are reaching the server.
    private func sleepInterval() -> UInt64 {
        guard consecutiveFailures > 0 else { return Self.sweepIntervalSeconds }
        let scaled = Self.sweepIntervalSeconds << min(consecutiveFailures - 1, 3)
        return min(scaled, Self.sweepIntervalSeconds * 8)
    }

    /// One pass. Uploads at most one segment per source file so a single sweep
    /// cannot monopolise the account's hourly budget, and returns as soon as
    /// anything fails so the cursor never advances past unsent bytes.
    func sweep() async {
        guard isEnabled() else { return }
        // A rotation moved the bytes we were reading into `.1`. Finish that tail
        // first: the alternative is losing exactly the window where the log was
        // busiest, which is the window worth having.
        if let pending = pendingBackupSegment() {
            guard await send(pending) else { return }
        }
        while let segment = pendingCurrentSegment() {
            guard await send(segment) else { return }
            if segment.remainingBytes < UInt64(Self.eagerThresholdBytes) { break }
        }
    }

    private struct Segment {
        let payload: Data
        let lineCount: Int
        let nextCursor: Cursor
        let remainingBytes: UInt64
    }

    private func send(_ segment: Segment) async -> Bool {
        do {
            try await upload(
                segment.payload,
                sessionID,
                sequence,
                segment.lineCount,
                clientVersion,
                osVersion
            )
        } catch {
            consecutiveFailures += 1
            logger.error("log segment upload failed: \(String(describing: error), privacy: .public)")
            return false
        }
        consecutiveFailures = 0
        sequence += 1
        cursor = segment.nextCursor
        persistCursor()
        return true
    }

    // MARK: - Reading

    private func inode(of url: URL) -> UInt64? {
        guard let number = try? fileManager.attributesOfItem(atPath: url.path)[.systemFileNumber]
            as? NSNumber else { return nil }
        return number.uint64Value
    }

    private func backupURL(_ index: Int) -> URL {
        auditLogURL
            .deletingLastPathComponent()
            .appendingPathComponent("\(auditLogURL.lastPathComponent).\(index)")
    }

    /// The unsent tail of a file that has since rotated, if the cursor's inode
    /// now belongs to one of the backups rather than to the live log.
    private func pendingBackupSegment() -> Segment? {
        guard let recorded = cursor.inode else { return nil }
        if inode(of: auditLogURL) == recorded { return nil }
        for index in 1...LocalTrafficAudit.maximumBackups
        where inode(of: backupURL(index)) == recorded {
            // Read the tail, then hand the cursor to the live file at zero. The
            // backup is never revisited: whatever could not be read here is
            // gone at the next rotation anyway.
            let segment = readSegment(from: backupURL(index), offset: cursor.offset)
            guard let segment else {
                cursor = Cursor(inode: inode(of: auditLogURL), offset: 0)
                persistCursor()
                return nil
            }
            let exhausted = segment.remainingBytes == 0
            return Segment(
                payload: segment.payload,
                lineCount: segment.lineCount,
                nextCursor: exhausted
                    ? Cursor(inode: inode(of: auditLogURL), offset: 0)
                    : Cursor(inode: recorded, offset: segment.nextOffset),
                remainingBytes: segment.remainingBytes
            )
        }
        // The recorded inode is neither the live file nor a surviving backup:
        // rotation outran us. Resume from the start of the live file rather than
        // from an offset that means nothing in it.
        cursor = Cursor(inode: inode(of: auditLogURL), offset: 0)
        persistCursor()
        return nil
    }

    private func pendingCurrentSegment() -> Segment? {
        guard let live = inode(of: auditLogURL) else { return nil }
        // First run, or the file was replaced while we had no unsent bytes.
        let offset = cursor.inode == live ? cursor.offset : 0
        guard let read = readSegment(from: auditLogURL, offset: offset) else { return nil }
        return Segment(
            payload: read.payload,
            lineCount: read.lineCount,
            nextCursor: Cursor(inode: live, offset: read.nextOffset),
            remainingBytes: read.remainingBytes
        )
    }

    private struct Read {
        let payload: Data
        let lineCount: Int
        let nextOffset: UInt64
        let remainingBytes: UInt64
    }

    /// Reads up to one chunk from `offset`, trimmed to the last complete line so
    /// a segment is always whole JSONL records, then gzips it. Returns nil when
    /// there is nothing complete to send yet.
    private func readSegment(from url: URL, offset: UInt64) -> Read? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let size = (try? fileManager.attributesOfItem(atPath: url.path)[.size] as? NSNumber)??
            .uint64Value ?? 0
        guard size > offset else { return nil }
        do {
            try handle.seek(toOffset: offset)
        } catch {
            return nil
        }
        var chunk = Self.readChunkBytes
        while chunk >= 64 * 1_024 {
            guard let raw = try? handle.read(upToCount: chunk), !raw.isEmpty else { return nil }
            // A partial trailing line means the writer is mid-flush. Send only
            // what is complete; the remainder arrives in the next sweep.
            guard let lastNewline = raw.lastIndex(of: 0x0A) else { return nil }
            let complete = raw[raw.startIndex...lastNewline]
            guard let payload = Self.gzip(Data(complete)) else { return nil }
            if payload.count <= Self.compressedLimitBytes {
                let consumed = UInt64(complete.count)
                return Read(
                    payload: payload,
                    lineCount: complete.reduce(into: 0) { total, byte in
                        if byte == 0x0A { total += 1 }
                    },
                    nextOffset: offset + consumed,
                    remainingBytes: size - (offset + consumed)
                )
            }
            // Incompressible or unusually dense window: halve and retry rather
            // than sending something the server will refuse with 413.
            chunk /= 2
            do {
                try handle.seek(toOffset: offset)
            } catch {
                return nil
            }
        }
        return nil
    }

    // MARK: - Cursor persistence

    private static func loadCursor(from url: URL) -> Cursor? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Cursor.self, from: data)
    }

    private func persistCursor() {
        guard let data = try? JSONEncoder().encode(cursor) else { return }
        // 0600 like the log itself. The cursor is not sensitive, but it lives in
        // the same directory and inheriting the weaker default would be noise in
        // any later audit of that directory's permissions.
        try? data.write(to: cursorURL, options: [.atomic])
        try? fileManager.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: cursorURL.path
        )
    }

    // MARK: - Compression

    /// Gzip via zlib's deflate with a gzip wrapper. The server checks the magic
    /// bytes, so a raw deflate stream would be refused.
    static func gzip(_ input: Data) -> Data? {
        guard !input.isEmpty else { return nil }
        var stream = z_stream()
        // 15 window bits + 16 selects the gzip container rather than zlib's.
        guard deflateInit2_(
            &stream,
            Z_DEFAULT_COMPRESSION,
            Z_DEFLATED,
            15 + 16,
            8,
            Z_DEFAULT_STRATEGY,
            ZLIB_VERSION,
            Int32(MemoryLayout<z_stream>.size)
        ) == Z_OK else { return nil }
        defer { deflateEnd(&stream) }
        var output = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        var source = [UInt8](input)
        return source.withUnsafeMutableBufferPointer { sourcePointer -> Data? in
            stream.next_in = sourcePointer.baseAddress
            stream.avail_in = uInt(sourcePointer.count)
            repeat {
                let produced: Int = buffer.withUnsafeMutableBufferPointer { out in
                    stream.next_out = out.baseAddress
                    stream.avail_out = uInt(out.count)
                    let status = deflate(&stream, Z_FINISH)
                    guard status == Z_OK || status == Z_STREAM_END || status == Z_BUF_ERROR else {
                        return -1
                    }
                    return out.count - Int(stream.avail_out)
                }
                guard produced >= 0 else { return nil }
                if produced > 0 { output.append(contentsOf: buffer[0..<produced]) }
            } while stream.avail_out == 0
            return output.isEmpty ? nil : output
        }
    }
}
