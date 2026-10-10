//! Same-node hy2 auto-switch (backlog A17, owner decision D1-C).
//!
//! Pure decision logic. It opens no sockets and writes no WFP, TUN, or route.
//!
//! - The control plane permits it per account: `GET /api/v1/exit-catalog`
//!   carries an optional top-level `hy2AutoSwitch`. Missing is `false`. The
//!   client reads it on every 200, including an unchanged install. Until a
//!   200 has been read in this process the answer is "not permitted"; the
//!   cached catalog never turns it on.
//! - After [`TCP_FAILURES_BEFORE_HY2`] consecutive VLESS Reality connect
//!   failures on the selected node, the next unarmed attempt dials the
//!   ` · hy2` block of that same node: same base name, same IPv4, and the hy2
//!   password equal to the Reality UUID, i.e. the same Tono identity
//!   (`services/control-plane/src/catalog-yaml.ts`). It never picks another
//!   node and never picks Tokyo hy2 (vendor drops inbound UDP).
//! - A hy2 connect that reaches Connected is remembered for that node for
//!   [`REMEMBER_MS`] (24 h). After that the next attempt tries TCP again.
//! - A failed automatic hy2 attempt goes back to TCP. The node then needs a
//!   new run of TCP failures, and no automatic hy2 for that node until a
//!   doubling backoff ([`BACKOFF_BASE_MS`]..=[`BACKOFF_MAX_MS`]) has passed.
//! - Turning the flag off, a catalog without that node's hy2 block, or the
//!   user picking either block of that node drops the remembered choice and
//!   the counters.
//! - A user who selects a ` · hy2` row is a manual choice. Nothing here
//!   counts or changes it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::heal::udp_vendor_blocked;
use crate::node::{HY2_NAME_SUFFIX, ValidatedNode, catalog_base_name, is_hy2_catalog_name};

/// Consecutive TCP connect failures on the selected node before its hy2 block is dialed.
pub const TCP_FAILURES_BEFORE_HY2: u32 = 3;

/// How long a hy2 success is remembered for that node before TCP is retried.
pub const REMEMBER_MS: u64 = 24 * 60 * 60 * 1000;

/// First pause in automatic hy2 for a node after its automatic hy2 attempt
/// failed (the macOS client uses the same 30 min). Doubles per further failure.
pub const BACKOFF_BASE_MS: u64 = 30 * 60 * 1000;

/// Longest pause between automatic hy2 attempts for one node.
pub const BACKOFF_MAX_MS: u64 = 6 * 60 * 60 * 1000;

/// Upper bound on remembered nodes kept and persisted.
pub const MAX_REMEMBERED: usize = 64;

/// Persisted remembered choices, next to the catalog cache.
pub const STATE_FILE_NAME: &str = "hy2-auto-switch.json";

/// Largest state file read back.
pub const MAX_STATE_FILE_BYTES: u64 = 16 * 1024;

/// Failure text that names the node's TCP path, not this PC. Aligned with
/// the dashboard's "try the backup channel" test (`services/tono.ts`
/// `connectErrorSuggestsBackupChannel`) plus the pre-tunnel TCP proof.
/// Local failures (Service, WFP engine, DNS preflight, sign-in) do not count.
pub fn counts_as_tcp_failure(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("tcp connect to the selected exit did not complete")
        || lower.contains("tls handshake eof")
        || error.contains("CORE_EXIT_UNREACHABLE")
        || error.contains("TONO_NODE_OR_CORE_UNREACHABLE")
        || lower.contains("node or core unreachable")
}

/// The ` · hy2` block of `preferred`: same base name, admitted as hysteria2,
/// the same IPv4 as the selected Reality block, and its password equal to
/// the Reality UUID. `None` for a hy2 selection, a missing block, another
/// server or identity, or Tokyo hy2.
pub fn same_node_hy2<'a>(preferred: &str, nodes: &'a [ValidatedNode]) -> Option<&'a ValidatedNode> {
    if preferred.is_empty() || is_hy2_catalog_name(preferred) {
        return None;
    }
    let tcp = nodes
        .iter()
        .find(|node| node.name == preferred && !node.is_hysteria2())?;
    let name = format!("{preferred}{HY2_NAME_SUFFIX}");
    nodes
        .iter()
        .find(|node| {
            node.name == name
                && node.is_hysteria2()
                && node.server == tcp.server
                && node.uuid == tcp.uuid
        })
        .filter(|node| !udp_vendor_blocked(&node.name))
}

