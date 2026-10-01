//! The Service-side shape check for the runtime YAML a caller hands to the SYSTEM core.
//!
//! The App builds this document in `tono-core` (`config::build_owned_runtime_with_ports`), and
//! until now only the App enforced its contract. The Service runs whatever it is given as SYSTEM,
//! so it re-checks the parts that keep the core an owned, loopback-only, tunnel-first runtime.
//! Windows counterpart of the macOS helper's `ownedRuntimeConfigIsSafe`
//! (`tooling/scripts/core-helper/main.swift`): the same kinds of checks, mapped onto the keys
//! Mihomo uses. It is a whitelist of what the App emits, not a full re-derivation of the App's
//! routing plan. It does require the switches that keep packets on that plan: `udp`,
//! `tun.auto-route`, and host-only `route-exclude-address` entries.
use std::net::Ipv4Addr;

use serde_yaml_ng::{Mapping, Value};

/// Top-level keys the App's generator emits. Anything else — `external-ui`, `rule-providers`,
/// `proxy-providers`, `listeners`, `tunnels`, `external-controller-tls`/`-unix`/`-pipe`,
/// `sub-rules`, `experimental` and so on — is refused.
const TOP_LEVEL_KEYS: &[&str] = &[
    "port",
    "socks-port",
    "redir-port",
    "mixed-port",
    "bind-address",
    "allow-lan",
    "ipv6",
    "mode",
    "log-level",
    "udp",
    "unified-delay",
    "tcp-concurrent",
    "find-process-mode",
    "profile",
    "external-controller",
    "secret",
    "hosts",
    "sniffer",
    "dns",
    "tun",
    "proxies",
    "proxy-groups",
    "rules",
];
const DNS_KEYS: &[&str] = &[
    "enable",
    "listen",
    "ipv6",
    "enhanced-mode",
    "fake-ip-range",
    "fake-ip-ttl",
    "prefer-h3",
    "cache-algorithm",
    "respect-rules",
    "use-hosts",
    "nameserver",
    "fallback",
    "fallback-lazy-query",
    "fallback-filter",
    "proxy-server-nameserver",
];
const FALLBACK_FILTER_KEYS: &[&str] = &["geoip"];
const TUN_KEYS: &[&str] = &[
    "enable",
    "stack",
    "device",
    "auto-route",
    "auto-detect-interface",
    "strict-route",
    "disable-icmp-forwarding",
    "dns-hijack",
    "route-exclude-address",
];
const PROFILE_KEYS: &[&str] = &["store-selected"];
const SNIFFER_KEYS: &[&str] = &[
    "enable",
    "parse-pure-ip",
    "override-destination",
    "sniff",
    "force-domain",
];
const PROXY_TYPES: &[&str] = &["vless", "hysteria2", "socks5", "direct"];
/// Keys refused anywhere in the document: user-chosen files, a web UI loaded from disk or the
/// network, disabled certificate verification, and socket marks that step around routing.
/// Compared after `mihomo_key`, so every spelling Mihomo's decoder accepts is refused too.
const FORBIDDEN_KEYS: &[&str] = &[
    "certificate",
    "private-key",
    "ca",
    "ca-str",
    "external-ui",
    "external-ui-url",
    "external-ui-name",
    "skip-cert-verify",
    "routing-mark",
];
const EXIT_GROUP_NAME: &str = "Tono-Exit";
const TUN_DEVICE_NAME: &str = "Tono";
const LOOPBACK_PREFIX: &str = "127.0.0.1:";

