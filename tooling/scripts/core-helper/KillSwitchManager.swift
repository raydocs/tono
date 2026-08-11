import Foundation
import Darwin

private let killSwitchStatePath = "/Library/Application Support/Tono/killswitch.state"
private let killSwitchPFPath = "/Library/Application Support/Tono/pf.tono.conf"
private let killSwitchMainPFPath = "/etc/pf.conf"
private let killSwitchMainBackupPath = "/etc/pf.conf.tono-backup"
private let killSwitchHostsPath = "/etc/hosts"
private let killSwitchHostsBackupPath = "/etc/hosts.tono-backup"
private let killSwitchAnchor = "tono.killswitch"
private let killSwitchBeginMarker = "# BEGIN TONO KILL SWITCH"
private let killSwitchEndMarker = "# END TONO KILL SWITCH"
private let killSwitchHostsBeginMarker = "# BEGIN TONO KILL SWITCH HOSTS"
private let killSwitchHostsEndMarker = "# END TONO KILL SWITCH HOSTS"
private let killSwitchMaximumStateBytes = 64 * 1024
private let killSwitchMaximumDERPMapBytes = 1024 * 1024
private let killSwitchDERPMapURL = "https://login.tailscale.com/derpmap/default"

/// Ports the reviewed bundle's direct traffic uses. Observed: 80, 443 and 8080
/// for TCP, 443 and 8000 for its media path. Kept as a fixed list so a wider
/// permit cannot be introduced by data.
private let reviewedBundleDirectPorts = [80, 443, 8000, 8080]

private struct KillSwitchEndpoint: Hashable {
    let address: String
    let transport: String
    let port: UInt16

    var json: [String: Any] {
        ["address": address, "transport": transport, "port": Int(port)]
    }
}

private struct KillSwitchProxyTarget: Hashable {
    let host: String
    let transport: String
    let port: UInt16
    let addresses: [String]

    var json: [String: Any] {
        [
            "host": host,
            "transport": transport,
            "port": Int(port),
            "addresses": addresses,
        ]
    }
}

private struct KillSwitchState {
    let armed: Bool
    let tailscaleBootstrapEnabled: Bool
    let apiHosts: [String]
    let exitHints: [String]
    let tunnelInterfaces: [String]
    /// Addresses rendered into the active PF and /etc/hosts policy.
    let resolvedHosts: [String: [String]]
    /// Last safely resolved addresses. Inactive pins never enter PF or hosts.
    let pinnedHosts: [String: [String]]
    let derpEndpoints: [KillSwitchEndpoint]
    let cachedDERPEndpoints: [KillSwitchEndpoint]
    let proxyTargets: [KillSwitchProxyTarget]
    /// Ephemeral exceptions supplied by the current protected session only.
    /// These must never be restored from disk or inherited by a later arm.
    let sessionDirectEndpoints: [KillSwitchEndpoint]
    /// Whether the rule engine routes the reviewed bundle direct this session.
    /// Ephemeral like `sessionDirectEndpoints`: never restored from disk, so a
    /// recovery arm cannot inherit a broader permit than the session asked for.
    let reviewedBundleDirectEnabled: Bool
}

private struct HelperCommandResult {
    let status: Int32
    let output: Data

    var message: String {
        String(data: output.prefix(1024), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

final class KillSwitchManager {
    /// Ceiling for the persisted recovery pin set of a single host. Well under
    /// the 128-address limit `validateAddresses` enforces when those pins are
    /// read back, so accumulation can never lock out a future arm.
    private static let maximumPinnedAddressesPerHost = 32
    private static let defaultHosts = [
        "console.tailscale.com",
        "controlplane.tailscale.com",
        "log.tailscale.com",
        "login.tailscale.com",
    ]

    private let allowedUID: uid_t
    private let lock = NSLock()
    private var stateGeneration: UInt64 = 0
    /// Pass rules most recently loaded into the kernel by this process. A
    /// re-arm whose rule set keeps every previously granted permission may
    /// skip the machine-wide state flush that would otherwise sever every
    /// established flow on the host. nil always forces the safe full flush.
    private var lastLoadedPassRules: Set<String>?

    init(allowedUID: uid_t) throws {
        self.allowedUID = allowedUID
        try Self.ensureRootDirectory("/Library/Application Support/Tono", permissions: 0o700)
        try restoreAtLaunch()
    }

    func arm(
        _ object: [String: Any],
        commitAllowed: () -> Bool = { true }
    ) throws -> [String: Any] {
        // Name resolution and DERP refresh can block under packet loss. Read a
        // stable fallback snapshot under the manager lock, then perform all
        // network work unlocked so the power callback can close its gate
        // immediately instead of missing macOS's sleep acknowledgement window.
        lock.lock()
        let previous = try? loadState()
        let startingGeneration = stateGeneration
        lock.unlock()

        let allowSystemResolution = try Self.boolean(
            object["allowSystemResolution"] ?? false,
            field: "allowSystemResolution"
        )
        let tailscaleBootstrapEnabled = try Self.boolean(
            object["tailscaleBootstrapEnabled"]
                ?? previous?.tailscaleBootstrapEnabled
                ?? false,
            field: "tailscaleBootstrapEnabled"
        )
        let requestedHosts = try Self.list(
            object["apiHosts"] ?? previous?.apiHosts ?? [],
            field: "apiHosts",
            maximum: 16
        )
        let bootstrapPins = try Self.validateBootstrapPins(
            object["bootstrapPins"] ?? [:],
            requestedHosts: requestedHosts
        )
        let exitHints = try Self.validateExitHints(
            object["exitHints"] ?? previous?.exitHints ?? []
        )
        let tunnels = try Self.validateTunnels(
            object["tunnelInterfaces"] ?? previous?.tunnelInterfaces ?? []
        )
        let proxyTargets = try Self.resolveProxyTargets(
            object["proxyEndpoints"] ?? previous?.proxyTargets.map(\.json) ?? [],
            previous: previous?.proxyTargets ?? []
        )
        // Omission deliberately means clear. Unlike proxy targets, these
        // exceptions belong only to the arm request's protected session.
        let sessionDirectEndpoints = try Self.validateSessionDirectEndpoints(
            object["sessionDirectEndpoints"] ?? []
        )
        // Omission means off, and a non-boolean is a hard error rather than a
        // silent default: this flag widens the permit, so an ambiguous request
        // must fail instead of guessing. `NSNumber` would accept 0/1, which the
        // app never sends, so require a real Bool.
        let reviewedBundleDirect: Bool
        switch object["reviewedBundleDirect"] {
        case nil:
            reviewedBundleDirect = false
        case let flag as Bool:
            reviewedBundleDirect = flag
        default:
            throw HelperFailure.invalid("reviewedBundleDirect must be a boolean.")
        }
        var availablePins = previous?.pinnedHosts ?? [:]
        for (host, addresses) in bootstrapPins {
            // Bundle pins seed recovery but must not replace addresses learned
            // by a later successful clean-system resolution. Keep both so a
            // Cloudflare anycast rotation cannot make the next protected
            // reconnect depend on one stale build-time address set.
            //
            // Bounded, because this set is persisted and re-merged on every
            // arm: an unbounded union grew past the resolved-address ceiling as
            // the control plane's anycast addresses rotated, and once it did,
            // `validateAddresses` rejected the recovery pins and every
            // subsequent arm failed — a fail-closed machine that could no
            // longer be re-armed. Bundle pins are kept first so the build-time
            // recovery path always survives truncation; this set is only the
            // fallback anyway, since a successful resolution overwrites
            // `pinnedHosts` for the host immediately below.
            availablePins[host] = Array(
                (availablePins[host] ?? []).reduce(into: addresses) {
                    if !$0.contains($1) { $0.append($1) }
                }.prefix(Self.maximumPinnedAddressesPerHost)
            )
        }
        let (normalizedHosts, resolvedHosts) = try Self.resolveHosts(
            requestedHosts,
            previous: availablePins,
            includeTailscaleBootstrap: tailscaleBootstrapEnabled,
            allowSystemResolution: allowSystemResolution
        )
        var pinnedHosts = availablePins
        for (host, addresses) in resolvedHosts {
            pinnedHosts[host] = addresses
        }

        let derpEndpoints: [KillSwitchEndpoint]
        let cachedDERPEndpoints: [KillSwitchEndpoint]
        if tailscaleBootstrapEnabled {
            if allowSystemResolution {
                do {
                    derpEndpoints = try Self.fetchDERPEndpoints()
                } catch {
                    guard let cached = previous?.cachedDERPEndpoints,
                          !cached.isEmpty else {
                        throw HelperFailure.invalid(
                            "Could not refresh the bounded Tailscale relay allowlist."
                        )
                    }
                    derpEndpoints = try Self.validateEndpoints(cached)
                }
            } else {
                guard let cached = previous?.cachedDERPEndpoints,
                      !cached.isEmpty else {
                    throw HelperFailure.invalid(
                        "No cached Tailscale relay allowlist is available."
                    )
                }
                derpEndpoints = try Self.validateEndpoints(cached)
            }
            guard derpEndpoints.contains(where: {
                $0.transport == "tcp" && $0.port == 443
            }) else {
                throw HelperFailure.invalid("The Tailscale relay allowlist has no HTTPS endpoint.")
            }
            cachedDERPEndpoints = derpEndpoints
        } else {
            derpEndpoints = []
            cachedDERPEndpoints = previous?.cachedDERPEndpoints ?? []
        }

        let state = KillSwitchState(
            armed: true,
            tailscaleBootstrapEnabled: tailscaleBootstrapEnabled,
            apiHosts: normalizedHosts.filter { !Self.defaultHosts.contains($0) },
            exitHints: exitHints,
            tunnelInterfaces: tunnels,
            resolvedHosts: resolvedHosts,
            pinnedHosts: pinnedHosts,
            derpEndpoints: derpEndpoints,
            cachedDERPEndpoints: cachedDERPEndpoints,
            proxyTargets: proxyTargets,
            sessionDirectEndpoints: sessionDirectEndpoints,
            reviewedBundleDirectEnabled: reviewedBundleDirect
        )

        lock.lock()
        defer { lock.unlock() }
        guard stateGeneration == startingGeneration, commitAllowed() else {
            throw HelperFailure.invalid(
                "The network changed during Kill Switch preparation; protection remains fail-closed."
            )
        }
        try Self.writeRules(state: state, allowedUID: allowedUID)
        // Persist fail-closed intent before activating the new rules.
        try saveState(state)
        try Self.ensureHostsMappings(state: state)
        // A machine-wide state flush is a security requirement only when the
        // new rule set revokes a previously granted permission. Node switches
        // and config reloads re-arm with identical or wider rules; flushing
        // there severs every established flow on the host for no protection
        // gain. Any removed pass rule still forces the full flush.
        let passRules = Self.passRules(
            in: Self.renderRules(state: state, allowedUID: allowedUID)
        )
        let revokesAccess = lastLoadedPassRules.map {
            !$0.isSubset(of: passRules)
        } ?? true
        try Self.ensureAnchorLoaded(flushStates: revokesAccess)
        lastLoadedPassRules = passRules
        stateGeneration &+= 1
        return response(
            armed: true, wanted: true, live: true, flushedStates: revokesAccess
        )
    }

    private static func passRules(in rules: String) -> Set<String> {
        Set(
            rules.split(separator: "\n")
                .map(String.init)
                .filter { $0.hasPrefix("pass ") }
        )
    }

    /// Power transitions are secured inside the root helper rather than
    /// relying on a SwiftUI/NSWorkspace callback arriving before applications
    /// resume. Replace every tunnel, proxy, DNS-bootstrap, and control-plane
    /// exception with an emergency all-block and flush old states. The GUI must
    /// run the full arm → TUN → DNS transaction after wake to restore egress.
    @discardableResult
    func secureForPowerTransition() -> Bool {
        lock.lock()
        defer { lock.unlock() }

        do {
            guard let previous = try loadState(), previous.armed else {
                return false
            }
            // Invalidate any arm request that started network work before this
            // transition, while retaining inactive recovery pins for wake.
            stateGeneration &+= 1
            lastLoadedPassRules = nil
            let state = Self.emergencyState(preserving: previous)
            try Self.writeRules(state: state, allowedUID: allowedUID)
            try saveState(state)
            try Self.ensureAnchorLoaded(flushStates: true)
            // Stale /etc/hosts pins do not permit traffic through the all-block
            // PF state. Clean them best-effort after the kernel barrier commits.
            try? Self.ensureHostsMappings(state: state)
            return true
        } catch {
            if Self.stateFileExists() {
                stateGeneration &+= 1
                try? Self.installEmergencyBlock(allowedUID: allowedUID)
                return true
            }
            return false
        }
    }

    func disarm() throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }

        // The anchor flush below opens egress before later steps can still
        // throw. Any arm after a half-completed disarm must therefore take
        // the full state flush — direct PF states established during the open
        // window must never survive into a re-armed kill switch.
        lastLoadedPassRules = nil

        try Self.atomicWrite(
            path: killSwitchPFPath,
            data: Data("# Managed by Tono Kill Switch — intentionally disarmed\n".utf8),
            permissions: 0o600
        )
        // Remove pinned bootstrap names before opening egress. If this fails,
        // the existing live PF block remains in place.
        try Self.removeHostsMappings()
        let cleared = try Self.run("/sbin/pfctl", ["-a", killSwitchAnchor, "-F", "all"])
        guard cleared.status == 0 else {
            throw HelperFailure.system(
                cleared.message.isEmpty ? "PF disarm failed." : cleared.message
            )
        }
        guard !Self.childAnchorActive() else {
            throw HelperFailure.system("PF child anchor remained active.")
        }
        try Self.removeStateIfPresent()
        stateGeneration &+= 1
        lastLoadedPassRules = nil
        return response(armed: false, wanted: false, live: false)
    }

    func status() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }

