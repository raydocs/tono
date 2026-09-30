//! Sticky self-heal for the configured exit.
//!
//! Pure decision logic. It does not open sockets and it does not write PF, WFP,
//! TUN, or routes. Callers apply [`NetworkEffect`] as follows:
//!
//! - [`NetworkEffect::Untouched`] and [`NetworkEffect::DialBeforeArm`] never
//!   arm, stop, or release protection. A new dial name is used only while the
//!   barrier is down, before the next tunnel is built.
//! - [`NetworkEffect::FailOpen`] is one request to restore the original network
//!   through the existing explicit release. It is not a reconnect and it is not
//!   a route rewrite between hops.
//! - [`NetworkEffect::HoldClosed`] is allowed only when the user explicitly
//!   enabled a strict kill switch. The reconnect stays on the same node.

use std::collections::BTreeSet;
use std::future::Future;
use std::time::Duration;

use crate::node::{catalog_base_name, is_hy2_catalog_name};

/// How long the preferred exit must stay healthy, and how long a backup must
/// have been in use, before an unarmed connect may return to the preferred node.
pub const HYSTERESIS_MS: u64 = 45_000;

/// Dead TCP preflight. A refused or silent path gives up here, before any
/// tunnel is installed. Overlapped with work that already has to happen; a
/// successful probe is not waited on past this budget.
pub const TCP_FAIL_FAST_MS: u64 = 2_500;

/// Backup probe starts this long after the preferred probe, so a fast
/// preferred path wins without waiting for the alternate.
pub const HAPPY_EYEBALLS_STAGGER_MS: u64 = 250;

/// A remembered probe may skip the next preflight for this long.
pub const PROBE_CACHE_TTL_MS: u64 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Tcp,
    Hy2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureClass {
    Dns,
    Tcp,
    Tls,
    QuicHandshake,
    Auth,
    Other,
}

/// Ordinary is the default. Strict is only an explicit user choice
/// (macOS Kill Switch "Permanent"). Windows has no such toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KillSwitchStance {
    Ordinary,
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialChange {
    Transport,
    Port,
    Sni,
    ResolvedIp,
    /// Same-region pool, different node. The residential identity is not part
    /// of this change.
    SameRegion,
    ReturnPreferred,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub name: String,
    pub region: String,
    pub server: String,
    pub port: u16,
    pub sni: String,
    pub transport: Transport,
    /// Vendor drops inbound UDP (Tokyo). The policy also refuses a ` · hy2`
    /// name whose city is Tokyo, even when this flag is left false.
    pub udp_vendor_blocked: bool,
    pub rtt_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub preferred: String,
    pub dial: String,
    pub residential_id: String,
    pub tried: BTreeSet<String>,
    /// Set when a disarmed connect should use this name. Ignored while armed.
    pub pending_dial: Option<String>,
    pub backup_since_ms: Option<u64>,
    pub preferred_healthy_since_ms: Option<u64>,
    /// True only when a verified barrier is up. An armed-but-unverified
    /// attempt is already released by the existing failure plan, so callers
    /// pass false there and avoid a second release.
    pub protection_armed: bool,
}

impl Session {
    pub fn for_preferred(preferred: impl Into<String>, residential_id: impl Into<String>) -> Self {
        let preferred = preferred.into();
        Self {
            dial: preferred.clone(),
            preferred,
            residential_id: residential_id.into(),
            tried: BTreeSet::new(),
            pending_dial: None,
            backup_since_ms: None,
            preferred_healthy_since_ms: None,
            protection_armed: false,
        }
    }

