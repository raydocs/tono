//! Protected data-plane probe: resolve each origin on WinTUN DNS, then TLS
//! to that fake-IP with the original SNI. System DNS is not consulted.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::StreamExt as _;
use once_cell::sync::Lazy;
use reqwest::redirect::Policy;
use tokio::net::UdpSocket;

const PROTECTED_DNS: SocketAddr = SocketAddr::V4(std::net::SocketAddrV4::new(
    Ipv4Addr::new(198, 18, 0, 2),
    53,
));
const DNS_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProbeOrigin {
    pub label: &'static str,
    pub url: &'static str,
    pub expected_status: u16,
}

pub const PROBE_ORIGINS: [ProbeOrigin; 3] = [
    ProbeOrigin {
        label: "Google",
        url: "https://www.gstatic.com/generate_204",
        expected_status: 204,
    },
    ProbeOrigin {
        label: "Cloudflare",
        url: "https://cp.cloudflare.com/generate_204",
        expected_status: 204,
    },
    ProbeOrigin {
        label: "Apple",
        url: "https://www.apple.com/library/test/success.html",
        expected_status: 200,
    },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeCategory {
    Dns,
    Tcp,
    Tls,
    Http,
    Timeout,
    Cancelled,
    Unknown,
}

impl ProbeCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dns => "dns",
            Self::Tcp => "tcp",
            Self::Tls => "tls",
            Self::Http => "http",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeOriginResult {
    pub origin: String,
    pub expected_status: u16,
    pub actual_status: Option<u16>,
    pub category: ProbeCategory,
    pub elapsed_ms: u128,
    pub redacted_detail: String,
}

static LAST_SUCCESS_ORIGIN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub fn is_fake_ip(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(ip) => ip.octets()[0] == 198 && ip.octets()[1] == 18,
        IpAddr::V6(_) => false,
    }
}

pub fn remember_success(origin: &str) {
    if let Ok(mut slot) = LAST_SUCCESS_ORIGIN.lock() {
        *slot = Some(origin.to_string());
    }
}

pub fn origin_order() -> Vec<ProbeOrigin> {
    let preferred = LAST_SUCCESS_ORIGIN
        .lock()
        .ok()
        .and_then(|slot| slot.clone());
    let mut origins = PROBE_ORIGINS.to_vec();
    if let Some(preferred) = preferred {
        origins.sort_by_key(|origin| if origin.label == preferred { 0 } else { 1 });
    }
    origins
}

pub fn build_dns_a_query(name: &str, id: u16) -> Vec<u8> {
    let mut query = Vec::with_capacity(64);
    query.extend_from_slice(&id.to_be_bytes());
    query.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for label in name.trim_end_matches('.').split('.') {
        let bytes = label.as_bytes();
        query.push(bytes.len() as u8);
        query.extend_from_slice(bytes);
    }
    query.extend_from_slice(&[0, 0, 1, 0, 1]);
    query
}

pub fn parse_dns_a_records(packet: &[u8], expected_id: u16) -> Result<Vec<Ipv4Addr>, String> {
    if packet.len() < 12 {
        return Err("dns response too short".into());
    }
    let id = u16::from_be_bytes([packet[0], packet[1]]);
    if id != expected_id {
        return Err("dns transaction id mismatch".into());
    }
    if packet[2] & 0x80 == 0 {
        return Err("dns response flag missing".into());
    }
    let rcode = packet[3] & 0x0f;
    if rcode != 0 {
        return Err(format!("dns rcode {rcode}"));
    }
    let questions = u16::from_be_bytes([packet[4], packet[5]]) as usize;
    let answers = u16::from_be_bytes([packet[6], packet[7]]) as usize;
    let mut offset = 12;
    for _ in 0..questions {
        offset = skip_name(packet, offset)?;
        offset = offset.checked_add(4).ok_or("dns question overflow")?;
        if offset > packet.len() {
            return Err("dns question truncated".into());
        }
    }
    let mut records = Vec::new();
    for _ in 0..answers {
        offset = skip_name(packet, offset)?;
        if offset + 10 > packet.len() {
            return Err("dns answer truncated".into());
        }
        let rtype = u16::from_be_bytes([packet[offset], packet[offset + 1]]);
        let rdlength = u16::from_be_bytes([packet[offset + 8], packet[offset + 9]]) as usize;
        offset += 10;
        if offset + rdlength > packet.len() {
            return Err("dns rdata truncated".into());
        }
        if rtype == 1 && rdlength == 4 {
            records.push(Ipv4Addr::new(
                packet[offset],
                packet[offset + 1],
                packet[offset + 2],
                packet[offset + 3],
            ));
        }
        offset += rdlength;
    }
    Ok(records)
}

