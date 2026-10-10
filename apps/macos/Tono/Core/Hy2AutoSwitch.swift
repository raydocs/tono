import CryptoKit
import Foundation

/// A17 (D1-C): the client's own move from a managed node's Reality block to
/// the ` · hy2` block of the SAME node, and back.
///
/// Only the selection a connect attempt dials changes, in memory, the way a
/// manual hy2 pick does. PF endpoints come from that selected node, so an
/// automatic hy2 attempt gets exactly the permit a manual hy2 attempt gets;
/// this type adds none and never touches PF, DNS or the helper.
///
/// Rules (decision 081):
/// - Permitted only by `hy2AutoSwitch: true` on a fresh `GET exit-catalog` 200
///   for the bound account in this launch. Missing, false, a rejected
///   catalog, another account, or no 200 yet: TCP only, and the remembered
///   choice and counters are cleared (no 200 yet clears nothing, it only
///   withholds use).
/// - After `tcpFailureThreshold` consecutive `CORE_EXIT_UNREACHABLE` connect
///   failures on a Reality block, the next attempt dials its hy2 twin. Other
///   failure classes (DNS, helper, TUN) neither count nor reset.
/// - The twin must be the same node and the same Tono identity: name is the
///   base name plus ` · hy2`, `type: hysteria2`, its password equals the
///   Reality block's UUID, the bundled core can authenticate its pin, and its
///   UDP is not known vendor-blocked. Otherwise nothing switches.
/// - An automatic hy2 attempt that reaches Connected (the same readiness
///   checks as any attempt) is remembered for that node for `rememberFor`;
///   later connects dial hy2 until it expires (a remembered success does not
///   extend it), then Reality is tried again.
/// - Starting an automatic hy2 attempt consumes the node's strikes and memory
///   and blocks another automatic hy2 attempt on that node for
///   `retryAfterHy2Failure`; only reaching Connected gives the memory back.
///   So a failed, stalled or cancelled hy2 attempt cannot repeat: at most one
///   automatic hy2 attempt per node per window, after fresh strikes. The
///   existing reconnect loops supply the backoff between attempts.
/// - A manual pick (any block of the node) wipes that node's state. Manual hy2
///   is never rewritten: only a Reality selection is ever swapped.
final class Hy2AutoSwitch {
    static let tcpFailureThreshold = 3
    static let rememberFor: TimeInterval = 24 * 60 * 60
    static let retryAfterHy2Failure: TimeInterval = 30 * 60
    static let storageKey = "hy2AutoSwitch.remembered.v1"
    static let hy2Suffix = " · hy2"
    private static let maximumRemembered = 64

    /// One connect attempt's swap: the user's Reality block and the hy2 twin
    /// actually dialed.
    struct Dial: Equatable {
        let tcp: String
        let hy2: String
        /// The memory this attempt consumed; nil when strikes chose hy2.
        let rememberedUntil: Date?

        var remembered: Bool { rememberedUntil != nil }
    }

    private struct Stored: Codable {
        var owner: String
        var until: [String: Date]
    }

    private let defaults: UserDefaults
    /// SHA-256 of the account the permission and memory belong to.
    private var ownerKey: String?
    /// Set only by a 200 accepted in this launch.
    private(set) var permitted = false
    private var tcpFailures: [String: Int] = [:]
    private var hy2NotBefore: [String: Date] = [:]
    private var remembered: [String: Date] = [:]
    /// The swap of the attempt in flight (or the last one), until the next
    /// attempt or a manual pick replaces it. Kept across a permission change:
    /// it is what puts the user's Reality block back and keeps an automatic
    /// hy2 name out of the saved selection.
    private(set) var activeDial: Dial?