    /// The configured server changed. Drop the detour; do not touch protection.
    pub fn stick_to_preferred(
        &mut self,
        preferred: impl Into<String>,
        residential_id: impl Into<String>,
    ) {
        let preferred = preferred.into();
        let residential_id = residential_id.into();
        if self.preferred == preferred && self.residential_id == residential_id {
            return;
        }
        *self = Self::for_preferred(preferred, residential_id);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetworkEffect {
    /// No barrier change and no dial change.
    Untouched,
    /// Use `name` on the next connect only while protection is down.
    DialBeforeArm {
        name: String,
        change: DialChange,
        /// The VPS dialer base name moved. The residential hop did not.
        dialer_changed: bool,
    },
    /// Restore the original network once. `remember` is stored for a later
    /// unarmed connect; it must not be dialed while the barrier is still up.
    FailOpen {
        remember: Option<String>,
        dialer_changed: bool,
    },
    /// Explicit strict kill switch: keep the barrier and retry the same node.
    HoldClosed,
}

/// City key used to keep failover inside one region. Matches the Windows
/// catalog ordering tokens (`us` / `jp` / `other`).
pub fn region_key(name: &str) -> String {
    let base = catalog_base_name(name);
    for token in base
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
    {
        if token.eq_ignore_ascii_case("us") {
            return "us".to_string();
        }
        if token.eq_ignore_ascii_case("jp") {
            return "jp".to_string();
        }
    }
    let city = base.split('·').next().unwrap_or(base).trim().to_lowercase();
    match city.as_str() {
        "los angeles" | "salt lake city" | "buffalo" | "new york" | "san jose" | "seattle"
        | "chicago" | "dallas" | "miami" => "us".to_string(),
        "tokyo" | "osaka" => "jp".to_string(),
        _ => "other".to_string(),
    }
}

/// Tokyo hy2 inbound UDP is dropped by the vendor. Never an automatic hop.
pub fn udp_vendor_blocked(name: &str) -> bool {
    if !is_hy2_catalog_name(name) {
        return false;
    }
    let city = catalog_base_name(name)
        .split('·')
        .next()
        .unwrap_or(name)
        .trim();
    city.eq_ignore_ascii_case("tokyo")
}

pub fn classify_failure(text: &str) -> FailureClass {
    let lower = text.to_ascii_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("status code: 403")
        || lower.contains("auth failed")
    {
        return FailureClass::Auth;
    }
    if lower.contains("quic") || lower.contains("hysteria") || lower.contains("handshake timeout") {
        return FailureClass::QuicHandshake;
    }
    if lower.contains("tls") || lower.contains("certificate") || lower.contains("handshake") {
        return FailureClass::Tls;
    }
    if lower.contains("dns") || lower.contains("name resolution") || lower.contains("no such host")
    {
        return FailureClass::Dns;
    }
    if lower.contains("tcp")
        || lower.contains("connection refused")
        || lower.contains("timed out")
        || lower.contains("timeout")
    {
        return FailureClass::Tcp;
    }
    FailureClass::Other
}

pub fn note_health(session: &mut Session, name: &str, ok: bool, now_ms: u64) {
    if name != session.preferred {
        return;
    }
    if ok {
        session.preferred_healthy_since_ms.get_or_insert(now_ms);
    } else {
        session.preferred_healthy_since_ms = None;
    }
}

/// Apply a remembered dial once the barrier is down. No effect while armed.
pub fn note_protection(session: &mut Session, armed_and_verified: bool, now_ms: u64) {
    if session.protection_armed && !armed_and_verified {
        if let Some(next) = session.pending_dial.take() {
            session.dial = next;
            if session.dial != session.preferred {
                session.backup_since_ms.get_or_insert(now_ms);
            }
        }
    }
    session.protection_armed = armed_and_verified;
}

pub fn observe(
    session: &mut Session,
    failure: Option<FailureClass>,
    candidates: &[Candidate],
    stance: KillSwitchStance,
    now_ms: u64,
) -> NetworkEffect {
    if session.preferred.is_empty() {
        return NetworkEffect::Untouched;
    }
    let residential_before = session.residential_id.clone();
    let effect = if let Some(failure) = failure {
        on_failure(session, failure, candidates, stance)
    } else {
        on_quiet(session, candidates, now_ms)
    };
    debug_assert_eq!(session.residential_id, residential_before);
    effect
}

fn on_quiet(session: &mut Session, candidates: &[Candidate], now_ms: u64) -> NetworkEffect {
    if session.protection_armed
        || session.dial == session.preferred
        || !ready_to_return(session, now_ms)
    {
        return NetworkEffect::Untouched;
    }
    if !candidates
        .iter()
        .any(|candidate| candidate.name == session.preferred)
    {
        return NetworkEffect::Untouched;
    }
    session.dial = session.preferred.clone();
    session.tried.clear();
    session.pending_dial = None;
    session.backup_since_ms = None;
    session.preferred_healthy_since_ms = None;
    NetworkEffect::DialBeforeArm {
        name: session.dial.clone(),
        change: DialChange::ReturnPreferred,
        dialer_changed: false,
    }
}

fn on_failure(
    session: &mut Session,
    failure: FailureClass,
    candidates: &[Candidate],
    stance: KillSwitchStance,
) -> NetworkEffect {
    session.tried.insert(session.dial.clone());
    session.preferred_healthy_since_ms = None;
    let next = next_candidate(session, failure, candidates);
    if session.protection_armed {
        session.pending_dial = next.as_ref().map(|(candidate, _)| candidate.name.clone());
        return match stance {
            KillSwitchStance::Strict => NetworkEffect::HoldClosed,
            KillSwitchStance::Ordinary => NetworkEffect::FailOpen {
                remember: session.pending_dial.clone(),
                dialer_changed: next.as_ref().is_some_and(|(candidate, _)| {
                    catalog_base_name(&candidate.name) != catalog_base_name(&session.preferred)
                }),
            },
        };
    }
    let Some((candidate, change)) = next else {
        return NetworkEffect::Untouched;
    };
    let dialer_changed =
        catalog_base_name(&candidate.name) != catalog_base_name(&session.preferred);
    session.dial = candidate.name.clone();
    session.pending_dial = None;
    NetworkEffect::DialBeforeArm {
        name: candidate.name,
        change,
        dialer_changed,
    }
}

fn ready_to_return(session: &Session, now_ms: u64) -> bool {
    let Some(healthy_since) = session.preferred_healthy_since_ms else {
        return false;
    };
    let Some(backup_since) = session.backup_since_ms else {
        return false;
    };
    now_ms.saturating_sub(healthy_since) >= HYSTERESIS_MS
        && now_ms.saturating_sub(backup_since) >= HYSTERESIS_MS
}

fn next_candidate(
    session: &Session,
    failure: FailureClass,
    candidates: &[Candidate],
) -> Option<(Candidate, DialChange)> {
    let dial = candidates
        .iter()
        .find(|candidate| candidate.name == session.dial);
    let region = dial.map(|candidate| candidate.region.clone()).or_else(|| {
        candidates
            .iter()
            .find(|candidate| candidate.name == session.preferred)
            .map(|candidate| candidate.region.clone())
    })?;
    let current = dial.cloned();
    let mut ranked: Vec<(u8, u64, String, Candidate, DialChange)> = candidates
        .iter()
        .filter(|candidate| candidate.region == region)
        .filter(|candidate| !session.tried.contains(&candidate.name))
        .filter(|candidate| !hy2_blocked(candidate))
        .filter_map(|candidate| {
            let (rank, change) = repair_rank(failure, &current, candidate)?;
            Some((
                rank,
                candidate.rtt_ms.unwrap_or(u64::MAX),
                candidate.name.clone(),
                candidate.clone(),
                change,
            ))
        })
        .collect();
    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.cmp(&right.1))
            .then(left.2.cmp(&right.2))
    });
    ranked
        .into_iter()
        .next()
        .map(|(_, _, _, candidate, change)| (candidate, change))
}