/// `Ok` only for a document inside the App's owned-runtime contract; the error names the first
/// clause it broke.
pub(crate) fn ensure_owned_runtime_config_is_safe(yaml: &str) -> Result<(), String> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|error| format!("runtime YAML is invalid: {error}"))?;
    let root = root
        .as_mapping()
        .ok_or("runtime YAML is not a mapping")?;
    only_keys(root, TOP_LEVEL_KEYS, "top level")?;

    for listener in ["port", "socks-port", "redir-port"] {
        if let Some(value) = root.get(listener)
            && value.as_u64() != Some(0)
        {
            return Err(format!("`{listener}` must stay disabled"));
        }
    }
    require(root, "bind-address", |v| v.as_str() == Some("127.0.0.1"))?;
    require(root, "allow-lan", |v| v.as_bool() == Some(false))?;
    require(root, "mode", |v| v.as_str() == Some("rule"))?;
    // Without this flag Mihomo shortcuts TUN UDP to a ruleless physical dial
    // (`tono-core` `config::runtime_value`). The App always emits `true`.
    require(root, "udp", |v| v.as_bool() == Some(true))?;
    require(root, "external-controller", |v| {
        v.as_str().is_some_and(|c| c.starts_with(LOOPBACK_PREFIX))
    })?;
    require(root, "secret", |v| v.as_str().is_some_and(|s| !s.is_empty()))?;

    if let Some(profile) = root.get("profile") {
        let profile = profile.as_mapping().ok_or("`profile` is not a mapping")?;
        only_keys(profile, PROFILE_KEYS, "profile")?;
    }
    if let Some(sniffer) = root.get("sniffer") {
        let sniffer = sniffer.as_mapping().ok_or("`sniffer` is not a mapping")?;
        only_keys(sniffer, SNIFFER_KEYS, "sniffer")?;
    }

    let dns = mapping(root, "dns")?;
    only_keys(dns, DNS_KEYS, "dns")?;
    require(dns, "listen", |v| {
        v.as_str().is_some_and(|l| l.starts_with(LOOPBACK_PREFIX))
    })?;
    ensure_dns_fallback_stays_on_exit_doh(dns)?;

    let tun = mapping(root, "tun")?;
    only_keys(tun, TUN_KEYS, "tun")?;
    require(tun, "enable", |v| v.as_bool() == Some(true))?;
    require(tun, "device", |v| v.as_str() == Some(TUN_DEVICE_NAME))?;
    require(tun, "auto-route", |v| v.as_bool() == Some(true))?;
    require(tun, "strict-route", |v| v.as_bool() == Some(true))?;

    for proxy in sequence(root, "proxies")? {
        let kind = proxy.get("type").and_then(Value::as_str).unwrap_or("");
        if !PROXY_TYPES.contains(&kind) {
            return Err(format!("proxy type `{kind}` is not an owned outbound"));
        }
    }
    ensure_route_exclusions_match_exits(root, tun)?;
    let groups = sequence(root, "proxy-groups")?;
    for group in groups {
        if group.get("type").and_then(Value::as_str) != Some("select") {
            return Err("only select proxy groups are owned".into());
        }
    }
    if !groups
        .iter()
        .any(|group| group.get("name").and_then(Value::as_str) == Some(EXIT_GROUP_NAME))
    {
        return Err(format!("the `{EXIT_GROUP_NAME}` group is missing"));
    }
    let rules = sequence(root, "rules")?;
    if rules.last().and_then(Value::as_str) != Some("MATCH,Tono-Exit") {
        return Err("the final rule must be `MATCH,Tono-Exit`".into());
    }
    if !rules.iter().all(Value::is_string) {
        return Err("every rule must be a string".into());
    }

    no_forbidden_keys(&Value::Mapping(root.clone()))
}

/// `route-exclude-address` is how the core keeps its own exit sockets out of the TUN.
/// The App emits one IPv4 `/32` per VLESS or Hysteria2 server it must dial on the
/// physical NIC (`tono-core` `config::build_owned_runtime_with_ports`). Anything wider,
/// or an address that is not one of those servers, leaves ordinary traffic on the
/// physical NIC while `strict-route` still reads as enabled. Armed WFP then drops that
/// traffic instead of proxying it.
fn ensure_route_exclusions_match_exits(root: &Mapping, tun: &Mapping) -> Result<(), String> {
    let Some(value) = tun.get("route-exclude-address") else {
        return Ok(());
    };
    let entries = value.as_sequence().ok_or("`route-exclude-address` is not a list")?;
    let servers = exit_server_addresses(root)?;
    for entry in entries {
        let text = entry
            .as_str()
            .ok_or("`route-exclude-address` entries must be strings")?;
        let Some((address, prefix)) = text.split_once('/') else {
            return Err(format!(
                "`route-exclude-address` entry `{text}` is not an IPv4 host route"
            ));
        };
        if prefix != "32" {
            return Err(format!("`route-exclude-address` entry `{text}` is not an IPv4 /32"));
        }
        let ip = address.parse::<Ipv4Addr>().map_err(|_| {
            format!("`route-exclude-address` entry `{text}` is not an IPv4 host route")
        })?;
        if !servers.contains(&ip) {
            return Err(format!(
                "`route-exclude-address` entry `{text}` is not an exit server in this runtime"
            ));
        }
    }
    Ok(())
}

fn exit_server_addresses(root: &Mapping) -> Result<Vec<Ipv4Addr>, String> {
    let mut servers = Vec::new();
    for proxy in sequence(root, "proxies")? {
        let kind = proxy.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "vless" && kind != "hysteria2" {
            continue;
        }
        let server = proxy
            .get("server")
            .and_then(Value::as_str)
            .ok_or("an exit proxy is missing its server")?;
        let ip = server
            .parse::<Ipv4Addr>()
            .map_err(|_| format!("exit server `{server}` is not an IPv4 address"))?;
        if !servers.contains(&ip) {
            servers.push(ip);
        }
    }
    Ok(servers)
}

