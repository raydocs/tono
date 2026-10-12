//! Build support gate and config / endpoint / intent validation.

use super::*;

/// Whether the facade's state machine runs on this build: the real service on Windows, plus
/// test builds everywhere (the engine is stubbed there, the state machine is what is tested).
pub(super) const SUPPORTED: bool = cfg!(any(windows, test));

pub(super) fn ensure_supported() -> Result<()> {
    if SUPPORTED {
        Ok(())
    } else {
        bail!("Windows kill switch is unsupported on this platform")
    }
}

pub(super) const MAX_PROXY_ENDPOINTS: usize = 256;

pub(super) fn validate_config(config: &KillSwitchConfig) -> Result<()> {
    if config.tunnel_interface.trim().is_empty() {
        bail!("enabled kill switch requires tunnel_interface");
    }
    if config.tunnel_interface.chars().count() > 64 {
        bail!("tunnel_interface is not a plausible interface alias");
    }
    if config.proxy_endpoints.is_empty() {
        bail!("enabled kill switch requires at least one proxy endpoint");
    }
    // Bounded like every other list that feeds the same WFP install (`direct_endpoints`
    // below, API hosts in `wfp_model::sanitize_api_host_ips`, `proxyEndpoints` in the Mac
    // helper). Each entry becomes one ALE filter in a single transaction, and the intent is
    // persisted before that transaction runs, so an unbounded list arms the machine
    // fail-closed with an install that cannot finish and is replayed at every service start.
    // A session carries the selected node plus at most the home route; 256 is the sibling
    // bound and the Mac ceiling (8 hosts x 32 pinned addresses) alike.
    if config.proxy_endpoints.len() > MAX_PROXY_ENDPOINTS {
        bail!("proxy_endpoints exceeds the {MAX_PROXY_ENDPOINTS}-entry bound");
    }
    for endpoint in &config.proxy_endpoints {
        if wfp_model::parse_endpoint(endpoint).is_none() {
            bail!("invalid proxy endpoint {}:{}", endpoint.ip, endpoint.port);
        }
    }
    validate_direct_endpoints(config)
}

/// Cloud-approved DIRECT endpoints (WeChat acceleration), mirroring the Mac helper's
/// `validateSessionDirectEndpoints`: a bounded list of exact public `IP:port` tuples on an
/// approved port — and never one of the permanently protected addresses.
pub(super) fn validate_direct_endpoints(config: &KillSwitchConfig) -> Result<()> {
    const MAX_DIRECT_ENDPOINTS: usize = 256;
    if config.direct_endpoints.len() > MAX_DIRECT_ENDPOINTS {
        bail!("direct_endpoints exceeds the {MAX_DIRECT_ENDPOINTS}-entry bound");
    }
    // permanentlyProtected: a selected node address or the well-known DNS resolvers must
    // never go DIRECT.
    let node_ips = config
        .proxy_endpoints
        .iter()
        .filter_map(|endpoint| wfp_model::parse_endpoint(endpoint).map(|(ip, _, _)| ip))
        .collect::<Vec<_>>();
    for endpoint in &config.direct_endpoints {
        let Some((ip, port, protocol)) = wfp_model::parse_endpoint(endpoint) else {
            bail!("invalid direct endpoint {}:{}", endpoint.ip, endpoint.port);
        };
        let port_ok = match protocol {
            wfp_model::IpProtocol::Tcp => matches!(port, 80 | 443),
            wfp_model::IpProtocol::Udp => matches!(port, 443 | 8000),
            // parse_endpoint only yields Tcp/Udp; anything else is not an approved DIRECT port.
            _ => false,
        };
        if !port_ok {
            bail!("direct endpoint {ip}:{port}/{protocol:?} is not an approved WeChat port");
        }
        let IpAddr::V4(ipv4) = ip else {
            bail!("direct endpoint {ip} must be an IPv4 public-unicast address");
        };
        if !is_public_direct_ipv4(ipv4) {
            bail!("direct endpoint {ip} is not a public-unicast address");
        }
        if ip == IpAddr::from([1, 1, 1, 1]) || ip == IpAddr::from([8, 8, 8, 8]) {
            bail!("direct endpoint {ip} is a permanently protected resolver");
        }
        if node_ips.contains(&ip) {
            bail!("direct endpoint {ip} duplicates a selected node address");
        }
    }
    Ok(())
}

/// A conservative IPv4-only public-unicast gate for physical-interface DIRECT grants.
///
/// The generated outbound is explicitly `ip-version: ipv4`; rejecting every special-use range here
/// keeps loopback, LAN, link-local, carrier-NAT, benchmark, documentation, multicast, and
/// reserved destinations out of WFP even if a malformed cloud document reaches the Service.
pub(super) fn is_public_direct_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !matches!(
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

pub(super) fn intent_is_valid(intent: &IntentRecord) -> bool {
    intent.wanted
        && !intent.tunnel_interface.is_empty()
        // The app-scoped permit is resolved from this path, and the model emits an app-id rule
        // whenever an endpoint permit exists. An empty path would therefore make every install
        // from this record fall back to "block installed, endpoint permit missing" forever; a
        // truncated record is instead an unusable *wanted* intent (emergency block below).
        && !intent.app_path.is_empty()
        && !intent.endpoints.is_empty()
        && intent
            .endpoints
            .iter()
            .all(|endpoint| wfp_model::parse_endpoint(endpoint).is_some())
}

/// The installed Tono app, the only process that calls the control plane (the Service has no
/// HTTP client). Rule C is scoped to this image's app id; Program Files is writable only by
/// administrators, the same trust the core-path allowlist rests on. Empty when the app is not
/// installed there: the bootstrap API channel is then not rendered, which fails closed.
pub(super) fn installed_tono_app_path() -> String {
    #[cfg(all(windows, not(feature = "test")))]
    {
        crate::core::update::program_files()
            .map(|root| root.join("Tono").join("Tono.exe"))
            .ok()
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        String::new()
    }
}