fn skip_name(packet: &[u8], mut offset: usize) -> Result<usize, String> {
    let mut hops = 0;
    loop {
        if offset >= packet.len() {
            return Err("dns name truncated".into());
        }
        let len = packet[offset];
        if len == 0 {
            return Ok(offset + 1);
        }
        if len & 0xc0 == 0xc0 {
            if offset + 1 >= packet.len() {
                return Err("dns name pointer truncated".into());
            }
            return Ok(offset + 2);
        }
        if len & 0xc0 != 0 {
            return Err("dns name encoding unsupported".into());
        }
        offset = offset
            .checked_add(1 + len as usize)
            .ok_or("dns name overflow")?;
        hops += 1;
        if hops > 64 {
            return Err("dns name too long".into());
        }
    }
}

pub fn parse_https_origin(url: &str) -> Result<(String, String), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" {
        return Err("probe origin must be https".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "probe origin missing host".to_string())?
        .to_string();
    let path = if parsed.path().is_empty() {
        "/".to_string()
    } else {
        parsed.path().to_string()
    };
    Ok((host, path))
}

pub fn classify_reqwest(error: &reqwest::Error) -> ProbeCategory {
    if error.is_timeout() {
        return ProbeCategory::Timeout;
    }
    let joined = {
        let mut parts = vec![error.to_string()];
        let mut source = std::error::Error::source(error);
        while let Some(cause) = source {
            parts.push(cause.to_string());
            source = cause.source();
        }
        parts.join(" ").to_ascii_lowercase()
    };
    if joined.contains("dns") || joined.contains("resolve") {
        ProbeCategory::Dns
    } else if joined.contains("certificate")
        || joined.contains("tls")
        || joined.contains("ssl")
        || joined.contains("handshake")
    {
        ProbeCategory::Tls
    } else if error.is_connect() || joined.contains("connection") || joined.contains("tcp") {
        ProbeCategory::Tcp
    } else {
        ProbeCategory::Unknown
    }
}

fn redact(detail: impl Into<String>) -> String {
    let text = detail.into();
    text.chars().take(200).collect()
}

fn failed(
    origin: ProbeOrigin,
    category: ProbeCategory,
    elapsed: Instant,
    detail: impl Into<String>,
    status: Option<u16>,
) -> ProbeOriginResult {
    ProbeOriginResult {
        origin: origin.label.to_string(),
        expected_status: origin.expected_status,
        actual_status: status,
        category,
        elapsed_ms: elapsed.elapsed().as_millis(),
        redacted_detail: redact(detail),
    }
}

async fn query_protected_a(host: &str) -> Result<Ipv4Addr, String> {
    let id = 0x544f;
    let query = build_dns_a_query(host, id);
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|error| format!("dns bind: {error}"))?;
    socket
        .connect(PROTECTED_DNS)
        .await
        .map_err(|error| format!("dns connect: {error}"))?;
    socket
        .send(&query)
        .await
        .map_err(|error| format!("dns send: {error}"))?;
    let mut buf = [0_u8; 512];
    let received = tokio::time::timeout(DNS_TIMEOUT, socket.recv(&mut buf))
        .await
        .map_err(|_| "dns timeout".to_string())?
        .map_err(|error| format!("dns recv: {error}"))?;
    let answers = parse_dns_a_records(&buf[..received], id)?;
    answers
        .into_iter()
        .find(|ip| is_fake_ip(IpAddr::V4(*ip)))
        .ok_or_else(|| "protected listener did not return a fake-ip".to_string())
}