        var wanted = false
        var healed = false
        var live = Self.effectiveStatus()
        do {
            if let state = try loadState() {
                wanted = state.armed
                if wanted {
                    try Self.ensureHostsMappings(state: state)
                    if !live {
                        try Self.writeRules(state: state, allowedUID: allowedUID)
                        try Self.ensureAnchorLoaded(flushStates: true)
                        lastLoadedPassRules = nil
                        live = Self.effectiveStatus()
                        // Persisted state deliberately omits session direct
                        // endpoints, so this heal reinstalled PF without them.
                        // The GUI must see that and re-arm with the live
                        // session's exceptions.
                        healed = true
                    }
                }
            }
            return response(armed: live, wanted: wanted, live: live, healed: healed)
        } catch {
            // A corrupt persisted armed state can never turn into direct egress.
            if Self.stateFileExists() {
                wanted = true
                if !live {
                    try? Self.installEmergencyBlock(allowedUID: allowedUID)
                    lastLoadedPassRules = nil
                    live = Self.effectiveStatus()
                    healed = true
                }
            }
            var result = response(armed: live, wanted: wanted, live: live, healed: healed)
            result["ok"] = false
            result["error"] = String(describing: error).prefixString(1024)
            return result
        }
    }

    private func response(
        armed: Bool,
        wanted: Bool,
        live: Bool,
        healed: Bool = false,
        flushedStates: Bool = false
    ) -> [String: Any] {
        [
            "ok": true,
            "armed": armed,
            "wantArmed": wanted,
            "live": live,
            "healed": healed,
            // Whether this call severed every established connection on the
            // machine. The daemon has always known — a re-arm flushes states
            // when it withdraws a pass rule the previous ruleset had — and never
            // said so, which cost a day: the only visible symptom was health
            // probes timing out afterwards, and that reads equally well as a
            // restarted core, a dead exit, or a network change. Reporting the
            // one bit that distinguishes them turns that investigation into a
            // log line.
            "flushedStates": flushedStates,
            "version": helperVersion,
        ]
    }

    private func restoreAtLaunch() throws {
        do {
            guard let state = try loadState(), state.armed else { return }
            try Self.writeRules(state: state, allowedUID: allowedUID)
            try Self.ensureHostsMappings(state: state)
            try Self.ensureAnchorLoaded(flushStates: true)
        } catch {
            if Self.stateFileExists() {
                try Self.installEmergencyBlock(allowedUID: allowedUID)
            } else {
                throw error
            }
        }
    }

    private static func installEmergencyBlock(allowedUID: uid_t) throws {
        let state = emergencyState(preserving: nil)
        try writeRules(state: state, allowedUID: allowedUID)
        try ensureAnchorLoaded(flushStates: true)
    }

    private static func emergencyState(
        preserving previous: KillSwitchState?
    ) -> KillSwitchState {
        KillSwitchState(
            armed: true,
            tailscaleBootstrapEnabled: false,
            apiHosts: [],
            exitHints: [],
            tunnelInterfaces: [],
            resolvedHosts: [:],
            pinnedHosts: previous?.pinnedHosts ?? [:],
            derpEndpoints: [],
            cachedDERPEndpoints: previous?.cachedDERPEndpoints ?? [],
            proxyTargets: [],
            sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
        )
    }

    // MARK: - State

    private func loadState() throws -> KillSwitchState? {
        guard Self.stateFileExists() else { return nil }
        let data = try Self.secureRead(
            killSwitchStatePath,
            maximumBytes: killSwitchMaximumStateBytes
        )
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let armed = object["armed"] as? Bool else {
            throw HelperFailure.invalid("Kill Switch state is invalid.")
        }
        // Present-but-unreadable must not read as "no opinion". `if let … as?
        // NSNumber` alone skipped the comparison for any non-numeric value, so a
        // state file claiming `"allowedUid": "501"` — or any other type — was
        // accepted for every user. Absence still means legacy: builds before this
        // field existed wrote none, and `persistentObject` always writes it now,
        // so the compatibility window closes after the first arm.
        if object.keys.contains("allowedUid") {
            guard let stateUID = object["allowedUid"] as? NSNumber,
                  CFGetTypeID(stateUID) != CFBooleanGetTypeID(),
                  stateUID.uint32Value == UInt32(allowedUID) else {
                throw HelperFailure.invalid("Kill Switch state belongs to another user.")
            }
        }
        let tailscaleBootstrapEnabled = try Self.boolean(
            object["tailscaleBootstrapEnabled"] ?? false,
            field: "tailscaleBootstrapEnabled"
        )
        let apiHosts = try Self.list(
            object["apiHosts"] ?? [],
            field: "apiHosts",
            maximum: 16
        ).map { try Self.normalizeHost($0) }
        let exitHints = try Self.validateExitHints(object["exitHints"] ?? [])
        let tunnels = try Self.validateTunnels(
            object["tunnelInterfaces"] ?? [],
            requireExisting: false
        )

        var resolvedHosts: [String: [String]] = [:]
        guard let rawResolved = object["resolvedHosts"] as? [String: Any] else {
            throw HelperFailure.invalid("Kill Switch resolved-host state is invalid.")
        }
        guard rawResolved.count <= 32 else {
            throw HelperFailure.invalid("Kill Switch resolved-host state is too large.")
        }
        for (rawHost, rawAddresses) in rawResolved {
            let host = try Self.normalizeHost(rawHost)
            resolvedHosts[host] = try Self.validateAddresses(rawAddresses)
        }
        let rawPinned = object["pinnedHosts"] as? [String: Any]
            ?? rawResolved
        guard rawPinned.count <= 32 else {
            throw HelperFailure.invalid("Kill Switch pinned-host state is too large.")
        }
        var pinnedHosts: [String: [String]] = [:]
        for (rawHost, rawAddresses) in rawPinned {
            let host = try Self.normalizeHost(rawHost)
            pinnedHosts[host] = try Self.validateAddresses(rawAddresses)
        }

        var endpoints: [KillSwitchEndpoint] = []
        if let rawEndpoints = object["derpEndpoints"] as? [Any] {
            guard rawEndpoints.count <= 2048 else {
                throw HelperFailure.invalid("Kill Switch relay state is too large.")
            }
            for value in rawEndpoints {
                guard let item = value as? [String: Any],
                      let address = item["address"] as? String,
                      let transport = item["transport"] as? String,
                      let portNumber = item["port"] as? NSNumber,
                      let port = UInt16(exactly: portNumber.intValue),
                      let canonical = Self.canonicalPublicAddress(address),
                      transport == "tcp" || transport == "udp" else {
                    throw HelperFailure.invalid("Kill Switch relay state is invalid.")
                }
                endpoints.append(.init(
                    address: canonical,
                    transport: transport,
                    port: port
                ))
            }
        }
        endpoints = try Self.validateEndpoints(endpoints)
        guard tailscaleBootstrapEnabled || endpoints.isEmpty else {
            throw HelperFailure.invalid(
                "Tailscale relay endpoints require bootstrap mode."
            )
        }
        var cachedEndpoints: [KillSwitchEndpoint] = []
        if let rawCachedEndpoints = object["cachedDerpEndpoints"] as? [Any] {
            guard rawCachedEndpoints.count <= 2048 else {
                throw HelperFailure.invalid("Kill Switch cached relay state is too large.")
            }
            for value in rawCachedEndpoints {
                guard let item = value as? [String: Any],
                      let address = item["address"] as? String,
                      let transport = item["transport"] as? String,
                      let portNumber = item["port"] as? NSNumber,
                      let port = UInt16(exactly: portNumber.intValue),
                      let canonical = Self.canonicalPublicAddress(address),
                      transport == "tcp" || transport == "udp" else {
                    throw HelperFailure.invalid("Kill Switch cached relay state is invalid.")
                }
                cachedEndpoints.append(.init(
                    address: canonical,
                    transport: transport,
                    port: port
                ))
            }
            cachedEndpoints = try Self.validateEndpoints(cachedEndpoints)
        } else {
            // Build 26 stored only the active DERP allowlist. Import it once
            // so Build 27 can recover after a protected sleep transition.
            cachedEndpoints = endpoints
        }

        let proxyTargets = try Self.loadProxyTargets(object["proxyTargets"] ?? [])

        return KillSwitchState(
            armed: armed,
            tailscaleBootstrapEnabled: tailscaleBootstrapEnabled,
            apiHosts: apiHosts,
            exitHints: exitHints,
            tunnelInterfaces: tunnels,
            resolvedHosts: resolvedHosts,
            pinnedHosts: pinnedHosts,
            derpEndpoints: endpoints,
            cachedDERPEndpoints: cachedEndpoints,
            proxyTargets: proxyTargets,
            // Session exceptions are intentionally not persisted. A helper
            // restart and every boot therefore restore fail-closed with none.
            sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
        )
    }

    private func saveState(_ state: KillSwitchState) throws {
        let object = Self.persistentObject(state, allowedUID: allowedUID)
        let data = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        ) + Data([0x0A])
        try Self.atomicWrite(
            path: killSwitchStatePath,
            data: data,
            permissions: 0o600
        )
    }

    private static func persistentObject(
        _ state: KillSwitchState,
        allowedUID: uid_t
    ) -> [String: Any] {
        [
            "armed": state.armed,
            "tailscaleBootstrapEnabled": state.tailscaleBootstrapEnabled,
            "apiHosts": state.apiHosts,
            "exitHints": state.exitHints,
            "tunnelInterfaces": state.tunnelInterfaces,
            "resolvedHosts": state.resolvedHosts,
            "pinnedHosts": state.pinnedHosts,
            "derpEndpoints": state.derpEndpoints.map(\.json),
            "cachedDerpEndpoints": state.cachedDERPEndpoints.map(\.json),
            "proxyTargets": state.proxyTargets.map(\.json),
            "allowedUid": Int(allowedUID),
        ]
    }

    private static func stateFileExists() -> Bool {
        var metadata = stat()
        return lstat(killSwitchStatePath, &metadata) == 0
    }

    private static func removeStateIfPresent() throws {
        var metadata = stat()
        guard lstat(killSwitchStatePath, &metadata) == 0 else {
            if errno == ENOENT { return }
            throw HelperFailure.system("Could not inspect Kill Switch state.")
        }
        guard (metadata.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              metadata.st_uid == 0,
              metadata.st_mode & 0o022 == 0,
              unlink(killSwitchStatePath) == 0 else {
            throw HelperFailure.invalid("Refusing to remove unsafe Kill Switch state.")
        }
        try fsyncParent(killSwitchStatePath)
    }

    // MARK: - DERP and address validation

    private static func fetchDERPEndpoints() throws -> [KillSwitchEndpoint] {
        let result = try run(
            "/usr/bin/curl",
            [
                "--disable",
                "--silent",
                "--show-error",
                "--fail",
                "--proto", "=https",
                "--tlsv1.2",
                "--connect-timeout", "5",
                "--max-time", "10",
                "--max-filesize", String(killSwitchMaximumDERPMapBytes),
                killSwitchDERPMapURL,
            ]
        )
        guard result.status == 0,
              !result.output.isEmpty,
              result.output.count <= killSwitchMaximumDERPMapBytes else {
            throw HelperFailure.system(
                result.message.isEmpty ? "Could not download the Tailscale relay map." : result.message
            )
        }
        return try parseDERPMap(result.output)
    }

    private static func parseDERPMap(_ data: Data) throws -> [KillSwitchEndpoint] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let regions = root["Regions"] as? [String: Any],
              regions.count <= 128 else {
            throw HelperFailure.invalid("Tailscale relay map is invalid.")
        }

        var endpoints = Set<KillSwitchEndpoint>()
        var nodeCount = 0
        for value in regions.values {
            guard let region = value as? [String: Any],
                  let nodes = region["Nodes"] as? [Any],
                  nodes.count <= 32 else {
                throw HelperFailure.invalid("Tailscale relay region is invalid.")
            }
            nodeCount += nodes.count
            guard nodeCount <= 1024 else {
                throw HelperFailure.invalid("Tailscale relay map is too large.")
            }
            for rawNode in nodes {
                guard let node = rawNode as? [String: Any] else {
                    throw HelperFailure.invalid("Tailscale relay node is invalid.")
                }
                let stunOnly = node["STUNOnly"] as? Bool ?? false
                let derpPort = try port(node["DERPPort"], defaultValue: 443)
                let stunPort = try port(node["STUNPort"], defaultValue: 3478, allowDisabled: true)

                var addresses: [String] = []
                for key in ["IPv4", "IPv6"] {
                    guard let raw = node[key] as? String, !raw.isEmpty else { continue }
                    if let address = canonicalPublicAddress(raw) {
                        addresses.append(address)
                    } else if raw != "none" {
                        throw HelperFailure.invalid("Tailscale relay address is not public.")
                    }
                }
                if addresses.isEmpty, let hostname = node["HostName"] as? String {
                    let normalized = try normalizeHost(hostname)
                    addresses = try resolveHost(normalized, port: 443)
                }
                guard !addresses.isEmpty else {
                    throw HelperFailure.invalid("Tailscale relay node has no public address.")
                }
                for address in addresses {
                    if !stunOnly, let derpPort {
                        endpoints.insert(.init(
                            address: address,
                            transport: "tcp",
                            port: derpPort
                        ))
                    }
                    if let stunPort {
                        endpoints.insert(.init(
                            address: address,
                            transport: "udp",
                            port: stunPort
                        ))
                    }
                }
            }
        }
        return try validateEndpoints(Array(endpoints))
    }

    private static func port(
        _ value: Any?,
        defaultValue: Int,
        allowDisabled: Bool = false
    ) throws -> UInt16? {
        let parsed = (value as? NSNumber)?.intValue ?? defaultValue
        if allowDisabled && parsed == -1 { return nil }
        guard let port = UInt16(exactly: parsed), port > 0 else {
            throw HelperFailure.invalid("Tailscale relay port is invalid.")
        }
        return port
    }

    private static func validateEndpoints(
        _ endpoints: [KillSwitchEndpoint]
    ) throws -> [KillSwitchEndpoint] {
        guard endpoints.count <= 2048 else {
            throw HelperFailure.invalid("Tailscale relay allowlist is too large.")
        }
        var validated = Set<KillSwitchEndpoint>()
        for endpoint in endpoints {
            guard let address = canonicalPublicAddress(endpoint.address),
                  (endpoint.transport == "tcp" && endpoint.port == 443) ||
                    (endpoint.transport == "udp" && endpoint.port == 3478) else {
                throw HelperFailure.invalid("Tailscale relay endpoint is invalid.")
            }
            validated.insert(.init(
                address: address,
                transport: endpoint.transport,
                port: endpoint.port
            ))
        }
        return validated.sorted {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }
    }

    private static func loadProxyTargets(_ raw: Any) throws -> [KillSwitchProxyTarget] {
        guard let values = raw as? [Any], values.count <= 8 else {
            throw HelperFailure.invalid("Proxy target state must be a bounded array.")
        }
        var result: [KillSwitchProxyTarget] = []
        for value in values {
            guard let item = value as? [String: Any],
                  let rawHost = item["host"] as? String,
                  let transport = item["transport"] as? String,
                  let portNumber = item["port"] as? NSNumber,
                  let port = UInt16(exactly: portNumber.intValue),
                  port > 0 else {
                throw HelperFailure.invalid("Proxy target state is invalid.")
            }
            let host = try normalizeHost(rawHost)
            guard !host.contains(":"), canonicalPublicAddress(host) != nil else {
                throw HelperFailure.invalid("Proxy target host is not a public IP literal.")
            }
            guard transport == "tcp" else {
                throw HelperFailure.invalid("Proxy target transport is invalid.")
            }
            let addresses = try validateAddresses(item["addresses"] ?? [])
            guard addresses == [host] else {
                throw HelperFailure.invalid("Proxy target address does not match its pinned host.")
            }
            let target = KillSwitchProxyTarget(
                host: host,
                transport: transport,
                port: port,
                addresses: addresses
            )
            if !result.contains(target) { result.append(target) }
        }
        return result
    }

    private static func resolveProxyTargets(
        _ raw: Any,
        previous: [KillSwitchProxyTarget]
    ) throws -> [KillSwitchProxyTarget] {
        _ = previous
        guard let values = raw as? [Any], values.count <= 8 else {
            throw HelperFailure.invalid("proxyEndpoints must be a bounded array.")
        }
        var result: [KillSwitchProxyTarget] = []
        for value in values {
            guard let item = value as? [String: Any],
                  let rawHost = item["host"] as? String,
                  let transport = item["transport"] as? String,
                  let portNumber = item["port"] as? NSNumber,
                  let port = UInt16(exactly: portNumber.intValue),
                  port > 0,
                  transport == "tcp" else {
                throw HelperFailure.invalid("Proxy endpoint is invalid.")
            }
            let host = try normalizeHost(rawHost)
            guard !host.contains(":"), canonicalPublicAddress(host) != nil else {
                throw HelperFailure.invalid("Proxy endpoint must be a public IP literal.")
            }
            let addresses = [host]
            let target = KillSwitchProxyTarget(
                host: host,
                transport: transport,
                port: port,
                addresses: addresses
            )
            if !result.contains(target) { result.append(target) }
        }
        return result.sorted {
            ($0.transport, $0.port, $0.host) < ($1.transport, $1.port, $1.host)
        }
    }

    private static func validateSessionDirectEndpoints(_ raw: Any) throws -> [KillSwitchEndpoint] {
        guard let values = raw as? [Any], values.count <= 256 else {
            throw HelperFailure.invalid("sessionDirectEndpoints must be a bounded array.")
        }
        var result = Set<KillSwitchEndpoint>()
        for value in values {
            guard let item = value as? [String: Any],
                  Set(item.keys) == Set(["address", "transport", "port"]),
                  let rawAddress = item["address"] as? String,
                  let address = canonicalPublicAddress(rawAddress),
                  !address.contains(":"), address == rawAddress,
                  let transport = item["transport"] as? String,
                  let portNumber = item["port"] as? NSNumber,
                  CFGetTypeID(portNumber) != CFBooleanGetTypeID(),
                  let port = UInt16(exactly: portNumber.intValue),
                  (transport == "tcp" && (port == 80 || port == 443)) ||
                    (transport == "udp" && (port == 443 || port == 8000)) else {
                throw HelperFailure.invalid("Session direct endpoint is invalid.")
            }
            result.insert(.init(address: address, transport: transport, port: port))
        }
        return result.sorted {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }
    }

    private static func resolveHosts(
        _ requested: [String],
        previous: [String: [String]],
        includeTailscaleBootstrap: Bool,
        allowSystemResolution: Bool
    ) throws -> ([String], [String: [String]]) {
        var hosts: [String] = []
        let requestedHosts = includeTailscaleBootstrap
            ? defaultHosts + requested
            : requested
        for raw in requestedHosts {
            let host = try normalizeHost(raw)
            if !hosts.contains(host) { hosts.append(host) }
        }
        var resolved: [String: [String]] = [:]
        for host in hosts {
            let fallback = try validateAddresses(previous[host] ?? [])
            if allowSystemResolution {
                do {
                    resolved[host] = try resolveHost(host, port: 443)
                    continue
                } catch {
                    // A clean, unprotected connection refreshes pins when it
                    // can, but a transient resolver failure may still use the
                    // last validated public addresses.
                }
            }
            guard !fallback.isEmpty || host == "localhost" else {
                throw HelperFailure.invalid("Could not safely resolve \(host).")
            }
            resolved[host] = fallback
        }
        return (hosts, resolved)
    }

    private static func validateBootstrapPins(
        _ raw: Any,
        requestedHosts: [String]
    ) throws -> [String: [String]] {
        guard let values = raw as? [String: Any], values.count <= 16 else {
            throw HelperFailure.invalid("bootstrapPins must be a bounded object.")
        }
        let requested = try Set(requestedHosts.map(normalizeHost))
        var result: [String: [String]] = [:]
        for (rawHost, rawAddresses) in values {
            let host = try normalizeHost(rawHost)
            guard requested.contains(host) else {
                throw HelperFailure.invalid(
                    "A bootstrap pin does not belong to an active API host."
                )
            }
            let addresses = try validateAddresses(rawAddresses)
            guard !addresses.isEmpty else {
                throw HelperFailure.invalid("A bootstrap pin has no public address.")
            }
            result[host] = addresses
        }
        return result
    }

    private static func resolveHost(_ host: String, port: UInt16) throws -> [String] {
        _ = port
        if host == "localhost" { return [] }
        if let literal = canonicalIPAddress(host) {
            guard canonicalPublicAddress(literal) != nil else {
                if isLoopbackAddress(literal) { return [] }
                throw HelperFailure.invalid("Endpoint address is not public.")
            }
            return [literal]
        }

        // getaddrinfo() has no caller-controlled deadline and was observed
        // holding the single helper request loop for roughly 30 seconds after
        // Wi-Fi loss. dscacheutil uses the same macOS resolver/cache in a child
        // process that can be terminated without leaving a helper thread stuck.
        let lookup = try runBoundedSystemLookup(host, timeoutMilliseconds: 3_000)
        guard lookup.status == 0 else {
            throw HelperFailure.system("Endpoint hostname did not resolve.")
        }
        let values = try parseSystemLookupAddresses(lookup.output)
        guard !values.isEmpty else {
            throw HelperFailure.invalid("Endpoint hostname did not resolve.")
        }
        return values
    }

    private static func parseSystemLookupAddresses(_ data: Data) throws -> [String] {
        guard data.count <= 64 * 1024,
              let text = String(data: data, encoding: .utf8) else {
            throw HelperFailure.invalid("Endpoint resolver output is invalid.")
        }
        var values: [String] = []
        for line in text.components(separatedBy: .newlines) {
            let fields = line.split(separator: ":", maxSplits: 1)
            guard fields.count == 2 else { continue }
            let key = fields[0].trimmingCharacters(in: .whitespaces)
            guard key == "ip_address" || key == "ipv6_address" else { continue }
            let raw = fields[1].trimmingCharacters(in: .whitespaces)
            guard let address = canonicalPublicAddress(raw) else {
                throw HelperFailure.invalid(
                    "Endpoint hostname resolved to a non-public address."
                )
            }
            if !values.contains(address) {
                guard values.count < 128 else {
                    throw HelperFailure.invalid("Endpoint resolved to too many addresses.")
                }
                values.append(address)
            }
        }
        return values
    }

    private static func normalizeHost(_ raw: String) throws -> String {
        let host = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !host.isEmpty, host.utf8.count <= 253,
              !host.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
            throw HelperFailure.invalid("Invalid control-plane host.")
        }
        if host == "localhost" { return host }
        if let address = canonicalIPAddress(host) {
            guard canonicalPublicAddress(address) != nil || isLoopbackAddress(address) else {
                throw HelperFailure.invalid("Control-plane address is not public.")
            }
            return address
        }
        guard !host.hasSuffix(".local"),
              !host.hasSuffix(".internal"),
              !host.hasSuffix(".lan"),
              !host.hasSuffix(".home.arpa") else {
            throw HelperFailure.invalid("Invalid control-plane hostname.")
        }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ label in
            let value = String(label)
            guard value.utf8.count <= 63,
                  let range = value.range(
                    of: #"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"#,
                    options: .regularExpression
                  ) else { return false }
            return range == value.startIndex..<value.endIndex
        }) else {
            throw HelperFailure.invalid("Invalid control-plane hostname.")
        }
        return host
    }

    private static func validateAddresses(_ raw: Any) throws -> [String] {
        let values = try list(raw, field: "resolved addresses", maximum: 128)
        var result: [String] = []
        for value in values {
            guard let address = canonicalPublicAddress(value) else {
                throw HelperFailure.invalid("Resolved address is not public.")
            }
            if !result.contains(address) { result.append(address) }
        }
        return result
    }

    private static func canonicalIPAddress(_ raw: String) -> String? {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, raw, &ipv4) == 1 {
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            return withUnsafePointer(to: &ipv4) {
                inet_ntop(AF_INET, $0, &buffer, socklen_t(buffer.count))
            }.map { _ in String(cString: buffer) }
        }
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, raw, &ipv6) == 1 {
            var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            return withUnsafePointer(to: &ipv6) {
                inet_ntop(AF_INET6, $0, &buffer, socklen_t(buffer.count))
            }.map { _ in String(cString: buffer) }
        }
        return nil
    }

    private static func canonicalPublicAddress(_ raw: String) -> String? {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, raw, &ipv4) == 1 {
            let bytes = withUnsafeBytes(of: &ipv4) { Array($0) }
            guard bytes.count == 4,
                  bytes[0] != 0,
                  bytes[0] != 10,
                  bytes[0] != 127,
                  !(bytes[0] == 100 && (64...127).contains(bytes[1])),
                  !(bytes[0] == 169 && bytes[1] == 254),
                  !(bytes[0] == 172 && (16...31).contains(bytes[1])),
                  !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0),
                  !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2),
                  !(bytes[0] == 192 && bytes[1] == 168),
                  !(bytes[0] == 198 && (18...19).contains(bytes[1])),
                  !(bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100),
                  !(bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113),
                  bytes[0] < 224 else {
                return nil
            }
            return canonicalIPAddress(raw)
        }

        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, raw, &ipv6) == 1 {
            let bytes = withUnsafeBytes(of: &ipv6) { Array($0) }
            guard bytes.count == 16,
                  !bytes.allSatisfy({ $0 == 0 }),
                  !(bytes.dropLast().allSatisfy({ $0 == 0 }) && bytes.last == 1),
                  bytes[0] != 0xff,
                  (bytes[0] & 0xfe) != 0xfc,
                  !(bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80),
                  !(bytes[0] == 0x20 && bytes[1] == 0x01 &&
                    bytes[2] == 0x0d && bytes[3] == 0xb8) else {
                return nil
            }
            return canonicalIPAddress(raw)
        }
        return nil
    }

    private static func isLoopbackAddress(_ raw: String) -> Bool {
        if raw == "::1" { return true }
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, raw, &ipv4) == 1 else { return false }
        return withUnsafeBytes(of: &ipv4) { $0.first == 127 }
    }

    private static func list(
        _ raw: Any,
        field: String,
        maximum: Int
    ) throws -> [String] {
        guard let values = raw as? [Any], values.count <= maximum else {
            throw HelperFailure.invalid("\(field) must be a bounded array.")
        }
        var result: [String] = []
        for rawValue in values {
            guard let string = rawValue as? String else {
                throw HelperFailure.invalid("\(field) must contain strings.")
            }
            let value = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, value.utf8.count <= 255,
                  !value.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
                throw HelperFailure.invalid("\(field) contains an invalid value.")
            }
            if !result.contains(value) { result.append(value) }
        }
        return result
    }

    private static func boolean(_ raw: Any, field: String) throws -> Bool {
        guard let value = raw as? Bool else {
            throw HelperFailure.invalid("\(field) must be a boolean.")
        }
        return value
    }

    private static func validateExitHints(_ raw: Any) throws -> [String] {
        let values = try list(raw, field: "exitHints", maximum: 8)
        for value in values {
            guard let range = value.range(
                of: #"^[A-Za-z0-9_.:%\[\]-]{1,255}$"#,
                options: .regularExpression
            ), range == value.startIndex..<value.endIndex else {
                throw HelperFailure.invalid("Invalid exit-node hint.")
            }
        }
        // Exit hints are audit metadata only and never enter PF rules.
        return values
    }

    private static func validateTunnels(
        _ raw: Any,
        requireExisting: Bool = true
    ) throws -> [String] {
        let values = try list(raw, field: "tunnelInterfaces", maximum: 4)
        for value in values {
            guard let range = value.range(
                of: #"^utun(?:0|[1-9][0-9]{0,2})$"#,
                options: .regularExpression
            ), range == value.startIndex..<value.endIndex else {
                throw HelperFailure.invalid("Invalid owned tunnel interface.")
            }
            if requireExisting, value.withCString({ if_nametoindex($0) }) == 0 {
                throw HelperFailure.invalid("Owned tunnel interface does not exist.")
            }
        }
        return values
    }

    // MARK: - PF

    private static func renderHostsMappings(state: KillSwitchState) -> String {
        var lines = [killSwitchHostsBeginMarker]
        for host in state.resolvedHosts.keys.sorted() {
            guard host != "localhost", canonicalIPAddress(host) == nil else { continue }
            for address in (state.resolvedHosts[host] ?? []).sorted() {
                lines.append("\(address) \(host)")
            }
        }
        for target in state.proxyTargets.sorted(by: { $0.host < $1.host }) {
            guard canonicalIPAddress(target.host) == nil else { continue }
            for address in target.addresses.sorted() {
                let mapping = "\(address) \(target.host)"
                if !lines.contains(mapping) { lines.append(mapping) }
            }
        }
        lines.append(killSwitchHostsEndMarker)
        return lines.joined(separator: "\n") + "\n"
    }

    private static func ensureHostsMappings(state: KillSwitchState) throws {
        let originalData = try secureRead(killSwitchHostsPath, maximumBytes: 1024 * 1024)
        guard let original = String(data: originalData, encoding: .utf8) else {
            throw HelperFailure.invalid("The hosts file is not UTF-8.")
        }
        let candidate = try replacingManagedHosts(
            in: original,
            replacement: renderHostsMappings(state: state)
        )
        guard candidate != original else { return }
        if !FileManager.default.fileExists(atPath: killSwitchHostsBackupPath) {
            try atomicWrite(
                path: killSwitchHostsBackupPath,
                data: originalData,
                permissions: 0o600
            )
        }
        try atomicWrite(
            path: killSwitchHostsPath,
            data: Data(candidate.utf8),
            permissions: 0o644
        )
    }

    private static func removeHostsMappings() throws {
        let originalData = try secureRead(killSwitchHostsPath, maximumBytes: 1024 * 1024)
        guard let original = String(data: originalData, encoding: .utf8) else {
            throw HelperFailure.invalid("The hosts file is not UTF-8.")
        }
        let candidate = try replacingManagedHosts(in: original, replacement: nil)
        guard candidate != original else { return }
        try atomicWrite(
            path: killSwitchHostsPath,
            data: Data(candidate.utf8),
            permissions: 0o644
        )
    }

    private static func replacingManagedHosts(
        in original: String,
        replacement: String?
    ) throws -> String {
        let hasBegin = original.contains(killSwitchHostsBeginMarker)
        let hasEnd = original.contains(killSwitchHostsEndMarker)
        guard hasBegin == hasEnd else {
            throw HelperFailure.invalid("Malformed Tono hosts markers.")
        }

        if hasBegin,
           let begin = original.range(of: killSwitchHostsBeginMarker),
           let end = original.range(
            of: killSwitchHostsEndMarker,
            range: begin.upperBound..<original.endIndex
           ) {
            let suffixStart = original.index(afterLineContaining: end)
            var candidate = String(original[..<begin.lowerBound])
            if let replacement { candidate += replacement }
            candidate += String(original[suffixStart...])
            return candidate
        }
        guard let replacement else { return original }
        var candidate = original
        if !candidate.isEmpty, !candidate.hasSuffix("\n") { candidate += "\n" }
        candidate += replacement
        return candidate
    }

    private static func writeRules(
        state: KillSwitchState,
        allowedUID: uid_t
    ) throws {
        let rules = renderRules(state: state, allowedUID: allowedUID)
        try atomicWrite(
            path: killSwitchPFPath,
            data: Data(rules.utf8),
            permissions: 0o600
        )
        let checked = try run("/sbin/pfctl", ["-nf", killSwitchPFPath])
        guard checked.status == 0 else {
            throw HelperFailure.system(
                checked.message.isEmpty ? "PF rule validation failed." : checked.message
            )
        }
    }

    private static func renderRules(
        state: KillSwitchState,
        allowedUID: uid_t
    ) -> String {
        var lines = [
            "# Managed by Tono Kill Switch — do not edit",
            // Mihomo's controller is loopback-only. Both directions must pass
            // through the child anchor or the app's SYN reaches 127.0.0.1 but
            // the controller response is dropped while PF is fail-closed.
            // Bind every state to the interface where PF created it. macOS PF
            // defaults to floating states; without this, a state established
            // on a TUN that disappears could continue matching after the
            // kernel reroutes the same flow to a physical interface.
            "pass in quick on lo0 all keep state (if-bound)",
            "pass out quick on lo0 all keep state (if-bound)",
        ]
        for interface in state.tunnelInterfaces.sorted() {
            // Host packets leave through the TUN while proxied replies return
            // through it. Keep both directions explicit: macOS PF can otherwise
            // accept the route while silently starving Mihomo's packet path.
            lines.append("pass in quick on \(interface) all keep state (if-bound)")
            lines.append("pass out quick on \(interface) all keep state (if-bound)")
        }

        var controlEndpoints = Set<KillSwitchEndpoint>()
        for addresses in state.resolvedHosts.values {
            for address in addresses {
                controlEndpoints.insert(
                    .init(address: address, transport: "tcp", port: 443)
                )
            }
        }
        for endpoint in controlEndpoints.sorted(by: {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }) {
            // Restricted to the two identities that legitimately use this
            // bootstrap path: the root helper (DERP map refresh) and the signed
            // app running as the interactive user (control-plane recovery while
            // the tunnel is down). Without a `user` clause — the only exception
            // family that lacked one — *any* local process could send to these
            // addresses on 443 outside the tunnel. Because the control plane is
            // fronted by shared anycast addresses and the edge routes by SNI,
            // that was enough for an unprivileged process to reach an unrelated
            // origin of its choosing on the same address and disclose the real
            // IP while the kill switch was armed.
            let family = endpoint.address.contains(":") ? "inet6" : "inet"
            lines.append(
                "pass out quick \(family) proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) " +
                "user { 0, \(allowedUID) } keep state (if-bound)"
            )
        }
        for endpoint in state.derpEndpoints.sorted(by: {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }) {
            // tailscaled owns DERP/STUN transport and runs as root. Restricting
            // these steady-state physical-interface exceptions prevents an
            // unprivileged app or spawned tool from using a DERP tuple to
            // bypass the protected TUN.
            let family = endpoint.address.contains(":") ? "inet6" : "inet"
            lines.append(
                "pass out quick \(family) proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) user root " +
                "keep state (if-bound)"
            )
        }
        for target in state.proxyTargets.sorted(by: {
            ($0.transport, $0.port, $0.host) < ($1.transport, $1.port, $1.host)
        }) {
            for address in target.addresses.sorted() {
                let family = address.contains(":") ? "inet6" : "inet"
                lines.append(
                    "pass out quick \(family) proto \(target.transport) " +
                    "to \(address) port \(target.port) user root keep state (if-bound)"
                )
            }
        }
        for endpoint in state.sessionDirectEndpoints {
            lines.append(
                "pass out quick inet proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) user root keep state (if-bound)"
            )
        }
        if state.reviewedBundleDirectEnabled {
            // The reviewed bundle's traffic is routed direct by the rule engine,
            // and those packets leave as root from the core, so no `to <address>`
            // exception can express them: the addresses rotate and mostly never
            // appear in DNS. Scoped as tightly as PF allows — root only, and
            // only the ports that traffic uses — so a rule-engine mistake can at
            // worst escape on a web port instead of any port. Everything the
            // engine does not route direct still reaches `MATCH,Tono-Exit`, so a
            // dead tunnel remains fail-closed for it.
            //
            // `from any to any` is not decoration: PF only accepts `port` as
            // part of a host specification, so the shorter `proto tcp port {…}`
            // is a parse error that takes the whole ruleset down and leaves the
            // session unable to arm at all.
            for transport in ["tcp", "udp"] {
                lines.append(
                    "pass out quick inet proto \(transport) from any to any " +
                    "port { \(reviewedBundleDirectPorts.map(String.init).joined(separator: ", ")) } " +
                    "user root keep state (if-bound)"
                )
            }
        }
        lines.append("block drop out quick all")
        return lines.joined(separator: "\n") + "\n"
    }

    @discardableResult
    private static func ensureMainHook() throws -> Bool {
        let originalData = try secureRead(killSwitchMainPFPath, maximumBytes: 1024 * 1024)
        guard let original = String(data: originalData, encoding: .utf8) else {
            throw HelperFailure.invalid("The main PF configuration is not UTF-8.")
        }
        let hasBegin = original.contains(killSwitchBeginMarker)
        let hasEnd = original.contains(killSwitchEndMarker)
        guard hasBegin == hasEnd else {
            throw HelperFailure.invalid("Malformed Tono PF markers.")
        }

        let snippet = """
        \(killSwitchBeginMarker)
        anchor "\(killSwitchAnchor)"
        load anchor "\(killSwitchAnchor)" from "\(killSwitchPFPath)"
        \(killSwitchEndMarker)

        """
        let candidate: String
        if hasBegin,
           let begin = original.range(of: killSwitchBeginMarker),
           let end = original.range(
            of: killSwitchEndMarker,
            range: begin.upperBound..<original.endIndex
           ) {
            let suffixStart = original.index(afterLineContaining: end)
            candidate = String(original[..<begin.lowerBound]) +
                snippet +
                String(original[suffixStart...]).trimmingLeadingNewlines()
        } else {
            let legacy = """

            # Tono kill switch
            anchor "\(killSwitchAnchor)"
            load anchor "\(killSwitchAnchor)" from "\(killSwitchPFPath)"

            """
            var cleaned = original.replacingOccurrences(of: legacy, with: "\n")
            guard !cleaned.contains("anchor \"\(killSwitchAnchor)\""),
                  !cleaned.contains("load anchor \"\(killSwitchAnchor)\"") else {
                throw HelperFailure.invalid("An unmanaged Tono PF anchor already exists.")
            }
            var lines = cleaned.components(separatedBy: .newlines)
            var insertion = lines.count
            for (index, line) in lines.enumerated() {
                let value = line.trimmingCharacters(in: .whitespaces)
                if value.hasPrefix("anchor ") || value.hasPrefix("pass ") ||
                    value.hasPrefix("block ") || value.hasPrefix("match ") {
                    insertion = index
                    break
                }
            }
            lines.insert(contentsOf: snippet.components(separatedBy: .newlines), at: insertion)
            cleaned = lines.joined(separator: "\n")
            if original.hasSuffix("\n"), !cleaned.hasSuffix("\n") { cleaned += "\n" }
            candidate = cleaned
        }

        let candidatePath = "/etc/.tono-pf-\(UUID().uuidString)"
        defer { unlink(candidatePath) }
        try atomicWrite(
            path: candidatePath,
            data: Data(candidate.utf8),
            permissions: 0o600
        )
        let candidateCheck = try run("/sbin/pfctl", ["-nf", candidatePath])
        guard candidateCheck.status == 0 else {
            throw HelperFailure.system(
                candidateCheck.message.isEmpty
                    ? "Main PF validation failed."
                    : candidateCheck.message
            )
        }
        if candidate != original {
            if !FileManager.default.fileExists(atPath: killSwitchMainBackupPath) {
                try atomicWrite(
                    path: killSwitchMainBackupPath,
                    data: originalData,
                    permissions: 0o600
                )
            }
            try atomicWrite(
                path: killSwitchMainPFPath,
                data: Data(candidate.utf8),
                permissions: 0o644
            )
        }
        let installedCheck = try run("/sbin/pfctl", ["-nf", killSwitchMainPFPath])
        guard installedCheck.status == 0 else {
            throw HelperFailure.system(
                installedCheck.message.isEmpty
                    ? "Installed PF configuration is invalid."
                    : installedCheck.message
            )
        }
        return candidate != original
    }

    private static func ensureAnchorLoaded(flushStates: Bool) throws {
        let mainChanged = try ensureMainHook()
        let loaded: HelperCommandResult
        if mainChanged || !mainAnchorActive() {
            // Installing/recovering the anchor point requires one main ruleset
            // load. Normal arm/reassert operations must not flush unrelated
            // dynamic macOS anchors.
            loaded = try run("/sbin/pfctl", ["-f", killSwitchMainPFPath])
        } else {
            loaded = try run(
                "/sbin/pfctl",
                ["-a", killSwitchAnchor, "-f", killSwitchPFPath]
            )
        }
        guard loaded.status == 0 else {
            throw HelperFailure.system(
                loaded.message.isEmpty ? "Main PF load failed." : loaded.message
            )
        }
        if !pfEnabled() {
            let enabled = try run("/sbin/pfctl", ["-e"])
            guard enabled.status == 0 || pfEnabled() else {
                throw HelperFailure.system(
                    enabled.message.isEmpty ? "PF enable failed." : enabled.message
                )
            }
        }
        guard effectiveStatus() else {
            throw HelperFailure.system("Kill Switch rules are not active.")
        }
        if flushStates {
            let flushed = try run("/sbin/pfctl", ["-F", "states"])
            guard flushed.status == 0 else {
                throw HelperFailure.system(
                    flushed.message.isEmpty ? "PF state flush failed." : flushed.message
                )
            }
        }
        guard effectiveStatus() else {
            throw HelperFailure.system("Kill Switch verification failed.")
        }
    }

    private static func pfEnabled() -> Bool {
        guard let result = try? run("/sbin/pfctl", ["-s", "info"]),
              result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.lowercased().contains("status: enabled")
    }

    private static func mainAnchorActive() -> Bool {
        guard let result = try? run("/sbin/pfctl", ["-sr"]),
              result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.contains("anchor \"\(killSwitchAnchor)\"")
    }

    private static func childAnchorActive() -> Bool {
        guard let result = try? run(
            "/sbin/pfctl",
            ["-a", killSwitchAnchor, "-sr"]
        ), result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.lowercased().contains("block drop out quick all")
    }

    private static func effectiveStatus() -> Bool {
        pfEnabled() && mainAnchorActive() && childAnchorActive()
    }

    // MARK: - Root-owned I/O and commands

    private static func ensureRootDirectory(
        _ path: String,
        permissions: mode_t
    ) throws {
        var metadata = stat()
        if lstat(path, &metadata) != 0 {
            guard errno == ENOENT, mkdir(path, permissions) == 0 else {
                throw HelperFailure.system("Could not create a secure root directory.")
            }
        } else {
            guard (metadata.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
                  metadata.st_uid == 0,
                  metadata.st_mode & 0o022 == 0 else {
                throw HelperFailure.invalid("A root-owned directory is unsafe.")
            }
        }
        guard chown(path, 0, 0) == 0, chmod(path, permissions) == 0 else {
            throw HelperFailure.system("Could not secure a root-owned directory.")
        }
    }

    private static func secureRead(_ path: String, maximumBytes: Int) throws -> Data {
        let fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else {
            throw HelperFailure.system("A required root-owned file is unavailable.")
        }
        defer { close(fd) }
        var metadata = stat()
        guard fstat(fd, &metadata) == 0,
              (metadata.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              metadata.st_uid == 0,
              metadata.st_mode & 0o022 == 0,
              metadata.st_size >= 0,
              metadata.st_size <= maximumBytes else {
            throw HelperFailure.invalid("A root-owned file is unsafe.")
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw HelperFailure.system("Could not read a root-owned file.")
            }
            data.append(buffer, count: count)
            guard data.count <= maximumBytes else {
                throw HelperFailure.invalid("A root-owned file is too large.")
            }
        }
        return data
    }

    private static func atomicWrite(
        path: String,
        data: Data,
        permissions: mode_t
    ) throws {
        let parent = (path as NSString).deletingLastPathComponent
        if parent == "/Library/Application Support/Tono" {
            try ensureRootDirectory(parent, permissions: 0o700)
        }
        var existing = stat()
        if lstat(path, &existing) == 0 {
            guard (existing.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
                  existing.st_uid == 0,
                  existing.st_mode & 0o022 == 0 else {
                throw HelperFailure.invalid("Refusing to replace an unsafe root-owned file.")
            }
        } else if errno != ENOENT {
            throw HelperFailure.system("Could not inspect a root-owned file.")
        }

        let temporary = "\(parent)/.tono-\(UUID().uuidString)"
        let fd = open(
            temporary,
            O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
            0o600
        )
        guard fd >= 0 else {
            throw HelperFailure.system("Could not create an atomic root-owned file.")
        }
        var committed = false
        defer {
            close(fd)
            if !committed { unlink(temporary) }
        }
        try data.withUnsafeBytes {
            guard let base = $0.baseAddress else { return }
            var offset = 0
            while offset < $0.count {
                let count = Darwin.write(fd, base.advanced(by: offset), $0.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw HelperFailure.system("Could not write a root-owned file.")
                }
                guard count > 0 else {
                    throw HelperFailure.system("Could not write a root-owned file.")
                }
                offset += count
            }
        }
        guard fsync(fd) == 0,
              fchown(fd, 0, 0) == 0,
              fchmod(fd, permissions) == 0,
              rename(temporary, path) == 0 else {
            throw HelperFailure.system("Could not commit a root-owned file.")
        }
        committed = true
        try fsyncParent(path)
    }

    private static func fsyncParent(_ path: String) throws {
        let parent = (path as NSString).deletingLastPathComponent
        let fd = open(parent, O_RDONLY | O_CLOEXEC)
        guard fd >= 0 else {
            throw HelperFailure.system("Could not open a root-owned directory.")
        }
        defer { close(fd) }
        guard fsync(fd) == 0 else {
            throw HelperFailure.system("Could not persist a root-owned directory.")
        }
    }

    private static func run(
        _ executable: String,
        _ arguments: [String]
    ) throws -> HelperCommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return .init(status: process.terminationStatus, output: output)
    }

    private static func runBoundedSystemLookup(
        _ host: String,
        timeoutMilliseconds: Int
    ) throws -> HelperCommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/dscacheutil")
        process.arguments = ["-q", "host", "-a", "name", host]
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()

        let deadline = Date().addingTimeInterval(
            Double(max(100, timeoutMilliseconds)) / 1_000
        )
        while process.isRunning, Date() < deadline {
            usleep(20_000)
        }
        if process.isRunning {
            process.terminate()
            for _ in 0..<10 where process.isRunning { usleep(20_000) }
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        guard output.count <= 64 * 1024 else {
            throw HelperFailure.invalid("Endpoint resolver output is too large.")
        }
        return .init(status: process.terminationStatus, output: output)
    }

    // MARK: - Pure self-tests

    /// Hands a rendered ruleset to `pfctl -n` so the parser — not a substring
    /// assertion — decides whether it is valid. Substring assertions cannot
    /// catch a malformed rule they were written to match: a permit missing its
    /// host specification passed every content check and then failed to load on
    /// the user's machine, leaving two builds unable to arm at all.
    ///
    /// `nil` means the check could not run (pfctl needs root to open /dev/pf),
    /// never "valid". Callers must surface a skip rather than absorb it.
    static func pfSyntaxAccepts(_ rules: String) -> Bool? {
        guard geteuid() == 0 else { return nil }
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-pf-syntax-check.conf").path
        guard let _ = try? Data(rules.utf8).write(to: URL(fileURLWithPath: path)) else {
            return nil
        }
        defer { try? FileManager.default.removeItem(atPath: path) }
        guard let result = try? run("/sbin/pfctl", ["-nf", path]) else { return nil }
        if result.status != 0 {
            FileHandle.standardError.write(Data("pf syntax: \(result.message)\n".utf8))
        }
        return result.status == 0
    }

    /// Lifecycle coverage for the ruleset, exercised through `pfctl` itself.
    ///
    /// Every fault this session shipped was a lifecycle fault, not a rendering
    /// fault: a permit revoked by a later re-arm, a rule shape the parser
    /// rejects, a contract change that never reached the installed daemon.
    /// String assertions over a rendered document cannot see any of those,
    /// which is why they all reached a user's machine before anything noticed.
    ///
    /// PF is global state, and that is the real reason this coverage did not
    /// exist: a test that arms for real can take the machine's network down.
    /// So these rules load into an anchor no parent ruleset references. Loading
    /// is genuine — `pfctl -f` parses and installs it, and `pfctl -sr` reads
    /// back what the kernel actually holds — while an unreferenced anchor is
    /// never evaluated against a packet, so no traffic decision changes.
    ///
    /// Deliberately not parameterised: the anchor and the scratch path are
    /// compiled in, so there is no seam for a caller to point this at the
    /// production anchor, `/etc/pf.conf`, or the real state file.
    static func runLifecycleSelfTests() -> Bool {
        let testAnchor = "tono.lifecycle-test"
        guard geteuid() == 0 else {
            FileHandle.standardError.write(Data("""
            lifecycle self-test needs root: it loads rules through pfctl.
              sudo <helper> --lifecycle-self-test
            The rules go into the unreferenced anchor "\(testAnchor)", so no
            traffic decision changes and the production anchor is untouched.

            """.utf8))
            return false
        }
        let scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-lifecycle-test.conf").path
        defer {
            _ = try? run("/sbin/pfctl", ["-a", testAnchor, "-F", "all"])
            try? FileManager.default.removeItem(atPath: scratch)
        }

        func state(reviewedBundleDirect: Bool) -> KillSwitchState {
            KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: false,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: ["utun199"],
                resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                derpEndpoints: [],
                cachedDERPEndpoints: [],
                proxyTargets: [
                    .init(host: "8.8.4.4", transport: "tcp", port: 443,
                          addresses: ["8.8.4.4"]),
                ],
                sessionDirectEndpoints: [],
                reviewedBundleDirectEnabled: reviewedBundleDirect
            )
        }

        /// Loads a rendered ruleset and returns what the kernel holds, or nil
        /// when the parser refused it.
        func load(_ rules: String) -> String? {
            guard (try? Data(rules.utf8).write(
                to: URL(fileURLWithPath: scratch)
            )) != nil else { return nil }
            guard let applied = try? run(
                "/sbin/pfctl", ["-a", testAnchor, "-f", scratch]
            ), applied.status == 0 else {
                FileHandle.standardError.write(Data(
                    "lifecycle: pfctl refused the ruleset\n".utf8
                ))
                return nil
            }
            guard let shown = try? run("/sbin/pfctl", ["-a", testAnchor, "-sr"]),
                  shown.status == 0,
                  let text = String(data: shown.output, encoding: .utf8)
            else { return nil }
            return text
        }

        // pfctl normalises what it prints, so match on the parts that carry
        // meaning rather than on the rendered line. Calibrated against real
        // output: a port list expands into one rule per port.
        // Calibrated against what the kernel actually reports. A port list is
        // expanded into one rule per port per protocol, and `from any to any`
        // is unique to this permit — the exact-address exceptions all print as
        // `to <address>`. Counting exactly pins the port set too, so quietly
        // widening it fails here instead of shipping.
        let expectedPermitRules = reviewedBundleDirectPorts.count * 2
        func permitCount(_ shown: String) -> Int {
            shown.split(separator: "\n").filter {
                $0.contains("from any to any port = ") && $0.contains("user = 0")
            }.count
        }

        var failures: [String] = []
        func check(_ name: String, _ ok: Bool) {
            if !ok { failures.append(name) }
        }

        // 1. Armed with the reviewed-bundle permit: it must be installed, and
        //    the catch-all must still be the last word.
        let armedRules = renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        guard let armed = load(armedRules) else {
            FileHandle.standardError.write(Data("lifecycle: armed ruleset failed to load\n".utf8))
            return false
        }
        if ProcessInfo.processInfo.environment["TONO_LIFECYCLE_DUMP"] != nil {
            FileHandle.standardError.write(Data("--- kernel holds ---\n\(armed)\n".utf8))
        }
        check("armed-permit-installed", permitCount(armed) == expectedPermitRules)
        check("armed-fails-closed", armed.contains("block drop out quick all"))
        // Order is only observable in what the kernel holds. A permit placed
        // after the catch-all parses, prints, and satisfies every substring
        // assertion while being dead — the packet is dropped before it is
        // reached.
        let permitBeforeCatchAll: Bool = {
            guard let block = armed.range(of: "block drop out quick all") else {
                return false
            }
            guard let lastPermit = armed.range(
                of: "from any to any port = ", options: .backwards
            ) else { return false }
            return lastPermit.lowerBound < block.lowerBound
        }()
        check("permit-precedes-catch-all", permitBeforeCatchAll)
        check("armed-keeps-tunnel", armed.contains("utun199"))

        // 2. A re-arm that omits the flag must revoke it. This is the shipped
        //    bug from the other direction: the convergence arm dropped the
        //    argument and the permit disappeared under a live session while the
        //    rule engine still routed that bundle direct.
        guard let withoutPermit = load(renderRules(state: state(reviewedBundleDirect: false), allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: re-armed ruleset failed to load\n".utf8))
            return false
        }
        check("re-arm-without-flag-revokes", permitCount(withoutPermit) == 0)
        check("re-arm-still-fails-closed", withoutPermit.contains("block drop out quick all"))

        // 3. The convergence sequence that actually shipped broken: arm, then
        //    arm again for the same session. The permit must survive.
        guard let convergence = load(renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: convergence arm failed to load\n".utf8))
            return false
        }
        check("convergence-arm-keeps-permit", permitCount(convergence) == expectedPermitRules)

        // 4. The fault that reached customers, in its real shape.
        //
        // A re-arm flushes every PF state on the machine exactly when it removes
        // a pass rule that the previous ruleset had — correct as a security
        // rule, and devastating as an accident. The pin-refresh transaction
        // arms twice: once with the union of old and new endpoints, then again
        // to converge on the new set. That second arm dropped its
        // `reviewedBundleDirect` argument, so it removed all eight permit rules,
        // which made every refresh a machine-wide state flush. Long-lived
        // streams died mid-response roughly every twenty minutes.
        //
        // Not a rendering property and not a parsing property: both arms are
        // individually valid and both load. It is a property of the pair, which
        // is why nothing caught it.
        let firstArmPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        )
        let convergedPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        )
        let droppedPermitPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: false), allowedUID: 501)
        )
        check(
            "convergence-arm-does-not-revoke",
            firstArmPassRules.isSubset(of: convergedPassRules)
        )
        // The same comparison against the broken shape, which is what gives the
        // assertion above its teeth: if dropping the permit did not register as
        // a revocation, passing it would not be protecting anything.
        check(
            "dropping-the-permit-registers-as-revocation",
            !firstArmPassRules.isSubset(of: droppedPermitPassRules)
        )

        // 5. The predicate behind the reported flush bit. Note the limit: this
        //    covers whether a withdrawal is *detected* as one, not whether the
        //    bit `arm` returns is wired to that detection. Both read the same
        //    local, so they can only diverge if someone edits one of them, but
        //    proving the wiring needs a real arm — the install-and-start
        //    integration coverage that does not exist yet.
        check(
            "flush-reported-when-a-pass-rule-is-withdrawn",
            !firstArmPassRules.isSubset(of: droppedPermitPassRules)
        )
        check(
            "no-flush-reported-when-nothing-is-withdrawn",
            firstArmPassRules.isSubset(of: convergedPassRules)
        )
        // Widening must not count as a withdrawal, or every added endpoint would
        // sever the session it was added for.
        let widened = passRules(
            in: renderRules(
                state: KillSwitchState(
                    armed: true,
                    tailscaleBootstrapEnabled: false,
                    apiHosts: [],
                    exitHints: [],
                    tunnelInterfaces: ["utun199"],
                    resolvedHosts: [
                        "api.example.com": ["1.1.1.1"],
                        "extra.example.com": ["9.9.9.9"],
                    ],
                    pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                    derpEndpoints: [],
                    cachedDERPEndpoints: [],
                    proxyTargets: [
                        .init(host: "8.8.4.4", transport: "tcp", port: 443,
                              addresses: ["8.8.4.4"]),
                    ],
                    sessionDirectEndpoints: [],
                    reviewedBundleDirectEnabled: true
                ),
                allowedUID: 501
            )
        )
        check("widening-is-not-a-withdrawal", firstArmPassRules.isSubset(of: widened))

        // 6. Emergency reset leaves loopback and the catch-all, nothing else.
        let emergency = emergencyState(preserving: state(reviewedBundleDirect: true))
        guard let emergencyShown = load(renderRules(state: emergency, allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: emergency ruleset failed to load\n".utf8))
            return false
        }
        check("emergency-drops-permit", permitCount(emergencyShown) == 0)
        check("emergency-drops-tunnel", !emergencyShown.contains("utun199"))
        check("emergency-fails-closed", emergencyShown.contains("block drop out quick all"))

        if failures.isEmpty { return true }
        FileHandle.standardError.write(Data(
            "lifecycle self-test failed: \(failures.joined(separator: ", "))\n".utf8
        ))
        return false
    }

    static func runSelfTests() -> Bool {
        do {
            guard canonicalPublicAddress("8.8.8.8") == "8.8.8.8",
                  canonicalPublicAddress("2606:4700:4700::1111") != nil,
                  canonicalPublicAddress("127.0.0.1") == nil,
                  canonicalPublicAddress("10.0.0.1") == nil,
                  canonicalPublicAddress("100.64.0.1") == nil,
                  canonicalPublicAddress("192.168.1.1") == nil,
                  canonicalPublicAddress("::1") == nil,
                  canonicalPublicAddress("fd00::1") == nil,
                  try normalizeHost("ControlPlane.Tailscale.com.") ==
                    "controlplane.tailscale.com" else {
                return false
            }
            let sample = Data(
                #"{"Regions":{"1":{"Nodes":[{"HostName":"derp.example.com","IPv4":"8.8.8.8","IPv6":"2606:4700:4700::1111","DERPPort":443,"STUNPort":3478}]}}}"#
                    .utf8
            )
            let endpoints = try parseDERPMap(sample)
            guard endpoints.count == 4 else { return false }
            let lookupAddresses = try parseSystemLookupAddresses(Data("""
            name: api.example.com
            ipv6_address: 2606:4700:4700::1111

            name: api.example.com
            ip_address: 1.1.1.1
            """.utf8))
            guard lookupAddresses == ["2606:4700:4700::1111", "1.1.1.1"] else {
                return false
            }
            let directEndpoints = try validateSessionDirectEndpoints([
                ["address": "8.8.8.8", "transport": "udp", "port": 8000],
                ["address": "1.1.1.1", "transport": "tcp", "port": 443],
                ["address": "8.8.8.8", "transport": "tcp", "port": 80],
                ["address": "1.0.0.1", "transport": "udp", "port": 443],
                ["address": "8.8.8.8", "transport": "udp", "port": 8000],
            ])
            guard directEndpoints.count == 4,
                  directEndpoints.map(\.json).map({ $0["transport"] as? String }) ==
                    ["tcp", "tcp", "udp", "udp"] else { return false }
            let invalidDirectEndpoints: [Any] = [
                [["address": "10.0.0.1", "transport": "tcp", "port": 443]],
                [["address": "2606:4700:4700::1111", "transport": "tcp", "port": 443]],
                [["address": "8.8.8.0/24", "transport": "tcp", "port": 443]],
                [["address": "example.com", "transport": "tcp", "port": 443]],
                [["address": "8.8.8.8", "transport": "tcp", "port": 8000]],
                [["address": "8.8.8.8", "transport": "udp", "port": 80]],
                [["address": "8.8.8.8", "transport": "quic", "port": 443]],
                Array(repeating: ["address": "8.8.8.8", "transport": "tcp", "port": 443], count: 257),
            ]
            for invalid in invalidDirectEndpoints {
                do {
                    _ = try validateSessionDirectEndpoints(invalid)
                    return false
                } catch {}
            }
            let state = KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: true,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: [],
                resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                derpEndpoints: endpoints,
                cachedDERPEndpoints: endpoints,
                proxyTargets: [
                    .init(
                        host: "8.8.4.4",
                        transport: "tcp",
                        port: 8443,
                        addresses: ["8.8.4.4"]
                    ),
                ],
                sessionDirectEndpoints: directEndpoints,
                reviewedBundleDirectEnabled: true
            )
            let rules = renderRules(state: state, allowedUID: 501)
            let emergencyState = emergencyState(preserving: state)
            let emergencyRules = renderRules(
                state: emergencyState,
                allowedUID: 501
            )
            let cloudRules = renderRules(
                state: .init(
                    armed: true,
                    tailscaleBootstrapEnabled: false,
                    apiHosts: ["api.example.com"],
                    exitHints: [],
                    tunnelInterfaces: ["utun199"],
                    resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                    pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                    derpEndpoints: [],
                    cachedDERPEndpoints: [],
                    proxyTargets: state.proxyTargets,
                    sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
                ),
                allowedUID: 501
            )
            let inactiveState = KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: false,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: ["utun199"],
                resolvedHosts: [:],
                pinnedHosts: state.pinnedHosts,
                derpEndpoints: [],
                cachedDERPEndpoints: state.cachedDERPEndpoints,
                proxyTargets: state.proxyTargets,
                sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
            )
            let inactiveRules = renderRules(
                state: inactiveState,
                allowedUID: 501
            )
            let inactiveHosts = renderHostsMappings(state: inactiveState)
            let (_, cacheOnlyResolved) = try resolveHosts(
                ["api.example.com"],
                previous: state.pinnedHosts,
                includeTailscaleBootstrap: false,
                allowSystemResolution: false
            )
            let hosts = renderHostsMappings(state: state)
            let installedHosts = try replacingManagedHosts(
                in: "127.0.0.1 localhost\n",
                replacement: hosts
            )
            let removedHosts = try replacingManagedHosts(
                in: hosts,
                replacement: nil
            )
            let bootstrapPins = try validateBootstrapPins(
                ["api.example.com": ["1.1.1.1"]],
                requestedHosts: ["api.example.com"]
            )
            let rejectedUnrequestedPin: Bool
            do {
                _ = try validateBootstrapPins(
                    ["other.example.com": ["8.8.8.8"]],
                    requestedHosts: ["api.example.com"]
                )
                rejectedUnrequestedPin = false
            } catch {
                rejectedUnrequestedPin = true
            }
            let rejectedPrivateTarget: Bool
            do {
                _ = try resolveProxyTargets(
                    [[
                        "host": "10.0.0.1",
                        "transport": "tcp",
                        "port": 443,
                    ]],
                    previous: []
                )
                rejectedPrivateTarget = false
            } catch {
                rejectedPrivateTarget = true
            }
            let rejectedUDPProxyTarget: Bool
            do {
                _ = try resolveProxyTargets(
                    [[
                        "host": "8.8.4.4",
                        "transport": "udp",
                        "port": 443,
                    ]],
                    previous: []
                )
                rejectedUDPProxyTarget = false
            } catch {
                rejectedUDPProxyTarget = true
            }
            let persisted = persistentObject(state, allowedUID: 501)
            // Split into named steps: as a single boolean chain this grew past
            // what the type checker will solve in reasonable time.
            let required = [
                // The reviewed-bundle permit must stay root-only and stay bound
                // to the fixed port list; an "any port" form would let a routing
                // mistake exfiltrate anywhere.
                "pass out quick inet proto tcp from any to any " +
                    "port { 80, 443, 8000, 8080 } user root keep state (if-bound)",
                "pass out quick inet proto udp from any to any " +
                    "port { 80, 443, 8000, 8080 } user root keep state (if-bound)",
                "to 1.1.1.1 port 443 user { 0, 501 } keep state (if-bound)",
                "to 8.8.8.8 port 443 user root keep state (if-bound)",
                "proto udp",
                "to 8.8.4.4 port 8443 user root keep state (if-bound)",
                "pass out quick inet proto tcp to 8.8.8.8 port 80 user root keep state (if-bound)",
                "pass out quick inet proto udp to 8.8.8.8 port 8000 user root keep state (if-bound)",
                "pass in quick on lo0 all keep state (if-bound)",
                "pass out quick on lo0 all keep state (if-bound)",
                "block drop out quick all",
            ]
            let forbidden = [
                // Never a permit without a user clause, and never all ports.
                "pass out quick inet proto tcp user root keep state (if-bound)",
                "pass out quick inet proto tcp from any to any " +
                    "port { 80, 443, 8000, 8080 } keep state (if-bound)",
                // PF rejects `port` that is not attached to a host spec. This
                // shipped once and cost two builds: the ruleset failed to parse,
                // so no session could arm at all. The substring only matches the
                // broken form, since the correct one reads `to any port {`.
                "proto tcp port {",
                "proto udp port {",
                // The bootstrap permit must never be world-usable again.
                "to 1.1.1.1 port 443 keep state (if-bound)",
                "to 8.8.8.8 port 443 keep state (if-bound)",
                "proto tcp to any",
            ]
            let ruleShapesHold = required.allSatisfy(rules.contains)
                && !forbidden.contains(where: rules.contains)
            let emergencyExpected = [
                "# Managed by Tono Kill Switch — do not edit",
                "pass in quick on lo0 all keep state (if-bound)",
                "pass out quick on lo0 all keep state (if-bound)",
                "block drop out quick all",
                "",
            ].joined(separator: "\n")
            let cloudRequired = [
                "pass in quick on utun199 all keep state (if-bound)",
                "pass out quick on utun199 all keep state (if-bound)",
                "to 1.1.1.1 port 443 user { 0, 501 } keep state (if-bound)",
            ]
            let cloudForbidden = [
                "pass in quick on en",
                "proto udp",
                // A session that did not ask for it must not inherit the permit.
                "port { 80, 443, 8000, 8080 }",
            ]
            let cloudShapesHold = cloudRequired.allSatisfy(cloudRules.contains)
                && !cloudForbidden.contains(where: cloudRules.contains)
            let noStrayPermits = !rules.contains("to any port 443")
                && !inactiveRules.contains("to 1.1.1.1 port 443")
                && !inactiveHosts.contains("api.example.com")
            // Each comparison bound separately: the dictionary/array element
            // types make a single chain expensive for the type checker.
            let inactivePinsMatch: Bool = inactiveState.pinnedHosts == state.pinnedHosts
            let emergencyPinsMatch: Bool = emergencyState.pinnedHosts == state.pinnedHosts
            let derpCacheMatch: Bool =
                emergencyState.cachedDERPEndpoints == state.cachedDERPEndpoints
            let emergencySessionCleared: Bool =
                emergencyState.sessionDirectEndpoints.isEmpty
            let sessionNotPersisted: Bool = persisted["sessionDirectEndpoints"] == nil
            let statesAgree = inactivePinsMatch && emergencyPinsMatch
                && derpCacheMatch && emergencySessionCleared && sessionNotPersisted
            let cacheOnlyMatch: Bool = cacheOnlyResolved["api.example.com"] == ["1.1.1.1"]
            let bootstrapMatch: Bool = bootstrapPins["api.example.com"] == ["1.1.1.1"]
            let pinsAgree = cacheOnlyMatch && bootstrapMatch && rejectedUnrequestedPin
            let hostsAgree = hosts.contains("1.1.1.1 api.example.com")
                && !hosts.contains("localhost")
                && installedHosts.contains(killSwitchHostsEndMarker)
                && removedHosts.isEmpty
            // Reported, not silently folded in: a skip must not read as a pass.
            let armedParse = pfSyntaxAccepts(rules)
            let bootstrapParse = pfSyntaxAccepts(cloudRules)
            let pfParses: Bool
            switch (armedParse, bootstrapParse) {
            case (nil, _), (_, nil):
                let warning = "warn: PF syntax check skipped (needs root); "
                    + "run `sudo tono-core-helper --self-test` to include it\n"
                FileHandle.standardError.write(Data(warning.utf8))
                pfParses = true
            case let (armed?, bootstrap?):
                pfParses = armed && bootstrap
            }
            return ruleShapesHold
                && emergencyRules == emergencyExpected
                && cloudShapesHold
                && pfParses
                && noStrayPermits
                && statesAgree
                && pinsAgree
                && hostsAgree
                && rejectedPrivateTarget
                && rejectedUDPProxyTarget
        } catch {
            return false
        }
    }

    static func runNetworkSelfTest() -> Bool {
        guard let endpoints = try? fetchDERPEndpoints() else { return false }
        return endpoints.count >= 2 &&
            endpoints.contains(where: { $0.transport == "tcp" && $0.port == 443 }) &&
            endpoints.contains(where: { $0.transport == "udp" && $0.port == 3478 })
    }
}

private extension String {
    func prefixString(_ maximum: Int) -> String {
        String(prefix(maximum))
    }

    func trimmingLeadingNewlines() -> String {
        var value = self
        while value.hasPrefix("\n") || value.hasPrefix("\r") {
            value.removeFirst()
        }
        return value
    }

    func index(afterLineContaining range: Range<String.Index>) -> String.Index {
        guard let newline = self[range.upperBound...].firstIndex(of: "\n") else {
            return endIndex
        }
        return index(after: newline)
    }
}