fn hy2_blocked(candidate: &Candidate) -> bool {
    candidate.transport == Transport::Hy2
        && (candidate.udp_vendor_blocked || udp_vendor_blocked(&candidate.name))
}

fn repair_rank(
    failure: FailureClass,
    current: &Option<Candidate>,
    candidate: &Candidate,
) -> Option<(u8, DialChange)> {
    let same_base = current
        .as_ref()
        .is_some_and(|item| catalog_base_name(&item.name) == catalog_base_name(&candidate.name));
    if failure == FailureClass::Auth && same_base {
        return None;
    }
    if same_base {
        if let Some(current) = current {
            if current.transport != candidate.transport
                && transport_matches(failure, candidate.transport)
            {
                return Some((0, DialChange::Transport));
            }
            if current.port != candidate.port {
                return Some((1, DialChange::Port));
            }
            if current.sni != candidate.sni {
                return Some((2, DialChange::Sni));
            }
            if current.server != candidate.server {
                return Some((3, DialChange::ResolvedIp));
            }
        }
        return None;
    }
    if candidate.transport == Transport::Hy2 {
        return None;
    }
    Some((4, DialChange::SameRegion))
}

fn transport_matches(failure: FailureClass, transport: Transport) -> bool {
    match failure {
        FailureClass::QuicHandshake => transport == Transport::Tcp,
        FailureClass::Auth => false,
        _ => transport == Transport::Hy2,
    }
}