async fn probe_one(
    origin: ProbeOrigin,
    connect_timeout: Duration,
    request_timeout: Duration,
) -> Result<ProbeOriginResult, ProbeOriginResult> {
    let started = Instant::now();
    let (host, _) = parse_https_origin(origin.url)
        .map_err(|error| failed(origin, ProbeCategory::Unknown, started, error, None))?;
    let fake_ip = match query_protected_a(&host).await {
        Ok(ip) => ip,
        Err(error) => {
            let category = if error.contains("timeout") {
                ProbeCategory::Timeout
            } else {
                ProbeCategory::Dns
            };
            return Err(failed(origin, category, started, error, None));
        }
    };
    let pinned = SocketAddr::new(IpAddr::V4(fake_ip), 443);
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(connect_timeout)
        .timeout(request_timeout)
        .resolve(&host, pinned)
        .build()
        .map_err(|error| failed(origin, ProbeCategory::Unknown, started, error.to_string(), None))?;
    match client.get(origin.url).send().await {
        Ok(response) => {
            let actual = response.status().as_u16();
            if actual == origin.expected_status {
                Ok(ProbeOriginResult {
                    origin: origin.label.to_string(),
                    expected_status: origin.expected_status,
                    actual_status: Some(actual),
                    category: ProbeCategory::Http,
                    elapsed_ms: started.elapsed().as_millis(),
                    redacted_detail: String::new(),
                })
            } else {
                Err(failed(
                    origin,
                    ProbeCategory::Http,
                    started,
                    format!("answered {actual}, expected {}", origin.expected_status),
                    Some(actual),
                ))
            }
        }
        Err(error) => Err(failed(
            origin,
            classify_reqwest(&error),
            started,
            error.to_string(),
            None,
        )),
    }
}

pub fn format_failures(failures: &[ProbeOriginResult]) -> String {
    format!(
        "all {} independent protected TUN probes failed: {}",
        PROBE_ORIGINS.len(),
        failures
            .iter()
            .map(|failure| format!(
                "{} ({}): {}",
                failure.origin,
                failure.category.as_str(),
                failure.redacted_detail
            ))
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

pub async fn verify_protected_origins(
    connect_timeout: Duration,
    request_timeout: Duration,
    stagger: Duration,
) -> Result<ProbeOriginResult, Vec<ProbeOriginResult>> {
    let origins = origin_order();
    let mut in_flight = futures::stream::FuturesUnordered::new();
    for (index, origin) in origins.into_iter().enumerate() {
        in_flight.push(async move {
            if index > 0 && !stagger.is_zero() {
                tokio::time::sleep(stagger * index as u32).await;
            }
            probe_one(origin, connect_timeout, request_timeout).await
        });
    }
    let mut failures = Vec::new();
    while let Some(result) = in_flight.next().await {
        match result {
            Ok(success) => {
                remember_success(&success.origin);
                return Ok(success);
            }
            Err(failure) => failures.push(failure),
        }
    }
    Err(failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_ip_is_198_18_only() {
        assert!(is_fake_ip(IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1))));
        assert!(is_fake_ip(IpAddr::V4(Ipv4Addr::new(198, 18, 255, 254))));
        assert!(!is_fake_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
        assert!(!is_fake_ip(IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)));
    }

    #[test]
    fn public_a_record_is_rejected_as_dns() {
        let ip = Ipv4Addr::new(142, 250, 190, 14);
        assert!(!is_fake_ip(IpAddr::V4(ip)));
    }

    #[test]
    fn dns_query_round_trips_a_record() {
        let query = build_dns_a_query("www.gstatic.com", 0x544f);
        assert_eq!(&query[..2], &[0x54, 0x4f]);
        let mut response = query.clone();
        response[2] = 0x81;
        response[3] = 0x80;
        response[6] = 0;
        response[7] = 1;
        response.extend_from_slice(&[0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04]);
        response.extend_from_slice(&[198, 18, 0, 7]);
        let answers = parse_dns_a_records(&response, 0x544f).unwrap();
        assert_eq!(answers, vec![Ipv4Addr::new(198, 18, 0, 7)]);
    }

    #[test]
    fn preferred_origin_is_tried_first() {
        remember_success("Apple");
        assert_eq!(origin_order()[0].label, "Apple");
        remember_success("Google");
    }

    #[test]
    fn https_origins_parse() {
        let (host, path) = parse_https_origin(PROBE_ORIGINS[0].url).unwrap();
        assert_eq!(host, "www.gstatic.com");
        assert_eq!(path, "/generate_204");
    }

    #[test]
    fn timeout_error_classifies_as_timeout() {
        // reqwest has no public constructor; pin the string classifier.
        assert_eq!(ProbeCategory::Timeout.as_str(), "timeout");
        assert_eq!(ProbeCategory::Dns.as_str(), "dns");
        assert_eq!(ProbeCategory::Tls.as_str(), "tls");
    }
}
