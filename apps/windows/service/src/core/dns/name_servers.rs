use super::*;

// --- Pure logic (platform-independent, unit-tested below) ---

/// Registry `NameServer` values are comma-separated; tolerate spaces and empty segments.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn parse_name_server_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|server| !server.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// DNS servers the live apply should restore for **one address family**. `ProfileNameServer`
/// overrides `NameServer` when populated. `None` means "no saved value": restore DHCP for that
/// family.
///
/// The two families are deliberately never merged into one list. `SetDNSServerSearchOrder` on
/// `Win32_NetworkAdapterConfiguration` is documented for IPv4 addresses only, so a mixed
/// `["127.0.0.1", "::1"]` array is either rejected outright (every adapter fails forever) or —
/// worse — silently truncated to its IPv4 element, leaving the IPv6 resolver pointing at the
/// previous ISP/DHCP server while the registry read-back still reports "protected". Each
/// family now travels through its own mechanism and is proven separately (`engine`).
///
/// A saved value that is present but *empty* still maps to `None` (restore DHCP), even though
/// an empty static list is what the protect path now writes for IPv6. Windows leaves an empty
/// `NameServer` behind on perfectly ordinary DHCP adapters, so the registry cannot tell "the
/// user chose static-with-no-servers" from "this family is on DHCP"; guessing static there
/// would strand a DHCP machine with no resolvers at all. This never affects the protected
/// state, which is read from the *snapshot* — the values as they were before Tono touched
/// them — and the four exact registry values are written back verbatim regardless
/// (`engine::apply_snapshot`), which is what the restore proof compares.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn restored_family_servers(profile: Option<&str>, base: Option<&str>) -> Option<Vec<String>> {
    // Windows also accepts space-separated servers, used by mobile broadband drivers.
    // Normalize at the restore boundary; ownership/protection predicates keep their contract.
    let parse_servers = |value: &str| {
        value
            .split(|separator: char| separator == ',' || separator.is_ascii_whitespace())
            .map(str::trim)
            .filter(|server| !server.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>()
    };
    let profile = profile.map(parse_servers).unwrap_or_default();
    let effective = if profile.is_empty() {
        base.map(parse_servers).unwrap_or_default()
    } else {
        profile
    };
    let mut restored: Vec<String> = Vec::new();
    for server in effective {
        if !restored.contains(&server) {
            restored.push(server);
        }
    }
    (!restored.is_empty()).then_some(restored)
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn restored_live_servers_v4(adapter: &AdapterDnsSnapshot) -> Option<Vec<String>> {
    restored_family_servers(
        adapter.ipv4_profile_name_server.as_deref(),
        adapter.ipv4_name_server.as_deref(),
    )
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn restored_live_servers_v6(adapter: &AdapterDnsSnapshot) -> Option<Vec<String>> {
    restored_family_servers(
        adapter.ipv6_profile_name_server.as_deref(),
        adapter.ipv6_name_server.as_deref(),
    )
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn format_name_server_list(servers: &[String]) -> String {
    servers.join(",")
}

/// Whether a saved/read-back value is made only of legacy loopback resolvers.
///
/// Deliberately does **not** include the current `198.18.0.2` target. This predicate distinguishes
/// a user's legitimate pre-existing local resolver (Acrylic/dnscrypt-proxy/Pi-hole) when deciding
/// which adapters owe live restore proof. The broader [`is_tono_dns_value`] predicate is what
/// recognises current plus legacy Tono-owned targets on the actual restore path.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn is_loopback_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty()
        && servers
            .iter()
            .all(|server| server == LOOPBACK_V4 || server == LOOPBACK_V6)
}

/// Whether IPv4 reads back exactly as the current protected DNS target. Requiring the complete
/// list to contain only the TUN endpoint prevents a mixed `198.18.0.2, ISP-DNS` configuration
/// from being reported as protected.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn is_protected_v4_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty() && servers.iter().all(|server| server == PROTECTED_DNS_V4)
}

/// Whether a registry value contains the current Tono-only DNS endpoint anywhere in its list.
///
/// This is intentionally broader than [`is_protected_v4_value`]. A half-restored value such as
/// `198.18.0.2, 1.1.1.1` is not a valid protected state, but it is still unsafe to capture as the
/// user's original DNS when the recovery snapshot is missing: after the core stops, the first
/// address is dead and Windows may wait on it before trying the next one.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn contains_current_protected_v4(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        parse_name_server_list(value)
            .iter()
            .any(|server| server == PROTECTED_DNS_V4)
    })
}

