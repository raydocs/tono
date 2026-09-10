//! Per-route byte totals from `/connections` snapshots.
//!
//! Holds only connection ids and byte counters — no host or process strings.
//! Classification must stay in step with `classifyActivityRoute` in
//! `app/src/pages/tono/activity-model.ts`.
//!
//! Window reporting uses the delta of [`RouteLedger::overall`] since the last
//! successful (2xx) upload baseline. `overall` is never reset for the process
//! lifetime; per-connection counters are cleared on ConnectOk and disconnect
//! because a new core issues fresh ids. The window delta is `saturating_sub`
//! so a conceptual reset that dropped `overall` below the baseline clamps to 0
//! rather than wrapping.

use std::collections::{HashMap, HashSet};

use tono_core::EXIT_GROUP_NAME;
use tono_core::auth::BytesByRoute;
use tono_core::config::{CLAUDE_HOME_GROUP_NAME, DIRECT_GROUP_NAME, HOME_SOCKS5_OUTBOUND_NAME, WEB_DIRECT_GROUP_NAME};

use crate::tono::connection_routes::SampledConnections;

/// Worker-facing route class. `rejected` is dropped (not a `bytesByRoute` key);
/// TS `local` loopback flows terminate in DIRECT and fold into `direct`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RouteClass {
    Cloud,
    Residential,
    Direct,
    Rejected,
}

/// Keep in step with `classifyActivityRoute` in `activity-model.ts`.
///
/// Terminal hop is `chains[0]` (mihomo orders terminal outbound first).
/// `REJECT`/`REJECT-DROP` → rejected; `DIRECT` / `Tono-China-Direct` /
/// `Tono-China-Web-Direct` → direct (case-sensitive: lowercase `direct` is
/// proxied); `Tono-Home-Residential` anywhere → residential; `Tono-Claude-Home`
/// without `Tono-Exit` → residential; else cloud (proxied). Group-name
/// constants come from tono-core (`config.rs` / `node.rs`); the TS twin
/// hardcodes the same literals.
pub(crate) fn classify_route(chains: &[String]) -> RouteClass {
    let hops: Vec<&str> = chains.iter().map(|hop| hop.trim()).collect();
    let terminal = hops.first().copied().unwrap_or("");
    if terminal == "REJECT" || terminal == "REJECT-DROP" {
        return RouteClass::Rejected;
    }
    if terminal == "DIRECT" || terminal == DIRECT_GROUP_NAME || terminal == WEB_DIRECT_GROUP_NAME {
        return RouteClass::Direct;
    }
    if hops.iter().any(|hop| *hop == HOME_SOCKS5_OUTBOUND_NAME) {
        return RouteClass::Residential;
    }
    if hops.iter().any(|hop| *hop == CLAUDE_HOME_GROUP_NAME) && !hops.iter().any(|hop| *hop == EXIT_GROUP_NAME) {
        return RouteClass::Residential;
    }
    RouteClass::Cloud
}

#[derive(Debug, Default)]
pub struct RouteLedger {
    /// Last-seen (upload, download) per live connection id. Bounded by the
    /// number of open connections: closed ids are dropped after their last
    /// delta is banked into `overall`.
    counters: HashMap<String, (u64, u64)>,
    overall: BytesByRoute,
    /// Copy of `overall` taken after the last 2xx telemetry upload. The
    /// window body is `overall.saturating_sub(baseline)`.
    baseline: BytesByRoute,
}

impl RouteLedger {
    pub fn overall(&self) -> BytesByRoute {
        self.overall
    }

    /// Bytes attributed to each route since the last successful upload.
    ///
    /// Clamp is defensive: `overall` is never reset, so the delta is never
    /// negative by construction. saturating_sub still covers a reconnect that
    /// conceptually zeroed the ledger.
    pub fn window_bytes(&self) -> BytesByRoute {
        BytesByRoute {
            cloud: self.overall.cloud.saturating_sub(self.baseline.cloud),
            residential: self.overall.residential.saturating_sub(self.baseline.residential),
            direct: self.overall.direct.saturating_sub(self.baseline.direct),
        }
    }

    /// Advance the window baseline. Call only after a 2xx upload.
    pub fn advance_baseline(&mut self) {
        self.baseline = self.overall;
    }

    /// Drop per-connection cursors. Does not touch `overall` or the baseline.
    pub fn clear_connection_counters(&mut self) {
        self.counters.clear();
    }