    init(defaults: UserDefaults = AppProfile.defaults) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.storageKey), data.count <= 32_768,
           let stored = try? JSONDecoder().decode(Stored.self, from: data),
           stored.owner.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
           stored.until.count <= Self.maximumRemembered,
           stored.until.keys.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 400 }) {
            ownerKey = stored.owner
            remembered = stored.until
        }
    }

    static func ownerKey(_ owner: String) -> String {
        SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func isHy2(_ name: String) -> Bool { name.hasSuffix(hy2Suffix) }

    static func base(_ name: String) -> String {
        isHy2(name) ? String(name.dropLast(hy2Suffix.count)) : name
    }

    // MARK: Permission (every exit-catalog 200)

    /// `permitted` is the response's `hy2AutoSwitch`; `catalog` the managed
    /// nodes installed after it. False clears everything this account holds.
    func applyCatalogPermission(_ permitted: Bool, owner: String, catalog: [ProxyNode]) {
        let key = Self.ownerKey(owner)
        if ownerKey != key {
            ownerKey = key
            clearCounters()
            remembered = [:]
        }
        self.permitted = permitted
        if !permitted {
            clearCounters()
            remembered = [:]
        } else {
            let names = Set(catalog.map(\.name))
            remembered = remembered.filter { names.contains($0.key + Self.hy2Suffix) }
            tcpFailures = tcpFailures.filter { names.contains($0.key + Self.hy2Suffix) }
        }
        save()
    }

    /// A refused catalog: no automatic hy2 until the next accepted 200 says
    /// so. Another account is already excluded by the owner key.
    func revoke() {
        permitted = false
        clearCounters()
        remembered = [:]
        save()
    }

    // MARK: Connect attempts

    /// The automatic swap's in-memory selection to undo before a new attempt
    /// is judged: the Reality block, when `current` is still the hy2 twin the
    /// last attempt dialed on its own.
    func selectionToRestore(current: String?) -> String? {
        guard let dial = activeDial, current == dial.hy2 else { return nil }
        return dial.tcp
    }

    /// Decides this attempt's dial and records it as `activeDial`. Nil keeps
    /// the selected block.
    func beginAttempt(
        selected: ProxyNode?,
        catalog: [ProxyNode],
        owner: String?,
        now: Date
    ) -> Dial? {
        activeDial = nil
        guard permitted, let owner, Self.ownerKey(owner) == ownerKey,
              let selected, selected.type == .vless, !Self.isHy2(selected.name),
              let uuid = selected.uuid, !uuid.isEmpty,
              catalog.contains(where: { $0.name == selected.name }) else { return nil }
        let base = selected.name
        guard let twin = catalog.first(where: { $0.name == base + Self.hy2Suffix }),
              twin.type == .hysteria2, twin.password == uuid,
              ConfigPipeline.singBoxUnavailableReason(twin) == nil,
              !ProxyNode.hy2UdpIsVendorBlocked(twin.name) else { return nil }
        let rememberedUntil = remembered[base].flatMap {
            $0 > now && $0.timeIntervalSince(now) <= Self.rememberFor ? $0 : nil
        }
        let failuresDue = (tcpFailures[base] ?? 0) >= Self.tcpFailureThreshold
            && (hy2NotBefore[base].map { $0 <= now } ?? true)
        guard rememberedUntil != nil || failuresDue else { return nil }
        // Consumed now, given back only by Connected: an attempt that never
        // reports (watchdog, cancel) counts as a failed one.
        tcpFailures[base] = 0
        hy2NotBefore[base] = now.addingTimeInterval(Self.retryAfterHy2Failure)
        remembered[base] = nil
        save()
        let dial = Dial(tcp: base, hy2: twin.name, rememberedUntil: rememberedUntil)
        activeDial = dial
        return dial
    }

    /// The swap could not be applied; the attempt dials the selected block.
    /// The memory it consumed is given back; the strikes are not.
    func abandonAttempt() {
        if let dial = activeDial {
            remembered[dial.tcp] = dial.rememberedUntil
            hy2NotBefore[dial.tcp] = nil
            save()
        }
        activeDial = nil
    }

    /// A connect attempt that dialed `dialed` failed with `code`. Returns the
    /// Reality block to put back when the failed attempt was an automatic hy2.
    @discardableResult
    func noteConnectFailure(dialed: String, code: ProtectedFailureCode?, now: Date) -> String? {
        if let dial = activeDial, dial.hy2 == dialed {
            remembered[dial.tcp] = nil
            tcpFailures[dial.tcp] = 0
            hy2NotBefore[dial.tcp] = now.addingTimeInterval(Self.retryAfterHy2Failure)
            save()
            return dial.tcp
        }
        guard permitted, !Self.isHy2(dialed), code == .coreExitUnreachable else { return nil }
        tcpFailures[dialed, default: 0] += 1
        return nil
    }

    /// A connect attempt that dialed `dialed` reached Connected.
    func noteConnected(dialed: String, now: Date) {
        if let dial = activeDial, dial.hy2 == dialed {
            tcpFailures[dial.tcp] = 0
            hy2NotBefore[dial.tcp] = nil
            if permitted {
                remembered[dial.tcp] = dial.rememberedUntil ?? now.addingTimeInterval(Self.rememberFor)
                if remembered.count > Self.maximumRemembered {
                    remembered = Dictionary(uniqueKeysWithValues: remembered
                        .sorted { $0.value > $1.value }
                        .prefix(Self.maximumRemembered)
                        .map { ($0.key, $0.value) })
                }
            }
            save()
            return
        }
        guard !Self.isHy2(dialed) else { return }
        tcpFailures[dialed] = nil
        hy2NotBefore[dialed] = nil
        if remembered.removeValue(forKey: dialed) != nil { save() }
    }

    /// The user (or a catalog survivor) picked `name` on purpose: that node
    /// starts over, and a manual pick of the hy2 block just dialed on its own
    /// is saved as hy2. A pick elsewhere keeps `activeDial`, so a switch that
    /// rolls back onto the automatic hy2 dial is still undone later.
    func noteManualSelection(_ name: String) {
        if activeDial?.hy2 == name { activeDial = nil }
        let base = Self.base(name)
        tcpFailures[base] = nil
        hy2NotBefore[base] = nil
        if remembered.removeValue(forKey: base) != nil { save() }
    }

    /// The name to save as the user's selection. An automatic hy2 dial is a
    /// detour of the user's Reality choice, never a new preference.
    func persistedTarget(for target: String) -> String {
        guard let dial = activeDial, target == dial.hy2 else { return target }
        return dial.tcp
    }

    func consecutiveTcpFailures(_ name: String) -> Int { tcpFailures[name] ?? 0 }
    func rememberedUntil(_ name: String) -> Date? { remembered[name] }

    private func clearCounters() {
        tcpFailures = [:]
        hy2NotBefore = [:]
    }

    private func save() {
        guard let ownerKey, !remembered.isEmpty,
              let data = try? JSONEncoder().encode(Stored(owner: ownerKey, until: remembered)) else {
            defaults.removeObject(forKey: Self.storageKey)
            return
        }
        defaults.set(data, forKey: Self.storageKey)
    }
}