pub(super) fn adapter_contains_current_protected_dns(adapter: &AdapterDnsSnapshot) -> bool {
    contains_current_protected_v4(adapter.ipv4_name_server.as_deref())
        || contains_current_protected_v4(adapter.ipv4_profile_name_server.as_deref())
}

/// Whether this adapter reads, right now, as pointed at a Tono-owned resolver — the current
/// `198.18.0.2` or a legacy `127.0.0.1` / `::1` left by an older build — in any of the four
/// values.
///
/// One predicate on purpose, shared by the two halves of the snapshot-less restore: the half
/// that *selects* which adapters to reset, and [`engine::any_loopback`], the half that *proves*
/// the reset worked. They were written separately and drifted: the proof was updated when the
/// redirect target moved from loopback to the TUN endpoint, and the selection was not. It kept
/// asking [`is_loopback_value`], which deliberately excludes `198.18.0.2`, so on every machine
/// protected by a current build it selected nothing — and an empty selection proved itself
/// trivially. Asking one question in one place is what stops that from recurring.
/// A mixed IPv4 list is not fully protected, but still contains a Tono-only resolver that
/// will stop answering with the core. Reuse the missing-snapshot containment check rather
/// than mistaking a public fallback for evidence that the redirect has been removed.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn adapter_reads_as_tono_dns(adapter: &AdapterDnsSnapshot) -> bool {
    adapter_contains_current_protected_dns(adapter)
        || is_tono_dns_value(adapter.ipv4_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv4_profile_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv6_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv6_profile_name_server.as_deref())
}

pub(super) fn is_current_tunnel_adapter(
    adapter: &AdapterDnsSnapshot,
    current_tunnel_luid: Option<u64>,
) -> bool {
    current_tunnel_luid.is_some() && adapter.interface_luid == current_tunnel_luid
}

/// Tono's WinTUN adapter is the route *to* the protected resolver, not a Windows resolver client
/// that needs to be redirected. Including it would snapshot our own `198.18.0.2` as a user value,
/// write DNS back onto the tunnel, and make snapshot-less safety checks reject a healthy connect.
///
/// Two identities, because neither alone covers the adapter's whole life. The WFP-validated
/// runtime LUID is the strong one, but it dies with the core: Disconnect stops the core *before*
/// the restore proof runs, so a stale WinTUN adapter left behind by an orphaned core would
/// re-enter the proof and its own `198.18.0.2` would read as "still on loopback" — refused,
/// every time. The connection name is the weaker but core-independent signal that still covers
/// that case. Excluding by name cannot mask a real leak: physical adapters keep their exact
/// per-value snapshot comparison, and a same-named *physical* adapter would require an
/// administrator renaming one to "Tono", which is outside the threat model.
pub(super) fn without_current_tunnel(
    adapters: Vec<AdapterDnsSnapshot>,
    current_tunnel_luid: Option<u64>,
) -> Vec<AdapterDnsSnapshot> {
    adapters
        .into_iter()
        .filter(|adapter| {
            !is_current_tunnel_adapter(adapter, current_tunnel_luid)
                && adapter.connection_name.as_deref() != Some(TUN_ADAPTER_NAME)
        })
        .collect()
}

/// Whether a value is still owned by Tono and may become unreachable when the core stops. This
/// includes the current TUN endpoint and the loopback values written by older builds. Restore
/// proof uses this broader predicate; snapshot logic still uses [`is_loopback_value`] to retain
/// a user's legitimate pre-existing local resolver.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn is_tono_dns_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty()
        && servers.iter().all(|server| {
            server == PROTECTED_DNS_V4 || server == LOOPBACK_V4 || server == LOOPBACK_V6
        })
}

/// Whether a read-back **IPv6** value is the protected state — the question "is this adapter
/// still protected?", which for IPv6 is not the same question as [`is_loopback_value`].
///
/// The protect path writes an empty static list, so an empty value is the protected state and
/// must *not* read as drift: otherwise the watchdog would see every adapter as unprotected on
/// every tick and rewrite the registry forever. A value absent altogether is DHCP — the ISP's
/// resolvers — and is genuinely unprotected. `::1` is accepted so that an upgrade over a build
/// that wrote it does not trigger a pointless machine-wide replay.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
/// Whether an IPv6 name-server value is one we consider protected: an empty list (what the
/// protect path writes) or the `::1` an older build wrote.
///
/// No longer a gate on the protect path — the registry stores "no servers" and "use DHCP"
/// identically, so this can never prove the state it names. Kept because it still documents
/// the intended shape and is asserted by tests; the enable-time verification requires only
/// IPv4 loopback (see `engine::all_loopback`).
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn is_protected_v6_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    parse_name_server_list(value).is_empty() || is_loopback_value(Some(value))
}