/// Preferred probe wins when it succeeds inside the budget, even if the backup
/// was faster. A dead preferred path yields the first backup success inside
/// the same budget. Nothing past the budget is a winner.
pub fn pick_raced(preferred: &str, samples: &[ProbeSample], budget_ms: u64) -> Option<String> {
    let preferred_ok = samples
        .iter()
        .find(|sample| sample.name == preferred && sample.ok && sample.elapsed_ms <= budget_ms);
    if preferred_ok.is_some() {
        return Some(preferred.to_string());
    }
    samples
        .iter()
        .filter(|sample| sample.name != preferred && sample.ok && sample.elapsed_ms <= budget_ms)
        .min_by_key(|sample| (sample.elapsed_ms, sample.name.as_str()))
        .map(|sample| sample.name.clone())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeSample {
    pub name: String,
    pub ok: bool,
    pub elapsed_ms: u64,
}

/// Race a preferred attempt against a backup that starts after `stagger`.
/// The first success wins. A successful preferred attempt does not wait out
/// the stagger. Both legs share one deadline.
pub async fn race_sticky<P, B>(
    preferred: P,
    backup: B,
    stagger: Duration,
    budget: Duration,
) -> RaceWinner
where
    P: Future<Output = bool>,
    B: Future<Output = bool>,
{
    fn elapsed_ms(started: std::time::Instant) -> u64 {
        started.elapsed().as_millis() as u64
    }
    let started = std::time::Instant::now();
    let mut preferred = Box::pin(preferred);
    let mut backup = Box::pin(backup);
    let stagger_sleep = tokio::time::sleep(stagger);
    tokio::pin!(stagger_sleep);
    let deadline = tokio::time::sleep(budget);
    tokio::pin!(deadline);

    let preferred_first = tokio::select! {
        biased;
        result = &mut preferred => Some(result),
        _ = &mut stagger_sleep => None,
        _ = &mut deadline => return RaceWinner::None { elapsed_ms: elapsed_ms(started) },
    };
    if preferred_first == Some(true) {
        return RaceWinner::Preferred {
            elapsed_ms: elapsed_ms(started),
        };
    }
    if preferred_first == Some(false) {
        let remaining = budget.saturating_sub(started.elapsed());
        return match tokio::time::timeout(remaining, &mut backup).await {
            Ok(true) => RaceWinner::Backup {
                elapsed_ms: elapsed_ms(started),
            },
            _ => RaceWinner::None {
                elapsed_ms: elapsed_ms(started),
            },
        };
    }

    tokio::select! {
        biased;
        result = &mut preferred => {
            if result {
                RaceWinner::Preferred { elapsed_ms: elapsed_ms(started) }
            } else {
                let remaining = budget.saturating_sub(started.elapsed());
                match tokio::time::timeout(remaining, &mut backup).await {
                    Ok(true) => RaceWinner::Backup { elapsed_ms: elapsed_ms(started) },
                    _ => RaceWinner::None { elapsed_ms: elapsed_ms(started) },
                }
            }
        }
        result = &mut backup => {
            if result {
                RaceWinner::Backup { elapsed_ms: elapsed_ms(started) }
            } else {
                let remaining = budget.saturating_sub(started.elapsed());
                match tokio::time::timeout(remaining, &mut preferred).await {
                    Ok(true) => RaceWinner::Preferred { elapsed_ms: elapsed_ms(started) },
                    _ => RaceWinner::None { elapsed_ms: elapsed_ms(started) },
                }
            }
        }
        _ = &mut deadline => RaceWinner::None { elapsed_ms: elapsed_ms(started) },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceWinner {
    Preferred { elapsed_ms: u64 },
    Backup { elapsed_ms: u64 },
    None { elapsed_ms: u64 },
}

/// Names the connect stages we can account for without a device, and the
/// budget each one is allowed to spend. `after_ms` is the fail-fast budget;
/// it is not a measured Niagara handshake.
pub fn stage_budgets() -> &'static [StageBudget] {
    &STAGE_BUDGETS
}

pub fn serial_budget_ms() -> u64 {
    STAGE_BUDGETS.iter().map(|stage| stage.before_ms).sum()
}

pub fn raced_budget_ms() -> u64 {
    // Config, DNS and the TCP/QUIC preflight share one wait. TUN and route
    // stay in order. TLS is inside the QUIC handshake, not a second wait.
    let parallel = STAGE_BUDGETS
        .iter()
        .filter(|stage| stage.raced)
        .map(|stage| stage.after_ms)
        .max()
        .unwrap_or(0);
    let serial: u64 = STAGE_BUDGETS
        .iter()
        .filter(|stage| !stage.raced)
        .map(|stage| stage.after_ms)
        .sum();
    parallel + serial
}

#[derive(Debug, Clone, Copy)]
pub struct StageBudget {
    pub stage: &'static str,
    pub before_ms: u64,
    pub after_ms: u64,
    pub raced: bool,
}

const STAGE_BUDGETS: [StageBudget; 8] = [
    StageBudget {
        stage: "config-cache",
        before_ms: 0,
        after_ms: 0,
        raced: true,
    },
    StageBudget {
        stage: "dns",
        before_ms: 2_000,
        after_ms: 2_500,
        raced: true,
    },
    StageBudget {
        stage: "tcp-or-quic-preflight",
        before_ms: 5_000,
        after_ms: TCP_FAIL_FAST_MS,
        raced: true,
    },
    StageBudget {
        stage: "tun-setup",
        before_ms: 10_000,
        after_ms: 10_000,
        raced: false,
    },
    StageBudget {
        stage: "route-install",
        before_ms: 8_000,
        after_ms: 8_000,
        raced: false,
    },
    StageBudget {
        stage: "hy2-quic-tls",
        before_ms: 5_000,
        after_ms: 5_000,
        raced: true,
    },
    StageBudget {
        stage: "auth",
        before_ms: 5_000,
        after_ms: 5_000,
        raced: true,
    },
    StageBudget {
        stage: "first-byte",
        before_ms: 12_000,
        after_ms: 12_000,
        raced: false,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        name: &str,
        region: &str,
        transport: Transport,
        port: u16,
        rtt: Option<u64>,
    ) -> Candidate {
        Candidate {
            name: name.to_string(),
            region: region.to_string(),
            server: "203.0.113.10".to_string(),
            port,
            sni: "www.example.com".to_string(),
            transport,
            udp_vendor_blocked: false,
            rtt_ms: rtt,
        }
    }

    fn pool() -> Vec<Candidate> {
        vec![
            candidate("Buffalo · Niagara", "us", Transport::Tcp, 443, Some(180)),
            candidate(
                "Buffalo · Niagara · hy2",
                "us",
                Transport::Hy2,
                443,
                Some(140),
            ),
            candidate("Buffalo · Other", "us", Transport::Tcp, 443, Some(90)),
            candidate("Los Angeles · Harbor", "us", Transport::Tcp, 443, Some(40)),
            candidate("Tokyo · Sakura", "jp", Transport::Tcp, 443, Some(30)),
            candidate("Tokyo · Sakura · hy2", "jp", Transport::Hy2, 443, Some(20)),
        ]
    }

    #[test]
    fn failover_order_retries_the_same_node_before_the_pool() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "socks5:198.51.100.8:1080");
        let effect = observe(
            &mut session,
            Some(FailureClass::Tcp),
            &pool(),
            KillSwitchStance::Ordinary,
            0,
        );
        assert_eq!(effect, NetworkEffect::DialBeforeArm {
            name: "Buffalo · Niagara · hy2".to_string(),
            change: DialChange::Transport,
            dialer_changed: false,
        });
        let effect = observe(
            &mut session,
            Some(FailureClass::QuicHandshake),
            &pool(),
            KillSwitchStance::Ordinary,
            0,
        );
        assert_eq!(effect, NetworkEffect::DialBeforeArm {
            name: "Los Angeles · Harbor".to_string(),
            change: DialChange::SameRegion,
            dialer_changed: true,
        });
        assert_eq!(session.residential_id, "socks5:198.51.100.8:1080");
        assert_ne!(
            catalog_base_name("Buffalo · Other"),
            catalog_base_name("Tokyo · Sakura")
        );
    }

    #[test]
    fn same_node_alternate_port_beats_a_faster_other_node() {
        let mut nodes = pool();
        nodes.push(Candidate {
            name: "Buffalo · Niagara · hy2".to_string(),
            region: "us".to_string(),
            server: "203.0.113.10".to_string(),
            port: 8443,
            sni: "www.example.com".to_string(),
            transport: Transport::Tcp,
            udp_vendor_blocked: false,
            rtt_ms: Some(900),
        });
        // The catalog's real hy2 row is still present. Force the port row to be
        // the only same-base TCP alternate by marking the hy2 row vendor-blocked.
        for node in &mut nodes {
            if node.transport == Transport::Hy2 && node.name == "Buffalo · Niagara · hy2" {
                node.udp_vendor_blocked = true;
            }
        }
        let mut session = Session::for_preferred("Buffalo · Niagara", "socks5:198.51.100.8:1080");
        let effect = observe(
            &mut session,
            Some(FailureClass::Tcp),
            &nodes,
            KillSwitchStance::Ordinary,
            0,
        );
        assert_eq!(effect, NetworkEffect::DialBeforeArm {
            name: "Buffalo · Niagara · hy2".to_string(),
            change: DialChange::Port,
            dialer_changed: false,
        });
        assert_eq!(session.residential_id, "socks5:198.51.100.8:1080");
    }

    #[test]
    fn stick_to_preferred_compares_server_and_residential_identity() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "socks5:198.51.100.8:1080");
        session.dial = "Buffalo · Other".into();
        session.tried.insert("Buffalo · Niagara".into());
        session.stick_to_preferred("Buffalo · Niagara", "socks5:198.51.100.8:1080");
        assert_eq!(session.dial, "Buffalo · Other");
        assert!(session.tried.contains("Buffalo · Niagara"));
        assert_eq!(session.residential_id, "socks5:198.51.100.8:1080");

        session.stick_to_preferred("Buffalo · Niagara", "socks5:198.51.100.9:1080");
        assert_eq!(session.preferred, "Buffalo · Niagara");
        assert_eq!(session.dial, "Buffalo · Niagara");
        assert_eq!(session.residential_id, "socks5:198.51.100.9:1080");
        assert!(session.tried.is_empty());
    }

    #[test]
    fn stickiness_keeps_the_configured_server_without_a_failure() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "none");
        session.dial = "Buffalo · Other".to_string();
        session.backup_since_ms = Some(0);
        let effect = observe(
            &mut session,
            None,
            &pool(),
            KillSwitchStance::Ordinary,
            1_000,
        );
        assert_eq!(effect, NetworkEffect::Untouched);
        assert_eq!(session.preferred, "Buffalo · Niagara");
        assert_eq!(session.dial, "Buffalo · Other");
    }

    #[test]
    fn hysteresis_holds_the_backup_until_both_windows_elapse() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "none");
        session.dial = "Buffalo · Other".to_string();
        session.backup_since_ms = Some(0);
        note_health(&mut session, "Buffalo · Niagara", true, 0);
        let early = observe(
            &mut session,
            None,
            &pool(),
            KillSwitchStance::Ordinary,
            HYSTERESIS_MS - 1,
        );
        assert_eq!(early, NetworkEffect::Untouched);
        let ready = observe(
            &mut session,
            None,
            &pool(),
            KillSwitchStance::Ordinary,
            HYSTERESIS_MS,
        );
        assert_eq!(ready, NetworkEffect::DialBeforeArm {
            name: "Buffalo · Niagara".to_string(),
            change: DialChange::ReturnPreferred,
            dialer_changed: false,
        });
        note_health(&mut session, "Buffalo · Niagara", false, HYSTERESIS_MS + 1);
        session.dial = "Buffalo · Other".to_string();
        session.backup_since_ms = Some(0);
        let flapped = observe(
            &mut session,
            None,
            &pool(),
            KillSwitchStance::Ordinary,
            HYSTERESIS_MS * 3,
        );
        assert_eq!(flapped, NetworkEffect::Untouched);
    }

    #[test]
    fn dead_path_budget_fails_fast_and_ignores_late_samples() {
        assert_eq!(TCP_FAIL_FAST_MS, 2_500);
        let samples = vec![
            ProbeSample {
                name: "preferred".into(),
                ok: false,
                elapsed_ms: 2_500,
            },
            ProbeSample {
                name: "backup".into(),
                ok: true,
                elapsed_ms: 2_501,
            },
            ProbeSample {
                name: "backup-late".into(),
                ok: true,
                elapsed_ms: 9_000,
            },
        ];
        assert_eq!(pick_raced("preferred", &samples, TCP_FAIL_FAST_MS), None);
        let samples = vec![
            ProbeSample {
                name: "preferred".into(),
                ok: true,
                elapsed_ms: 2_000,
            },
            ProbeSample {
                name: "backup".into(),
                ok: true,
                elapsed_ms: 20,
            },
        ];
        assert_eq!(
            pick_raced("preferred", &samples, TCP_FAIL_FAST_MS).as_deref(),
            Some("preferred")
        );
        assert!(raced_budget_ms() < serial_budget_ms());
    }

    #[test]
    fn armed_ordinary_failure_fails_open_without_rotating_under_the_barrier() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "socks5:198.51.100.8:1080");
        session.protection_armed = true;
        let effect = observe(
            &mut session,
            Some(FailureClass::Tls),
            &pool(),
            KillSwitchStance::Ordinary,
            0,
        );
        assert_eq!(effect, NetworkEffect::FailOpen {
            remember: Some("Buffalo · Niagara · hy2".to_string()),
            dialer_changed: false,
        });
        assert_eq!(session.dial, "Buffalo · Niagara");
        assert!(session.protection_armed);
        note_protection(&mut session, false, 10);
        assert_eq!(session.dial, "Buffalo · Niagara · hy2");
        assert!(!session.protection_armed);
    }

    #[test]
    fn armed_strict_failure_holds_the_same_node() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "none");
        session.protection_armed = true;
        let effect = observe(
            &mut session,
            Some(FailureClass::Tcp),
            &pool(),
            KillSwitchStance::Strict,
            0,
        );
        assert_eq!(effect, NetworkEffect::HoldClosed);
        assert_eq!(session.dial, "Buffalo · Niagara");
        let quiet = observe(
            &mut session,
            None,
            &pool(),
            KillSwitchStance::Strict,
            HYSTERESIS_MS * 4,
        );
        assert_eq!(quiet, NetworkEffect::Untouched);
    }

    #[test]
    fn auth_failure_does_not_retry_the_same_credentials() {
        let mut session = Session::for_preferred("Buffalo · Niagara", "none");
        let effect = observe(
            &mut session,
            Some(FailureClass::Auth),
            &pool(),
            KillSwitchStance::Ordinary,
            0,
        );
        match effect {
            NetworkEffect::DialBeforeArm {
                name,
                change,
                dialer_changed,
            } => {
                assert_eq!(name, "Los Angeles · Harbor");
                assert_eq!(change, DialChange::SameRegion);
                assert!(dialer_changed);
                assert_ne!(catalog_base_name(&name), "Buffalo · Niagara");
            }
            other => panic!("expected a different node, got {other:?}"),
        }
    }

    #[test]
    fn failover_stays_in_region_and_never_uses_tokyo_hy2() {
        let mut session = Session::for_preferred("Tokyo · Sakura", "socks5:198.51.100.8:1080");
        let effect = observe(
            &mut session,
            Some(FailureClass::Tcp),
            &pool(),
            KillSwitchStance::Ordinary,
            0,
        );
        assert_eq!(effect, NetworkEffect::Untouched);
        assert!(udp_vendor_blocked("Tokyo · Sakura · hy2"));
        assert_eq!(session.residential_id, "socks5:198.51.100.8:1080");
        assert_eq!(region_key("Buffalo · Niagara"), "us");
        assert_eq!(region_key("Tokyo · Sakura · hy2"), "jp");
    }

    #[tokio::test]
    async fn preferred_success_does_not_wait_for_the_backup_leg() {
        let started = std::time::Instant::now();
        let winner = race_sticky(
            async {
                tokio::time::sleep(Duration::from_millis(30)).await;
                true
            },
            async {
                tokio::time::sleep(Duration::from_millis(400)).await;
                true
            },
            Duration::from_millis(HAPPY_EYEBALLS_STAGGER_MS),
            Duration::from_millis(TCP_FAIL_FAST_MS),
        )
        .await;
        let elapsed = started.elapsed();
        assert!(matches!(winner, RaceWinner::Preferred { .. }));
        assert!(
            elapsed < Duration::from_millis(200),
            "preferred leg took {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn a_dead_preferred_leg_yields_the_backup_without_stacking_timeouts() {
        let started = std::time::Instant::now();
        let winner = race_sticky(
            async {
                tokio::time::sleep(Duration::from_millis(40)).await;
                false
            },
            async {
                tokio::time::sleep(Duration::from_millis(40)).await;
                true
            },
            Duration::from_millis(20),
            Duration::from_millis(300),
        )
        .await;
        let elapsed = started.elapsed();
        assert!(matches!(winner, RaceWinner::Backup { .. }), "{winner:?}");
        assert!(
            elapsed < Duration::from_millis(250),
            "stacked timeouts would be ~340ms, took {elapsed:?}"
        );
    }
}
