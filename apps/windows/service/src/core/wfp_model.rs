//! Platform-independent WFP rule model for the Tono kill switch.
//!
//! Everything here is a pure function of the desired protection state: [`expected_filters`]
//! renders the exact filter set the Windows engine (`wfp.rs`) must install, and [`diff`] turns
//! the live set into an ordered change plan. Keeping this module free of `windows-sys` is what
//! makes the rule tables from `docs/wfp-kill-switch.md` unit-testable on any host.
//!
//! Arbitration note: WFP arbitrates **sublayer-by-sublayer, highest sublayer weight first**;
//! within a sublayer, filters are ordered by descending filter weight and the first match with
//! a terminating action (permit/block) ends arbitration
//! (<https://learn.microsoft.com/en-us/windows/win32/fwp/filter-arbitration>). That is why every
//! rule lives in a *single* sublayer (Mullvad-style): "weighted permits over a low block-all"
//! only holds when filter weight is the sole ordering axis. A second, higher-weight sublayer
//! carrying a match-all block would decide every packet before any permit here is consulted.
//! Persistence is still reserved for the condition-free block-all filters, which are what
//! survive a reboot; everything else is rebuilt on service start. Enforcement stays entirely at
//! ALE authorization layers so identity (`ALE_APP_ID`) and endpoint tuple are evaluated in the
//! same filter. Adding or removing an ALE filter triggers policy-change reauthorization on the
//! affected flow's next packet, which blocks stale TCP/UDP (including QUIC) flows without an
//! identity-free packet-layer permit
//! (<https://learn.microsoft.com/en-us/windows/win32/fwp/ale-re-authorization>).

use crate::core::structure::{KillSwitchStatusMode, ProxyEndpoint, ProxyProtocol};
use std::net::IpAddr;

/// A WFP object key. `wfp.rs` converts this into `windows_sys::core::GUID`; having our own
/// type is what lets this module compile off-Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Guid(u128);

impl Guid {
    pub const fn from_u128(value: u128) -> Self {
        Self(value)
    }

    /// Used by the Windows engine (`wfp.rs`) to render `windows_sys::core::GUID`s.
    #[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
    pub const fn into_u128(self) -> u128 {
        self.0
    }
}

// Fixed object GUIDs, generated once for Tono and never reused by anything else. Every WFP
// object the service creates carries `TONO_WFP_PROVIDER_KEY` as its provider key, so
// enumeration, verification, and emergency deletion are all scoped by it.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub const TONO_WFP_PROVIDER_KEY: Guid = Guid::from_u128(0x2f7c9d41_8b3e_4a6c_9d52_1e7f0a4b6c8d);
/// The single `tono-kill-switch` sublayer every rule lives in (see the arbitration note in the
/// module docs). Persistent, so its fail-closed block-all filters survive reboot.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub const TONO_WFP_SUBLAYER_KEY: Guid = Guid::from_u128(0x2f7c9d42_8b3e_4a6c_9d52_1e7f0a4b6c8d);

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub const TONO_WFP_SUBLAYER_WEIGHT: u16 = 1000;

/// Hard permits: floor loopback, mihomo endpoint, tunnel interface.
pub const WEIGHT_HARD_PERMIT: u64 = 8;
/// Infrastructure permits: floor DHCP/NDP, bootstrap API channel.
pub const WEIGHT_INFRA_PERMIT: u64 = 7;
/// All block-alls: the intent floor's persistent set and the session's redundant set.
pub const WEIGHT_BLOCK_ALL: u64 = 1;

/// Resolved API host IPs are a bounded, public-only set before they ever reach WFP.
pub const MAX_API_HOST_IPS: usize = 8;

/// Filter keys are deterministic so verify-by-key works across restarts: a fixed 64-bit Tono
/// namespace over a 64-bit FNV-1a hash of the rule's identity tag.
///
/// **Bump this namespace on every rule-table change.** A rule whose conditions changed keeps
/// its tag — and therefore its key — so without a bump, the key-only diff would adopt an
/// older build's stale filter instead of replacing it. Bumping remaps every key, so the
/// upgrade path cleanly removes the entire old set and installs the new one.
/// (v1: `…9e00…` dual-sublayer; v2: `…9e01…` single-sublayer; v3: `…9e02…`
/// port-scoped DHCP with no global NTP bypass; v4: `…9e03…` ALE-only loopback matching;
/// v5: `…9e04…` hard address-or-ALE loopback permits; v6: `…9e05…` no redundant
/// port-53 block over the default-deny floor; v7: `…9e06…` per-packet outbound-transport
/// enforcement; v8: `…9e07…` Mihomo-app-scoped ALE plus exact transport tuples for
/// lease-backed DIRECT; v9: `…9e08…` ALE-only stateful enforcement, keeping app identity and
/// tuple in one filter and relying on documented policy-change reauthorization for stale flows.)
const FILTER_NAMESPACE: u128 = 0x2f7c_9e08_0000_4a6c_0000_0000_0000_0000;

const fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut index = 0;
    while index < bytes.len() {
        hash ^= bytes[index] as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        index += 1;
    }
    hash
}

