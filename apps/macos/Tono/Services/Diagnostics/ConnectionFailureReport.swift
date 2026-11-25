import Foundation

/// The last control-plane and update failures as path labels and failure
/// classes, for text a customer can copy to support. The report holds only a
/// closed vocabulary (`pathLabels`, `ControlPlanePathTimeline.failureClass`
/// plus `skipped`), so it never carries an address, host, URL, error text or
/// account value. Before this, the per-path reasons reached the unified log
/// only, and a customer who could not connect or update had nothing to send.
nonisolated final class ConnectionFailureReport: @unchecked Sendable {
    static let shared = ConnectionFailureReport()

    /// Where a failure happened.
    nonisolated enum Area: String, Sendable, CaseIterable {
        case controlPlane = "Control plane"
        case updateMetadata = "Update metadata"
        case updatePackage = "Update package"
    }

    /// Labels a report may name; any other label is written as `other`.
    static let pathLabels: Set<String> = ["system_dns", "direct", "pinned", "relay"]
    /// The failure class of a path the walk did not try (decision 086).
    static let skipped = "skipped"
    /// `userInfo` flag on an error that stands for a path that was not tried.
    static let skippedKey = "TonoPathSkipped"

    private struct Entry {
        let attempts: [ControlPlaneUnreachable.Attempt]
        let stoppedEarly: Bool
        let at: Date
    }

    private let lock = NSLock()
    private var entries: [Area: Entry] = [:]

    func record(_ area: Area, attempts: [ControlPlaneUnreachable.Attempt], stoppedEarly: Bool = false, at: Date = Date()) {
        guard !attempts.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        entries[area] = Entry(attempts: attempts, stoppedEarly: stoppedEarly, at: at)
    }

    /// An attempt for `path` failing with `error`. A package relay's label
    /// carries its endpoint (`relay 1.2.3.4:443`); only `relay` is kept.
    static func attempt(path: String, error: any Error) -> ControlPlaneUnreachable.Attempt {
        let name = path.hasPrefix("relay") ? "relay" : path
        let label = pathLabels.contains(name) ? name : "other"
        if (error as NSError).userInfo[skippedKey] as? Bool == true {
            return .init(path: label, failure: skipped)
        }
        return .init(path: label, failure: ControlPlanePathTimeline.failureClass(error))
    }

    /// `system_dns:dns, pinned:connect, relay:timeout`
    static func summary(_ attempts: [ControlPlaneUnreachable.Attempt]) -> String {
        attempts.map { "\($0.path):\($0.failure)" }.joined(separator: ", ")
    }

    /// The report lines. `protection` and `osVersion` are passed in so a test
    /// does not depend on the machine.
    func lines(protection: String, osVersion: String, now: Date = Date()) -> [String] {
        lock.lock()
        let snapshot = entries
        lock.unlock()
        var lines = ["macOS: \(osVersion)", "Protection: \(protection)"]
        for area in Area.allCases {
            guard let entry = snapshot[area] else { continue }
            let minutes = max(0, Int(now.timeIntervalSince(entry.at) / 60))
            var line = "\(area.rawValue): \(Self.summary(entry.attempts))"
            if entry.stoppedEarly { line += " (not sent again)" }
            lines.append(line + " (\(minutes) min ago)")
        }
        return lines
    }

    /// The same lines for this Mac now.
    func currentLines() -> [String] {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        let protection: String
        if KillSwitchService.isArmedWithoutTunnel {
            protection = "armed, no tunnel"
        } else if KillSwitchService.isArmed {
            protection = "armed, tunnel"
        } else {
            protection = "not armed"
        }
        return lines(
            protection: protection,
            osVersion: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        )
    }
}
