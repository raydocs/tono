//! Owned runtime configuration (product-contract.md §5).
//!
//! The runtime is generated locally per connect from validated catalog
//! nodes only — imported YAML is never copied. Every control value is
//! forced; there is no user-facing override. The controller secret is
//! 32 random bytes (base64) per start and exists only in the in-memory
//! runtime copy; [`redact_secret`] produces the disk-safe variant.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_yaml_ng::{Mapping, Value};
use thiserror::Error;

use crate::catalog::CatalogHomeSocks5;
use crate::node::{EXIT_GROUP_NAME, NodeRejection, ValidatedNode, validate_node_set};

pub const MIXED_PORT: u16 = 7890;
pub const EXTERNAL_CONTROLLER: &str = "127.0.0.1:9090";
pub const TUN_DEVICE_NAME: &str = "Tono";
pub const FAKE_IP_RANGE: &str = "198.18.0.1/16";
pub const DNS_LISTEN: &str = "127.0.0.1:53";
/// Names of the physical-interface-bound DIRECT outbounds (present only when
/// the corresponding DirectPlan rules exist).
pub const DIRECT_GROUP_NAME: &str = "Tono-China-Direct";
pub const WEB_DIRECT_GROUP_NAME: &str = "Tono-China-Web-Direct";
/// Reviewed WeChat product executables. Keep this list narrow: WFP remains
/// the exact IP:port security boundary for each generated DIRECT rule.
pub const WECHAT_PROCESS_NAMES: [&str; 9] = [
    "WeChat.exe",
    "Weixin.exe",
    "xwechat.exe",
    "WeChatAppEx.exe",
    "WeChatPlayer.exe",
    "WeixinPlay.exe",
    "WeChatApp.exe",
    "WeixinApp.exe",
    "WeChatBrowser.exe",
];
/// Desktop assistants that should share Claude's residential (or exit) path.
/// Command-line `node.exe` is deliberately absent: it would capture every
/// Node process on the machine.
pub const HOME_PROCESS_NAMES: [&str; 7] = [
    "Claude.exe",
    "claude.exe",
    "Claude Helper.exe",
    "ChatGPT.exe",
    "chatgpt.exe",
    "Codex.exe",
    "codex.exe",
];
/// Windows install-tree fragments whose helpers should share the home (or
/// exit) hop. These are contains-matches, not identity: a mistaken hit still
/// leaves through the tunnel. The AND payload cannot contain `,` or `()`.
/// `claude\versions` covers Claude Code's versioned launcher (`2.1.223`),
/// whose process name is not `claude.exe`.
const HOME_PROCESS_PATH_FRAGMENTS: [&str; 7] = [
    "AnthropicClaude",
    r"claude\versions",
    r".local\share\claude",
    "claude-code",
    r"@anthropic-ai\claude-code",
    "ChatGPT",
    r"openai\codex",
];
/// Signed WeChat install prefixes that may join a DirectPlan. Discovery is
/// bounded so a poisoned registry cannot grow the rule table without limit.
pub const MAX_WECHAT_PROCESS_PATH_REGEXES: usize = 8;
/// Name of the Claude→home-broadband select group, present only when the
/// catalog carries a verified `homeProxy` or `homeSocks5` routing directive.
pub const CLAUDE_HOME_GROUP_NAME: &str = "Tono-Claude-Home";
/// Name of the chained residential SOCKS5 outbound emitted when the catalog
/// carries a verified `homeSocks5` directive. It dials through `Tono-Exit`
/// (`dialer-proxy`), so the chain hop follows the user's node selection and
/// the VPS needs no change.
pub const HOME_SOCKS5_OUTBOUND_NAME: &str = "Tono-Home-Residential";
/// First-party assistant domains pinned to the home-broadband exit when
/// `homeProxy` / `homeSocks5` is in force. These are DOMAIN-SUFFIX rules
/// with no process constraint, so Chrome / Edge / Arc count the same as
/// the desktop apps. `google.com`, `googleapis.com`, and `gstatic.com`
/// stay out: they are shared by Search, YouTube, Gmail, and Tono's own
/// exit probe. Gemini is pinned by its product hostnames instead.
pub const CLAUDE_HOME_DOMAINS: [&str; 28] = [
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "chatgpt.com",
    "openai.com",
    "chat.com",
    "ai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "grok.com",
    "grok.x.com",
    "grokipedia.com",
    "x.ai",
    "perplexity.ai",
    "perplexity.com",
    "pplx.ai",
    "gemini.google.com",
    "bard.google.com",
    "aistudio.google.com",
    "generativelanguage.googleapis.com",
    "notebooklm.google.com",
];
/// Anthropic's own unicast range (ARIN AP-2440 / AS399358). Customer audits
/// only ever show `160.79.104.10:443` as a raw dest, which skips every
/// DOMAIN-SUFFIX pin. The ARIN block is first-party only — unlike `1.1.1.1` /
/// `8.8.8.8`, which Tono itself uses as the exit probe and must stay on
/// `Tono-Exit`. `no-resolve` keeps the match on the packet address.
pub const CLAUDE_HOME_IPV4_CIDRS: [&str; 1] = ["160.79.104.0/21"];
/// Same ASN's advertised IPv6 prefixes. `a-api.anthropic.com` answers
/// `2607:6bc0::10`; a dual-stack client that dials the AAAA by IP would
/// otherwise miss every DOMAIN-SUFFIX pin the same way IPv4 did.
pub const CLAUDE_HOME_IPV6_CIDRS: [&str; 2] = ["2607:6bc0::/48", "2607:6bc0:11::/48"];
/// DoH resolvers pinned through the exit group; the `#Tono-Exit` fragment
/// routes the lookups through the tunnel.
pub const DOH_NAMESERVERS: [&str; 2] = [
    "https://1.1.1.1/dns-query#Tono-Exit",
    "https://8.8.8.8/dns-query#Tono-Exit",
];
/// The only rules the runtime ever carries (§5).
pub const RULES: [&str; 3] = [
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "MATCH,Tono-Exit",
];

/// Why runtime generation failed.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("selected node is not in the catalog: {0}")]
    MissingSelection(String),
    #[error("node set rejected: {0}")]
    Node(#[from] NodeRejection),
    #[error("direct plan rejected: {0}")]
    DirectPlan(String),
    #[error("runtime listener plan rejected: {0}")]
    RuntimePorts(String),
}

/// Per-connection loopback listeners. The App gives the mixed listener an ephemeral port used
/// only for a post-failure cross-check: a request through that listener bypasses WinTUN while
/// still exercising the selected node. It therefore distinguishes node/Core egress failure from
/// a broken Windows TUN data plane without weakening the real TUN connection verdict. The
/// controller must be non-zero because the App needs its exact authenticated endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimePorts {
    pub mixed_port: u16,
    pub controller_port: u16,
}

impl Default for RuntimePorts {
    fn default() -> Self {
        Self {
            mixed_port: MIXED_PORT,
            controller_port: 9090,
        }
    }
}

/// The exact China-DIRECT overlay for one connect. All
/// fields are already policy-validated by the caller; `build_owned_runtime`
/// re-checks the invariants that guard the tunnel (interface shape, no
/// rule targeting the selected node's IP).
///
/// - `hosts`: (domain, pinned IP) pairs rendered into the top-level
///   `hosts:` section (grouped per domain, sorted).
/// - `tcp_wechat_rules`: exact (host, IP, port) tuples for WeChat TCP rules.
/// - `tcp_web_rules`: exact (host, IP, TCP/443) tuples for reviewed web rules.
/// - `web_suffix_rules`: (suffix, TCP port) tuples for suffix-level web
///   direct rules — no pinned IP, TCP only, sorted by (suffix, port).
/// - `udp_wechat_rules`: exact (IP, port) tuples for the WeChat media UDP
///   rules (ports ⊆ {443, 8000}).
/// - `wechat_process_path_regexes`: extra PROCESS-PATH-REGEX rows for signed
///   WeChat install trees. Empty keeps name-only matching. Each pattern is
///   re-checked at build time so a bad payload cannot ship.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectPlan {
    pub physical_interface: String,
    pub hosts: Vec<(String, String)>,
    pub tcp_wechat_rules: Vec<(String, std::net::Ipv4Addr, u16)>,
    pub tcp_web_rules: Vec<(String, std::net::Ipv4Addr, u16)>,
    pub web_suffix_rules: Vec<(String, u16)>,
    pub udp_wechat_rules: Vec<(std::net::Ipv4Addr, u16)>,
    pub wechat_process_path_regexes: Vec<String>,
}

impl DirectPlan {
    /// Accept a Windows interface alias exactly as returned by `MIB_IF_ROW2::Alias`. Aliases are
    /// user-visible Unicode and commonly contain localized text, dots, parentheses, or trademark
    /// characters. The runtime is serialized through `serde_yaml`, so validation needs to reject
    /// control characters and ambiguous surrounding whitespace rather than imposing an ASCII
    /// grammar. The Windows API reserves 257 UTF-16 code units including the terminator.
    pub fn validate_physical_interface(interface: &str) -> Result<(), ConfigError> {
        let reject =
            || ConfigError::DirectPlan(format!("invalid physical interface: {interface:?}"));
        if interface.is_empty()
            || interface.trim() != interface
            || interface.encode_utf16().count() > 256
            || interface.chars().any(char::is_control)
        {
            return Err(reject());
        }
        let lowered = interface.to_lowercase();
        if lowered == "tono" || matches!(lowered.as_str(), "lo" | "lo0" | "loopback") {
            return Err(reject());
        }
        Ok(())
    }
}

