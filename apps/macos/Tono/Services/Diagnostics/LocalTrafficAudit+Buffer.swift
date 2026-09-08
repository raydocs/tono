import Foundation
import Darwin

extension LocalTrafficAudit {
    /// Flush queued entries before revealing the file in Finder.
    func prepareForReveal() -> URL {
        queue.sync { [self] in
            flushPending()
            _ = ensureLogFile()
        }
        return logFileURL
    }

    func enqueue(
        kind: String,
        fields: [String: String],
        force: Bool = false
    ) {
        guard force || Self.isEnabled else { return }
        var object: [String: Any] = [
            "schema": 1,
            "timestamp": timestampFormatter.string(from: Date()),
            "session_id": sessionID,
            "kind": kind,
        ]
        for (key, value) in fields {
            object[key] = Self.sanitize(value)
        }
        guard var data = try? JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        ) else { return }
        data.append(0x0A)
        pending.append(data)
        pendingBytes += data.count

        if pending.count >= 64 || pendingBytes >= 64 * 1_024 {
            flushPending()
            return
        }
        guard flushWorkItem == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            self?.flushPending()
        }
        flushWorkItem = work
        queue.asyncAfter(deadline: .now() + 1, execute: work)
    }

    func flushPending() {
        flushWorkItem?.cancel()
        flushWorkItem = nil
        guard !pending.isEmpty else { return }
        let output = pending.reduce(into: Data()) { $0.append($1) }
        let snapshot = pending
        let snapshotBytes = pendingBytes
        pending.removeAll(keepingCapacity: true)
        pendingBytes = 0
        func restorePending() {
            pending.insert(contentsOf: snapshot, at: 0)
            pendingBytes += snapshotBytes
        }
        guard rotateIfNeeded(adding: output.count), ensureLogFile(),
              let handle = try? FileHandle(forWritingTo: logFileURL) else {
            restorePending()
            return
        }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: output)
        } catch {
            restorePending()
        }
    }

    func rotateIfNeeded(adding bytes: Int) -> Bool {
        let currentSize = (
            try? fileManager.attributesOfItem(atPath: logFileURL.path)[.size]
                as? NSNumber
        )??.intValue ?? 0
        guard currentSize + bytes > Self.maximumFileBytes else { return true }

        for index in stride(
            from: Self.maximumBackups,
            through: 2,
            by: -1
        ) {
            let destination = backupURL(index)
            let source = backupURL(index - 1)
            if fileManager.fileExists(atPath: destination.path) {
                try? fileManager.removeItem(at: destination)
            }
            if fileManager.fileExists(atPath: source.path) {
                try? fileManager.moveItem(at: source, to: destination)
            }
        }
        let firstBackup = backupURL(1)
        if fileManager.fileExists(atPath: firstBackup.path) {
            do {
                try fileManager.removeItem(at: firstBackup)
            } catch {
                return false
            }
        }
        guard fileManager.fileExists(atPath: logFileURL.path) else {
            return true
        }
        do {
            try fileManager.moveItem(at: logFileURL, to: firstBackup)
            return true
        } catch {
            return false
        }
    }

    func backupURL(_ index: Int) -> URL {
        logFileURL.deletingLastPathComponent()
            .appendingPathComponent("traffic-audit.jsonl.\(index)")
    }

    func ensureLogFile() -> Bool {
        if fileManager.fileExists(atPath: logFileURL.path) {
            guard let values = try? logFileURL.resourceValues(forKeys: [
                .isRegularFileKey,
                .isSymbolicLinkKey,
            ]),
                  values.isRegularFile == true,
                  values.isSymbolicLink != true,
                  let attributes = try? fileManager.attributesOfItem(
                    atPath: logFileURL.path
                  ),
                  (attributes[.ownerAccountID] as? NSNumber)?.uint32Value
                    == getuid(),
                  let permissions = (attributes[.posixPermissions] as? NSNumber)?
                    .uint16Value,
                  permissions & 0o077 == 0 else {
                return false
            }
            return true
        }
        return fileManager.createFile(
            atPath: logFileURL.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        )
    }

    static func sanitize(_ raw: String) -> String {
        var value = raw.replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        for redaction in redactions {
            value = redaction.expression.stringByReplacingMatches(
                in: value,
                range: NSRange(value.startIndex..., in: value),
                withTemplate: redaction.replacement
            )
        }
        return String(value.prefix(4_096))
    }
}
