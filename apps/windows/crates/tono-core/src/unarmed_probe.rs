//! TCP proofs and backoff after a fail-open release.
//!
//! Whether to release is [`crate::customer_failure::disposition_after_exhausted_failure`].
//! This module does not install a tunnel, a WFP filter, or a PF anchor, and it
//! does not describe doing so. A reconnect is allowed only after one TCP proof
//! succeeds. Hysteria2 is not a TCP proof.

use std::collections::BTreeSet;

use crate::customer_failure::{self, NetworkDisposition};

/// How long a successful TCP proof may skip another wait on the success path.
pub const PROOF_TTL_MS: u64 = 60_000;

/// One TCP connect budget. A miss does not arm protection.
pub const TCP_PROOF_MS: u64 = 2_500;

/// Capped gaps between unarmed rounds. The last value repeats; the loop does not stop.
pub const BACKOFF_MS: [u64; 6] = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];

const MAX_PROBES_PER_ROUND: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeTarget {
    pub name: String,
    pub region: String,
    /// `ip:port`. Memory only; callers do not log it.
    pub endpoint: String,
    /// False for Hysteria2. Those rows are never a background TCP proof.
    pub tcp: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Wait { until_ms: u64 },
    Probe { names: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    attempt: u32,
    next_due_ms: u64,
    down: BTreeSet<String>,
}

impl Schedule {
    pub fn begin(now_ms: u64) -> Self {
        Self {
            attempt: 0,
            next_due_ms: now_ms,
            down: BTreeSet::new(),
        }
    }

    pub fn note_down(&mut self, name: &str) {
        self.down.insert(name.to_string());
    }

    /// A proof succeeded. The caller may dial `name` only while protection is down.
    /// TCP reachability does not reset the full-connection failure backoff.
    pub fn proven(&mut self, name: &str) -> String {
        self.down.clear();
        name.to_string()
    }

    /// The proved endpoint failed the full connection (or admission refused it).
    /// Leave protection down and wait before another attempt, even if TCP answers.
    pub fn connect_failed(&mut self, now_ms: u64) {
        let index = (self.attempt as usize).min(BACKOFF_MS.len() - 1);
        let delay = BACKOFF_MS[index];
        self.attempt = self.attempt.saturating_add(1);
        self.down.clear();
        self.next_due_ms = now_ms.saturating_add(delay);
    }

    pub fn on_clock(
        &mut self,
        preferred: &str,
        region: &str,
        targets: &[ProbeTarget],
        now_ms: u64,
    ) -> Step {
        if now_ms < self.next_due_ms {
            return Step::Wait { until_ms: self.next_due_ms };
        }
        let names = ordered_tcp_names(preferred, region, targets, &self.down);
        if names.is_empty() {
            self.connect_failed(now_ms);
            return Step::Wait { until_ms: self.next_due_ms };
        }
        Step::Probe { names }
    }
}

#[derive(Debug, Default, Clone)]
pub struct ProofCache {
    until_ms: std::collections::BTreeMap<String, u64>,
}

impl ProofCache {
    pub fn remember(&mut self, endpoint: &str, now_ms: u64) {
        self.until_ms.insert(
            endpoint.to_string(),
            now_ms.saturating_add(PROOF_TTL_MS),
        );
    }

    pub fn fresh(&self, endpoint: &str, now_ms: u64) -> bool {
        self.until_ms
            .get(endpoint)
            .is_some_and(|until| now_ms < *until)
    }
}

/// Health-monitor recovery. Policy rebuilds stay on the existing protected path.
/// The release bit itself is the shared disposition, not a second policy.
pub fn health_monitor_releases(strict_explicit: bool, policy_rebuild: bool) -> bool {
    if policy_rebuild {
        return false;
    }
    customer_failure::disposition_after_exhausted_failure(strict_explicit)
        == NetworkDisposition::FailOpen
}

pub fn region_of(name: &str) -> String {
    let base = name.trim_end_matches(" · hy2");
    for token in base.split(|ch: char| !ch.is_alphanumeric()) {
        if token.eq_ignore_ascii_case("us") {
            return "us".to_string();
        }
        if token.eq_ignore_ascii_case("jp") {
            return "jp".to_string();
        }
    }
    let city = base.split('·').next().unwrap_or(base).trim().to_ascii_lowercase();
    match city.as_str() {
        "los angeles" | "salt lake city" | "buffalo" | "new york" | "san jose"
        | "seattle" | "chicago" | "dallas" | "miami" => "us".to_string(),
        "tokyo" | "osaka" => "jp".to_string(),
        _ => "other".to_string(),
    }
}

fn ordered_tcp_names(
    preferred: &str,
    region: &str,
    targets: &[ProbeTarget],
    down: &BTreeSet<String>,
) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(preferred_target) = targets.iter().find(|target| target.name == preferred) {
        if preferred_target.tcp
            && preferred_target.region == region
            && !down.contains(&preferred_target.name)
        {
            names.push(preferred_target.name.clone());
        }
    }
    let mut rest: Vec<&ProbeTarget> = targets
        .iter()
        .filter(|target| target.tcp && target.region == region && target.name != preferred)
        .filter(|target| !down.contains(&target.name))
        .collect();
    rest.sort_by(|left, right| left.name.cmp(&right.name));
    for target in rest {
        if names.len() == MAX_PROBES_PER_ROUND {
            break;
        }
        names.push(target.name.clone());
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(name: &str, region: &str, tcp: bool) -> ProbeTarget {
        ProbeTarget {
            name: name.to_string(),
            region: region.to_string(),
            endpoint: format!("{name}-endpoint"),
            tcp,
        }
    }

    #[test]
    fn tcp_proofs_prefer_the_selected_node_then_the_same_region() {
        let targets = vec![
            target("Buffalo · Niagara", "us", true),
            target("Buffalo · Niagara · hy2", "us", false),
            target("Tokyo · Sakura", "jp", true),
            target("Los Angeles · Harbor", "us", true),
        ];
        let mut schedule = Schedule::begin(0);
        let first = schedule.on_clock("Buffalo · Niagara", "us", &targets, 0);
        assert_eq!(
            first,
            Step::Probe {
                names: vec![
                    "Buffalo · Niagara".to_string(),
                    "Los Angeles · Harbor".to_string(),
                ]
            }
        );
        schedule.note_down("Buffalo · Niagara");
        let next = schedule.on_clock("Buffalo · Niagara", "us", &targets, 0);
        assert_eq!(
            next,
            Step::Probe {
                names: vec!["Los Angeles · Harbor".to_string()]
            }
        );
        let proven = schedule.proven("Los Angeles · Harbor");
        assert_eq!(proven, "Los Angeles · Harbor");
    }

    #[test]
    fn a_round_with_nothing_left_waits_and_does_not_reconnect() {
        let targets = vec![target("Buffalo · Niagara", "us", true)];
        let mut schedule = Schedule::begin(0);
        schedule.note_down("Buffalo · Niagara");
        let step = schedule.on_clock("Buffalo · Niagara", "us", &targets, 10);
        assert_eq!(step, Step::Wait { until_ms: 10 + BACKOFF_MS[0] });
        let early = schedule.on_clock("Buffalo · Niagara", "us", &targets, 10 + BACKOFF_MS[0] - 1);
        assert!(matches!(early, Step::Wait { .. }));
    }

    #[test]
    fn reachable_tcp_does_not_reset_repeated_failure_backoff() {
        let targets = vec![target("Buffalo · Niagara", "us", true)];
        let mut schedule = Schedule::begin(0);
        let mut now = 0;
        for delay in [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 120_000] {
            assert!(matches!(
                schedule.on_clock("Buffalo · Niagara", "us", &targets, now),
                Step::Probe { .. }
            ));
            schedule.proven("Buffalo · Niagara");
            // TCP answered, but the full connection failed. Use the same wait
            // as an exhausted TCP round without restarting the ladder.
            schedule.connect_failed(now);
            let due = now + delay;
            assert_eq!(
                schedule.on_clock("Buffalo · Niagara", "us", &targets, now),
                Step::Wait { until_ms: due }
            );
            assert_eq!(
                schedule.on_clock("Buffalo · Niagara", "us", &targets, due - 1),
                Step::Wait { until_ms: due }
            );
            now = due;
        }
    }

    #[test]
    fn health_failure_uses_the_shared_disposition() {
        assert!(health_monitor_releases(false, false));
        assert!(!health_monitor_releases(true, false));
        assert!(!health_monitor_releases(false, true));
        let mut cache = ProofCache::default();
        cache.remember("203.0.113.10:443", 1_000);
        assert!(cache.fresh("203.0.113.10:443", 1_000 + PROOF_TTL_MS - 1));
        assert!(!cache.fresh("203.0.113.10:443", 1_000 + PROOF_TTL_MS));
    }
}