/// Whether a PROCESS-PATH-REGEX payload can be embedded in a Mihomo AND rule
/// without changing how that rule parses. Commas split sub-rules and
/// parentheses delimit them; a pattern that contains either is refused.
pub fn is_rule_payload_safe(pattern: &str) -> bool {
    !pattern.is_empty()
        && pattern.len() <= 2_048
        && !pattern.contains([',', '(', ')'])
        && pattern.chars().all(|character| {
            let value = character as u32;
            value >= 0x20 && value != 0x7F && value != 0x85 && value != 0x2028 && value != 0x2029
        })
}

/// Kind of Windows process-path regex to emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsPathRegexKind {
    /// `^prefix` — every executable under a signed WeChat install tree.
    AnchoredPrefix,
    /// `^file$` — one verified portable executable, no directory grant.
    ExactFile,
    /// Unanchored contains-match for a home-assistant folder fragment.
    ContainsFragment,
}

/// Build a Mihomo PROCESS-PATH-REGEX payload from a Windows path or fragment.
///
/// `(?i)` cannot be used: parentheses would break the AND splitter. ASCII
/// letters become `[Xx]` classes instead, and `\` / `/` both match so Mihomo's
/// reported separator cannot miss the rule.
pub fn windows_path_regex(path: &str, kind: WindowsPathRegexKind) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.len() > 1_024 {
        return None;
    }
    let mut pattern = String::new();
    if matches!(
        kind,
        WindowsPathRegexKind::AnchoredPrefix | WindowsPathRegexKind::ExactFile
    ) {
        pattern.push('^');
    }
    for character in trimmed.chars() {
        push_windows_path_regex_char(&mut pattern, character);
    }
    if kind == WindowsPathRegexKind::ExactFile {
        pattern.push('$');
    }
    is_rule_payload_safe(&pattern).then_some(pattern)
}

/// Anchored prefix regex for a signed WeChat install directory. The directory
/// must already end with a separator so helpers under it match and a sibling
/// folder does not.
pub fn wechat_prefix_path_regex(prefix: &str) -> Option<String> {
    let normalized = normalize_windows_prefix(prefix)?;
    windows_path_regex(&normalized, WindowsPathRegexKind::AnchoredPrefix)
}

/// Exact-file regex for a verified portable WeChat executable.
pub fn wechat_file_path_regex(path: &str) -> Option<String> {
    let normalized = normalize_windows_file(path)?;
    windows_path_regex(&normalized, WindowsPathRegexKind::ExactFile)
}

/// Home-assistant folder fragments, already encoded for AND-rule emission.
pub fn home_process_path_regexes() -> Vec<String> {
    HOME_PROCESS_PATH_FRAGMENTS
        .iter()
        .filter_map(|fragment| windows_path_regex(fragment, WindowsPathRegexKind::ContainsFragment))
        .collect()
}

fn normalize_windows_prefix(prefix: &str) -> Option<String> {
    let mut value = prefix.trim().replace('/', "\\");
    if value.is_empty() {
        return None;
    }
    if !value.ends_with('\\') {
        value.push('\\');
    }
    is_windows_path_shape(&value).then_some(value)
}

fn normalize_windows_file(path: &str) -> Option<String> {
    let value = path.trim().replace('/', "\\");
    if value.ends_with('\\') || !is_windows_path_shape(&value) {
        return None;
    }
    Some(value)
}

fn is_windows_path_shape(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\'
        && !path.contains("..")
        && path.chars().all(|character| {
            let value = character as u32;
            value >= 0x20 && value != 0x7F
        })
}

fn push_windows_path_regex_char(pattern: &mut String, character: char) {
    match character {
        '/' | '\\' => pattern.push_str(r"[\\/]"),
        ',' => pattern.push_str(r"\x2c"),
        '(' => pattern.push_str(r"\x28"),
        ')' => pattern.push_str(r"\x29"),
        letter if letter.is_ascii_alphabetic() => {
            pattern.push('[');
            pattern.push(letter.to_ascii_uppercase());
            pattern.push(letter.to_ascii_lowercase());
            pattern.push(']');
        }
        special @ ('.' | '^' | '$' | '*' | '+' | '?' | '{' | '}' | '[' | ']' | '|') => {
            pattern.push('\\');
            pattern.push(special);
        }
        other => pattern.push(other),
    }
}

fn validate_wechat_process_path_regexes(patterns: &[String]) -> Result<(), ConfigError> {
    if patterns.len() > MAX_WECHAT_PROCESS_PATH_REGEXES {
        return Err(ConfigError::DirectPlan(format!(
            "too many WeChat process-path regexes: {}",
            patterns.len()
        )));
    }
    for pattern in patterns {
        if !pattern.starts_with('^') || !is_rule_payload_safe(pattern) {
            return Err(ConfigError::DirectPlan(format!(
                "WeChat process-path regex is not safe to emit: {pattern:?}"
            )));
        }
    }
    Ok(())
}

/// 32 random bytes, base64-encoded — the per-start controller secret (§5).
pub fn generate_controller_secret() -> String {
    STANDARD.encode(rand::random::<[u8; 32]>())
}

/// Build the owned Mihomo runtime (§5). `nodes` must come from catalog
/// admission; `selected` must name one of them and is placed first in the
/// single `Tono-Exit` group. `direct` is the optional WeChat-DIRECT
/// overlay — `None` produces byte-identical output to a plan-less build.
pub fn build_owned_runtime(
    nodes: &[ValidatedNode],
    selected: &str,
    secret: &str,
    direct: Option<&DirectPlan>,
) -> Result<OwnedRuntime, ConfigError> {
    build_owned_runtime_with_ports(nodes, selected, secret, direct, None, None, RuntimePorts::default())
}

/// Build the owned runtime with listeners chosen for this connection generation. This removes
/// the fixed 7890/9090 collision without allowing cloud/user configuration to choose a bind.
///
/// `home_proxy` is the catalog's verified `homeProxy` routing directive: when it names one of
/// `nodes`, Claude processes and the Claude/Anthropic domains exit through a dedicated
/// `Tono-Claude-Home` group holding that node alone, and the node's address joins the TUN
/// route exclusions so Mihomo's second Reality socket stays out of the tunnel. A name not in
/// `nodes` (stale caller) degrades to the unsplit runtime instead of failing the connect.
///
/// `home_socks5` is the catalog's verified `homeSocks5` directive and takes precedence over
/// `home_proxy` (mirroring [`crate::catalog::sanitize_routing`]): the group then holds a
/// chained SOCKS5 outbound that dials the residential upstream through the user's selected
/// node (`dialer-proxy: Tono-Exit`). The upstream stays inside the tunnel, so it joins
/// neither the TUN route exclusions nor the WFP permit set.
pub fn build_owned_runtime_with_ports(
    nodes: &[ValidatedNode],
    selected: &str,
    secret: &str,
    direct: Option<&DirectPlan>,
    home_proxy: Option<&str>,
    home_socks5: Option<&CatalogHomeSocks5>,
    ports: RuntimePorts,
) -> Result<OwnedRuntime, ConfigError> {
    if ports.controller_port == 0 {
        return Err(ConfigError::RuntimePorts(
            "controller port must be non-zero".to_string(),
        ));
    }
    if ports.mixed_port != 0 && ports.mixed_port == ports.controller_port {
        return Err(ConfigError::RuntimePorts(
            "mixed and controller listeners must use different ports".to_string(),
        ));
    }
    validate_node_set(nodes)?;
    let selected = selected.trim();
    let selected_node = nodes
        .iter()
        .find(|node| node.name == selected)
        .ok_or_else(|| ConfigError::MissingSelection(selected.to_string()))?;
    // `home_socks5` wins over `home_proxy`: a catalog home node is ignored
    // while a chained residential upstream is in force.
    let home_node = if home_socks5.is_some() {
        None
    } else {
        home_proxy.and_then(|name| nodes.iter().find(|node| node.name == name))
    };
    let mut route_exclusions = vec![format!("{}/32", selected_node.server)];
    if let Some(home) = home_node
        && home.server != selected_node.server
    {
        route_exclusions.push(format!("{}/32", home.server));
    }

    if let Some(plan) = direct {
        DirectPlan::validate_physical_interface(&plan.physical_interface)?;
        validate_wechat_process_path_regexes(&plan.wechat_process_path_regexes)?;
        // A DIRECT rule that targets the selected node's own IP would pull
        // the tunnel's control socket out of the tunnel.
        let hits_node = plan
            .tcp_wechat_rules
            .iter()
            .chain(plan.tcp_web_rules.iter())
            .any(|(_, ip, _)| *ip == selected_node.server)
            || plan
                .udp_wechat_rules
                .iter()
                .any(|(ip, _)| *ip == selected_node.server);
        if hits_node {
            return Err(ConfigError::DirectPlan(format!(
                "direct rule targets the selected node: {}",
                selected_node.server
            )));
        }
    }

    let yaml = serde_yaml_ng::to_string(&runtime_value(
        nodes,
        selected,
        secret,
        &route_exclusions,
        direct,
        home_node,
        home_socks5,
        ports,
    ))
    .map_err(|err| ConfigError::Node(NodeRejection::Malformed(err.to_string())))?;
    Ok(OwnedRuntime {
        yaml: quote_block_sequence_scalars_with_flow_indicators(&yaml),
    })
}

