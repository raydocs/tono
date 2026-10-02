import Foundation
import Observation

/// Serializes runtime-config reads, validation, YAML generation, hashing, and
/// atomic disk writes away from the main actor. Catalogs are intentionally
/// bounded, but even a valid large YAML file must not stall SwiftUI while the
/// connect button is animating.
private actor RuntimeConfigWriter {
    func write(
        overlay: ConfigPipeline.OverlayConfig,
        customNodes: [ProxyNode],
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?,
        outputPath: URL,
        fakeIPRotation: SingBoxFakeIPRotation
    ) throws -> String {
        let document = try fakeIPRotation.document { slot in
            try ConfigPipeline.buildSingBoxRuntime(
                overlay: overlay,
                nodes: customNodes,
                directPlan: directPolicy,
                fakeIPSlot: slot
            ).runtimeJSON
        }
        return try ConfigPipeline.secureWrite(String(decoding: document, as: UTF8.self), to: outputPath)
    }
}

// MARK: - Fake-IP rotation

/// Which quarter of the fake-IP pool the next runtime document takes (#1258).
///
/// The Core keeps its fake-IP table in memory and hands addresses out in order
/// from the start of its range. A replacement process on the same range maps
/// an address an app still has cached to whichever name it resolves first.
/// On another quarter that address is a plain IP, and the document rejects
/// the pool.
nonisolated final class SingBoxFakeIPRotation: @unchecked Sendable {
    private let lock = NSLock()
    private var slot: Int
    private var written: Data?

    /// A relaunched app cannot read which quarter a Core it adopts is using,
    /// so it starts anywhere.
    init(slot: Int = Int.random(in: 0..<ConfigPipeline.singBoxFakeIPRanges.count)) {
        self.slot = slot
    }

    /// `render` returns the document for a slot. The config last written keeps
    /// its bytes: the reload path skips a Core restart on an equal digest. Any
    /// other document replaces the process and takes the next quarter.
    func document(_ render: (Int) throws -> Data) rethrows -> Data {
        lock.lock()
        defer { lock.unlock() }
        var document = try render(slot)
        if let written, written != document {
            slot = (slot + 1) % ConfigPipeline.singBoxFakeIPRanges.count
            document = try render(slot)
        }
        written = document
        return document
    }

    /// The process is gone. The next document starts a new one, even with the
    /// same config.
    func processStopped() {
        lock.lock()
        defer { lock.unlock() }
        written = nil
        slot = (slot + 1) % ConfigPipeline.singBoxFakeIPRanges.count
    }
}

// MARK: - Delay gate

/// sing-box `/delay` stays quiet until a TUN/data-plane proof exists.
///
/// A probe started beside the first Reality handshake costs a second
/// handshake. Closing this gate makes `testProxyDelay` return without an
/// HTTP call. Opening it does not by itself send a probe.
enum SingBoxDelayGate {
    static let deferredMessage = "delay deferred until data plane"

    private static let lock = NSLock()
    private static var proven = false

    static func suspend() {
        lock.lock()
        proven = false
        lock.unlock()
    }

    static func prove() {
        lock.lock()
        proven = true
        lock.unlock()
    }

    static var isProven: Bool {
        lock.lock()
        defer { lock.unlock() }
        return proven
    }
}

// MARK: - Core Runtime Manager

@Observable
final class CoreRuntimeManager {
    var isRunning = false
    var logOutput: [String] = []
    private(set) var runtimeConfigSHA256: String?
    private let configWriter = RuntimeConfigWriter()
    private let fakeIPRotation = SingBoxFakeIPRotation()