/// A backup resolver is allowed only as exit-pinned DoH, and only in lazy
/// mode. Plaintext, or a racing fallback, would resolve beside the tunnel.
fn ensure_dns_fallback_stays_on_exit_doh(dns: &Mapping) -> Result<(), String> {
    if let Some(fallback) = dns.get("fallback") {
        let entries = fallback
            .as_sequence()
            .ok_or("`fallback` is not a list")?;
        for entry in entries {
            let text = entry
                .as_str()
                .ok_or("`fallback` entries must be strings")?;
            if !text.starts_with("https://") || !text.ends_with("#Tono-Exit") {
                return Err(format!(
                    "`fallback` entry `{text}` is not an exit DoH server"
                ));
            }
        }
    }
    if let Some(lazy) = dns.get("fallback-lazy-query")
        && lazy.as_bool() != Some(true)
    {
        return Err("`fallback-lazy-query` must stay enabled".into());
    }
    // Mihomo's default filter is GeoIP CN. With a `fallback` it loads Country.mmdb while
    // parsing; the SYSTEM core would download it off-tunnel or refuse to start.
    match dns.get("fallback-filter") {
        Some(filter) => {
            let filter = filter
                .as_mapping()
                .ok_or("`fallback-filter` is not a mapping")?;
            only_keys(filter, FALLBACK_FILTER_KEYS, "dns.fallback-filter")?;
            require(filter, "geoip", |v| v.as_bool() == Some(false))?;
        }
        None if dns.get("fallback").is_some() => {
            return Err("`fallback` requires `fallback-filter.geoip: false`".into());
        }
        None => {}
    }
    Ok(())
}

fn only_keys(mapping: &Mapping, allowed: &[&str], section: &str) -> Result<(), String> {
    for key in mapping.keys() {
        let key = key.as_str().unwrap_or("<non-string>");
        if !allowed.contains(&key) {
            return Err(format!("`{key}` is not allowed in {section}"));
        }
    }
    Ok(())
}

fn require(mapping: &Mapping, key: &str, accept: impl Fn(&Value) -> bool) -> Result<(), String> {
    match mapping.get(key) {
        Some(value) if accept(value) => Ok(()),
        _ => Err(format!("`{key}` is missing or outside the owned runtime")),
    }
}

fn mapping<'a>(root: &'a Mapping, key: &str) -> Result<&'a Mapping, String> {
    root.get(key)
        .and_then(Value::as_mapping)
        .ok_or_else(|| format!("`{key}` is missing or not a mapping"))
}

fn sequence<'a>(root: &'a Mapping, key: &str) -> Result<&'a Vec<Value>, String> {
    root.get(key)
        .and_then(Value::as_sequence)
        .ok_or_else(|| format!("`{key}` is missing or not a list"))
}

fn no_forbidden_keys(value: &Value) -> Result<(), String> {
    match value {
        Value::Mapping(mapping) => {
            for (key, child) in mapping {
                if let Some(key) = key.as_str()
                    && FORBIDDEN_KEYS.contains(&mihomo_key(key).as_str())
                {
                    return Err(format!("`{key}` is not allowed in the owned runtime"));
                }
                no_forbidden_keys(child)?;
            }
            Ok(())
        }
        Value::Sequence(items) => items.iter().try_for_each(no_forbidden_keys),
        Value::Tagged(tagged) => no_forbidden_keys(&tagged.value),
        _ => Ok(()),
    }
}