    /// Diff one `/connections` snapshot into `overall`, matching macOS
    /// `AppTrafficLedger.ingest`: a counter that went backwards is treated as
    /// id reuse (the current value is the whole of the new connection).
    pub fn ingest(&mut self, sample: &SampledConnections) {
        let mut live = HashSet::with_capacity(sample.connections.len());
        for connection in &sample.connections {
            if connection.id.is_empty() {
                continue;
            }
            live.insert(connection.id.clone());
            let previous = self.counters.get(&connection.id).copied();
            let upload_delta = match previous {
                Some((prev_up, _)) if connection.upload >= prev_up => connection.upload - prev_up,
                Some(_) => connection.upload,
                None => connection.upload,
            };
            let download_delta = match previous {
                Some((_, prev_down)) if connection.download >= prev_down => connection.download - prev_down,
                Some(_) => connection.download,
                None => connection.download,
            };
            self.counters
                .insert(connection.id.clone(), (connection.upload, connection.download));
            let bytes = upload_delta.saturating_add(download_delta);
            match classify_route(&connection.chains) {
                RouteClass::Cloud => self.overall.cloud = self.overall.cloud.saturating_add(bytes),
                RouteClass::Residential => {
                    self.overall.residential = self.overall.residential.saturating_add(bytes);
                }
                RouteClass::Direct => self.overall.direct = self.overall.direct.saturating_add(bytes),
                RouteClass::Rejected => {}
            }
        }
        if self.counters.len() > live.len() {
            self.counters.retain(|id, _| live.contains(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tono::connection_routes::SampledConnection;

    fn conn(id: &str, chains: &[&str], upload: u64, download: u64) -> SampledConnection {
        SampledConnection {
            id: id.to_string(),
            chains: chains.iter().map(|hop| (*hop).to_string()).collect(),
            upload,
            download,
            ..SampledConnection::default()
        }
    }

    fn sample(connections: Vec<SampledConnection>) -> SampledConnections {
        SampledConnections {
            connections,
            upload_total: 0,
            download_total: 0,
        }
    }

    #[test]
    fn classify_route_matches_activity_model_table() {
        // Mirrors `activity.test.tsx` classifyActivityRoute cases, mapped to
        // Worker keys: proxied → cloud, home → residential, rejected dropped.
        let cases: &[(&[&str], RouteClass)] = &[
            (&["Tono Cloud"], RouteClass::Cloud),
            (&["DIRECT"], RouteClass::Direct),
            (&["REJECT-DROP"], RouteClass::Rejected),
            (&["REJECT-us"], RouteClass::Cloud),
            (&["direct"], RouteClass::Cloud),
            (&["Tono-Home-Residential"], RouteClass::Residential),
            (&["HomeNode", "Tono-Claude-Home"], RouteClass::Residential),
            (&["Tono-Exit", "Tono-Claude-Home"], RouteClass::Cloud),
            (&["Tono-China-Direct"], RouteClass::Direct),
            (&["Home Residential", "Tono-Claude-Home"], RouteClass::Residential),
            (&["Tono-China-Web-Direct"], RouteClass::Direct),
            (&["REJECT"], RouteClass::Rejected),
        ];
        for (hops, expected) in cases {
            let chains: Vec<String> = hops.iter().map(|hop| (*hop).to_string()).collect();
            assert_eq!(classify_route(&chains), *expected, "hops={hops:?}");
        }
    }

    #[test]
    fn ingest_diffs_live_counters_and_keeps_closed_connection_bytes() {
        let mut ledger = RouteLedger::default();
        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 100, 50)]));
        assert_eq!(ledger.overall().cloud, 150);
        assert_eq!(ledger.overall().residential, 0);
        assert_eq!(ledger.overall().direct, 0);

        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 180, 70)]));
        assert_eq!(ledger.overall().cloud, 250);

        // `a` closed: last-seen bytes stay in overall; the cursor is dropped.
        ledger.ingest(&sample(vec![conn("b", &["DIRECT"], 10, 5)]));
        assert_eq!(ledger.overall().cloud, 250);
        assert_eq!(ledger.overall().direct, 15);
        assert!(!ledger.counters.contains_key("a"));
        assert!(ledger.counters.contains_key("b"));
    }

    #[test]
    fn ingest_treats_counter_rewind_as_id_reuse() {
        let mut ledger = RouteLedger::default();
        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 100, 0)]));
        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 30, 0)]));
        assert_eq!(ledger.overall().cloud, 130);
    }

    #[test]
    fn ingest_drops_rejected_and_does_not_count_empty_ids() {
        let mut ledger = RouteLedger::default();
        ledger.ingest(&sample(vec![
            conn("", &["Tono Cloud"], 99, 99),
            conn("r", &["REJECT-DROP"], 40, 10),
        ]));
        assert_eq!(ledger.overall(), BytesByRoute::default());
        assert!(ledger.counters.is_empty());
    }

    #[test]
    fn window_bytes_is_delta_since_baseline_and_clamps_on_reset() {
        let mut ledger = RouteLedger::default();
        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 200, 0)]));
        ledger.advance_baseline();
        assert_eq!(ledger.window_bytes().cloud, 0);

        ledger.ingest(&sample(vec![conn("a", &["Tono Cloud"], 250, 0)]));
        assert_eq!(ledger.window_bytes().cloud, 50);

        // Defensive clamp: a reconnect that conceptually zeroed overall must
        // not wrap to a huge unsigned delta.
        ledger.overall = BytesByRoute::default();
        ledger.counters.clear();
        assert_eq!(ledger.window_bytes(), BytesByRoute::default());
    }

    #[test]
    fn clear_connection_counters_does_not_reset_overall() {
        let mut ledger = RouteLedger::default();
        ledger.ingest(&sample(vec![conn("a", &["DIRECT"], 8, 2)]));
        ledger.clear_connection_counters();
        assert_eq!(ledger.overall().direct, 10);
        assert!(ledger.counters.is_empty());
    }
}