    /// Config directory for the owned sing-box runtime.
    var configDirectory: URL {
        let dir = ConfigStorage.shared.appSupportDirectory.appendingPathComponent("config", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// Main config file path
    var configFilePath: URL {
        configDirectory.appendingPathComponent("config.json")
    }

    /// Only the packaged core is an eligible input. No executable fallback.
    func findBinary() -> URL? {
        guard let binary = Bundle.main.url(forResource: "sing-box", withExtension: nil),
              FileManager.default.isExecutableFile(atPath: binary.path) else { return nil }
        return binary
    }

    // MARK: - Write Runtime Config

    @discardableResult
    func writeRuntimeConfig(
        overlay: ConfigPipeline.OverlayConfig,
        customNodes: [ProxyNode] = [],
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy? = nil
    ) async throws -> String {
        let digest = try await configWriter.write(
            overlay: overlay,
            customNodes: customNodes,
            directPolicy: directPolicy,
            outputPath: configFilePath,
            fakeIPRotation: fakeIPRotation
        )
        runtimeConfigSHA256 = digest
        return digest
    }

    // MARK: - Start (via Helper Daemon)

    func start(
        overlay: ConfigPipeline.OverlayConfig,
        customNodes: [ProxyNode] = [],
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy? = nil,
        helperPrepared: Bool = false,
        precomputedDigest: String? = nil
    ) async throws {
        SingBoxDelayGate.suspend()
        let helperStatus = await PrivilegedRuntimeCoordinator.shared.coreStatus()
        if isRunning || (helperStatus.verified && helperStatus.running) {
            let stopped = await stopAsync()
            let afterStop = await PrivilegedRuntimeCoordinator.shared.coreStatus()
            if afterStop.verified && afterStop.running {
                throw CoreRuntimeError.startFailed("Mihomo is already running.")
            }
            if !stopped && !afterStop.verified {
                throw CoreRuntimeError.startFailed("Mihomo is already running.")
            }
        }

        let digest: String
        if let precomputedDigest, !precomputedDigest.isEmpty {
            digest = precomputedDigest
            runtimeConfigSHA256 = precomputedDigest
        } else {
            digest = try await writeRuntimeConfig(
                overlay: overlay,
                customNodes: customNodes,
                directPolicy: directPolicy
            )
        }

        // Helper installation, launchd replacement, and Unix-socket IPC are
        // serialized off the main actor so the connection animation stays
        // responsive even when macOS displays an administrator prompt.
        do {
            try await PrivilegedRuntimeCoordinator.shared.installAndStartCore(
                configDirectory: configDirectory.path,
                configSHA256: digest,
                helperPrepared: helperPrepared
            )
        } catch {
            guard Self.isAlreadyRunningError(error) else { throw error }
            let stopped = await stopAsync()
            let afterStop = await PrivilegedRuntimeCoordinator.shared.coreStatus()
            let confirmedStopped = afterStop.verified && !afterStop.running
            guard stopped || confirmedStopped else {
                throw CoreRuntimeError.startFailed("Mihomo is already running.")
            }
            try await PrivilegedRuntimeCoordinator.shared.installAndStartCore(
                configDirectory: configDirectory.path,
                configSHA256: digest,
                helperPrepared: helperPrepared
            )
        }
        isRunning = true
    }

    /// The daemon refuses a start while a core it owns is still up. Recognise
    /// that refusal by its code: the message is prose meant for a person, and
    /// rewording it must not silently disable the orphaned-core recovery below.
    /// The text check stays only for a daemon old enough to predate the code.
    private static func isAlreadyRunningError(_ error: Error) -> Bool {
        if case HelperIPCError.commandFailed(_, let code) = error,
           code == "CORE_ALREADY_RUNNING" {
            return true
        }
        return error.localizedDescription.lowercased().contains("already running")
    }

    // MARK: - Stop (via Helper Daemon)

    @discardableResult
    func stop() -> Bool {
        SingBoxDelayGate.suspend()
        let stopped: Bool
        do {
            try HelperManager.stopCore()
            isRunning = false
            stopped = true
        } catch {
            print("[CoreRuntimeManager] stop failed: \(error)")
            let status = HelperManager.coreStatus()
            isRunning = status.running || !status.verified
            stopped = !isRunning
        }
        Self.flushSystemDNSCacheBestEffort()
        fakeIPRotation.processStopped()
        return stopped
    }

    @discardableResult
    func stopAsync() async -> Bool {
        SingBoxDelayGate.suspend()
        let stopped: Bool
        do {
            try await PrivilegedRuntimeCoordinator.shared.stopCore()
            isRunning = false
            stopped = true
        } catch {
            print("[CoreRuntimeManager] stop failed: \(error)")
            let status = await PrivilegedRuntimeCoordinator.shared.coreStatus()
            isRunning = status.running || !status.verified
            stopped = !isRunning
        }
        Self.flushSystemDNSCacheBestEffort()
        fakeIPRotation.processStopped()
        return stopped
    }

    /// Unprivileged and non-blocking. A hung or missing flush must not stall
    /// stop, and it must not change the stop result. This does not ask the
    /// helper to signal mDNSResponder. Whether the system resolver actually
    /// drops a fake-IP answer has to be checked on a Mac.
    private static func flushSystemDNSCacheBestEffort() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/dscacheutil")
        task.arguments = ["-flushcache"]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try? task.run()
    }

    // MARK: - Rewrite Config (for hot reload without restarting process)

    func rewriteConfig(
        overlay: ConfigPipeline.OverlayConfig,
        customNodes: [ProxyNode] = [],
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy? = nil
    ) async throws {
        try await writeRuntimeConfig(
            overlay: overlay,
            customNodes: customNodes,
            directPolicy: directPolicy
        )
    }
}

// MARK: - Core Runtime Error

enum CoreRuntimeError: LocalizedError {
    case binaryNotFound
    case configWriteFailed
    case startFailed(String)

    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            String(localized: "mihomo core binary not found")
        case .configWriteFailed:
            String(localized: "Failed to write config file")
        case .startFailed(let msg):
            String(localized: "Core failed to start: \(msg)")
        }
    }
}
