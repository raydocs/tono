import Foundation
import Darwin

let killSwitchStatePath = "/Library/Application Support/Tono/killswitch.state"
let killSwitchPFPath = "/Library/Application Support/Tono/pf.tono.conf"
let killSwitchMainPFPath = "/etc/pf.conf"
let killSwitchMainBackupPath = "/etc/pf.conf.tono-backup"
let killSwitchHostsPath = "/etc/hosts"
let killSwitchHostsBackupPath = "/etc/hosts.tono-backup"
let killSwitchAnchor = "tono.killswitch"
let killSwitchBeginMarker = "# BEGIN TONO KILL SWITCH"
let killSwitchEndMarker = "# END TONO KILL SWITCH"
let killSwitchHostsBeginMarker = "# BEGIN TONO KILL SWITCH HOSTS"
let killSwitchHostsEndMarker = "# END TONO KILL SWITCH HOSTS"
let killSwitchMaximumStateBytes = 64 * 1024
let killSwitchMaximumDERPMapBytes = 1024 * 1024
let killSwitchDERPMapURL = "https://login.tailscale.com/derpmap/default"

/// Ports the reviewed bundle's direct traffic uses. Observed: 80, 443 and 8080
/// for TCP, 443 and 8000 for its media path. Kept as a fixed list so a wider
/// permit cannot be introduced by data.
let reviewedBundleDirectPorts = [80, 443, 8000, 8080]

struct KillSwitchEndpoint: Hashable {
    let address: String
    let transport: String
    let port: UInt16

    var json: [String: Any] {
        ["address": address, "transport": transport, "port": Int(port)]
    }
}

struct KillSwitchProxyTarget: Hashable {
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

struct KillSwitchState {
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

struct HelperCommandResult {
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
    static let maximumPinnedAddressesPerHost = 32
    static let defaultHosts = [
        "console.tailscale.com",
        "controlplane.tailscale.com",
        "log.tailscale.com",
        "login.tailscale.com",
    ]

    let allowedUID: uid_t
    let lock = NSLock()
    var stateGeneration: UInt64 = 0
    /// Pass rules most recently loaded into the kernel by this process. A
    /// re-arm whose rule set keeps every previously granted permission may
    /// skip the machine-wide state flush that would otherwise sever every
    /// established flow on the host. nil always forces the safe full flush.
    var lastLoadedPassRules: Set<String>?

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
        // Two different failures shared one message, and that message named a
        // cause neither of them has. A customer's log carried 21 of these in
        // five hours — 46 user-visible errors — while only three wake events
        // occurred, so nearly all of them were the generation check rather than
        // the sleep gate, and the text sent everyone looking at their Wi-Fi.
        // Naming which condition failed is what lets the next log distinguish
        // "a concurrent helper operation superseded this arm" from "the machine
        // went to sleep mid-arm"; the two have completely different fixes.
        if stateGeneration != startingGeneration {
            // Coded, because the caller's correct response is to retry rather
            // than to tell the user anything: the state that superseded this one
            // is itself a protection change, so the machine is not less
            // protected — this attempt simply lost a race with it.
            throw HelperFailure.coded(
                code: "KILLSWITCH_ARM_SUPERSEDED",
                message: "Kill Switch preparation was superseded by another protection change; "
                    + "protection remains fail-closed."
            )
        }
        guard commitAllowed() else {
            throw HelperFailure.invalid(
                "The machine began sleeping during Kill Switch preparation; "
                + "protection remains fail-closed."
            )
        }
        let renderedRules = try Self.writeRules(state: state, allowedUID: allowedUID)
        // Persist fail-closed intent before activating the new rules.
        try saveState(state)
        try Self.ensureHostsMappings(state: state)
        // A machine-wide state flush is a security requirement only when the
        // new rule set revokes a previously granted permission. Node switches
        // and config reloads re-arm with identical or wider rules; flushing
        // there severs every established flow on the host for no protection
        // gain. Any removed pass rule still forces the full flush.
        let passRules = Self.passRules(in: renderedRules)
        let disposal = Self.stateDisposal(replacing: lastLoadedPassRules, with: passRules)
        // The kernel takes the new ruleset part-way through the call below, ahead
        // of the PF enable, the state disposal, and the verification probes that
        // can each still throw. Recording nothing across it is what keeps a
        // partial commit honest: the baseline is left with no generation to diff
        // against, so the next arm takes the machine-wide flush instead of
        // measuring against a ruleset that was never fully live — which would
        // hide a withdrawn permit and leave its states passing.
        lastLoadedPassRules = nil
        try Self.ensureAnchorLoaded(disposal: disposal)
        lastLoadedPassRules = passRules
        stateGeneration &+= 1
        return response(
            armed: true,
            wanted: true,
            live: true,
            flushedStates: disposal == .full,
            killedHosts: {
                if case .targeted(let hosts) = disposal { return hosts.count }
                return 0
            }()
        )
    }