/// serde_yaml_ng emits PROCESS-PATH-REGEX character classes unquoted
/// (`[Aa][Nn]…`). go-yaml, which Mihomo uses, treats `[` as a flow
/// sequence. Quote those block-sequence scalars so the sidecar loads the
/// rule as one string.
fn quote_block_sequence_scalars_with_flow_indicators(yaml: &str) -> String {
    let mut lines: Vec<String> = yaml
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let Some(scalar) = trimmed.strip_prefix("- ") else {
                return line.to_string();
            };
            if scalar.starts_with('\'') || scalar.starts_with('"') {
                return line.to_string();
            }
            if !(scalar.contains('[') || scalar.contains(']') || scalar.contains('{') || scalar.contains('}'))
            {
                return line.to_string();
            }
            let indent = &line[..line.len() - trimmed.len()];
            let escaped = scalar.replace('\'', "''");
            format!("{indent}- '{escaped}'")
        })
        .collect();
    if yaml.ends_with('\n') {
        lines.push(String::new());
    }
    lines.join("\n")
}

/// A freshly built owned runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedRuntime {
    yaml: String,
}

impl OwnedRuntime {
    /// Full runtime YAML including the controller secret. In-memory only.
    pub fn yaml(&self) -> &str {
        &self.yaml
    }

    /// Disk-safe copy with the controller secret blanked (§5: the secret
    /// exists only in the service-held runtime copy).
    pub fn redacted_yaml(&self) -> String {
        redact_secret(&self.yaml)
    }
}

/// Blank the top-level `secret` key. Returns the input unchanged if it is
/// not a YAML mapping (never the case for [`build_owned_runtime`] output).
pub fn redact_secret(runtime_yaml: &str) -> String {
    let Ok(mut value) = serde_yaml_ng::from_str::<Value>(runtime_yaml) else {
        return runtime_yaml.to_string();
    };
    if let Some(mapping) = value.as_mapping_mut() {
        let key = Value::String("secret".to_string());
        if mapping.contains_key(&key) {
            mapping.insert(key, Value::String(String::new()));
        }
    }
    let yaml = serde_yaml_ng::to_string(&value).unwrap_or_else(|_| runtime_yaml.to_string());
    quote_block_sequence_scalars_with_flow_indicators(&yaml)
}

fn string(value: &str) -> Value {
    Value::String(value.to_string())
}

fn strings(values: &[&str]) -> Value {
    Value::Sequence(values.iter().map(|value| string(value)).collect())
}

fn put(mapping: &mut Mapping, key: &str, value: Value) {
    mapping.insert(string(key), value);
}

fn direct_outbound(name: &str, physical_interface: &str) -> Value {
    let mut outbound = Mapping::new();
    put(&mut outbound, "name", string(name));
    put(&mut outbound, "type", string("direct"));
    put(&mut outbound, "udp", Value::Bool(true));
    // Mihomo v1.19.29 accepts `ipv4`, not `ipv4-only`. Unknown values silently fall back to
    // dual-stack, which would make this security boundary weaker than the IPv4-only rule/WFP
    // plan around it.
    put(&mut outbound, "ip-version", string("ipv4"));
    // Current Mihomo releases remove proxy groups carrying interface-name.
    // The supported form binds the concrete DIRECT outbound instead.
    put(&mut outbound, "interface-name", string(physical_interface));
    Value::Mapping(outbound)
}

fn home_socks5_outbound(socks5: &CatalogHomeSocks5) -> Value {
    let mut outbound = Mapping::new();
    put(&mut outbound, "name", string(HOME_SOCKS5_OUTBOUND_NAME));
    put(&mut outbound, "type", string("socks5"));
    put(&mut outbound, "server", string(&socks5.host));
    put(&mut outbound, "port", Value::Number(socks5.port.into()));
    put(&mut outbound, "username", string(&socks5.username));
    put(&mut outbound, "password", string(&socks5.password));
    // Client-side chaining: the residential upstream is dialed through
    // whatever node the user currently has selected in Tono-Exit, so the
    // chain hop follows a node switch and the VPS needs no change.
    put(&mut outbound, "dialer-proxy", string(EXIT_GROUP_NAME));
    // The Claude rules pointing here are TCP-scoped; the upstream never
    // carries UDP (the UDP REJECT row stays ahead of any fallthrough).
    put(&mut outbound, "udp", Value::Bool(false));
    Value::Mapping(outbound)
}