fn hy2_name_of(preferred: &str) -> String {
    format!("{preferred}{HY2_NAME_SUFFIX}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Backoff {
    streak: u32,
    until_ms: u64,
}

/// One remembered node, as written to [`STATE_FILE_NAME`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RememberedHy2 {
    /// Base (VLESS Reality) name of the node.
    pub node: String,
    #[serde(rename = "untilMs")]
    pub until_ms: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedHy2Choices {
    #[serde(default)]
    pub remembered: Vec<RememberedHy2>,
}

#[derive(Debug, Clone, Default)]
pub struct Hy2AutoSwitch {
    /// `None` until a catalog 200 was read in this process.
    permitted: Option<bool>,
    tcp_failures: BTreeMap<String, u32>,
    remembered: BTreeMap<String, u64>,
    backoff: BTreeMap<String, Backoff>,
    /// Base name whose last Connected attempt dialed its hy2 block automatically.
    live_hy2: Option<String>,
    /// Exact node the most recently admitted attempt dials. Set under the
    /// admission lock, so it is already current when that attempt publishes
    /// Connected. The runtime and the barrier's permit follow this node.
    live_exit: Option<ValidatedNode>,
}

impl Hy2AutoSwitch {
    pub fn permitted(&self) -> bool {
        self.permitted == Some(true)
    }

    /// Apply the `hy2AutoSwitch` of a catalog 200. `false` forgets every
    /// remembered choice and counter. `true` keeps only nodes whose hy2
    /// block is still in `nodes`. Returns true when the remembered set
    /// changed and must be persisted.
    pub fn on_catalog(&mut self, permitted: bool, nodes: &[ValidatedNode]) -> bool {
        self.permitted = Some(permitted);
        if !permitted {
            let changed = !self.remembered.is_empty();
            self.tcp_failures.clear();
            self.remembered.clear();
            self.backoff.clear();
            return changed;
        }
        let before = self.remembered.len();
        let keep = |base: &String| same_node_hy2(base, nodes).is_some();
        self.tcp_failures.retain(|base, _| keep(base));
        self.remembered.retain(|base, _| keep(base));
        self.backoff.retain(|base, _| keep(base));
        before != self.remembered.len()
    }

    fn backing_off(&self, base: &str, now_ms: u64) -> bool {
        self.backoff
            .get(base)
            .is_some_and(|backoff| backoff.until_ms > now_ms)
    }

    /// The flag is on, `preferred` is a Reality row with an eligible hy2
    /// block, and no backoff is running. While this holds, a failure of the
    /// selected node stays on that node (TCP, then its hy2 block) instead of
    /// letting the sticky healer move to another node.
    pub fn holds(&self, preferred: &str, nodes: &[ValidatedNode], now_ms: u64) -> bool {
        self.permitted()
            && same_node_hy2(preferred, nodes).is_some()
            && !self.backing_off(preferred, now_ms)
    }

    /// Name to dial instead of `preferred`, if any.
    pub fn dial(&self, preferred: &str, nodes: &[ValidatedNode], now_ms: u64) -> Option<String> {
        if !self.holds(preferred, nodes, now_ms) {
            return None;
        }
        let remembered = self
            .remembered
            .get(preferred)
            .is_some_and(|until| *until > now_ms);
        let failed =
            self.tcp_failures.get(preferred).copied().unwrap_or(0) >= TCP_FAILURES_BEFORE_HY2;
        (remembered || failed)
            .then(|| same_node_hy2(preferred, nodes).map(|node| node.name.clone()))
            .flatten()
    }

    /// An attempt for `preferred` that dialed `dialed` failed with `error`.
    /// Returns true when the remembered set changed.
    pub fn note_failure(
        &mut self,
        preferred: &str,
        dialed: &str,
        error: &str,
        now_ms: u64,
    ) -> bool {
        if preferred.is_empty() || is_hy2_catalog_name(preferred) {
            return false;
        }
        self.live_hy2 = None;
        if dialed == preferred {
            if counts_as_tcp_failure(error) {
                let count = self.tcp_failures.entry(preferred.to_string()).or_insert(0);
                *count = count.saturating_add(1).min(TCP_FAILURES_BEFORE_HY2);
            }
            return false;
        }
        if dialed != hy2_name_of(preferred) {
            return false;
        }
        // The automatic hop failed. Back to TCP, with a fresh count and a growing pause.
        self.tcp_failures.remove(preferred);
        let streak = self
            .backoff
            .get(preferred)
            .map_or(0, |backoff| backoff.streak)
            .saturating_add(1);
        let shift = streak.saturating_sub(1).min(16);
        let wait = BACKOFF_BASE_MS
            .saturating_mul(1u64 << shift)
            .min(BACKOFF_MAX_MS);
        self.backoff.insert(
            preferred.to_string(),
            Backoff {
                streak,
                until_ms: now_ms.saturating_add(wait),
            },
        );
        self.remembered.remove(preferred).is_some()
    }

    /// An attempt for `preferred` that dialed `dialed` reached Connected.
    /// Returns true when the remembered set changed.
    pub fn note_connected(&mut self, preferred: &str, dialed: &str, now_ms: u64) -> bool {
        self.live_hy2 = None;
        if preferred.is_empty() || is_hy2_catalog_name(preferred) {
            return false;
        }
        if dialed == preferred {
            self.tcp_failures.remove(preferred);
            self.backoff.remove(preferred);
            return self.remembered.remove(preferred).is_some();
        }
        if dialed != hy2_name_of(preferred) {
            return false;
        }
        // Only a fresh switch (the TCP count was reached) starts a 24 h window.
        // A dial from an unexpired memory, or an in-place reconnect of the live
        // hy2 session, keeps the original expiry, so TCP is still retried.
        let fresh =
            self.tcp_failures.get(preferred).copied().unwrap_or(0) >= TCP_FAILURES_BEFORE_HY2;
        self.tcp_failures.remove(preferred);
        self.backoff.remove(preferred);
        self.live_hy2 = Some(preferred.to_string());
        if !fresh {
            return false;
        }
        self.remembered
            .insert(preferred.to_string(), now_ms.saturating_add(REMEMBER_MS));
        while self.remembered.len() > MAX_REMEMBERED {
            let Some(oldest) = self
                .remembered
                .iter()
                .min_by_key(|(_, until)| **until)
                .map(|(base, _)| base.clone())
            else {
                break;
            };
            self.remembered.remove(&oldest);
        }
        true
    }

    /// The user picked either block of this node by hand. Drop its counters,
    /// backoff, and remembered choice. Returns true when the remembered set
    /// changed.
    pub fn forget_node(&mut self, name: &str) -> bool {
        let base = catalog_base_name(name);
        self.tcp_failures.remove(base);
        self.backoff.remove(base);
        if self.live_hy2.as_deref() == Some(base) {
            self.live_hy2 = None;
        }
        self.remembered.remove(base).is_some()
    }

    /// An attempt was admitted to dial exactly `node`.
    pub fn note_admitted(&mut self, node: &ValidatedNode) {
        self.live_exit = Some(node.clone());
    }

    /// Exact node of the most recently admitted attempt.
    pub fn live_exit(&self) -> Option<&ValidatedNode> {
        self.live_exit.as_ref()
    }

    /// `node` is still a permitted automatic hop for `preferred`: the flag is
    /// on and the catalog's hy2 block of that node is exactly `node`. Checked
    /// again right before the tunnel starts.
    pub fn auto_hop_permitted(
        &self,
        preferred: &str,
        node: &ValidatedNode,
        nodes: &[ValidatedNode],
    ) -> bool {
        self.permitted() && same_node_hy2(preferred, nodes) == Some(node)
    }

    /// Under a live barrier the dial target is not moved, with one case: the
    /// live session already dials `preferred`'s hy2 block automatically and
    /// reached Connected, so an in-place reconnect keeps that endpoint. Only
    /// when the flag is still on, no backoff runs, and the catalog's hy2 block
    /// is exactly the node the barrier already permits (same IPv4, port,
    /// protocol, pin). Otherwise the selected Reality block is rebuilt with the
    /// barrier kept, as for any VLESS/HY2 change.
    pub fn live_dial(
        &self,
        preferred: &str,
        nodes: &[ValidatedNode],
        now_ms: u64,
    ) -> Option<String> {
        if !self.permitted()
            || self.live_hy2.as_deref() != Some(preferred)
            || self.backing_off(preferred, now_ms)
        {
            return None;
        }
        let live = self.live_exit.as_ref()?;
        same_node_hy2(preferred, nodes)
            .filter(|node| *node == live)
            .map(|node| node.name.clone())
    }

    pub fn snapshot(&self) -> PersistedHy2Choices {
        PersistedHy2Choices {
            remembered: self
                .remembered
                .iter()
                .map(|(node, until_ms)| RememberedHy2 {
                    node: node.clone(),
                    until_ms: *until_ms,
                })
                .collect(),
        }
    }

    /// Load persisted choices. Expired entries, hy2 names, and expiries
    /// further out than [`REMEMBER_MS`] are dropped.
    pub fn restore(&mut self, persisted: PersistedHy2Choices, now_ms: u64) {
        let horizon = now_ms.saturating_add(REMEMBER_MS);
        self.remembered = persisted
            .remembered
            .into_iter()
            .filter(|item| {
                !item.node.is_empty()
                    && !is_hy2_catalog_name(&item.node)
                    && item.until_ms > now_ms
                    && item.until_ms <= horizon
            })
            .take(MAX_REMEMBERED)
            .map(|item| (item.node, item.until_ms))
            .collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeProtocol;
    use std::net::Ipv4Addr;

    fn node(name: &str, protocol: NodeProtocol) -> ValidatedNode {
        ValidatedNode {
            name: name.to_string(),
            server: Ipv4Addr::new(8, 8, 8, 8),
            port: 443,
            uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".to_string(),
            servername: "www.microsoft.com".to_string(),
            flow: None,
            client_fingerprint: None,
            reality_public_key: "0123456789abcdef0123456789abcdef0123456789a".to_string(),
            reality_short_id: "0123456789abcdef".to_string(),
            protocol,
            tls_fingerprint: None,
            certificate_public_key_sha256: None,
        }
    }

    #[test]
    fn three_tcp_failures_dial_the_same_nodes_hy2_only_when_the_flag_is_on() {
        let nodes = vec![
            node("Buffalo · Niagara", NodeProtocol::VlessReality),
            node("Buffalo · Niagara · hy2", NodeProtocol::Hysteria2),
            node("Buffalo · Falls", NodeProtocol::VlessReality),
            node("Buffalo · Falls · hy2", NodeProtocol::Hysteria2),
        ];
        let selected = "Buffalo · Niagara";
        let eof = "connect failed: tls handshake eof";
        let now = 1_000;
        let run = |permitted: bool| {
            let mut switch = Hy2AutoSwitch::default();
            switch.on_catalog(permitted, &nodes);
            for _ in 0..TCP_FAILURES_BEFORE_HY2 {
                assert_eq!(switch.dial(selected, &nodes, now), None);
                switch.note_failure(selected, selected, eof, now);
            }
            switch
        };

        let mut on = run(true);
        let next = on.dial(selected, &nodes, now);
        assert_eq!(next.as_deref(), Some("Buffalo · Niagara · hy2"));
        // Remembered for 24 h after a hy2 Connected; TCP again afterwards.
        assert!(on.note_connected(selected, next.as_deref().unwrap(), now));
        assert_eq!(on.dial(selected, &nodes, now + REMEMBER_MS - 1), next);
        assert_eq!(on.dial(selected, &nodes, now + REMEMBER_MS), None);
        // An armed in-place reconnect keeps only the exact block the barrier permits.
        on.note_admitted(&nodes[1]);
        assert_eq!(on.live_dial(selected, &nodes, now), next);
        let mut moved = nodes.clone();
        moved[1].port = 8443;
        assert_eq!(on.live_dial(selected, &moved, now), None);
        // A hand pick of the Reality row forgets it: the next dial is Reality.
        let mut picked = on.clone();
        picked.forget_node(selected);
        assert_eq!(picked.dial(selected, &nodes, now), None);
        assert_eq!(picked.live_dial(selected, &nodes, now), None);
        // The flag turning off forgets it at once.
        on.on_catalog(false, &nodes);
        assert_eq!(on.dial(selected, &nodes, now), None);

        // Flag off (or never read): stays on TCP.
        let off = run(false);
        assert_eq!(off.dial(selected, &nodes, now), None);
        assert_eq!(Hy2AutoSwitch::default().dial(selected, &nodes, now), None);
    }
}