/// The spelling Mihomo's struct decoder resolves a key to when no field matches it exactly:
/// `_` is replaced with `-` (`DefaultKeyReplacer`) and the result is compared with Go's
/// `strings.EqualFold`. Simple case folding maps only two non-ASCII characters onto ASCII
/// letters (U+017F long s and U+212A Kelvin sign), so folding those plus ASCII lowercasing
/// matches every key EqualFold would equate with an ASCII field name.
fn mihomo_key(key: &str) -> String {
    key.chars()
        .map(|c| match c {
            '_' => '-',
            '\u{017F}' => 's',
            '\u{212A}' => 'k',
            c => c.to_ascii_lowercase(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::ensure_owned_runtime_config_is_safe;

    /// Shape of `tono-core`'s owned runtime (one Reality node, no DIRECT overlay).
    const OWNED: &str = r#"
port: 0
socks-port: 0
redir-port: 0
mixed-port: 28990
bind-address: 127.0.0.1
allow-lan: false
ipv6: false
mode: rule
log-level: warning
udp: true
unified-delay: true
find-process-mode: always
profile:
  store-selected: false
external-controller: 127.0.0.1:9090
secret: runtime-secret
dns:
  enable: true
  listen: 127.0.0.1:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  use-hosts: true
  nameserver:
  - https://1.1.1.1/dns-query#Tono-Exit
  proxy-server-nameserver:
  - https://1.1.1.1/dns-query#Tono-Exit
tun:
  enable: true
  stack: gvisor
  device: Tono
  auto-route: true
  auto-detect-interface: true
  strict-route: true
  disable-icmp-forwarding: true
  dns-hijack:
  - any:53
  route-exclude-address:
  - 203.0.113.10/32
proxies:
- name: JP Reality 02
  server: 203.0.113.10
  port: 443
  type: vless
  uuid: 9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d
  tls: true
  servername: www.microsoft.com
  network: tcp
  reality-opts:
    public-key: 0123456789abcdef0123456789abcdef0123456789a
    short-id: 0123456789abcdef
proxy-groups:
- name: Tono-Exit
  type: select
  proxies:
  - JP Reality 02
rules:
- IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
- MATCH,Tono-Exit
"#;

    #[test]
    fn the_service_refuses_runtime_yaml_outside_the_owned_contract() {
        assert_eq!(ensure_owned_runtime_config_is_safe(OWNED), Ok(()));
        let with_dial_defaults = OWNED.replacen(
            "unified-delay: true\n",
            "unified-delay: true\ntcp-concurrent: true\n",
            1,
        ).replacen(
            "  enable: true\n  listen:",
            "  enable: true\n  ipv6: false\n  listen:",
            1,
        ).replacen(
            "  fake-ip-range: 198.18.0.1/16\n",
            "  fake-ip-range: 198.18.0.1/16\n  fake-ip-ttl: 30\n  prefer-h3: false\n  cache-algorithm: lru\n",
            1,
        );
        assert_ne!(with_dial_defaults, OWNED);
        assert_eq!(ensure_owned_runtime_config_is_safe(&with_dial_defaults), Ok(()));
        for (from, to) in [
            ("external-controller: 127.0.0.1:9090", "external-controller: 0.0.0.0:9090"),
            ("  network: tcp", "  network: tcp\n  skip-cert-verify: true"),
            ("  network: tcp", "  network: tcp\n  Skip_Cert_Verify: true"),
            ("- MATCH,Tono-Exit", "- MATCH,DIRECT"),
        ] {
            let changed = OWNED.replacen(from, to, 1);
            assert_ne!(changed, OWNED, "fixture edit `{from}` did not apply");
            assert!(
                ensure_owned_runtime_config_is_safe(&changed).is_err(),
                "accepted `{to}`"
            );
        }
    }

    #[test]
    fn the_service_refuses_a_plaintext_dns_fallback() {
        let lazy = OWNED.replacen(
            "  nameserver:\n  - https://1.1.1.1/dns-query#Tono-Exit\n",
            "  nameserver:\n  - https://1.1.1.1/dns-query#Tono-Exit\n  fallback:\n  - https://8.8.8.8/dns-query#Tono-Exit\n  fallback-lazy-query: true\n  fallback-filter:\n    geoip: false\n",
            1,
        );
        assert_ne!(lazy, OWNED);
        assert_eq!(ensure_owned_runtime_config_is_safe(&lazy), Ok(()));
        let geoip_default = lazy.replacen("  fallback-filter:\n    geoip: false\n", "", 1);
        assert!(
            ensure_owned_runtime_config_is_safe(&geoip_default).is_err(),
            "the default GeoIP filter makes the SYSTEM core fetch an MMDB before the tunnel"
        );
        let plaintext = lazy.replacen(
            "  - https://8.8.8.8/dns-query#Tono-Exit\n",
            "  - 8.8.8.8\n",
            1,
        );
        assert!(ensure_owned_runtime_config_is_safe(&plaintext).is_err());
        let racing = lazy.replacen("fallback-lazy-query: true", "fallback-lazy-query: false", 1);
        assert!(ensure_owned_runtime_config_is_safe(&racing).is_err());
    }

    #[test]
    fn the_service_refuses_a_runtime_that_leaves_traffic_off_the_tunnel() {
        assert_eq!(ensure_owned_runtime_config_is_safe(OWNED), Ok(()));
        for (from, to) in [
            ("udp: true", "udp: false"),
            ("auto-route: true", "auto-route: false"),
            ("- 203.0.113.10/32", "- 0.0.0.0/0"),
            ("- 203.0.113.10/32", "- 203.0.113.10/24"),
            ("- 203.0.113.10/32", "- 198.51.100.20/32"),
        ] {
            let changed = OWNED.replacen(from, to, 1);
            assert_ne!(changed, OWNED, "fixture edit `{from}` did not apply");
            assert!(
                ensure_owned_runtime_config_is_safe(&changed).is_err(),
                "accepted `{to}`"
            );
        }
    }
}