fn runtime_value(
    nodes: &[ValidatedNode],
    selected: &str,
    secret: &str,
    route_exclusions: &[String],
    direct: Option<&DirectPlan>,
    home: Option<&ValidatedNode>,
    home_socks5: Option<&CatalogHomeSocks5>,
    ports: RuntimePorts,
) -> Value {
    let mut root = Mapping::new();
    // Extra listeners stay disabled (macOS owned-runtime parity); the only
    // ingress is the mixed port below, bound locally.
    put(&mut root, "port", Value::Number(0.into()));
    put(&mut root, "socks-port", Value::Number(0.into()));
    put(&mut root, "redir-port", Value::Number(0.into()));
    put(
        &mut root,
        "mixed-port",
        Value::Number(ports.mixed_port.into()),
    );
    // `allow-lan: false` already limits Mihomo's normal listener scope. Keep the concrete bind as
    // a second, explicit boundary because the diagnostic port is not part of the product API and
    // must never become reachable from another machine after a future Mihomo default changes.
    put(&mut root, "bind-address", string("127.0.0.1"));
    put(&mut root, "allow-lan", Value::Bool(false));
    put(&mut root, "ipv6", Value::Bool(false));
    put(&mut root, "mode", string("rule"));
    put(&mut root, "log-level", string("info"));
    // Without the top-level udp flag Mihomo shortcuts TUN UDP sessions to a
    // ruleless DIRECT dial (QUIC, Discord STUN, …) — the real egress leaks
    // past the tunnel and the MATCH fallback never runs. Every UDP packet
    // must face the rule engine like TCP does.
    put(&mut root, "udp", Value::Bool(true));
    put(&mut root, "unified-delay", Value::Bool(true));
    put(&mut root, "find-process-mode", string("strict"));
    let mut profile = Mapping::new();
    // Never let a stale cache.db choice resurrect an old selection.
    put(&mut profile, "store-selected", Value::Bool(false));
    put(&mut root, "profile", Value::Mapping(profile));
    put(
        &mut root,
        "external-controller",
        string(&format!("127.0.0.1:{}", ports.controller_port)),
    );
    put(&mut root, "secret", string(secret));

    // WeChat-DIRECT: pin resolved domain addresses into `hosts:` so the
    // runtime never depends on a resolver for them (F/Mac Build 28).
    if let Some(plan) = direct
        && !plan.hosts.is_empty()
    {
        let mut grouped: std::collections::BTreeMap<&str, std::collections::BTreeSet<&str>> =
            std::collections::BTreeMap::new();
        for (domain, address) in &plan.hosts {
            grouped
                .entry(domain.as_str())
                .or_default()
                .insert(address.as_str());
        }
        let mut hosts = Mapping::new();
        for (domain, addresses) in grouped {
            hosts.insert(
                Value::String(domain.to_string()),
                Value::Sequence(addresses.iter().map(|address| string(address)).collect()),
            );
        }
        put(&mut root, "hosts", Value::Mapping(hosts));

        // WeChat helpers may dial HTTPDNS results as raw IPs. Recover TLS SNI
        // only for reviewed pinned hosts, without globally replacing destinations.
        let force_domains: Vec<Value> = plan
            .hosts
            .iter()
            .map(|(host, _)| host.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .map(string)
            .collect();
        let mut tls = Mapping::new();
        put(
            &mut tls,
            "ports",
            Value::Sequence(vec![Value::Number(443.into())]),
        );
        let mut sniff = Mapping::new();
        put(&mut sniff, "TLS", Value::Mapping(tls));
        let mut sniffer = Mapping::new();
        put(&mut sniffer, "enable", Value::Bool(true));
        put(&mut sniffer, "parse-pure-ip", Value::Bool(true));
        put(&mut sniffer, "override-destination", Value::Bool(false));
        put(&mut sniffer, "sniff", Value::Mapping(sniff));
        put(&mut sniffer, "force-domain", Value::Sequence(force_domains));
        put(&mut root, "sniffer", Value::Mapping(sniffer));
    }

    let mut dns = Mapping::new();
    put(&mut dns, "enable", Value::Bool(true));
    put(&mut dns, "listen", string(DNS_LISTEN));
    put(&mut dns, "enhanced-mode", string("fake-ip"));
    put(&mut dns, "fake-ip-range", string(FAKE_IP_RANGE));
    put(&mut dns, "respect-rules", Value::Bool(true));
    put(&mut dns, "use-hosts", Value::Bool(true));
    put(&mut dns, "nameserver", strings(&DOH_NAMESERVERS));
    put(
        &mut dns,
        "proxy-server-nameserver",
        strings(&DOH_NAMESERVERS),
    );
    put(&mut root, "dns", Value::Mapping(dns));

    let mut tun = Mapping::new();
    put(&mut tun, "enable", Value::Bool(true));
    put(&mut tun, "stack", string("gvisor"));
    put(&mut tun, "device", string(TUN_DEVICE_NAME));
    put(&mut tun, "auto-route", Value::Bool(true));
    put(&mut tun, "auto-detect-interface", Value::Bool(true));
    put(&mut tun, "strict-route", Value::Bool(true));
    // gVisor ICMP would otherwise attempt a host-direct socket (macOS
    // parity; honored where the core build supports it).
    put(&mut tun, "disable-icmp-forwarding", Value::Bool(true));
    put(&mut tun, "dns-hijack", strings(&["any:53", "tcp://any:53"]));
    // Keeps Mihomo's own Reality sockets out of the tunnel: the selected
    // node's address, plus the home node's when split routing is in force.
    put(
        &mut tun,
        "route-exclude-address",
        Value::Sequence(route_exclusions.iter().map(|ip| string(ip)).collect()),
    );
    put(&mut root, "tun", Value::Mapping(tun));

    let mut proxies: Vec<Value> = nodes
        .iter()
        .map(|node| Value::Mapping(node.to_runtime_mapping()))
        .collect();
    if let Some(socks5) = home_socks5 {
        proxies.push(home_socks5_outbound(socks5));
    }
    if let Some(plan) = direct {
        let has_wechat = !plan.tcp_wechat_rules.is_empty() || !plan.udp_wechat_rules.is_empty();
        let has_web = !plan.tcp_web_rules.is_empty() || !plan.web_suffix_rules.is_empty();
        if has_wechat {
            proxies.push(direct_outbound(DIRECT_GROUP_NAME, &plan.physical_interface));
        }
        if has_web {
            proxies.push(direct_outbound(
                WEB_DIRECT_GROUP_NAME,
                &plan.physical_interface,
            ));
        }
    }
    put(&mut root, "proxies", Value::Sequence(proxies));

    let mut groups: Vec<Value> = Vec::new();
    let mut ordered: Vec<&str> = Vec::with_capacity(nodes.len());
    ordered.push(selected);
    ordered.extend(
        nodes
            .iter()
            .map(|node| node.name.as_str())
            .filter(|name| *name != selected),
    );
    let mut group = Mapping::new();
    put(&mut group, "name", string(EXIT_GROUP_NAME));
    put(&mut group, "type", string("select"));
    put(
        &mut group,
        "proxies",
        Value::Sequence(ordered.iter().map(|name| string(name)).collect()),
    );
    groups.push(Value::Mapping(group));
    if home_socks5.is_some() {
        // Claude split routing via the cloud-assigned residential exit: the
        // dedicated group holds exactly the chained SOCKS5 outbound.
        let mut home_group = Mapping::new();
        put(&mut home_group, "name", string(CLAUDE_HOME_GROUP_NAME));
        put(&mut home_group, "type", string("select"));
        put(
            &mut home_group,
            "proxies",
            Value::Sequence(vec![string(HOME_SOCKS5_OUTBOUND_NAME)]),
        );
        groups.push(Value::Mapping(home_group));
    } else if let Some(home) = home {
        // Claude split routing: a dedicated group holding exactly the bound
        // home-broadband node, so the Claude rules below cannot follow the
        // user's Tono-Exit selection.
        let mut home_group = Mapping::new();
        put(&mut home_group, "name", string(CLAUDE_HOME_GROUP_NAME));
        put(&mut home_group, "type", string("select"));
        put(
            &mut home_group,
            "proxies",
            Value::Sequence(vec![string(&home.name)]),
        );
        groups.push(Value::Mapping(home_group));
    }
    put(&mut root, "proxy-groups", Value::Sequence(groups));

    // Loopback, protected Claude processes, exact DIRECT pins, then MATCH.
    let mut rules: Vec<String> = RULES[..RULES.len() - 1]
        .iter()
        .map(|rule| rule.to_string())
        .collect();
    if home.is_some() || home_socks5.is_some() {
        // TCP-scoped on purpose: these pins sit ahead of the UDP REJECT row,
        // and a network-agnostic Claude pin would swallow UDP into a group
        // that cannot carry it (Vision) — Mihomo's fallback for that is a
        // ruleless DIRECT dial, leaking Claude's UDP to the physical egress.
        // With TCP scope, Claude UDP falls through to REJECT and the app
        // retries over TCP, through the tunnel.
        for process in HOME_PROCESS_NAMES {
            rules.push(format!(
                "AND,((NETWORK,TCP),(PROCESS-NAME,{process})),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for regex in home_process_path_regexes() {
            rules.push(format!(
                "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,{regex})),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        // No PROCESS-NAME here: a Chrome tab to ChatGPT / Claude / Grok /
        // Perplexity / Gemini takes the same residential hop as the apps.
        for domain in CLAUDE_HOME_DOMAINS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,{domain})),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        // Raw Anthropic unicast. Claude Code has dialed this range by IP,
        // which no DOMAIN-SUFFIX can see.
        for cidr in CLAUDE_HOME_IPV4_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for cidr in CLAUDE_HOME_IPV6_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR6,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
    } else if let Some(plan) = direct {
        if !plan.tcp_wechat_rules.is_empty()
            || !plan.tcp_web_rules.is_empty()
            || !plan.web_suffix_rules.is_empty()
            || !plan.udp_wechat_rules.is_empty()
        {
            for process in HOME_PROCESS_NAMES {
                rules.push(format!(
                    "AND,((NETWORK,TCP),(PROCESS-NAME,{process})),Tono-Exit"
                ));
            }
            for regex in home_process_path_regexes() {
                rules.push(format!(
                    "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,{regex})),Tono-Exit"
                ));
            }
        }
    }
    if let Some(plan) = direct {
        // WeChat TCP is process-scoped, not per-domain: the clients dial Tencent's
        // file/CDN transfer endpoints by raw IP (no SNI), so domain pins can never
        // cover file transfer and large sends die hairpinned through the exit node.
        // PROCESS-NAME covers the reviewed product names; PROCESS-PATH-REGEX
        // covers helpers inside a signature-verified install tree. WFP remains
        // the exact IP:port boundary. UDP stays pinned to reviewed media.
        if !plan.tcp_wechat_rules.is_empty() {
            for process in WECHAT_PROCESS_NAMES {
                rules.push(format!(
                    "AND,((NETWORK,TCP),(PROCESS-NAME,{process})),{DIRECT_GROUP_NAME}"
                ));
            }
            for regex in &plan.wechat_process_path_regexes {
                rules.push(format!(
                    "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,{regex})),{DIRECT_GROUP_NAME}"
                ));
            }
        }
        for (address, port) in &plan.udp_wechat_rules {
            for process in WECHAT_PROCESS_NAMES {
                rules.push(format!(
                    "AND,((NETWORK,UDP),(DST-PORT,{port}),(IP-CIDR,{address}/32,no-resolve),(PROCESS-NAME,{process})),{DIRECT_GROUP_NAME}"
                ));
            }
            for regex in &plan.wechat_process_path_regexes {
                rules.push(format!(
                    "AND,((NETWORK,UDP),(DST-PORT,{port}),(IP-CIDR,{address}/32,no-resolve),(PROCESS-PATH-REGEX,{regex})),{DIRECT_GROUP_NAME}"
                ));
            }
        }
        for (host, address, port) in &plan.tcp_web_rules {
            rules.push(format!(
                "AND,((NETWORK,TCP),(DST-PORT,{port}),(DOMAIN,{host}),(IP-CIDR,{address}/32,no-resolve)),{WEB_DIRECT_GROUP_NAME}"
            ));
        }
        // Suffix-level web direct: TCP only, no pinned IP — the resolver
        // answers through the tunnel and only the connection leaves directly.
        for (suffix, port) in &plan.web_suffix_rules {
            rules.push(format!(
                "AND,((NETWORK,TCP),(DST-PORT,{port}),(DOMAIN-SUFFIX,{suffix})),{WEB_DIRECT_GROUP_NAME}"
            ));
        }
    }
    // Every node is VLESS+Vision today, and Vision cannot carry UDP — Mihomo
    // marks the exit group "UDP is not supported" and *falls back to a
    // ruleless DIRECT dial*, leaking the physical egress (QUIC, Discord
    // STUN, …). Reject all non-pinned UDP instead: whitelisted WeChat media
    // already matched its pins above, everything else must fail over to TCP
    // rather than leave the machine. Revisit when nodes speak UoT.
    rules.push("AND,((NETWORK,UDP)),REJECT".to_string());
    rules.push(RULES[RULES.len() - 1].to_string());
    put(
        &mut root,
        "rules",
        Value::Sequence(rules.iter().map(|rule| string(rule)).collect()),
    );
    Value::Mapping(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::admit_node;

    fn node(name: &str, server: &str) -> ValidatedNode {
        let yaml = format!(
            r#"
name: "{name}"
type: vless
server: {server}
port: 443
uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d"
tls: true
sni: "www.microsoft.com"
flow: xtls-rprx-vision
reality-opts:
  public-key: "0123456789abcdef0123456789abcdef0123456789a"
  short-id: "0123456789abcdef"
"#
        );
        admit_node(&serde_yaml_ng::from_str(&yaml).unwrap()).unwrap()
    }

    fn three_nodes() -> Vec<ValidatedNode> {
        vec![
            node("US Reality 01", "8.8.8.8"),
            node("JP Reality 02", "1.1.1.1"),
            node("SG Reality 03", "9.9.9.9"),
        ]
    }

    fn build() -> OwnedRuntime {
        build_owned_runtime(&three_nodes(), "JP Reality 02", "test-secret", None).unwrap()
    }

    fn parsed(runtime: &OwnedRuntime) -> Value {
        serde_yaml_ng::from_str(runtime.yaml()).expect("generated YAML must parse")
    }

    fn get<'a>(value: &'a Value, path: &[&str]) -> &'a Value {
        let mut current = value;
        for key in path {
            current = &current.as_mapping().unwrap()[string(key)];
        }
        current
    }

    #[test]
    fn generated_yaml_parses_back_to_a_map() {
        assert!(parsed(&build()).as_mapping().is_some());
    }

    #[test]
    fn forces_top_level_control_values() {
        let value = parsed(&build());
        assert_eq!(get(&value, &["mixed-port"]).as_i64(), Some(7890));
        assert_eq!(get(&value, &["bind-address"]).as_str(), Some("127.0.0.1"));
        assert_eq!(get(&value, &["allow-lan"]).as_bool(), Some(false));
        assert_eq!(get(&value, &["ipv6"]).as_bool(), Some(false));
        assert_eq!(get(&value, &["mode"]).as_str(), Some("rule"));
        assert_eq!(get(&value, &["log-level"]).as_str(), Some("info"));
        assert_eq!(get(&value, &["unified-delay"]).as_bool(), Some(true));
        assert_eq!(get(&value, &["find-process-mode"]).as_str(), Some("strict"));
        assert_eq!(
            get(&value, &["profile", "store-selected"]).as_bool(),
            Some(false)
        );
        assert_eq!(
            get(&value, &["external-controller"]).as_str(),
            Some("127.0.0.1:9090")
        );
        assert_eq!(get(&value, &["secret"]).as_str(), Some("test-secret"));
        // No leftover listeners.
        for key in ["port", "socks-port", "redir-port"] {
            assert_eq!(get(&value, &[key]).as_i64(), Some(0), "{key}");
        }
    }

    #[test]
    fn per_connection_ports_disable_mixed_listener_and_move_controller() {
        let runtime = build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            None,
            None,
            None,
            RuntimePorts {
                mixed_port: 0,
                controller_port: 41_237,
            },
        )
        .unwrap();
        let value = parsed(&runtime);
        assert_eq!(get(&value, &["mixed-port"]).as_i64(), Some(0));
        assert_eq!(
            get(&value, &["external-controller"]).as_str(),
            Some("127.0.0.1:41237")
        );
    }

    #[test]
    fn rejects_invalid_runtime_listener_plan() {
        for ports in [
            RuntimePorts {
                mixed_port: 0,
                controller_port: 0,
            },
            RuntimePorts {
                mixed_port: 9_090,
                controller_port: 9_090,
            },
        ] {
            assert!(matches!(
                build_owned_runtime_with_ports(
                    &three_nodes(),
                    "JP Reality 02",
                    "test-secret",
                    None,
                    None,
                    None,
                    ports,
                ),
                Err(ConfigError::RuntimePorts(_))
            ));
        }
    }

    #[test]
    fn forces_dns_contract() {
        let value = parsed(&build());
        assert_eq!(get(&value, &["dns", "enable"]).as_bool(), Some(true));
        assert_eq!(
            get(&value, &["dns", "listen"]).as_str(),
            Some("127.0.0.1:53")
        );
        assert_eq!(
            get(&value, &["dns", "enhanced-mode"]).as_str(),
            Some("fake-ip")
        );
        assert_eq!(
            get(&value, &["dns", "fake-ip-range"]).as_str(),
            Some("198.18.0.1/16")
        );
        assert_eq!(get(&value, &["dns", "respect-rules"]).as_bool(), Some(true));
        assert_eq!(get(&value, &["dns", "use-hosts"]).as_bool(), Some(true));
        let expected: Vec<Value> = DOH_NAMESERVERS
            .iter()
            .map(|server| string(server))
            .collect();
        assert_eq!(
            get(&value, &["dns", "nameserver"]).as_sequence().unwrap(),
            &expected
        );
        assert_eq!(
            get(&value, &["dns", "proxy-server-nameserver"])
                .as_sequence()
                .unwrap(),
            &expected
        );
    }

    #[test]
    fn forces_tun_contract_and_route_exclusion() {
        let value = parsed(&build());
        assert_eq!(get(&value, &["tun", "enable"]).as_bool(), Some(true));
        // TUN UDP must reach the rule engine — a ruleless DIRECT dial leaks
        // the physical egress (QUIC/STUN) past the tunnel.
        assert_eq!(get(&value, &["udp"]).as_bool(), Some(true));
        assert_eq!(get(&value, &["tun", "stack"]).as_str(), Some("gvisor"));
        assert_eq!(get(&value, &["tun", "device"]).as_str(), Some("Tono"));
        assert_eq!(get(&value, &["tun", "auto-route"]).as_bool(), Some(true));
        assert_eq!(
            get(&value, &["tun", "auto-detect-interface"]).as_bool(),
            Some(true)
        );
        assert_eq!(get(&value, &["tun", "strict-route"]).as_bool(), Some(true));
        assert_eq!(
            get(&value, &["tun", "dns-hijack"]).as_sequence().unwrap(),
            &vec![string("any:53"), string("tcp://any:53")]
        );
        // Selected node is JP Reality 02 at 1.1.1.1.
        assert_eq!(
            get(&value, &["tun", "route-exclude-address"])
                .as_sequence()
                .unwrap(),
            &vec![string("1.1.1.1/32")]
        );
    }

    #[test]
    fn emits_exactly_one_select_group_with_selected_first() {
        let value = parsed(&build());
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 1, "no DIRECT/fallback group may exist");
        assert_eq!(groups[0][string("name")].as_str(), Some("Tono-Exit"));
        assert_eq!(groups[0][string("type")].as_str(), Some("select"));
        let choices: Vec<&str> = groups[0][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(choices, ["JP Reality 02", "US Reality 01", "SG Reality 03"]);
    }

    #[test]
    fn emits_exactly_the_contract_rules() {
        let value = parsed(&build());
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(
            rules,
            [
                "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
                "IP-CIDR6,::1/128,DIRECT,no-resolve",
                "AND,((NETWORK,UDP)),REJECT",
                "MATCH,Tono-Exit"
            ]
        );
        let raw = build().yaml().to_string();
        assert!(!raw.contains("GEOIP"), "no GEOIP rules may leak in");
    }

    #[test]
    fn serializes_vless_with_servername_and_reality_opts() {
        let value = parsed(&build());
        let proxies = get(&value, &["proxies"]).as_sequence().unwrap();
        assert_eq!(proxies.len(), 3);
        let first = &proxies[0];
        assert_eq!(first[string("type")].as_str(), Some("vless"));
        assert_eq!(
            first[string("servername")].as_str(),
            Some("www.microsoft.com")
        );
        assert!(
            first.get(string("sni")).is_none(),
            "sni alias must not be emitted"
        );
        assert_eq!(first[string("tls")].as_bool(), Some(true));
        assert_eq!(first[string("network")].as_str(), Some("tcp"));
        assert_eq!(first[string("flow")].as_str(), Some("xtls-rprx-vision"));
        assert_eq!(first[string("server")].as_str(), Some("8.8.8.8"));
        assert_eq!(
            first[string("reality-opts")][string("public-key")].as_str(),
            Some("0123456789abcdef0123456789abcdef0123456789a")
        );
        assert_eq!(
            first[string("reality-opts")][string("short-id")].as_str(),
            Some("0123456789abcdef")
        );
    }

    #[test]
    fn rejects_duplicate_and_reserved_names() {
        let mut nodes = three_nodes();
        nodes.push(node("US Reality 01", "1.0.0.1"));
        assert!(matches!(
            build_owned_runtime(&nodes, "US Reality 01", "s", None).unwrap_err(),
            ConfigError::Node(NodeRejection::DuplicateOrReservedName(_))
        ));
        let reserved = vec![node("Tono-Exit", "1.1.1.1")];
        assert_eq!(
            build_owned_runtime(&reserved, "Tono-Exit", "s", None).unwrap_err(),
            ConfigError::Node(NodeRejection::DuplicateOrReservedName(
                "Tono-Exit".to_string()
            ))
        );
        // A forged node named after the Claude home group must be refused
        // before it can capture the split-routing rules.
        let reserved = vec![node("Tono-Claude-Home", "1.1.1.1")];
        assert_eq!(
            build_owned_runtime(&reserved, "Tono-Claude-Home", "s", None).unwrap_err(),
            ConfigError::Node(NodeRejection::DuplicateOrReservedName(
                "Tono-Claude-Home".to_string()
            ))
        );
    }

    #[test]
    fn rejects_missing_selection() {
        assert_eq!(
            build_owned_runtime(&three_nodes(), "No Such Node", "s", None).unwrap_err(),
            ConfigError::MissingSelection("No Such Node".to_string())
        );
        assert!(matches!(
            build_owned_runtime(&[], "anything", "s", None).unwrap_err(),
            ConfigError::MissingSelection(_)
        ));
    }

    #[test]
    fn secret_lives_only_in_the_memory_copy() {
        let runtime =
            build_owned_runtime(&three_nodes(), "US Reality 01", "super-secret-value", None)
                .unwrap();
        assert!(runtime.yaml().contains("super-secret-value"));
        let redacted = runtime.redacted_yaml();
        assert!(!redacted.contains("super-secret-value"));
        // The redacted copy is still valid YAML with a blanked secret.
        let value: Value = serde_yaml_ng::from_str(&redacted).unwrap();
        assert_eq!(get(&value, &["secret"]).as_str(), Some(""));
        // Everything else survives redaction.
        assert_eq!(get(&value, &["mixed-port"]).as_i64(), Some(7890));
    }

    #[test]
    fn redact_secret_handles_garbage_input() {
        assert_eq!(redact_secret("not: [valid"), "not: [valid");
        // A bare scalar parses fine and round-trips unchanged in content.
        assert_eq!(redact_secret("plain scalar").trim(), "plain scalar");
    }

    #[test]
    fn controller_secret_is_32_random_bytes_base64() {
        let first = generate_controller_secret();
        let second = generate_controller_secret();
        assert_ne!(first, second, "secret must be per-start random");
        let decoded = STANDARD.decode(&first).unwrap();
        assert_eq!(decoded.len(), 32);
        assert_eq!(first.len(), 44);
    }

    #[test]
    fn redact_secret_preserves_everything_but_the_secret() {
        let runtime = build();
        let redacted: Value = serde_yaml_ng::from_str(&runtime.redacted_yaml()).unwrap();
        assert_eq!(get(&redacted, &["secret"]).as_str(), Some(""));
        assert_eq!(
            get(&redacted, &["external-controller"]).as_str(),
            Some("127.0.0.1:9090")
        );
        let rules: Vec<&str> = get(&redacted, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(rules, [RULES[0], RULES[1], "AND,((NETWORK,UDP)),REJECT", RULES[2]]);
        assert_eq!(get(&redacted, &["proxies"]).as_sequence().unwrap().len(), 3);
        let groups = get(&redacted, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0][string("name")].as_str(), Some("Tono-Exit"));
        let choices: Vec<&str> = groups[0][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(choices, ["JP Reality 02", "US Reality 01", "SG Reality 03"]);
    }

    // ---- WeChat-DIRECT overlay ----

    fn direct_plan() -> DirectPlan {
        DirectPlan {
            physical_interface: "Ethernet 2".to_string(),
            hosts: vec![
                ("wxs.qq.com".to_string(), "9.0.0.11".to_string()),
                ("qpic.cn".to_string(), "9.0.0.12".to_string()),
                ("wxs.qq.com".to_string(), "9.0.0.10".to_string()),
                ("wxs.qq.com".to_string(), "9.0.0.10".to_string()),
            ],
            tcp_wechat_rules: vec![
                (
                    "wxs.qq.com".to_string(),
                    std::net::Ipv4Addr::new(9, 0, 0, 10),
                    443,
                ),
                (
                    "wxs.qq.com".to_string(),
                    std::net::Ipv4Addr::new(9, 0, 0, 10),
                    80,
                ),
                (
                    "qpic.cn".to_string(),
                    std::net::Ipv4Addr::new(9, 0, 0, 12),
                    443,
                ),
            ],
            tcp_web_rules: vec![(
                "www.bilibili.com".to_string(),
                std::net::Ipv4Addr::new(9, 0, 0, 30),
                443,
            )],
            web_suffix_rules: vec![("baidu.com".to_string(), 80), ("baidu.com".to_string(), 443)],
            udp_wechat_rules: vec![(std::net::Ipv4Addr::new(9, 0, 0, 20), 443)],
            wechat_process_path_regexes: Vec::new(),
        }
    }

    fn expected_home_process_rules(group: &str) -> Vec<String> {
        let mut rules: Vec<String> = HOME_PROCESS_NAMES
            .iter()
            .map(|process| format!("AND,((NETWORK,TCP),(PROCESS-NAME,{process})),{group}"))
            .collect();
        for regex in home_process_path_regexes() {
            rules.push(format!(
                "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,{regex})),{group}"
            ));
        }
        rules
    }

    fn expected_wechat_direct_rules() -> Vec<String> {
        let mut rules: Vec<String> = WECHAT_PROCESS_NAMES
            .iter()
            .map(|process| {
                format!("AND,((NETWORK,TCP),(PROCESS-NAME,{process})),Tono-China-Direct")
            })
            .collect();
        for process in WECHAT_PROCESS_NAMES {
            rules.push(format!(
                "AND,((NETWORK,UDP),(DST-PORT,443),(IP-CIDR,9.0.0.20/32,no-resolve),(PROCESS-NAME,{process})),Tono-China-Direct"
            ));
        }
        rules
    }

    fn expected_home_only_rules() -> Vec<String> {
        let mut rules = vec![
            "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve".to_string(),
            "IP-CIDR6,::1/128,DIRECT,no-resolve".to_string(),
        ];
        rules.extend(expected_home_process_rules(CLAUDE_HOME_GROUP_NAME));
        for domain in CLAUDE_HOME_DOMAINS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,{domain})),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for cidr in CLAUDE_HOME_IPV4_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for cidr in CLAUDE_HOME_IPV6_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR6,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        rules.push("AND,((NETWORK,UDP)),REJECT".to_string());
        rules.push("MATCH,Tono-Exit".to_string());
        rules
    }

    fn expected_home_with_direct_rules() -> Vec<String> {
        let mut rules = vec![
            "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve".to_string(),
            "IP-CIDR6,::1/128,DIRECT,no-resolve".to_string(),
        ];
        rules.extend(expected_home_process_rules(CLAUDE_HOME_GROUP_NAME));
        for domain in CLAUDE_HOME_DOMAINS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,{domain})),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for cidr in CLAUDE_HOME_IPV4_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        for cidr in CLAUDE_HOME_IPV6_CIDRS {
            rules.push(format!(
                "AND,((NETWORK,TCP),(IP-CIDR6,{cidr},no-resolve)),{CLAUDE_HOME_GROUP_NAME}"
            ));
        }
        rules.extend(expected_wechat_direct_rules());
        rules.push("AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN,www.bilibili.com),(IP-CIDR,9.0.0.30/32,no-resolve)),Tono-China-Web-Direct".to_string());
        rules.push("AND,((NETWORK,TCP),(DST-PORT,80),(DOMAIN-SUFFIX,baidu.com)),Tono-China-Web-Direct".to_string());
        rules.push("AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,baidu.com)),Tono-China-Web-Direct".to_string());
        rules.push("AND,((NETWORK,UDP)),REJECT".to_string());
        rules.push("MATCH,Tono-Exit".to_string());
        rules
    }

    #[test]
    fn no_direct_build_is_byte_identical_to_before() {
        let without =
            build_owned_runtime(&three_nodes(), "JP Reality 02", "test-secret", None).unwrap();
        let value = parsed(&without);
        // No direct artifacts at all.
        assert!(value.as_mapping().unwrap().get(string("hosts")).is_none());
        assert!(value.as_mapping().unwrap().get(string("sniffer")).is_none());
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 1);
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(rules, [RULES[0], RULES[1], "AND,((NETWORK,UDP)),REJECT", RULES[2]]);
        let proxies = get(&value, &["proxies"]).as_sequence().unwrap();
        assert_eq!(proxies.len(), 3);
        assert!(
            proxies
                .iter()
                .all(|proxy| proxy[string("type")].as_str() != Some("direct"))
        );
    }

    #[test]
    fn direct_build_renders_hosts_outbounds_and_rules_in_order() {
        let runtime = build_owned_runtime(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            Some(&direct_plan()),
        )
        .unwrap();
        let value = parsed(&runtime);

        // hosts: grouped per domain, pinned addresses only.
        let hosts = get(&value, &["hosts"]);
        let wxs = hosts
            .as_mapping()
            .unwrap()
            .get(string("wxs.qq.com"))
            .unwrap()
            .as_sequence()
            .unwrap();
        assert_eq!(wxs.len(), 2);
        assert_eq!(wxs, &vec![string("9.0.0.10"), string("9.0.0.11")]);
        let qpic = hosts
            .as_mapping()
            .unwrap()
            .get(string("qpic.cn"))
            .unwrap()
            .as_sequence()
            .unwrap();
        assert_eq!(qpic.len(), 1);

        let sniffer = get(&value, &["sniffer"]);
        assert_eq!(sniffer[string("enable")].as_bool(), Some(true));
        assert_eq!(sniffer[string("parse-pure-ip")].as_bool(), Some(true));
        assert_eq!(
            sniffer[string("override-destination")].as_bool(),
            Some(false)
        );
        assert_eq!(
            sniffer[string("sniff")][string("TLS")][string("ports")]
                .as_sequence()
                .unwrap(),
            &vec![Value::Number(443.into())]
        );
        assert_eq!(
            sniffer[string("force-domain")].as_sequence().unwrap(),
            &vec![string("qpic.cn"), string("wxs.qq.com")]
        );

        // Current Mihomo accepts interface binding on concrete proxies, not
        // on proxy groups. Both DIRECT rule targets are concrete outbounds.
        let proxies = get(&value, &["proxies"]).as_sequence().unwrap();
        assert_eq!(proxies.len(), 5);
        let direct = &proxies[3];
        assert_eq!(direct[string("name")].as_str(), Some("Tono-China-Direct"));
        assert_eq!(direct[string("type")].as_str(), Some("direct"));
        assert_eq!(direct[string("udp")].as_bool(), Some(true));
        assert_eq!(direct[string("ip-version")].as_str(), Some("ipv4"));
        assert_eq!(
            direct[string("interface-name")].as_str(),
            Some("Ethernet 2")
        );
        let web_direct = &proxies[4];
        assert_eq!(
            web_direct[string("name")].as_str(),
            Some("Tono-China-Web-Direct")
        );
        assert_eq!(web_direct[string("type")].as_str(), Some("direct"));
        assert_eq!(web_direct[string("ip-version")].as_str(), Some("ipv4"));
        assert_eq!(
            web_direct[string("interface-name")].as_str(),
            Some("Ethernet 2")
        );

        // Tono-Exit remains the only group and still carries the selected
        // Reality node first; no deprecated group interface-name is emitted.
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0][string("name")].as_str(), Some("Tono-Exit"));
        assert!(groups[0].get(string("interface-name")).is_none());

        // Rules: loopback, then TCP pins, then UDP WeChat pins, then MATCH.
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        let mut expected = vec![
            "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve".to_string(),
            "IP-CIDR6,::1/128,DIRECT,no-resolve".to_string(),
        ];
        expected.extend(expected_home_process_rules("Tono-Exit"));
        for process in WECHAT_PROCESS_NAMES {
            expected.push(format!("AND,((NETWORK,TCP),(PROCESS-NAME,{process})),Tono-China-Direct"));
        }
        for process in WECHAT_PROCESS_NAMES {
            expected.push(format!("AND,((NETWORK,UDP),(DST-PORT,443),(IP-CIDR,9.0.0.20/32,no-resolve),(PROCESS-NAME,{process})),Tono-China-Direct"));
        }
        expected.push("AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN,www.bilibili.com),(IP-CIDR,9.0.0.30/32,no-resolve)),Tono-China-Web-Direct".to_string());
        expected.push("AND,((NETWORK,TCP),(DST-PORT,80),(DOMAIN-SUFFIX,baidu.com)),Tono-China-Web-Direct".to_string());
        expected.push("AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,baidu.com)),Tono-China-Web-Direct".to_string());
        expected.push("AND,((NETWORK,UDP)),REJECT".to_string());
        expected.push("MATCH,Tono-Exit".to_string());
        assert_eq!(
            rules,
            expected.iter().map(String::as_str).collect::<Vec<_>>()
        );
        let home_rules = expected_home_process_rules("Tono-Exit");
        assert_eq!(
            &rules[2..2 + home_rules.len()],
            home_rules
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
        // MATCH remains the only fallback.
        assert_eq!(rules.last(), Some(&"MATCH,Tono-Exit"));

        let mut reordered = direct_plan();
        reordered.hosts.reverse();
        let reordered_runtime = build_owned_runtime(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            Some(&reordered),
        )
        .unwrap();
        assert_eq!(runtime.yaml(), reordered_runtime.yaml());
    }

    #[test]
    fn direct_rules_never_target_the_selected_node() {
        let mut plan = direct_plan();
        // JP Reality 02 is 1.1.1.1 in the fixture set; adding it must fail.
        plan.tcp_wechat_rules.push((
            "wxs.qq.com".to_string(),
            std::net::Ipv4Addr::new(1, 1, 1, 1),
            443,
        ));
        assert!(matches!(
            build_owned_runtime(&three_nodes(), "JP Reality 02", "s", Some(&plan)),
            Err(ConfigError::DirectPlan(_))
        ));
        // The same address is fine when it is not the selected node.
        assert!(
            build_owned_runtime(&three_nodes(), "US Reality 01", "s", Some(&plan)).is_ok(),
            "a pin matching an unselected node stays legal"
        );
    }

    #[test]
    fn physical_interface_validation() {
        for good in [
            "Ethernet 2",
            "Wi-Fi",
            "en0",
            "以太网",
            "イーサネット",
            "vEthernet (Default Switch)",
            "Ethernet.Intel®",
            "LAN_1",
            "a",
        ] {
            DirectPlan::validate_physical_interface(good)
                .unwrap_or_else(|err| panic!("{good}: {err}"));
        }
        for bad in [
            "",
            &"x".repeat(257),
            "Tono",
            "tono",
            "lo0",
            "Loopback",
            " Ethernet",
            "Ethernet ",
            "Ethernet\nInjected",
            "Ethernet\0Hidden",
        ] {
            assert!(
                DirectPlan::validate_physical_interface(bad).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn direct_plan_with_empty_collections_keeps_outbounds_groups_and_rules_stable() {
        let plan = DirectPlan {
            physical_interface: "Ethernet".to_string(),
            hosts: Vec::new(),
            tcp_wechat_rules: Vec::new(),
            tcp_web_rules: Vec::new(),
            web_suffix_rules: Vec::new(),
            udp_wechat_rules: Vec::new(),
            wechat_process_path_regexes: Vec::new(),
        };
        let runtime =
            build_owned_runtime(&three_nodes(), "JP Reality 02", "s", Some(&plan)).unwrap();
        let value = parsed(&runtime);
        assert!(value.as_mapping().unwrap().get(string("hosts")).is_none());
        assert!(value.as_mapping().unwrap().get(string("sniffer")).is_none());
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 1, "an empty plan declares no DIRECT group");
        let proxies = get(&value, &["proxies"]).as_sequence().unwrap();
        assert_eq!(
            proxies.len(),
            3,
            "an empty plan declares no DIRECT outbound"
        );
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(rules, [RULES[0], RULES[1], "AND,((NETWORK,UDP)),REJECT", RULES[2]]);
    }

    #[test]
    fn windows_path_regex_is_case_insensitive_and_payload_safe() {
        let prefix = wechat_prefix_path_regex(r"C:\Users\foo\AppData\Local\Tencent\WeChat").unwrap();
        assert!(prefix.starts_with('^'), "{prefix}");
        assert!(is_rule_payload_safe(&prefix), "{prefix}");
        assert!(prefix.contains(r"[\\/]"), "{prefix}");
        assert!(prefix.contains("[Ww][Ee][Cc][Hh][Aa][Tt]"), "{prefix}");
        assert!(!prefix.contains('(') && !prefix.contains(')'), "{prefix}");
        assert_eq!(
            wechat_prefix_path_regex(r"C:/Users/foo/AppData/Local/Tencent/WeChat/").as_deref(),
            Some(prefix.as_str())
        );

        let file = wechat_file_path_regex(r"D:\Apps\WeChat.exe").unwrap();
        assert!(file.starts_with('^') && file.ends_with('$'), "{file}");
        assert!(is_rule_payload_safe(&file), "{file}");
        assert!(file.contains(r"[Ww][Ee][Cc][Hh][Aa][Tt]\.[Ee][Xx][Ee]$"), "{file}");

        assert!(wechat_prefix_path_regex("").is_none());
        assert!(wechat_prefix_path_regex(r"WeChat").is_none());
        assert!(wechat_prefix_path_regex(r"C:\Users\foo\..\Tencent\WeChat").is_none());
        assert!(wechat_file_path_regex(r"C:\Tencent\WeChat\").is_none());
    }

    #[test]
    fn process_path_regex_rules_are_quoted_yaml_scalars() {
        let runtime = build_with_home(Some("US Reality 01"));
        let yaml = runtime.yaml();
        let mut saw_path_regex = false;
        for line in yaml.lines() {
            if !line.contains("PROCESS-PATH-REGEX") {
                continue;
            }
            saw_path_regex = true;
            let trimmed = line.trim_start();
            assert!(
                trimmed.starts_with("- \"")
                    || trimmed.starts_with("- '")
                    || trimmed.contains(": \"")
                    || trimmed.contains(": '"),
                "go-yaml treats an unquoted [ as a flow sequence: {line}"
            );
        }
        assert!(saw_path_regex, "home routing must emit PROCESS-PATH-REGEX rows");
    }

    #[test]
    fn home_domains_cover_reviewed_assistants_without_google_at_large() {
        for required in [
            "openai.com",
            "chatgpt.com",
            "anthropic.com",
            "claude.ai",
            "claude.com",
            "claude.app",
            "claude.site",
            "clau.de",
            "claudestudio.com",
            "claudemcpclient.com",
            "claudemcpcontent.com",
            "claudeusercontent.com",
            "x.ai",
            "grok.com",
            "perplexity.ai",
            "perplexity.com",
            "gemini.google.com",
            "bard.google.com",
            "generativelanguage.googleapis.com",
        ] {
            assert!(
                CLAUDE_HOME_DOMAINS.contains(&required),
                "{required} must leave through the home hop"
            );
        }
        for forbidden in ["google.com", "googleapis.com", "gstatic.com", "youtube.com"] {
            assert!(
                !CLAUDE_HOME_DOMAINS.contains(&forbidden),
                "{forbidden} would pull unrelated traffic onto the home hop"
            );
        }
        assert!(
            CLAUDE_HOME_IPV4_CIDRS.contains(&"160.79.104.0/21"),
            "Anthropic's first-party unicast must ride the home hop by IP"
        );
        for required in ["2607:6bc0::/48", "2607:6bc0:11::/48"] {
            assert!(
                CLAUDE_HOME_IPV6_CIDRS.contains(&required),
                "{required} must ride the home hop by IP"
            );
        }
        for forbidden in ["1.1.1.1/32", "8.8.8.8/32", "8.8.4.4/32", "0.0.0.0/0"] {
            assert!(
                !CLAUDE_HOME_IPV4_CIDRS.contains(&forbidden),
                "{forbidden} is Tono's own probe or a wildcard, not Claude"
            );
        }
    }

    #[test]
    fn claude_home_covers_desktop_helpers_and_versioned_code_launcher() {
        for process in ["Claude.exe", "claude.exe", "Claude Helper.exe"] {
            assert!(
                HOME_PROCESS_NAMES.contains(&process),
                "{process} must share the home hop"
            );
        }
        for fragment in [
            "AnthropicClaude",
            r"claude\versions",
            r".local\share\claude",
            "claude-code",
            r"@anthropic-ai\claude-code",
        ] {
            assert!(
                HOME_PROCESS_PATH_FRAGMENTS.contains(&fragment),
                "{fragment} must share the home hop"
            );
        }
        let regexes = home_process_path_regexes();
        for sample in [
            r"C:\Users\me\AppData\Local\AnthropicClaude\app-1.0.0\Claude.exe",
            r"C:\Users\me\AppData\Local\AnthropicClaude\app-1.0.0\Claude Helper (Renderer).exe",
            r"C:\Users\me\.local\share\claude\versions\2.1.223",
            r"C:\Users\me\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js",
        ] {
            let encoded = windows_path_regex(sample, WindowsPathRegexKind::ContainsFragment)
                .expect(sample);
            assert!(
                regexes.iter().any(|regex| encoded.contains(regex.as_str())),
                "{sample} must match a home path fragment"
            );
        }
    }

    #[test]
    fn home_process_path_regexes_are_payload_safe_contains_matches() {
        let regexes = home_process_path_regexes();
        assert_eq!(regexes.len(), HOME_PROCESS_PATH_FRAGMENTS.len());
        for regex in &regexes {
            assert!(is_rule_payload_safe(regex), "{regex}");
            assert!(!regex.starts_with('^'), "{regex}");
            assert!(!regex.ends_with('$'), "{regex}");
        }
        assert!(
            regexes
                .iter()
                .any(|regex| regex.contains("[Aa][Nn][Tt][Hh][Rr][Oo][Pp][Ii][Cc][Cc][Ll][Aa][Uu][Dd][Ee]"))
        );
    }

    #[test]
    fn signed_wechat_path_regexes_join_the_direct_rules() {
        let mut plan = direct_plan();
        let prefix = wechat_prefix_path_regex(r"C:\Program Files\Tencent\WeChat").unwrap();
        plan.wechat_process_path_regexes = vec![prefix.clone()];
        let runtime =
            build_owned_runtime(&three_nodes(), "JP Reality 02", "test-secret", Some(&plan)).unwrap();
        let parsed_runtime = parsed(&runtime);
        let rules: Vec<&str> = get(&parsed_runtime, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert!(rules.contains(&format!(
            "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,{prefix})),Tono-China-Direct"
        ).as_str()));
        assert!(rules.contains(&format!(
            "AND,((NETWORK,UDP),(DST-PORT,443),(IP-CIDR,9.0.0.20/32,no-resolve),(PROCESS-PATH-REGEX,{prefix})),Tono-China-Direct"
        ).as_str()));
        // Name rules stay so a standard-named helper still matches without discovery.
        assert!(rules.iter().any(|rule| rule.contains("PROCESS-NAME,WeChat.exe")));
    }

    #[test]
    fn unsafe_wechat_path_regexes_are_refused() {
        let mut plan = direct_plan();
        plan.wechat_process_path_regexes = vec!["^C:\\Apps (2)\\WeChat\\".to_string()];
        assert!(matches!(
            build_owned_runtime(&three_nodes(), "JP Reality 02", "s", Some(&plan)),
            Err(ConfigError::DirectPlan(_))
        ));
        plan.wechat_process_path_regexes = vec!["not-anchored".to_string()];
        assert!(matches!(
            build_owned_runtime(&three_nodes(), "JP Reality 02", "s", Some(&plan)),
            Err(ConfigError::DirectPlan(_))
        ));
        plan.wechat_process_path_regexes = (0..=MAX_WECHAT_PROCESS_PATH_REGEXES)
            .map(|index| format!("^C:\\\\WeChat{index}\\\\"))
            .collect();
        assert!(matches!(
            build_owned_runtime(&three_nodes(), "JP Reality 02", "s", Some(&plan)),
            Err(ConfigError::DirectPlan(_))
        ));
    }

    // ---- Claude→home-exit split routing ----

    fn build_with_home(home: Option<&str>) -> OwnedRuntime {
        build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            None,
            home,
            None,
            RuntimePorts::default(),
        )
        .unwrap()
    }

    fn build_with_home_socks5(socks5: Option<&CatalogHomeSocks5>) -> OwnedRuntime {
        build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            None,
            None,
            socks5,
            RuntimePorts::default(),
        )
        .unwrap()
    }

    fn home_socks5() -> CatalogHomeSocks5 {
        CatalogHomeSocks5 {
            host: "resi-gateway.example.com".to_string(),
            port: 11080,
            username: "resi-user".to_string(),
            password: "resi-secret".to_string(),
        }
    }

    #[test]
    fn no_home_build_is_byte_identical_to_the_plain_build() {
        assert_eq!(build_with_home(None).yaml(), build().yaml());
    }

    #[test]
    fn unknown_home_name_degrades_to_the_unsplit_runtime() {
        // A stale caller must never produce a group pointing nowhere, and a
        // control-plane hiccup must not block the whole connect.
        assert_eq!(build_with_home(Some("No Such Node")).yaml(), build().yaml());
    }

    #[test]
    fn home_build_adds_the_dedicated_group_rules_and_route_exclusion() {
        let value = parsed(&build_with_home(Some("US Reality 01")));

        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0][string("name")].as_str(), Some("Tono-Exit"));
        let exit_choices: Vec<&str> = groups[0][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(exit_choices, ["JP Reality 02", "US Reality 01", "SG Reality 03"]);
        assert_eq!(groups[1][string("name")].as_str(), Some("Tono-Claude-Home"));
        assert_eq!(groups[1][string("type")].as_str(), Some("select"));
        let home_choices: Vec<&str> = groups[1][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(home_choices, ["US Reality 01"]);

        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(
            rules,
            expected_home_only_rules()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );

        // Both Reality sockets stay out of the tunnel: selected (1.1.1.1)
        // first, then the home node (8.8.8.8).
        assert_eq!(
            get(&value, &["tun", "route-exclude-address"])
                .as_sequence()
                .unwrap(),
            &vec![string("1.1.1.1/32"), string("8.8.8.8/32")]
        );
    }

    #[test]
    fn home_equal_to_the_selected_node_adds_no_second_route_exclusion() {
        let value = parsed(&build_with_home(Some("JP Reality 02")));
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 2, "the dedicated group still exists");
        assert_eq!(
            get(&value, &["tun", "route-exclude-address"])
                .as_sequence()
                .unwrap(),
            &vec![string("1.1.1.1/32")]
        );
    }

    #[test]
    fn home_build_with_direct_plan_replaces_the_bare_process_pins() {
        let runtime = build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            Some(&direct_plan()),
            Some("US Reality 01"),
            None,
            RuntimePorts::default(),
        )
        .unwrap();
        let value = parsed(&runtime);
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        // The home pins take the bare PROCESS-NAME slot, ahead of the DIRECT
        // pins; no Claude rule may keep targeting Tono-Exit.
        assert_eq!(
            rules,
            expected_home_with_direct_rules()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
    }

    // ---- Claude→residential SOCKS5 split routing ----

    #[test]
    fn no_home_socks5_build_is_byte_identical_to_the_plain_build() {
        assert_eq!(build_with_home_socks5(None).yaml(), build().yaml());
    }

    #[test]
    fn home_socks5_build_adds_the_chained_outbound_group_and_rules() {
        let socks5 = home_socks5();
        let value = parsed(&build_with_home_socks5(Some(&socks5)));

        let proxies = get(&value, &["proxies"]).as_sequence().unwrap();
        assert_eq!(proxies.len(), 4);
        let outbound = &proxies[3];
        assert_eq!(
            outbound[string("name")].as_str(),
            Some(HOME_SOCKS5_OUTBOUND_NAME)
        );
        assert_eq!(outbound[string("type")].as_str(), Some("socks5"));
        assert_eq!(
            outbound[string("server")].as_str(),
            Some("resi-gateway.example.com")
        );
        assert_eq!(outbound[string("port")].as_i64(), Some(11080));
        assert_eq!(outbound[string("username")].as_str(), Some("resi-user"));
        assert_eq!(outbound[string("password")].as_str(), Some("resi-secret"));
        assert_eq!(outbound[string("dialer-proxy")].as_str(), Some("Tono-Exit"));
        assert_eq!(outbound[string("udp")].as_bool(), Some(false));

        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0][string("name")].as_str(), Some("Tono-Exit"));
        // The chained outbound never joins the user's exit choices.
        let exit_choices: Vec<&str> = groups[0][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(exit_choices, ["JP Reality 02", "US Reality 01", "SG Reality 03"]);
        assert_eq!(groups[1][string("name")].as_str(), Some("Tono-Claude-Home"));
        assert_eq!(groups[1][string("type")].as_str(), Some("select"));
        let home_choices: Vec<&str> = groups[1][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(home_choices, [HOME_SOCKS5_OUTBOUND_NAME]);

        // The Claude TCP scope rules are unchanged, still ahead of the UDP
        // REJECT row and the MATCH fallback.
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(
            rules,
            expected_home_only_rules()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );

        // The upstream dials through the tunnel: only the selected node is
        // route-excluded; the socks5 server must NOT appear.
        assert_eq!(
            get(&value, &["tun", "route-exclude-address"])
                .as_sequence()
                .unwrap(),
            &vec![string("1.1.1.1/32")]
        );
    }

    #[test]
    fn home_socks5_takes_precedence_over_home_proxy() {
        let socks5 = home_socks5();
        let runtime = build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            None,
            Some("US Reality 01"),
            Some(&socks5),
            RuntimePorts::default(),
        )
        .unwrap();
        let value = parsed(&runtime);
        let groups = get(&value, &["proxy-groups"]).as_sequence().unwrap();
        let home_choices: Vec<&str> = groups[1][string("proxies")]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert_eq!(home_choices, [HOME_SOCKS5_OUTBOUND_NAME]);
        // The ignored catalog home node (8.8.8.8) earns no route exclusion.
        assert_eq!(
            get(&value, &["tun", "route-exclude-address"])
                .as_sequence()
                .unwrap(),
            &vec![string("1.1.1.1/32")]
        );
    }

    #[test]
    fn home_socks5_build_with_direct_plan_keeps_rule_order() {
        let socks5 = home_socks5();
        let runtime = build_owned_runtime_with_ports(
            &three_nodes(),
            "JP Reality 02",
            "test-secret",
            Some(&direct_plan()),
            None,
            Some(&socks5),
            RuntimePorts::default(),
        )
        .unwrap();
        let value = parsed(&runtime);
        let rules: Vec<&str> = get(&value, &["rules"])
            .as_sequence()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap())
            .collect();
        assert_eq!(
            rules,
            expected_home_with_direct_rules()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
    }

}