    static func passRules(in rules: String) -> Set<String> {
        Set(
            rules.split(separator: "\n")
                .map(String.init)
                .filter { $0.hasPrefix("pass ") }
        )
    }

    /// What a re-arm must do about states established under the generation it
    /// is replacing.
    ///
    /// A nil baseline cannot know what it is replacing, so it takes the
    /// machine-wide flush. That covers a first arm after daemon start and every
    /// mutator that opened egress or committed rules it could not finish
    /// recording — the conservative answer is the only one that can never
    /// under-kill.
    static func stateDisposal(
        replacing previous: Set<String>?,
        with passRules: Set<String>
    ) -> StateDisposal {
        guard let withdrawn = previous?.subtracting(passRules) else { return .full }
        guard !withdrawn.isEmpty else { return .keep }
        // Address-scoped withdrawals — a node switch moving the exit permit, a
        // refreshed control-plane pin — kill only those addresses' states.
        // Anything structural falls back to the flush. A customer's log showed
        // seventeen machine-wide flushes in sixty-three minutes, one every 3.7
        // minutes, mostly from node switches; each of those took every unrelated
        // connection on the host down with it.
        return withdrawnHosts(withdrawn).map { StateDisposal.targeted($0) } ?? .full
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

    func response(
        armed: Bool,
        wanted: Bool,
        live: Bool,
        healed: Bool = false,
        flushedStates: Bool = false,
        killedHosts: Int = 0
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
            // How many addresses had their states killed individually instead.
            // Distinguishes "withdrew a permit and dealt with it narrowly" from
            // "withdrew nothing" — both report flushedStates false, and only one
            // of them changed the ruleset.
            "killedHosts": killedHosts,
            "version": helperVersion,
        ]
    }

    func restoreAtLaunch() throws {
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

    static func installEmergencyBlock(allowedUID: uid_t) throws {
        let state = emergencyState(preserving: nil)
        try writeRules(state: state, allowedUID: allowedUID)
        try ensureAnchorLoaded(flushStates: true)
    }

    static func emergencyState(
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

    func loadState() throws -> KillSwitchState? {
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

    func saveState(_ state: KillSwitchState) throws {
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

    static func persistentObject(
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

    static func stateFileExists() -> Bool {
        var metadata = stat()
        return lstat(killSwitchStatePath, &metadata) == 0
    }

    static func removeStateIfPresent() throws {
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

    static func fetchDERPEndpoints() throws -> [KillSwitchEndpoint] {
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

    static func parseDERPMap(_ data: Data) throws -> [KillSwitchEndpoint] {
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

    static func port(
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

    static func validateEndpoints(
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

    static func loadProxyTargets(_ raw: Any) throws -> [KillSwitchProxyTarget] {
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
            guard transport == "tcp" || transport == "udp" else {
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

    static func resolveProxyTargets(
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
                  transport == "tcp" || transport == "udp" else {
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

    static func validateSessionDirectEndpoints(_ raw: Any) throws -> [KillSwitchEndpoint] {
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

    static func resolveHosts(
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

    static func validateBootstrapPins(
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

    static func resolveHost(_ host: String, port: UInt16) throws -> [String] {
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

    static func parseSystemLookupAddresses(_ data: Data) throws -> [String] {
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

    static func normalizeHost(_ raw: String) throws -> String {
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

    static func validateAddresses(_ raw: Any) throws -> [String] {
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

    static func canonicalIPAddress(_ raw: String) -> String? {
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

    static func canonicalPublicAddress(_ raw: String) -> String? {
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

    static func isLoopbackAddress(_ raw: String) -> Bool {
        if raw == "::1" { return true }
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, raw, &ipv4) == 1 else { return false }
        return withUnsafeBytes(of: &ipv4) { $0.first == 127 }
    }

    static func list(
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

    static func boolean(_ raw: Any, field: String) throws -> Bool {
        guard let value = raw as? Bool else {
            throw HelperFailure.invalid("\(field) must be a boolean.")
        }
        return value
    }

    static func validateExitHints(_ raw: Any) throws -> [String] {
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

    static func validateTunnels(
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

    static func renderHostsMappings(state: KillSwitchState) -> String {
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

    static func ensureHostsMappings(state: KillSwitchState) throws {
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

    static func removeHostsMappings() throws {
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

    static func replacingManagedHosts(
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
}

extension String {
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
