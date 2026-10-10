import CryptoKit
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
        fakeIPRotation: SingBoxFakeIPRotation,
        installedDigest: String?,
        keepsInstalled: Bool
    ) throws -> String {
        let document = try fakeIPRotation.document(installed: installedDigest, keeping: keepsInstalled) { slot in
            try ConfigPipeline.buildSingBoxRuntime(
                overlay: overlay,
                nodes: customNodes,
                directPlan: directPolicy,
                fakeIPSlot: slot
            ).runtimeJSON
        }
        let digest = try ConfigPipeline.secureWrite(String(decoding: document, as: UTF8.self), to: outputPath)
        // D7: which "Allow local network devices" generation these bytes
        // carry, so the install that runs them can record it as applied.
        LocalNetworkDevicesSync.documentWritten(
            digest: digest,
            setting: .init(
                generation: overlay.localNetworkDevicesGeneration,
                allow: overlay.allowLocalNetworkDevices
            )
        )
        return digest
    }
}

// MARK: - Fake-IP rotation

/// Which slot of the fake-IP pool the next runtime document takes (#1258).
///
/// The Core keeps its fake-IP table in memory and hands addresses out in order
/// from the start of its range. A replacement process on the same range maps
/// an address an app still has cached to whichever name it resolves first.
/// On another slot that address is a plain IP, and the document rejects the
/// pool.
nonisolated final class SingBoxFakeIPRotation: @unchecked Sendable {
    static let defaultsKey = "singBoxFakeIPSlot"

    private let lock = NSLock()
    private let defaults: UserDefaults?
    private var next: Int
    /// The slot each remembered document was rendered on, newest last.
    private var rendered: [(digest: String, slot: Int)] = []
    private static let remembered = 64

    /// The count is kept in `defaults`: a relaunched app adopts the Core the
    /// last one started and carries on after its slot. With nothing stored it
    /// starts anywhere.
    init(defaults: UserDefaults? = AppProfile.defaults) {
        self.defaults = defaults
        let stored = (defaults?.object(forKey: Self.defaultsKey) as? Int).flatMap { $0 >= 0 ? $0 : nil }
        next = stored ?? Int.random(in: 0..<ConfigPipeline.singBoxFakeIPSlots)
    }

    /// `render` returns the document for a slot. A document takes the next
    /// slot that is not the installed document's, because every path that
    /// writes one restarts the Core; the count moves once it has rendered. The
    /// one exception is the reload that skips the restart on an equal digest:
    /// a config that still renders to the installed bytes on the installed
    /// document's slot keeps them.
    func document(
        installed installedDigest: String? = nil, keeping: Bool = false, _ render: (Int) throws -> Data
    ) rethrows -> Data {
        lock.lock()
        defer { lock.unlock() }
        var installedSlot: Int?
        if let index = rendered.lastIndex(where: { $0.digest == installedDigest }) {
            // Named again, so it outlives the documents that were not installed.
            let installed = rendered.remove(at: index)
            rendered.append(installed)
            installedSlot = installed.slot
        }
        if keeping, let installedSlot {
            let document = try render(installedSlot)
            if Self.digest(document) == installedDigest { return document }
        }
        let slot = Self.slot(next, avoiding: installedSlot)
        let document = try render(slot)
        // Stored already past the installed slot: a relaunched app does not
        // remember which one that was.
        next = Self.slot(Self.following(slot), avoiding: installedSlot)
        defaults?.set(next, forKey: Self.defaultsKey)
        rendered.append((Self.digest(document), slot))
        if rendered.count > Self.remembered { rendered.removeFirst() }
        return document
    }

    private static func slot(_ slot: Int, avoiding installed: Int?) -> Int {
        guard let installed else { return slot }
        let slots = ConfigPipeline.singBoxFakeIPSlots
        return slot % slots == installed % slots ? following(slot) : slot
    }

    private static func following(_ slot: Int) -> Int {
        slot == Int.max ? 0 : slot + 1
    }

    private static func digest(_ document: Data) -> String {
        SHA256.hash(data: document).map { String(format: "%02x", $0) }.joined()
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
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy? = nil,
        installed installedDigest: String? = nil,
        keepsInstalled: Bool = false
    ) async throws -> String {
        let digest = try await configWriter.write(
            overlay: overlay,
            customNodes: customNodes,
            directPolicy: directPolicy,
            outputPath: configFilePath,
            fakeIPRotation: fakeIPRotation,
            installedDigest: installedDigest,
            keepsInstalled: keepsInstalled
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