pub(crate) fn key_for(tag: &str) -> Guid {
    Guid::from_u128(FILTER_NAMESPACE | fnv1a64(tag.as_bytes()) as u128)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerKind {
    AleAuthConnectV4,
    AleAuthConnectV6,
    AleAuthRecvAcceptV6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterAction {
    Permit,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpProtocol {
    Tcp,
    Udp,
    IcmpV6,
}

impl IpProtocol {
    pub const fn number(self) -> u8 {
        match self {
            Self::Tcp => 6,
            Self::Udp => 17,
            Self::IcmpV6 => 58,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Condition {
    RemoteAddressV4 {
        addr: [u8; 4],
        prefix: u8,
    },
    RemoteAddressV6 {
        addr: [u8; 16],
        prefix: u8,
    },
    Protocol(IpProtocol),
    LocalPort(u16),
    RemotePort(u16),
    /// NDP types 133–137 as one inclusive range.
    IcmpV6TypeRange {
        min: u16,
        max: u16,
    },
    /// Loopback as classified by ALE. At `ALE_AUTH_CONNECT`, Windows exposes loopback through
    /// `FWPM_CONDITION_FLAGS` (`IS_APPCONTAINER_LOOPBACK` or
    /// `IS_NON_APPCONTAINER_LOOPBACK`). Matching only `IP_REMOTE_ADDRESS = 127/8` is not
    /// equivalent on the real layer, so the rule table retains independent address and ALE
    /// permits rather than assuming either representation is universal.
    AleLoopback,
    /// `FwpmGetAppIdFromFileName` blob of the staged core binary; resolved by the engine.
    AleAppId,
    /// WinTUN adapter LUID, matched at ALE authorization.
    LocalInterface(u64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterSpec {
    pub key: Guid,
    pub name: String,
    pub layer: LayerKind,
    pub weight: u64,
    pub action: FilterAction,
    pub conditions: Vec<Condition>,
    /// Render this permit with `FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT`. Loopback infrastructure
    /// needs a hard permit so a later filtering provider cannot veto local control traffic;
    /// Internet endpoint and tunnel permits intentionally remain soft.
    pub hard_permit: bool,
    /// Only the intent floor's condition-free block-all set is persistent — Proton's rule
    /// that persistence is reserved for condition-free blocking.
    pub persistent: bool,
}

/// The protection state the rule set is a function of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleConfig {
    pub mode: KillSwitchStatusMode,
    /// Selected node endpoints the staged core may reach directly (usually exactly one).
    pub endpoints: Vec<ProxyEndpoint>,
    /// Resolved, validated, public-only API host IPs for the bootstrap channel.
    pub api_host_ips: Vec<IpAddr>,
    /// WinTUN LUID; only consulted in `Locked` mode.
    pub tun_luid: Option<u64>,
    /// Staged core path, folded into the endpoint permit's key: an installer that moves the
    /// binary must rekey the permit (Proton's upgrade lesson — app-path filters silently die
    /// when the exe moves), which the add-before-remove plan then swaps atomically.
    pub app_path: String,
    /// Cloud-approved DIRECT endpoints (WeChat acceleration): exact `IP:port` tuples the staged
    /// core may reach on the physical NIC. Rendered **only in `Locked`** (see rule G);
    /// never persisted, never restored, never inherited by the next arm — omission = clear.
    pub direct_endpoints: Vec<ProxyEndpoint>,
    /// Ports the App declared it routes process-scoped DIRECT traffic on, already filtered to
    /// `REVIEWED_DIRECT_PORTS` by the Service. Rule H renders exactly these and nothing when
    /// empty, so the permit surface and the routing surface are the same set by construction
    /// rather than by inference from whatever pins happen to exist.
    pub reviewed_direct_ports: Vec<u16>,
}

/// One row of the rule tables: every field of a `FilterSpec` except the derived key/name.
fn spec(
    tag: String,
    name: &str,
    layer: LayerKind,
    weight: u64,
    action: FilterAction,
    conditions: Vec<Condition>,
    persistent: bool,
) -> FilterSpec {
    FilterSpec {
        key: key_for(&tag),
        name: format!("Tono {name}"),
        layer,
        weight,
        action,
        conditions,
        hard_permit: false,
        persistent,
    }
}

fn hard_permit(mut filter: FilterSpec) -> FilterSpec {
    debug_assert_eq!(filter.action, FilterAction::Permit);
    filter.hard_permit = true;
    filter
}

/// The persistent fail-closed floor: address-or-ALE loopback, DHCP, and NDP permits over
/// persistent ALE block-alls. The independent loopback paths are deliberate: real Windows has
/// exposed controller connections through address matching and DNS through ALE classification.
pub fn intent_floor() -> Vec<FilterSpec> {
    use Condition as C;
    use FilterAction as A;
    use LayerKind as L;
    vec![
        hard_permit(spec(
            "intent/permit-loopback-address-v4".into(),
            "intent permit loopback address v4",
            L::AleAuthConnectV4,
            WEIGHT_HARD_PERMIT,
            A::Permit,
            vec![C::RemoteAddressV4 {
                addr: [127, 0, 0, 0],
                prefix: 8,
            }],
            false,
        )),
        hard_permit(spec(
            "intent/permit-loopback-address-v6".into(),
            "intent permit loopback address v6",
            L::AleAuthConnectV6,
            WEIGHT_HARD_PERMIT,
            A::Permit,
            vec![C::RemoteAddressV6 {
                addr: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                prefix: 128,
            }],
            false,
        )),
        hard_permit(spec(
            "intent/permit-loopback-ale-v4".into(),
            "intent permit loopback ALE v4",
            L::AleAuthConnectV4,
            WEIGHT_HARD_PERMIT,
            A::Permit,
            vec![C::AleLoopback],
            false,
        )),
        hard_permit(spec(
            "intent/permit-loopback-ale-v6".into(),
            "intent permit loopback ALE v6",
            L::AleAuthConnectV6,
            WEIGHT_HARD_PERMIT,
            A::Permit,
            vec![C::AleLoopback],
            false,
        )),
        spec(
            "intent/permit-dhcp-v4".into(),
            "intent permit DHCP v4",
            L::AleAuthConnectV4,
            WEIGHT_INFRA_PERMIT,
            A::Permit,
            vec![
                C::Protocol(IpProtocol::Udp),
                C::LocalPort(68),
                C::RemotePort(67),
            ],
            false,
        ),
        spec(
            "intent/permit-dhcp-v6".into(),
            "intent permit DHCPv6 client to server",
            L::AleAuthConnectV6,
            WEIGHT_INFRA_PERMIT,
            A::Permit,
            vec![
                C::Protocol(IpProtocol::Udp),
                C::LocalPort(546),
                C::RemotePort(547),
            ],
            false,
        ),
        spec(
            "intent/permit-ndp-out".into(),
            "intent permit NDP outbound",
            L::AleAuthConnectV6,
            WEIGHT_INFRA_PERMIT,
            A::Permit,
            vec![
                C::Protocol(IpProtocol::IcmpV6),
                C::IcmpV6TypeRange { min: 133, max: 137 },
            ],
            false,
        ),
        spec(
            "intent/permit-ndp-in".into(),
            "intent permit NDP inbound",
            L::AleAuthRecvAcceptV6,
            WEIGHT_INFRA_PERMIT,
            A::Permit,
            vec![
                C::Protocol(IpProtocol::IcmpV6),
                C::IcmpV6TypeRange { min: 133, max: 137 },
            ],
            false,
        ),
        spec(
            "intent/block-all-v4".into(),
            "intent block all v4",
            L::AleAuthConnectV4,
            WEIGHT_BLOCK_ALL,
            A::Block,
            vec![],
            true,
        ),
        spec(
            "intent/block-all-v6".into(),
            "intent block all v6",
            L::AleAuthConnectV6,
            WEIGHT_BLOCK_ALL,
            A::Block,
            vec![],
            true,
        ),
    ]
}

/// Parse and classify an endpoint for rule rendering. Invalid *or non-public* IPs render no
/// permit — the facade validates before arming, and a skipped permit fails closed, never open.
/// The public-IP table is shared with the API-host check (`is_public_api_ip`) so an endpoint
/// can never quietly point at loopback/LAN/link-local space either.
pub fn parse_endpoint(endpoint: &ProxyEndpoint) -> Option<(IpAddr, u16, IpProtocol)> {
    let ip: IpAddr = endpoint.ip.trim().parse().ok()?;
    if endpoint.port == 0 || !is_public_unreserved(&ip) {
        return None;
    }
    let protocol = match endpoint.protocol {
        ProxyProtocol::Tcp => IpProtocol::Tcp,
        ProxyProtocol::Udp => IpProtocol::Udp,
    };
    Some((ip, endpoint.port, protocol))
}

fn remote_address_condition(ip: IpAddr) -> Condition {
    match ip {
        IpAddr::V4(addr) => Condition::RemoteAddressV4 {
            addr: addr.octets(),
            prefix: 32,
        },
        IpAddr::V6(addr) => Condition::RemoteAddressV6 {
            addr: addr.octets(),
            prefix: 128,
        },
    }
}

fn ale_layer_for(ip: IpAddr) -> LayerKind {
    match ip {
        IpAddr::V4(_) => LayerKind::AleAuthConnectV4,
        IpAddr::V6(_) => LayerKind::AleAuthConnectV6,
    }
}

/// The volatile session set, rebuilt per connect and per service start.

/// IPv4 ranges the reviewed-port permit must never cover.
///
/// Mirrors `windows_kill_switch::is_public_direct_ipv4`, which every cloud-supplied address is
/// already filtered through. Rule H takes no address from the policy, so without this it would
/// be the one permit in this file with no public-unicast bound — and the traffic it exists for
/// is WeChat's plaintext HTTPDNS, where the address comes from whatever answered the lookup. A
/// hostile network answering `192.168.1.1` would have the integrity-pinned core dial the user's
/// own LAN, from inside a kill switch the user believes is closed.
const RESERVED_V4: [([u8; 4], u8); 14] = [
    ([0, 0, 0, 0], 8),
    ([10, 0, 0, 0], 8),
    ([100, 64, 0, 0], 10),
    ([127, 0, 0, 0], 8),
    ([169, 254, 0, 0], 16),
    ([172, 16, 0, 0], 12),
    ([192, 0, 0, 0], 24),
    ([192, 0, 2, 0], 24),
    ([192, 88, 99, 0], 24),
    ([192, 168, 0, 0], 16),
    ([198, 18, 0, 0], 15),
    ([198, 51, 100, 0], 24),
    ([203, 0, 113, 0], 24),
    ([224, 0, 0, 0], 3),
];

/// The complement of [`RESERVED_V4`], as prefixes.
///
/// Computed rather than written out, so the permit and the predicate it mirrors cannot drift:
/// editing the table moves both. WFP ORs conditions that share a field key, so these go on one
/// filter and mean "remote address is public unicast".
pub(crate) fn public_unicast_v4_prefixes() -> Vec<([u8; 4], u8)> {
    let mut blocked: Vec<(u32, u32)> = RESERVED_V4
        .iter()
        .map(|(addr, prefix)| {
            let base = u32::from_be_bytes(*addr);
            let size = if *prefix == 0 { u32::MAX } else { (1u32 << (32 - prefix)) - 1 };
            (base, base.saturating_add(size))
        })
        .collect();
    blocked.sort_unstable();

    let mut allowed: Vec<([u8; 4], u8)> = Vec::new();
    let mut cursor: u64 = 0;
    for (start, end) in blocked {
        if u64::from(start) > cursor {
            emit_prefixes(cursor as u32, (start - 1), &mut allowed);
        }
        cursor = cursor.max(u64::from(end) + 1);
    }
    if cursor <= u64::from(u32::MAX) {
        emit_prefixes(cursor as u32, u32::MAX, &mut allowed);
    }
    allowed
}

/// Split an inclusive address range into the fewest CIDR blocks that cover it exactly.
fn emit_prefixes(mut start: u32, end: u32, out: &mut Vec<([u8; 4], u8)>) {
    loop {
        // The largest block that starts here and does not run past `end`.
        let max_by_alignment = if start == 0 { 32 } else { start.trailing_zeros() };
        let mut size = max_by_alignment.min(32);
        while size > 0 && (u64::from(start) + (1u64 << size) - 1) > u64::from(end) {
            size -= 1;
        }
        out.push((start.to_be_bytes(), (32 - size) as u8));
        let next = u64::from(start) + (1u64 << size);
        if next > u64::from(end) {
            return;
        }
        start = next as u32;
    }
}

pub fn session_rules(config: &RuleConfig) -> Vec<FilterSpec> {
    use Condition as C;
    use FilterAction as A;
    use LayerKind as L;

    let mut filters = Vec::new();

    // A: the Tono-specific narrowing — the staged core may reach exactly the selected endpoint,
    // nothing else on the Internet. Identity, address, protocol, and port stay together at ALE;
    // policy changes reauthorize existing flows on their next packet. Do not pair this with an
    // outbound-transport permit: that layer has no app-id condition, so even an exact destination
    // tuple would be a machine-wide capability.
    for endpoint in &config.endpoints {
        let Some((ip, port, protocol)) = parse_endpoint(endpoint) else {
            continue;
        };
        filters.push(spec(
            format!(
                "session/permit-endpoint/ale/{}/{ip}/{port}/{}",
                config.app_path,
                protocol.number()
            ),
            "session permit core endpoint ALE",
            ale_layer_for(ip),
            WEIGHT_HARD_PERMIT,
            A::Permit,
            vec![
                C::AleAppId,
                remote_address_condition(ip),
                C::Protocol(protocol),
                C::RemotePort(port),
            ],
            false,
        ));
    }

    // B: tunnel interface, locked phase only. Until the adapter exists and lock runs, tunnel
    // traffic is blocked too — fail-closed.
    if config.mode == KillSwitchStatusMode::Locked
        && let Some(luid) = config.tun_luid
    {
        for layer in [L::AleAuthConnectV4, L::AleAuthConnectV6] {
            filters.push(spec(
                format!("session/permit-tunnel/{layer:?}/{luid}"),
                "session permit tunnel interface",
                layer,
                WEIGHT_HARD_PERMIT,
                A::Permit,
                vec![C::LocalInterface(luid)],
                false,
            ));
        }
    }

    // C: the bounded bootstrap API channel. Open in bootstrap, retracted at lock, and open
    // again in blocked mode as the recovery channel.
    if config.mode != KillSwitchStatusMode::Locked {
        // One permit per pinned address per reachable port. The address set is what bounds
        // this channel; the port was never doing security work, and pinning it to 443 alone
        // meant the client could not use the alternate HTTPS ports the same Cloudflare zone
        // answers on — the one route around an SNI blocklist keyed on 443, and the difference
        // between a user stuck in Protected Offline being able to re-authenticate or not.
        for ip in &config.api_host_ips {
            for port in crate::CONTROL_PLANE_PORTS {
                filters.push(spec(
                    format!("session/permit-api/ale/{ip}/{port}"),
                    "session permit bootstrap API",
                    ale_layer_for(*ip),
                    WEIGHT_INFRA_PERMIT,
                    A::Permit,
                    vec![
                        remote_address_condition(*ip),
                        C::Protocol(IpProtocol::Tcp),
                        C::RemotePort(port),
                    ],
                    false,
                ));
            }
        }
    }

    // G: cloud-approved DIRECT endpoints (reviewed native-app acceleration). Mihomo owns the physical socket;
    // PROCESS-NAME/AND rules decide which captured original flow may select that outbound. The
    // physical exception therefore stays wholly at ALE, where the staged core app id and exact
    // tuple can be enforced together. Policy-change reauthorization prevents a pre-existing flow
    // owned by another process from inheriting the exception on its next packet.
    //
    // Locked with a currently renderable tunnel only. A DIRECT plan exists to let specific traffic bypass the tunnel *while
    // connected*; in Bootstrap and in Blocked ("Protected Offline") there is no tunnel to
    // bypass and the user is told nothing gets out. Leaving them up in those modes would retain
    // an unnecessary physical escape path for the core. The facade keeps the approved set in the armed session's memory
    // across a mode change, so re-locking re-renders it; the omission=clear contract still
    // decides when the set is empty. Retracting them is a mode change like any other: the
    // key-only diff removes exactly these keys, so nothing stale is left installed.
    if config.mode == KillSwitchStatusMode::Locked && config.tun_luid.is_some() {
        for endpoint in &config.direct_endpoints {
            let Some((ip, port, protocol)) = parse_endpoint(endpoint) else {
                continue;
            };
            filters.push(spec(
                format!(
                    "session/permit-direct/ale/{}/{ip}/{port}/{}",
                    config.app_path,
                    protocol.number()
                ),
                "session permit approved DIRECT ALE",
                ale_layer_for(ip),
                WEIGHT_HARD_PERMIT,
                A::Permit,
                vec![
                    C::AleAppId,
                    remote_address_condition(ip),
                    C::Protocol(protocol),
                    C::RemotePort(port),
                ],
                false,
            ));
        }
    }

    // H: the reviewed native-app port permit. Same gate as G, and deliberately the only permit
    // in this file with no address condition.
    //
    // G permits exact `IP:port` tuples resolved from the cloud policy. That is a complete
    // description of where the policy's *domains* live and a useless one for where WeChat
    // actually dials: it resolves file and CDN endpoints through its own HTTPDNS and connects
    // to addresses no pin can know in advance. The routing rules send those flows out the
    // physical NIC; without this class the floor at E drops them, which is the hang users
    // report as WeChat images and file transfers never finishing.
    //
    // Measured on macOS, whose PF policy is this same shape: 21.2 MB of WeChat upload left
    // through the port permit against 95 KB through all 58 exact pins.
    //
    // What keeps it narrow:
    //   - `AleAppId` — only the staged core, whose bytes the integrity pin fixes. No other
    //     process on the machine can match this filter, so no application can use it directly.
    //     The only way a flow reaches it is if the core dials on that flow's behalf.
    //   - `REVIEWED_DIRECT_PORTS` — four ports, shared with the rules that decide what gets
    //     routed here, so the two surfaces cannot name different sets.
    //   - Only alongside a live DIRECT plan. No plan means no permit, which is exactly the
    //     behaviour before this class existed.
    //
    // What it does not stop, stated plainly: a routing mistake that sends some other flow to
    // the physical interface on one of these four ports. The control for that is the rule
    // layer — specifically the terminating `(NETWORK,UDP),REJECT`, which is what stops
    // mihomo's ruleless UDP fallback from dialling out when an exit cannot carry UDP. That
    // rule is asserted unshadowable in `tono_core::config`. Bounding this permit by
    // destination is the next step and needs address data this build does not have.
    // Conjunctive with the plan itself, deliberately.
    //
    // Gating on the declaration alone was a regression: `reviewed_direct_ports` is stored on
    // `Armed` and every retraction path clears `direct_endpoints` without touching it, so a
    // re-lock inside the reload bracket — which is the *normal* second and later activation,
    // begin -> stage -> lock -> replace — rendered these permits with zero approved endpoints
    // behind them. The App even proves an empty endpoint digest at that moment. Requiring both
    // makes "no plan means no permit" true by construction rather than by remembering to clear
    // a second field at every future retraction site.
    if config.mode == KillSwitchStatusMode::Locked
        && config.tun_luid.is_some()
        && !config.direct_endpoints.is_empty()
        && !config.reviewed_direct_ports.is_empty()
    {
        // IPv4 only, matching the Mac helper's `inet`-scoped permit and the runtime's own
        // `ipv6: false`. The TUN and fake-ip are IPv4, AAAA dials are dropped, so there is no
        // IPv6 DIRECT flow to carry — and a permit with no address condition on the V6 layer
        // would be a widening with nothing asking for it.
        // TCP only. The declaration is computed from `tcp_wechat_rules` and the signed path
        // regexes — TCP routing — so rendering a UDP permit from it claims a surface the App
        // never described. And nothing routes unpinned UDP to the physical interface anyway:
        // the only UDP rules targeting the direct outbound carry an `IP-CIDR` pin, and
        // everything else meets the terminating `(NETWORK,UDP),REJECT`. A UDP permit here
        // therefore admits traffic that cannot arrive — widening with no beneficiary, which is
        // the worst kind. WeChat voice and video keep working as they do today: pinned media
        // endpoints go direct under rule G, and the rest falls back to TCP.
        //
        // If process-scoped UDP routing is ever added, both halves land together and the
        // declaration grows to say so.
        for protocol in [IpProtocol::Tcp] {
            for port in config.reviewed_direct_ports.iter().copied() {
                filters.push(spec(
                    format!(
                        "session/permit-reviewed-direct/{}/{port}/{}",
                        config.app_path,
                        protocol.number()
                    ),
                    "session permit reviewed DIRECT ports",
                    L::AleAuthConnectV4,
                    WEIGHT_HARD_PERMIT,
                    A::Permit,
                    {
                        // AleAppId AND Protocol AND RemotePort AND (address in any public
                        // unicast prefix) — WFP ANDs distinct field keys and ORs repeats of
                        // the same one, so the prefixes below are a single "is public"
                        // condition rather than many separate permits.
                        let mut conditions =
                            vec![C::AleAppId, C::Protocol(protocol), C::RemotePort(port)];
                        conditions.extend(public_unicast_v4_prefixes().into_iter().map(
                            |(addr, prefix)| C::RemoteAddressV4 { addr, prefix },
                        ));
                        conditions
                    },
                    false,
                ));
            }
        }
    }

    // E: redundant block-all, always present while armed. This default-deny floor already blocks
    // physical DNS unless a more specific permit matches. Do not add a separate port-53 block:
    // Windows resolver traffic starts at 127.0.0.1 and can transition to the TUN address, and a
    // terminating block action overrides the legitimate loopback/TUN path on real machines.
    // Never persistent — persistence is
    // reserved for the condition-free floor set. Note non-persistent filters still outlive
    // the process in BFE's runtime store (until BFE restarts); only the PERSISTENT floor
    // survives a BFE restart or reboot, and service start reconciles the rest by key.
    for layer in [
        L::AleAuthConnectV4,
        L::AleAuthConnectV6,
    ] {
        filters.push(spec(
            format!("session/block-all/{layer:?}"),
            "session block all",
            layer,
            WEIGHT_BLOCK_ALL,
            A::Block,
            vec![],
            false,
        ));
    }

    filters
}

/// The complete expected filter set: the persistent intent floor plus the session set.
pub fn expected_filters(config: &RuleConfig) -> Vec<FilterSpec> {
    let mut filters = intent_floor();
    filters.extend(session_rules(config));
    filters
}

/// The shared reserved-range table: whether an IP is public unicast, usable for either a
/// bootstrap API host or a proxy endpoint. Documentation ranges (192.0.2.0/24 etc.) are
/// accepted — they are not local; the point is to keep these channels off
/// loopback/LAN/link-local/CGNAT space.
pub fn is_public_unreserved(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(addr) => {
            let octets = addr.octets();
            !addr.is_private()
                && !addr.is_loopback()
                && !addr.is_link_local()
                && !addr.is_multicast()
                && !addr.is_unspecified()
                && !addr.is_broadcast()
                // 100.64.0.0/10 carrier-grade NAT
                && !(octets[0] == 100 && (64..=127).contains(&octets[1]))
                // 198.18.0.0/15 benchmarking (RFC 2544)
                && !(octets[0] == 198 && (18..=19).contains(&octets[1]))
                // 192.88.99.0/24 6to4 relay anycast (RFC 7526, deprecated)
                && !(octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
                // 240.0.0.0/4 class E / reserved (broadcast already excluded above)
                && octets[0] < 240
        }
        IpAddr::V6(addr) => {
            !addr.is_loopback()
                && !addr.is_unspecified()
                && !addr.is_unique_local()
                && !addr.is_unicast_link_local()
                && !addr.is_multicast()
                // Reject v4-mapped forms; the contract is a native literal.
                && addr.to_ipv4_mapped().is_none()
        }
    }
}

/// Whether an IP may serve as a bootstrap API channel endpoint. Same table as endpoints.
pub fn is_public_api_ip(ip: &IpAddr) -> bool {
    is_public_unreserved(ip)
}

/// Bounded, deduplicated, public-only API host IP set, ready to be written into WFP.
pub fn sanitize_api_host_ips(ips: impl IntoIterator<Item = IpAddr>) -> Vec<IpAddr> {
    let mut accepted: Vec<IpAddr> = Vec::new();
    for ip in ips {
        if !is_public_api_ip(&ip) || accepted.contains(&ip) {
            continue;
        }
        accepted.push(ip);
        if accepted.len() >= MAX_API_HOST_IPS {
            break;
        }
    }
    accepted
}

/// What must change to move the live set (`current`, by key) to `desired`.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangePlan {
    pub install: Vec<FilterSpec>,
    pub remove: Vec<Guid>,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanStep {
    Install(FilterSpec),
    Remove(Guid),
}

impl ChangePlan {
    /// Installs strictly before removes. When the endpoint changes, the new permit must be
    /// live before the old one is deleted — the core's selector moves only after the new WFP
    /// permit exists, so a switch never opens a direct window (Proton's ordering lesson).
    /// Teardown is the mirror: permits leave before any floor rule would be touched.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn ordered_steps(&self) -> Vec<PlanStep> {
        self.install
            .iter()
            .cloned()
            .map(PlanStep::Install)
            .chain(self.remove.iter().copied().map(PlanStep::Remove))
            .collect()
    }
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub fn diff(current_keys: &[Guid], desired: &[FilterSpec]) -> ChangePlan {
    let install = desired
        .iter()
        .filter(|filter| !current_keys.contains(&filter.key))
        .cloned()
        .collect::<Vec<_>>();
    let desired_keys = desired.iter().map(|filter| filter.key).collect::<Vec<_>>();
    let remove = current_keys
        .iter()
        .filter(|key| !desired_keys.contains(key))
        .copied()
        .collect();
    ChangePlan { install, remove }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::structure::ProxyEndpoint;

    fn endpoint(ip: &str, port: u16) -> ProxyEndpoint {
        ProxyEndpoint {
            ip: ip.to_owned(),
            port,
            protocol: ProxyProtocol::Tcp,
        }
    }

    fn config(mode: KillSwitchStatusMode) -> RuleConfig {
        RuleConfig {
            mode,
            endpoints: vec![endpoint("8.8.8.8", 443)],
            api_host_ips: vec!["1.1.1.1".parse().unwrap()],
            tun_luid: Some(0x1234_5678),
            app_path: r"C:\ProgramData\Tono\bin\mihomo.exe".to_owned(),
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
        }
    }

    fn has_condition(filters: &[FilterSpec], probe: &Condition) -> bool {
        filters
            .iter()
            .any(|filter| filter.conditions.contains(probe))
    }

    #[test]
    fn block_all_is_always_present_for_both_families() {
        for mode in [
            KillSwitchStatusMode::Bootstrap,
            KillSwitchStatusMode::Locked,
            KillSwitchStatusMode::Blocked,
        ] {
            let filters = expected_filters(&config(mode));
            // The persistent floor and redundant session floor both exist, so every outbound
            // authorization layer ends in a condition-free block in every mode.
            for layer in [LayerKind::AleAuthConnectV4, LayerKind::AleAuthConnectV6] {
                let block_alls = filters
                    .iter()
                    .filter(|filter| {
                        filter.layer == layer
                            && filter.action == FilterAction::Block
                            && filter.conditions.is_empty()
                            && filter.weight == WEIGHT_BLOCK_ALL
                    })
                    .count();
                assert_eq!(
                    block_alls, 2,
                    "{mode:?}: missing persistent/session block-all set in {layer:?}"
                );
            }
        }
    }

    #[test]
    fn only_floor_blocks_are_persistent() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Locked));
        let persistent = filters
            .iter()
            .filter(|filter| filter.persistent)
            .collect::<Vec<_>>();
        assert_eq!(persistent.len(), 2);
        assert!(
            persistent.iter().all(|filter| {
                filter.action == FilterAction::Block && filter.conditions.is_empty()
            }),
            "persistence is reserved for the condition-free floor block"
        );
    }

    #[test]
    fn bootstrap_has_api_permit_but_no_tunnel_permit() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Bootstrap));
        assert!(has_condition(
            &filters,
            &Condition::RemoteAddressV4 {
                addr: [1, 1, 1, 1],
                prefix: 32
            }
        ));
        assert!(filters.iter().any(|filter| {
            filter.action == FilterAction::Permit
                && filter.weight == WEIGHT_INFRA_PERMIT
                && filter.conditions.contains(&Condition::RemotePort(443))
        }));
        assert!(
            !filters
                .iter()
                .flat_map(|filter| filter.conditions.iter())
                .any(|condition| matches!(condition, Condition::LocalInterface(_))),
            "bootstrap must not permit the tunnel"
        );
    }

    #[test]
    fn locked_has_tunnel_permit_but_no_api_permit() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Locked));
        let tun_permits = filters
            .iter()
            .filter(|filter| {
                filter
                    .conditions
                    .contains(&Condition::LocalInterface(0x1234_5678))
            })
            .count();
        assert_eq!(
            tun_permits, 2,
            "tunnel permit on v4/v6 ALE authorization layers"
        );
        assert!(
            !filters.iter().any(|filter| {
                filter.action == FilterAction::Permit && filter.name.contains("bootstrap API")
            }),
            "locked must retract the bootstrap API channel"
        );
    }

    #[test]
    fn blocked_keeps_api_recovery_channel_without_tunnel() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Blocked));
        assert!(filters.iter().any(|filter| {
            filter.action == FilterAction::Permit
                && filter.weight == WEIGHT_INFRA_PERMIT
                && filter.conditions.contains(&Condition::RemotePort(443))
        }));
        assert!(
            !filters
                .iter()
                .flat_map(|filter| filter.conditions.iter())
                .any(|condition| matches!(condition, Condition::LocalInterface(_)))
        );
        // The endpoint permit (A) stays up while blocked; default deny covers all other traffic.
        assert!(has_condition(&filters, &Condition::AleAppId));
        assert!(!filters.iter().any(|filter| {
            filter.action == FilterAction::Block
                && filter.conditions.contains(&Condition::RemotePort(53))
        }));
    }

    #[test]
    fn endpoint_permit_is_app_scoped_and_exact() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Bootstrap));
        let ale_permits = filters
            .iter()
            .filter(|filter| filter.conditions.contains(&Condition::AleAppId))
            .collect::<Vec<_>>();
        assert_eq!(
            ale_permits.len(),
            1,
            "only the selected endpoint is app-authorized"
        );
        let conditions = &ale_permits[0].conditions;
        assert!(conditions.contains(&Condition::RemoteAddressV4 {
            addr: [8, 8, 8, 8],
            prefix: 32
        }));
        assert!(conditions.contains(&Condition::RemotePort(443)));
        assert!(conditions.contains(&Condition::Protocol(IpProtocol::Tcp)));
        assert_eq!(ale_permits[0].weight, WEIGHT_HARD_PERMIT);
        assert!(!ale_permits[0].persistent);
        assert_eq!(ale_permits[0].layer, LayerKind::AleAuthConnectV4);
    }

    #[test]
    fn rule_keys_are_deterministic() {
        let first = expected_filters(&config(KillSwitchStatusMode::Bootstrap));
        let second = expected_filters(&config(KillSwitchStatusMode::Bootstrap));
        assert_eq!(
            first.iter().map(|filter| filter.key).collect::<Vec<_>>(),
            second.iter().map(|filter| filter.key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn filter_namespace_marks_the_current_rule_table_version() {
        // Upgrade safety: the key-only diff adopts anything with a matching key, so the
        // namespace must change whenever the rule tables do. Pin the current marker (see the
        // constant's doc comment); any rule-table change must bump it and this pin.
        assert_eq!(FILTER_NAMESPACE >> 64, 0x2f7c_9e08_0000_4a6c);
    }

    #[test]
    fn moving_the_core_binary_rekeys_the_endpoint_permit() {
        let mut moved = config(KillSwitchStatusMode::Locked);
        moved.app_path = r"C:\ProgramData\Tono\bin\gen-2\mihomo.exe".to_owned();
        let before = expected_filters(&config(KillSwitchStatusMode::Locked));
        let after = expected_filters(&moved);
        let key_of = |filters: &[FilterSpec]| {
            filters
                .iter()
                .find(|filter| filter.conditions.contains(&Condition::AleAppId))
                .unwrap()
                .key
        };
        assert_ne!(
            key_of(&before),
            key_of(&after),
            "an installer moving the exe must rekey the app-id permit"
        );
        let plan = diff(
            &before.iter().map(|filter| filter.key).collect::<Vec<_>>(),
            &after,
        );
        assert_eq!(plan.install.len(), 1);
        assert_eq!(plan.remove.len(), 1);
    }

    #[test]
    fn a_new_tunnel_luid_rekeys_the_tunnel_permit() {
        let mut relanded = config(KillSwitchStatusMode::Locked);
        relanded.tun_luid = Some(0x9999);
        let before = expected_filters(&config(KillSwitchStatusMode::Locked));
        let after = expected_filters(&relanded);
        let tun_keys = |filters: &[FilterSpec]| {
            filters
                .iter()
                .filter(|filter| {
                    filter
                        .conditions
                        .iter()
                        .any(|condition| matches!(condition, Condition::LocalInterface(_)))
                })
                .map(|filter| filter.key)
                .collect::<Vec<_>>()
        };
        assert_ne!(tun_keys(&before), tun_keys(&after));
    }

    #[test]
    fn endpoint_switch_installs_new_permit_before_removing_old() {
        let old = expected_filters(&config(KillSwitchStatusMode::Locked));
        let mut switched = config(KillSwitchStatusMode::Locked);
        switched.endpoints = vec![endpoint("9.9.9.9", 8443)];
        let new = expected_filters(&switched);

        let old_permit = old
            .iter()
            .find(|filter| {
                filter.conditions.contains(&Condition::RemotePort(443))
                    && filter.conditions.contains(&Condition::AleAppId)
            })
            .unwrap()
            .key;
        let plan = diff(
            &old.iter().map(|filter| filter.key).collect::<Vec<_>>(),
            &new,
        );

        let new_permit = new
            .iter()
            .find(|filter| filter.conditions.contains(&Condition::RemotePort(8443)))
            .unwrap()
            .clone();
        assert!(plan.install.contains(&new_permit));
        assert!(plan.remove.contains(&old_permit));

        let steps = plan.ordered_steps();
        let install_at = steps
            .iter()
            .position(|step| *step == PlanStep::Install(new_permit.clone()))
            .unwrap();
        let remove_at = steps
            .iter()
            .position(|step| *step == PlanStep::Remove(old_permit))
            .unwrap();
        assert!(
            install_at < remove_at,
            "the new endpoint permit must be live before the old one is removed"
        );
        assert!(
            plan.remove
                .iter()
                .all(|key| !new.iter().any(|filter| filter.key == *key)),
            "nothing in the desired set may be removed"
        );
    }

    #[test]
    fn api_host_ips_are_public_bounded_and_deduplicated() {
        let rejected = [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "198.19.255.255",
            "192.88.99.1",
            "224.0.0.1",
            "240.0.0.1",
            "250.1.2.3",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "ff02::1",
            "::ffff:8.8.8.8",
        ];
        for ip in rejected {
            let parsed: IpAddr = ip.parse().unwrap();
            assert!(!is_public_api_ip(&parsed), "accepted {ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "203.0.113.7"] {
            let parsed: IpAddr = ip.parse().unwrap();
            assert!(is_public_api_ip(&parsed), "rejected {ip}");
        }

        let many =
            (0..32).map(|index| IpAddr::from([8, 8, (index / 256) as u8, (index % 256) as u8 + 1]));
        let sanitized = sanitize_api_host_ips(
            ["1.1.1.1".parse().unwrap(), "1.1.1.1".parse().unwrap()]
                .into_iter()
                .chain(many),
        );
        assert!(sanitized.len() <= MAX_API_HOST_IPS);
        assert_eq!(
            sanitized
                .iter()
                .filter(|ip| **ip == "1.1.1.1".parse::<IpAddr>().unwrap())
                .count(),
            1,
            "duplicates collapse"
        );
    }

    #[test]
    fn session_rules_are_never_persistent() {
        let config = config(KillSwitchStatusMode::Bootstrap);
        for filter in session_rules(&config) {
            assert!(
                !filter.persistent,
                "volatile session rules must not be persistent: {}",
                filter.name
            );
        }
    }

    #[test]
    fn locked_without_a_luid_renders_no_tunnel_permit() {
        let mut config = config(KillSwitchStatusMode::Locked);
        config.tun_luid = None;
        let filters = expected_filters(&config);
        assert!(
            !filters
                .iter()
                .flat_map(|filter| filter.conditions.iter())
                .any(|condition| matches!(condition, Condition::LocalInterface(_))),
            "lock without a resolved LUID must not guess a tunnel permit"
        );
        // And the rest of the locked policy still stands (fail-closed).
        assert!(has_condition(&filters, &Condition::AleAppId));
    }

    #[test]
    fn multiple_endpoints_each_get_an_exact_permit() {
        let mut config = config(KillSwitchStatusMode::Bootstrap);
        config.endpoints = vec![
            endpoint("8.8.8.8", 443),
            endpoint("9.9.9.9", 8443),
            ProxyEndpoint {
                ip: "2606:4700:4700::1111".to_owned(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            },
        ];
        let filters = session_rules(&config);
        let permits = filters
            .iter()
            .filter(|filter| filter.conditions.contains(&Condition::AleAppId))
            .collect::<Vec<_>>();
        assert_eq!(permits.len(), 3);
        assert!(has_condition(
            &filters,
            &Condition::RemoteAddressV4 {
                addr: [9, 9, 9, 9],
                prefix: 32
            }
        ));
        assert!(has_condition(&filters, &Condition::RemotePort(8443)));
        assert!(
            permits
                .iter()
                .any(|filter| filter.layer == LayerKind::AleAuthConnectV6),
            "v6 endpoint lands on the v6 connect layer"
        );
        assert_ne!(
            permits[0].key, permits[1].key,
            "each endpoint permit has its own deterministic key"
        );
    }

    #[test]
    fn invalid_endpoints_render_no_permit_and_stay_fail_closed() {
        for bad in [
            endpoint("not-an-ip", 443),
            endpoint("0.0.0.0", 443),
            endpoint("::", 443),
            endpoint("8.8.8.8", 0),
            endpoint("127.0.0.1", 443),   // loopback
            endpoint("10.0.0.8", 443),    // private
            endpoint("192.168.1.8", 443), // private
            endpoint("169.254.1.8", 443), // link-local
            endpoint("100.64.0.8", 443),  // CGNAT
            endpoint("fe80::8", 443),     // v6 link-local
            endpoint("fc00::8", 443),     // ULA
        ] {
            assert!(
                parse_endpoint(&bad).is_none(),
                "accepted invalid endpoint {}:{}",
                bad.ip,
                bad.port
            );
        }
        let mut config = config(KillSwitchStatusMode::Bootstrap);
        config.endpoints = vec![endpoint("10.0.0.8", 443)];
        let filters = expected_filters(&config);
        assert!(
            !has_condition(&filters, &Condition::AleAppId),
            "a rejected endpoint must produce no app-id permit"
        );
        // Fail closed: with no endpoint permit, the endpoint IP itself is blocked.
        let packet = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "10.0.0.8",
            443,
        );
        assert_eq!(arbitrate(&filters, &packet), FilterAction::Block);
    }

    // --- C1 arbitration simulator -----------------------------------------------------
    //
    // MSDN filter arbitration (https://learn.microsoft.com/en-us/windows/win32/fwp/filter-arbitration):
    // sublayers are traversed highest-weight first; within a sublayer, filters are ordered by
    // descending weight; the first matching filter with a terminating action (permit/block)
    // ends arbitration. This simulator pins those semantics so the rule tables can never
    // again rely on the inverse (wrong) "filter weight first" ordering.

    #[derive(Debug, Clone)]
    struct Packet {
        layer: LayerKind,
        protocol: IpProtocol,
        remote_ip: IpAddr,
        ale_loopback: bool,
        local_port: Option<u16>,
        remote_port: u16,
        icmp_type: Option<u16>,
        app_id_matches: bool,
        local_interface: Option<u64>,
    }

    fn packet(layer: LayerKind, protocol: IpProtocol, ip: &str, port: u16) -> Packet {
        let remote_ip: IpAddr = ip.parse().unwrap();
        Packet {
            layer,
            protocol,
            ale_loopback: remote_ip.is_loopback(),
            remote_ip,
            local_port: None,
            remote_port: port,
            icmp_type: None,
            app_id_matches: false,
            local_interface: None,
        }
    }

    fn v4_prefix_matches(addr: [u8; 4], network: [u8; 4], prefix: u8) -> bool {
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        u32::from_be_bytes(addr) & mask == u32::from_be_bytes(network) & mask
    }

    fn v6_prefix_matches(addr: [u8; 16], network: [u8; 16], prefix: u8) -> bool {
        let mask = if prefix == 0 {
            0
        } else {
            u128::MAX << (128 - prefix)
        };
        u128::from_be_bytes(addr) & mask == u128::from_be_bytes(network) & mask
    }

    fn condition_matches(condition: &Condition, packet: &Packet) -> bool {
        match condition {
            Condition::RemoteAddressV4 { addr, prefix } => match packet.remote_ip {
                IpAddr::V4(ip) => v4_prefix_matches(ip.octets(), *addr, *prefix),
                IpAddr::V6(_) => false,
            },
            Condition::RemoteAddressV6 { addr, prefix } => match packet.remote_ip {
                IpAddr::V6(ip) => v6_prefix_matches(ip.octets(), *addr, *prefix),
                IpAddr::V4(_) => false,
            },
            Condition::Protocol(protocol) => *protocol == packet.protocol,
            Condition::LocalPort(port) => packet.local_port == Some(*port),
            Condition::RemotePort(port) => *port == packet.remote_port,
            Condition::IcmpV6TypeRange { min, max } => packet
                .icmp_type
                .is_some_and(|ty| (*min..=*max).contains(&ty)),
            Condition::AleLoopback => packet.ale_loopback,
            Condition::AleAppId => packet.app_id_matches,
            Condition::LocalInterface(luid) => packet.local_interface == Some(*luid),
        }
    }

    /// WFP's own combining rule, which the model previously did not implement.
    ///
    /// From the `FWPM_FILTER0` contract: conditions on *different* fields are AND'd, and
    /// conditions repeating the *same* field are OR'd. The model ANDed everything, so a filter
    /// carrying several remote-address prefixes — the shape rule H uses to mean "any public
    /// unicast address" — could never match, and the test asserted a Block that production
    /// would not produce.
    ///
    /// Note this is the one place the model encodes a WFP semantic that cannot be exercised on
    /// a non-Windows host. It is the documented behaviour, and getting it wrong fails closed:
    /// the permit would simply never match and WeChat would stay as broken as it was before
    /// rule H existed. Still worth one confirmation on a real machine.
    fn field_key(condition: &Condition) -> u8 {
        match condition {
            Condition::RemoteAddressV4 { .. } => 0,
            Condition::RemoteAddressV6 { .. } => 1,
            Condition::Protocol(_) => 2,
            Condition::LocalPort(_) => 3,
            Condition::RemotePort(_) => 4,
            Condition::IcmpV6TypeRange { .. } => 5,
            Condition::AleLoopback => 6,
            Condition::AleAppId => 7,
            Condition::LocalInterface(_) => 8,
        }
    }

    fn filter_matches(filter: &FilterSpec, packet: &Packet) -> bool {
        if filter.layer != packet.layer {
            return false;
        }
        let mut keys: Vec<u8> = filter.conditions.iter().map(field_key).collect();
        keys.sort_unstable();
        keys.dedup();
        keys.into_iter().all(|key| {
            filter
                .conditions
                .iter()
                .filter(|condition| field_key(condition) == key)
                .any(|condition| condition_matches(condition, packet))
        })
    }

    fn arbitrate(filters: &[FilterSpec], packet: &Packet) -> FilterAction {
        let mut matched = filters
            .iter()
            .filter(|filter| filter_matches(filter, packet))
            .collect::<Vec<_>>();
        // One sublayer for everything, so MSDN arbitration reduces to filter weight only:
        // highest weight first, first terminating match wins.
        matched.sort_by_key(|filter| filter.weight);
        matched
            .last()
            .map(|filter| filter.action)
            .expect("every layer must end in a block-all")
    }

    #[test]
    fn arbitration_keeps_infrastructure_open_in_every_mode() {
        for mode in [
            KillSwitchStatusMode::Bootstrap,
            KillSwitchStatusMode::Locked,
            KillSwitchStatusMode::Blocked,
        ] {
            let filters = expected_filters(&config(mode));
            let cases: &[(Packet, FilterAction, &str)] = &[
                (
                    packet(
                        LayerKind::AleAuthConnectV4,
                        IpProtocol::Tcp,
                        "127.0.0.1",
                        53,
                    ),
                    FilterAction::Permit,
                    "loopback tcp/53",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV4,
                        IpProtocol::Udp,
                        "127.0.0.1",
                        53,
                    ),
                    FilterAction::Permit,
                    "loopback udp/53",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV4,
                        IpProtocol::Udp,
                        "127.0.0.53",
                        5353,
                    ),
                    FilterAction::Permit,
                    "loopback /8 udp/5353",
                ),
                (
                    packet(LayerKind::AleAuthConnectV6, IpProtocol::Udp, "::1", 53),
                    FilterAction::Permit,
                    "loopback v6 udp/53",
                ),
                (
                    {
                        let mut packet = packet(
                            LayerKind::AleAuthConnectV4,
                            IpProtocol::Udp,
                            "192.168.1.2",
                            67,
                        );
                        packet.local_port = Some(68);
                        packet
                    },
                    FilterAction::Permit,
                    "DHCPv4 client",
                ),
                (
                    {
                        let mut packet = packet(
                            LayerKind::AleAuthConnectV4,
                            IpProtocol::Udp,
                            "203.0.113.8",
                            67,
                        );
                        packet.local_port = Some(49_152);
                        packet
                    },
                    FilterAction::Block,
                    "non-DHCP source to udp/67",
                ),
                (
                    {
                        let mut packet =
                            packet(LayerKind::AleAuthConnectV6, IpProtocol::Udp, "fe80::1", 547);
                        packet.local_port = Some(546);
                        packet
                    },
                    FilterAction::Permit,
                    "DHCPv6 client to server",
                ),
                (
                    {
                        let mut packet = packet(
                            LayerKind::AleAuthConnectV6,
                            IpProtocol::Udp,
                            "2001:db8::1",
                            547,
                        );
                        packet.local_port = Some(49_152);
                        packet
                    },
                    FilterAction::Block,
                    "non-DHCPv6 source to udp/547",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV4,
                        IpProtocol::Udp,
                        "162.159.200.123",
                        123,
                    ),
                    FilterAction::Block,
                    "NTP v4 has no physical-network bypass",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV6,
                        IpProtocol::Udp,
                        "2606:4700:4700::1234",
                        123,
                    ),
                    FilterAction::Block,
                    "NTP v6 has no physical-network bypass",
                ),
                (
                    packet(LayerKind::AleAuthConnectV4, IpProtocol::Udp, "9.9.9.9", 53),
                    FilterAction::Block,
                    "direct udp/53",
                ),
                (
                    packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "9.9.9.9", 53),
                    FilterAction::Block,
                    "direct tcp/53",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV6,
                        IpProtocol::Udp,
                        "2606:4700:4700::1111",
                        53,
                    ),
                    FilterAction::Block,
                    "direct v6 udp/53",
                ),
                (
                    packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "9.9.9.9", 443),
                    FilterAction::Block,
                    "arbitrary tcp",
                ),
                (
                    packet(
                        LayerKind::AleAuthConnectV6,
                        IpProtocol::Tcp,
                        "2606:4700:4700::1111",
                        443,
                    ),
                    FilterAction::Block,
                    "arbitrary v6 tcp",
                ),
            ];
            for (packet, expected, label) in cases {
                assert_eq!(arbitrate(&filters, packet), *expected, "{mode:?}: {label}");
            }
            for ty in 133..=137_u16 {
                let mut outbound = packet(
                    LayerKind::AleAuthConnectV6,
                    IpProtocol::IcmpV6,
                    "fe80::1",
                    0,
                );
                outbound.icmp_type = Some(ty);
                assert_eq!(
                    arbitrate(&filters, &outbound),
                    FilterAction::Permit,
                    "{mode:?}: NDP outbound type {ty}"
                );
                let mut inbound = packet(
                    LayerKind::AleAuthRecvAcceptV6,
                    IpProtocol::IcmpV6,
                    "fe80::1",
                    0,
                );
                inbound.icmp_type = Some(ty);
                assert_eq!(
                    arbitrate(&filters, &inbound),
                    FilterAction::Permit,
                    "{mode:?}: NDP inbound type {ty}"
                );
            }
        }
    }

    #[test]
    fn loopback_permits_cover_address_and_ale_paths_as_hard_actions() {
        let filters = intent_floor();
        let loopback_permits = filters
            .iter()
            .filter(|filter| filter.name.contains("permit loopback"))
            .collect::<Vec<_>>();
        assert_eq!(loopback_permits.len(), 4);
        assert!(
            loopback_permits
                .iter()
                .all(|filter| filter.hard_permit && filter.action == FilterAction::Permit)
        );
        assert_eq!(
            loopback_permits
                .iter()
                .filter(|filter| filter.conditions == [Condition::AleLoopback])
                .count(),
            2
        );
        assert!(loopback_permits.iter().any(|filter| {
            filter.conditions
                == [Condition::RemoteAddressV4 {
                    addr: [127, 0, 0, 0],
                    prefix: 8,
                }]
        }));
        assert!(loopback_permits.iter().any(|filter| {
            filter.conditions
                == [Condition::RemoteAddressV6 {
                    addr: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                    prefix: 128,
                }]
        }));

        // Address matching preserves the controller path observed on real Windows.
        let mut unclassified = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Udp,
            "127.0.0.1",
            53,
        );
        unclassified.ale_loopback = false;
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Locked)),
                &unclassified
            ),
            FilterAction::Permit
        );

        // ALE classification independently preserves redirected/local DNS even when the
        // address view at this layer is not a literal loopback address.
        let mut classified = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Udp,
            "192.168.31.1",
            53,
        );
        classified.ale_loopback = true;
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Locked)),
                &classified
            ),
            FilterAction::Permit
        );
    }

    #[test]
    fn arbitration_endpoint_permit_requires_the_staged_app_id() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Bootstrap));
        let mut packet = packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "8.8.8.8", 443);
        packet.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &packet), FilterAction::Permit);
        packet.app_id_matches = false;
        assert_eq!(
            arbitrate(&filters, &packet),
            FilterAction::Block,
            "another binary must not inherit the endpoint permit"
        );
    }

    #[test]
    fn ale_reauthorization_decision_blocks_preexisting_physical_flows() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Locked));

        // WFP policy-change reauthorization sends the next packet of an existing TCP/UDP flow
        // back through the ALE layer where it was created. This models that reauthorization for
        // the reported regression: Chromium opened HTTP/3 before Tono connected, then its next
        // physical QUIC datagram is evaluated against the new app-aware ALE policy.
        let stale_quic = packet(LayerKind::AleAuthConnectV4, IpProtocol::Udp, "9.9.9.9", 443);
        assert_eq!(
            arbitrate(&filters, &stale_quic),
            FilterAction::Block,
            "a pre-authorized physical QUIC flow must not survive lock"
        );

        let mut tunneled_quic = stale_quic;
        tunneled_quic.local_interface = Some(0x1234_5678);
        assert_eq!(
            arbitrate(&filters, &tunneled_quic),
            FilterAction::Permit,
            "the replacement flow on WinTUN must remain usable"
        );

        let mut core_endpoint =
            packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "8.8.8.8", 443);
        assert_eq!(
            arbitrate(&filters, &core_endpoint),
            FilterAction::Block,
            "another process cannot inherit Mihomo's endpoint tuple"
        );
        core_endpoint.app_id_matches = true;
        assert_eq!(
            arbitrate(&filters, &core_endpoint),
            FilterAction::Permit,
            "the staged core retains its exact proxy endpoint"
        );
    }

    #[test]
    fn arbitration_api_channel_open_in_bootstrap_and_blocked_retracted_in_locked() {
        let packet = packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "1.1.1.1", 443);
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Bootstrap)),
                &packet
            ),
            FilterAction::Permit
        );
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Blocked)),
                &packet
            ),
            FilterAction::Permit
        );
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Locked)),
                &packet
            ),
            FilterAction::Block,
            "locked must retract the bootstrap API channel"
        );
    }

    #[test]
    fn arbitration_tunnel_permitted_only_when_locked() {
        let mut packet = packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "9.9.9.9", 443);
        packet.local_interface = Some(0x1234_5678);
        assert_eq!(
            arbitrate(
                &expected_filters(&config(KillSwitchStatusMode::Locked)),
                &packet
            ),
            FilterAction::Permit
        );
        for mode in [
            KillSwitchStatusMode::Bootstrap,
            KillSwitchStatusMode::Blocked,
        ] {
            assert_eq!(
                arbitrate(&expected_filters(&config(mode)), &packet),
                FilterAction::Block,
                "{mode:?}: tunnel traffic must stay blocked until lock"
            );
        }
    }

    #[test]
    fn dns_is_default_denied_physically_and_permitted_on_the_tunnel() {
        let filters = expected_filters(&config(KillSwitchStatusMode::Locked));
        assert!(
            !filters.iter().any(|filter| {
                filter.action == FilterAction::Block
                    && filter.conditions.contains(&Condition::RemotePort(53))
            }),
            "a separate terminating DNS block breaks Windows' legitimate resolver path"
        );

        for protocol in [IpProtocol::Tcp, IpProtocol::Udp] {
            let physical = packet(LayerKind::AleAuthConnectV4, protocol, "8.8.8.8", 53);
            assert_eq!(
                arbitrate(&filters, &physical),
                FilterAction::Block,
                "the block-all floor must still prevent physical DNS leaks"
            );

            let mut tunneled = physical;
            tunneled.local_interface = Some(0x1234_5678);
            assert_eq!(
                arbitrate(&filters, &tunneled),
                FilterAction::Permit,
                "DNS on the verified TUN interface is legitimate protected traffic"
            );
        }
    }

    fn config_with_direct_endpoints(mode: KillSwitchStatusMode) -> RuleConfig {
        let mut config = config(mode);
        // Declared by the App, not inferred from the pins: a plan carrying only web or media
        // pins routes nothing process-scoped and must therefore get no reviewed-port permit.
        config.reviewed_direct_ports = crate::REVIEWED_DIRECT_PORTS.to_vec();
        config.direct_endpoints = vec![
            endpoint("203.0.113.9", 443),
            ProxyEndpoint {
                ip: "203.0.113.10".to_owned(),
                port: 8000,
                protocol: ProxyProtocol::Udp,
            },
        ];
        config
    }

    /// The DIRECT boundary, stated as the two things that are still true and the one that
    /// deliberately is not.
    ///
    /// Still true: no process but the staged core reaches any of it, and outside
    /// `REVIEWED_DIRECT_PORTS` the permit is still an exact `IP:port` tuple.
    ///
    /// No longer true: on those four ports the core may reach any address. That is the point
    /// of class H — WeChat dials HTTPDNS-derived addresses no pin can know, and pinning was
    /// therefore silently dropping its images and file transfers. The trade is written out in
    /// the class comment; this test is where the shape is pinned so relaxing it further has to
    /// be deliberate.
    #[test]
    fn direct_endpoints_require_the_staged_core_at_ale_and_remain_exact_off_reviewed_ports() {
        let filters = expected_filters(&config_with_direct_endpoints(KillSwitchStatusMode::Locked));

        // An arbitrary process cannot open an exact tuple directly; Mihomo (the staged app id)
        // can open it after its process rule selected the DIRECT outbound.
        let mut tcp = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "203.0.113.9",
            443,
        );
        assert_eq!(arbitrate(&filters, &tcp), FilterAction::Block);
        tcp.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &tcp), FilterAction::Permit);
        let mut udp = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Udp,
            "203.0.113.10",
            8000,
        );
        assert_eq!(arbitrate(&filters, &udp), FilterAction::Block);
        udp.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &udp), FilterAction::Permit);

        // A port outside the reviewed set stays exact: even the pinned address is refused
        // there, and 8443 is deliberately close to 443 to catch a widened match.
        let mut wrong_port = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "203.0.113.9",
            8443,
        );
        wrong_port.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &wrong_port), FilterAction::Block);

        // On a reviewed port an unpinned address is permitted — for the staged core only.
        // This is the behaviour WeChat needs and the widening class H is.
        //
        // A real public address on purpose: the documentation ranges the other fixtures use
        // (203.0.113.0/24 and friends) are reserved, and class H refuses them. 43.175.230.151
        // is one of the addresses WeChat was measured dialling directly.
        let mut unpinned_reviewed = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "43.175.230.151",
            443,
        );
        assert_eq!(
            arbitrate(&filters, &unpinned_reviewed),
            FilterAction::Block,
            "a process that is not the staged core must never reach this permit"
        );
        unpinned_reviewed.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &unpinned_reviewed), FilterAction::Permit);

        // And an unpinned address off the reviewed ports is still refused, so the widening is
        // bounded by the port set rather than open-ended.
        let mut unpinned_other_port = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "43.175.230.151",
            9443,
        );
        unpinned_other_port.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &unpinned_other_port), FilterAction::Block);

        // The permit is bounded to public unicast. The exact table is checked exhaustively in
        // its own test; these are the ranges a hostile HTTPDNS answer would actually name.
        //
        // Loopback is deliberately absent from this list: the core must reach its own
        // controller and DNS listener, and a separate class permits that. Rule H not covering
        // 127/8 is the property under test, not whether 127.0.0.1 is reachable at all.
        for private in ["192.168.1.1", "10.0.0.5", "169.254.1.1", "100.64.0.1", "172.16.0.9"] {
            let mut probe =
                packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, private, 443);
            probe.app_id_matches = true;
            assert_eq!(
                arbitrate(&filters, &probe),
                FilterAction::Block,
                "{private} must stay unreachable: WeChat's HTTPDNS is plaintext, so the address \
                 comes from whatever answered the lookup"
            );
        }

        // IPv4 only. The runtime is `ipv6: false` and AAAA dials are dropped, so there is no
        // IPv6 DIRECT flow — and an address-free permit on the V6 layer would widen the
        // boundary with nothing asking for it. Adding one has to be a deliberate change.
        assert!(
            !filters.iter().any(|filter| {
                filter.name.contains("reviewed DIRECT")
                    && filter.layer == LayerKind::AleAuthConnectV6
            }),
            "the reviewed-port permit must not reach the IPv6 layer"
        );
        let mut v6 = packet(
            LayerKind::AleAuthConnectV6,
            IpProtocol::Tcp,
            "2001:db8::1",
            443,
        );
        v6.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &v6), FilterAction::Block);

        // Every reviewed port is covered on both protocols, and nothing outside the set is.
        for port in crate::REVIEWED_DIRECT_PORTS {
            let mut tcp_probe =
                packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "43.175.230.151", port);
            tcp_probe.app_id_matches = true;
            assert_eq!(
                arbitrate(&filters, &tcp_probe),
                FilterAction::Permit,
                "reviewed port {port}/tcp must be permitted for the staged core"
            );
            // UDP deliberately absent: nothing routes unpinned UDP to the physical interface,
            // so a permit here would admit traffic that cannot arrive. Pinned media still
            // works through rule G, which is what WeChat voice and video use.
            let mut udp_probe =
                packet(LayerKind::AleAuthConnectV4, IpProtocol::Udp, "43.175.230.151", port);
            udp_probe.app_id_matches = true;
            assert_eq!(
                arbitrate(&filters, &udp_probe),
                FilterAction::Block,
                "reviewed port {port}/udp must not be widened: no rule routes it here"
            );
        }

        // The ALE DIRECT permit is a weight-8, app-scoped exact tuple.
        let permit = filters
            .iter()
            .find(|filter| {
                filter.layer == LayerKind::AleAuthConnectV4
                    && filter.name.contains("DIRECT ALE")
                    && filter.conditions.contains(&Condition::RemoteAddressV4 {
                        addr: [203, 0, 113, 9],
                        prefix: 32,
                    })
            })
            .expect("direct permit must exist");
        assert_eq!(permit.weight, WEIGHT_HARD_PERMIT);
        assert!(permit.conditions.contains(&Condition::AleAppId));

        // Omission renders nothing.
        let without = expected_filters(&config(KillSwitchStatusMode::Locked));
        assert!(
            !without.iter().any(|filter| filter.name.contains("DIRECT")),
            "no direct endpoints configured, no DIRECT permits"
        );
    }

    #[test]
    fn locked_direct_endpoints_without_a_tunnel_luid_render_no_direct_permits() {
        let mut config = config_with_direct_endpoints(KillSwitchStatusMode::Locked);
        config.tun_luid = None;
        let filters = expected_filters(&config);
        assert!(!filters.iter().any(|filter| filter.name.contains("DIRECT")));
        assert!(
            !filters
                .iter()
                .any(|filter| filter.name.contains("tunnel interface"))
        );
    }

    /// The contract this replaces was "present in every mode while armed". A DIRECT permit is
    /// a controlled physical bypass for the staged core, so in the two modes where no tunnel
    /// exists it has no legitimate purpose. Bootstrap and Blocked must therefore arbitrate the
    /// exact approved tuples to Block, and the rendered
    /// set must not merely down-weight them — the permits must be absent, so the key-only diff
    /// removes them when the mode changes instead of leaving them installed.

    /// The computed complement must agree with the predicate it mirrors, everywhere.
    ///
    /// Exhaustive over the first two octets — 65 536 probes, which covers every boundary in
    /// `RESERVED_V4` — rather than a handful of samples, because an off-by-one in a CIDR split
    /// is exactly the kind of error a spot check passes.
    #[test]
    fn public_unicast_prefixes_are_the_exact_complement_of_the_reserved_table() {
        fn covered(prefixes: &[([u8; 4], u8)], addr: u32) -> bool {
            prefixes.iter().any(|(base, len)| {
                let mask = if *len == 0 { 0 } else { u32::MAX << (32 - len) };
                (u32::from_be_bytes(*base) & mask) == (addr & mask)
            })
        }
        fn reserved(addr: u32) -> bool {
            let [a, b, c, _] = addr.to_be_bytes();
            matches!(
                (a, b, c),
                (0, _, _)
                    | (10, _, _)
                    | (100, 64..=127, _)
                    | (127, _, _)
                    | (169, 254, _)
                    | (172, 16..=31, _)
                    | (192, 0, 0)
                    | (192, 0, 2)
                    | (192, 88, 99)
                    | (192, 168, _)
                    | (198, 18..=19, _)
                    | (198, 51, 100)
                    | (203, 0, 113)
                    | (224..=255, _, _)
            )
        }
        let prefixes = public_unicast_v4_prefixes();
        assert!(!prefixes.is_empty());

        // Boundaries first, because an off-by-one in a CIDR split lives exactly there and a
        // sampled sweep can step straight over it: every reserved range's first and last
        // address plus or minus one, every emitted prefix's first and last plus or minus one,
        // and the two ends of the space.
        let mut probes: Vec<u32> = vec![0, 1, u32::MAX - 1, u32::MAX];
        for (base, len) in RESERVED_V4 {
            let start = u32::from_be_bytes(base);
            let end = start + ((1u64 << (32 - len)) - 1) as u32;
            for edge in [start, end] {
                probes.extend([edge.saturating_sub(1), edge, edge.saturating_add(1)]);
            }
        }
        for (base, len) in &prefixes {
            let start = u32::from_be_bytes(*base);
            let end = start.saturating_add(((1u64 << (32 - len)) - 1) as u32);
            for edge in [start, end] {
                probes.extend([edge.saturating_sub(1), edge, edge.saturating_add(1)]);
            }
        }
        for addr in probes {
            assert_eq!(
                covered(&prefixes, addr),
                !reserved(addr),
                "boundary {}.{}.{}.{} disagrees with the reserved table",
                addr >> 24,
                (addr >> 16) & 255,
                (addr >> 8) & 255,
                addr & 255
            );
        }
        for a in 0..=255u8 {
            for b in 0..=255u8 {
                // Third octet chosen to land inside every /24 the table names.
                for c in [0u8, 2, 99, 100, 113, 255] {
                    let addr = u32::from_be_bytes([a, b, c, 7]);
                    assert_eq!(
                        covered(&prefixes, addr),
                        !reserved(addr),
                        "{a}.{b}.{c}.7 disagrees with the reserved table"
                    );
                }
            }
        }
    }

    /// A pinned tuple existing is not the same as process-scoped routing existing.
    ///
    /// `direct_endpoints` is the union of the WeChat, web and media pins, and a web pin is
    /// 80/443 exactly like a WeChat one, so the Service cannot tell them apart. Gating rule H
    /// on "some pin exists" rendered an address-free port permit for policies that route
    /// nothing to it — a web-only or media-only plan got the widening for free. The App now
    /// declares the ports it actually emitted rules for, and an empty declaration renders
    /// nothing.
    #[test]
    fn reviewed_port_permit_needs_the_app_to_declare_it_not_just_a_pin() {
        let mut config = config_with_direct_endpoints(KillSwitchStatusMode::Locked);
        config.reviewed_direct_ports.clear();
        let filters = expected_filters(&config);
        assert!(
            !filters
                .iter()
                .any(|filter| filter.name.contains("reviewed DIRECT")),
            "a plan that declares no reviewed ports must not widen the boundary"
        );
        // The exact pins it does carry still work: this withdraws the widening, not the plan.
        let mut pinned = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "203.0.113.9",
            443,
        );
        pinned.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &pinned), FilterAction::Permit);

        // And an unpinned address is refused again, which is the pre-rule-H behaviour.
        let mut unpinned = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "43.175.230.151",
            443,
        );
        unpinned.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &unpinned), FilterAction::Block);

        // Only the ports declared are rendered, not the whole compiled set.
        let mut narrowed = config_with_direct_endpoints(KillSwitchStatusMode::Locked);
        narrowed.reviewed_direct_ports = vec![443];
        let narrow_filters = expected_filters(&narrowed);
        assert_eq!(
            narrow_filters
                .iter()
                .filter(|filter| filter.name.contains("reviewed DIRECT"))
                .count(),
            1,
            "one filter for the single declared port, TCP only"
        );
        let mut port80 =
            packet(LayerKind::AleAuthConnectV4, IpProtocol::Tcp, "43.175.230.151", 80);
        port80.app_id_matches = true;
        assert_eq!(arbitrate(&narrow_filters, &port80), FilterAction::Block);
    }

    /// The converse of the declaration test, and the regression the second review found.
    ///
    /// `reviewed_direct_ports` lives on `Armed` and every retraction path clears
    /// `direct_endpoints` without touching it, so a re-lock inside the reload bracket — the
    /// normal second and later activation — arrived here with a declaration and no plan. The
    /// gate is conjunctive now, so this cannot render regardless of which field a future
    /// retraction site forgets.
    #[test]
    fn a_declaration_without_a_plan_renders_no_permit() {
        let mut config = config_with_direct_endpoints(KillSwitchStatusMode::Locked);
        config.direct_endpoints.clear();
        assert!(
            !config.reviewed_direct_ports.is_empty(),
            "the declaration must survive for this to test anything"
        );
        let filters = expected_filters(&config);
        assert!(
            !filters
                .iter()
                .any(|filter| filter.name.contains("reviewed DIRECT")),
            "no approved endpoint means no plan, and no plan means no permit"
        );
        let mut probe = packet(
            LayerKind::AleAuthConnectV4,
            IpProtocol::Tcp,
            "43.175.230.151",
            443,
        );
        probe.app_id_matches = true;
        assert_eq!(arbitrate(&filters, &probe), FilterAction::Block);
    }

    #[test]
    fn direct_permits_are_absent_and_blocked_outside_locked() {
        for mode in [
            KillSwitchStatusMode::Bootstrap,
            KillSwitchStatusMode::Blocked,
        ] {
            let filters = expected_filters(&config_with_direct_endpoints(mode));
            assert!(
                !filters.iter().any(|filter| filter.name.contains("DIRECT")),
                "{mode:?}: no tunnel exists, so no DIRECT permit may be installed"
            );
            for (protocol, ip, port) in [
                (IpProtocol::Tcp, "203.0.113.9", 443_u16),
                (IpProtocol::Udp, "203.0.113.10", 8000),
            ] {
                let mut approved = packet(LayerKind::AleAuthConnectV4, protocol, ip, port);
                approved.app_id_matches = true;
                assert_eq!(
                    arbitrate(&filters, &approved),
                    FilterAction::Block,
                    "{mode:?}: {ip}:{port} must not escape while disconnected"
                );
            }
        }

        // The mode change is what retracts them: every DIRECT key rendered while locked is in
        // the removal set once the switch drops back to Blocked, and nothing survives it.
        let locked = expected_filters(&config_with_direct_endpoints(KillSwitchStatusMode::Locked));
        let blocked =
            expected_filters(&config_with_direct_endpoints(KillSwitchStatusMode::Blocked));
        let direct_keys = locked
            .iter()
            .filter(|filter| filter.name.contains("DIRECT"))
            .map(|filter| filter.key)
            .collect::<Vec<_>>();
        // Rule G's two exact tuples plus rule H's port class. Both are gated on Locked with a
        // live tunnel, so both must appear here and both must be retracted below.
        assert_eq!(
            direct_keys.len(),
            2 + crate::REVIEWED_DIRECT_PORTS.len()
        );
        let plan = diff(
            &locked.iter().map(|filter| filter.key).collect::<Vec<_>>(),
            &blocked,
        );
        assert!(
            direct_keys.iter().all(|key| plan.remove.contains(key)),
            "a mode change must never leave a stale DIRECT permit installed"
        );
    }
}
