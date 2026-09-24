//! Exit catalog sync: fetch → validate → persist the
//! verified copy, immediately on login/restore and then every 300 s. Failures
//! retry at 1 s intervals, at most 3 retries. A `StaleRevision` install result
//! is a benign no-op (out-of-order delivery), never an error and never counted
//! toward retries.

use std::{sync::Arc, time::Duration};

use tauri::AppHandle;
use tono_core::{CatalogError, InstallOutcome, auth::ApiError, node::ValidatedNode};

use tono_logging::{Type, logging};

use crate::{
    process::AsyncHandler,
    tono::{
        commands, connection,
        state::{AccountState, TonoInner, TonoState},
    },
};

/// §3 periodic sync cadence.
pub const SYNC_INTERVAL: Duration = Duration::from_secs(300);
/// §3: failures retry at most 3 times.
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(1);

/// Why one catalog or policy sync attempt failed.
pub(crate) enum SyncFailure {
    /// The control plane refused this session after tono-core's own token
    /// renewal was refused too. The Worker answers that way for an expired
    /// plan, a used-up allowance, a disabled account and a revoked device or
    /// session; retrying only repeats a refresh that must fail.
    SessionRejected,
    Failed(String),
}

impl SyncFailure {
    pub(crate) fn from_api(err: ApiError) -> Self {
        match err {
            ApiError::Unauthorized => Self::SessionRejected,
            other => Self::Failed(other.to_string()),
        }
    }
}

impl std::fmt::Display for SyncFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionRejected => f.write_str("Tono no longer accepts this session"),
            Self::Failed(message) => f.write_str(message),
        }
    }
}

/// §3 retry budget shared by the catalog and policy syncs. A session
/// rejection ends it at once (internal review H13-F3).
pub(crate) async fn run_with_retries<F, Fut>(mut attempt: F) -> Result<(), SyncFailure>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), SyncFailure>>,
{
    let mut last = SyncFailure::Failed(String::new());
    for n in 0..=MAX_RETRIES {
        match attempt().await {
            Ok(()) => return Ok(()),
            Err(SyncFailure::SessionRejected) => return Err(SyncFailure::SessionRejected),
            Err(failure) => {
                last = failure;
                if n < MAX_RETRIES {
                    tokio::time::sleep(RETRY_DELAY).await;
                }
            }
        }
    }
    Err(last)
}

/// A rejected session suspends a Ready account, as macOS does: the periodic
/// sync stops, connect and reconnect already refuse a suspended account, and
/// the UI shows the paused-account screen. Protection is left exactly as it
/// is. Signing in again, or the next restore, re-reads the account.
fn suspend_rejected_session(inner: &mut TonoInner, auth_generation: u64) -> bool {
    if inner.sign_in_generation != auth_generation
        || inner.account_close.is_some()
        || inner.account_state != AccountState::Ready
    {
        return false;
    }
    inner.account_state = AccountState::Suspended;
    true
}

pub(crate) async fn note_session_rejected(state: &Arc<TonoState>, app: &AppHandle, auth_generation: u64) {
    let mut inner = state.lock().await;
    if !suspend_rejected_session(&mut inner, auth_generation) {
        return;
    }
    let snapshot = commands::status_of(&inner);
    drop(inner);
    logging!(
        warn,
        Type::Service,
        "Tono: the control plane rejected this session; account suspended"
    );
    commands::emit_status(app, &snapshot);
}

/// Whether the periodic sync for this authentication generation keeps running.
/// The periodic telemetry uploader stops on the same predicate.
pub(crate) fn periodic_sync_continues(inner: &TonoInner, auth_generation: u64) -> bool {
    inner.sign_in_generation == auth_generation
        && !matches!(
            inner.account_state,
            AccountState::SignedOut | AccountState::Restoring | AccountState::Suspended
        )
}

/// Seed the tracker and node list from the last verified on-disk cache so a
/// fresh download can never roll back across restarts (§3). Safe to call
/// before any session exists; a missing or corrupt cache is simply absent.
pub fn seed_from_cache(inner: &mut TonoInner) {
    let Some(cached) = inner.catalog_cache().load() else {
        return;
    };
    inner.catalog_tracker =
        tono_core::CatalogTracker::from_installed(cached.response.revision, cached.response.sha256.clone());
    inner.nodes = cached.nodes;
    inner.routing = sanitized_routing(cached.response.routing.as_ref(), &inner.nodes);
    enforce_selection_survival(inner);
    let _ = ensure_usable_selection(inner);
}

/// Drop the signed-out account's catalog from memory and disk. The body is
/// issued per account (client UUID, residential SOCKS5 credentials), so the
/// next account must never start from it, and the tracker must not compare
/// the next account's payload against it. A failed delete is logged: the
/// next session's catalog still replaces it on first sync.
pub(crate) fn discard_account_catalog(inner: &mut TonoInner) {
    inner.nodes = Vec::new();
    inner.routing = None;
    inner.catalog_tracker = tono_core::CatalogTracker::new();
    let cache = inner.catalog_cache();
    match std::fs::remove_file(cache.path()) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => logging!(
            warn,
            Type::Service,
            "Tono: failed to delete the signed-out account's catalog cache: {err}"
        ),
    }
}

/// Sanitize the catalog's split-routing directives against the admitted
/// nodes, warning on dropped selection hints. Catalog/cache admission has
/// already rejected any unusable declared home hop before this projection.
fn sanitized_routing(
    routing: Option<&tono_core::CatalogRouting>,
    nodes: &[ValidatedNode],
) -> Option<tono_core::CatalogRouting> {
    let routing = routing?;
    let (sanitized, dropped) = tono_core::sanitize_routing(routing, nodes);
    for name in dropped {
        // The dropped marker is unbounded server input (a proxy name or a
        // socks5 host:port — never credentials); log only a prefix.
        let shown: String = name.chars().take(64).collect();
        logging!(
            warn,
            Type::Service,
            "Tono: exit-catalog routing directive failed sanitization and is ignored: {shown}"
        );
    }
    sanitized
}

/// If the selected node is not in the current catalog, flag that the user
/// must choose again; auto-reconnect stays blocked until then (§3).
/// Growing the catalog does not tear a live session down.
fn enforce_selection_survival(inner: &mut TonoInner) {
    let Some(selected) = &inner.selected_node else {
        return;
    };
    if !selected_exit_still_present(selected, &inner.nodes) {
        inner.catalog_requires_choice = true;
    }
}

fn selected_exit_still_present(selected: &str, nodes: &[ValidatedNode]) -> bool {
    nodes.iter().any(|node| node.name == selected)
}

/// What a successful [`install_and_persist`] produced.
#[derive(Debug)]
pub struct PersistedInstall {
    pub tracker: tono_core::CatalogTracker,
    pub nodes: Vec<ValidatedNode>,
    pub installed: bool,
}

/// Clone → install → persist → commit (M2): the candidate tracker installs
/// the catalog, the verified bytes reach the disk cache, and only then does
/// the caller commit the advanced tracker and nodes. A failed `store`
/// propagates with nothing committed, so a redelivery of the same revision
/// retries the install instead of falling into the `Unchanged` hole.
pub fn install_and_persist(
    tracker: &tono_core::CatalogTracker,
    cache: &tono_core::catalog::CatalogCache,
    response: &tono_core::ExitCatalogResponse,
) -> Result<PersistedInstall, CatalogError> {
    let mut candidate = tracker.clone();
    match candidate.install(response)? {
        InstallOutcome::Installed(nodes) => {
            // Only fully verified catalogs reach disk (§3); if this fails,
            // the caller's tracker and nodes stay exactly as they were.
            cache.store(response)?;
            Ok(PersistedInstall {
                tracker: candidate,
                nodes,
                installed: true,
            })
        }
        InstallOutcome::Unchanged => Ok(PersistedInstall {
            tracker: candidate,
            nodes: Vec::new(),
            installed: false,
        }),
    }
}

/// An account-scoped fetch + install cycle. A late response from login/session restore is
/// discarded before it can persist or publish data for a session that has already signed out.
async fn sync_once_inner(state: &Arc<TonoState>, app: &AppHandle, auth_generation: u64) -> Result<(), SyncFailure> {
    let client = { state.lock().await.client.clone() };
    let response = client.exit_catalog().await.map_err(SyncFailure::from_api)?;

    let selection_vanished = {
        let mut inner = state.lock().await;
        if inner.sign_in_generation != auth_generation {
            return Ok(());
        }
        let (installed, emit) = match install_and_persist(&inner.catalog_tracker, &inner.catalog_cache(), &response) {
            Ok(effect) if effect.installed => {
                let node_count = effect.nodes.len();
                inner.cancel_server_tests();
                inner.catalog_tracker = effect.tracker;
                inner.nodes = effect.nodes;
                inner.routing = sanitized_routing(response.routing.as_ref(), &inner.nodes);
                enforce_selection_survival(&mut inner);
                let _ = ensure_usable_selection(&mut inner);
                state.audit().log(crate::tono::audit::AuditEvent::SyncOk {
                    revision: response.revision,
                    node_count,
                });
                (true, true)
            }
            Ok(_) => (false, true),
            // Benign out-of-order delivery (tono-core L5): never an error.
            Err(CatalogError::StaleRevision) => (false, false),
            Err(err) => return Err(SyncFailure::Failed(err.to_string())),
        };
        let vanished = (installed
            && inner.catalog_requires_choice
            && (inner.fsm.status().is_connected || inner.fsm.status().is_connecting))
            .then_some(inner.connect_generation);
        let snapshot = emit.then(|| commands::status_of(&inner));
        drop(inner);
        if let Some(snapshot) = snapshot {
            commands::emit_status(app, &snapshot);
        }
        vanished
    };

    if let Some(generation) = selection_vanished {
        if state.lock().await.sign_in_generation == auth_generation {
            connection::selected_node_vanished(state.clone(), app.clone(), generation).await;
        }
    }
    Ok(())
}

/// Login/restore variant whose responses cannot commit across an authentication generation.
pub(crate) async fn sync_with_retries_for_auth_generation(
    state: &Arc<TonoState>,
    app: &AppHandle,
    generation: u64,
) -> Result<(), String> {
    sync_with_retries_inner(state, app, generation).await
}

async fn sync_with_retries_inner(state: &Arc<TonoState>, app: &AppHandle, auth_generation: u64) -> Result<(), String> {
    let _operation = state.lock_catalog_sync().await;
    if state.lock().await.sign_in_generation != auth_generation {
        return Ok(());
    }
    let result = run_with_retries(|| async move {
        if state.lock().await.sign_in_generation != auth_generation {
            return Ok(());
        }
        sync_once_inner(state, app, auth_generation).await
    })
    .await;
    let failure = match result {
        Ok(()) => {
            let mut inner = state.lock().await;
            if inner.sign_in_generation == auth_generation {
                inner.catalog_last_synced_at_ms = Some(unix_time_ms());
                inner.catalog_sync_error = None;
            }
            return Ok(());
        }
        Err(failure) => failure,
    };
    let last_error = failure.to_string();
    let mut inner = state.lock().await;
    if inner.sign_in_generation != auth_generation {
        return Ok(());
    }
    inner.catalog_sync_error = Some(last_error.clone());
    drop(inner);
    state.audit().log(crate::tono::audit::AuditEvent::SyncFail {
        error: last_error.clone(),
    });
    if matches!(failure, SyncFailure::SessionRejected) {
        note_session_rejected(state, app, auth_generation).await;
    }
    Err(last_error)
}

fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// Start the 300 s periodic sync (§3) for one authenticated session. The task stops on sign-out
/// via the task registry and also self-terminates if its generation is superseded.
/// Callers must not hold the state lock (this registers the task handle).
pub(crate) async fn spawn_periodic_for_auth_generation(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    spawn_periodic_inner(state, app, generation).await;
}

/// The periodic sync's tick source. `Delay` turns a long sleep (lid closed,
/// Modern Standby) into one catch-up sync on wake instead of a burst of every
/// missed 300 s period, each of which would be an authenticated catalog and
/// policy fetch (internal review H13-F2).
fn periodic_sync_interval() -> tokio::time::Interval {
    let mut interval = tokio::time::interval(SYNC_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval
}

async fn spawn_periodic_inner(state: &Arc<TonoState>, app: &AppHandle, auth_generation: u64) {
    let task_state = state.clone();
    let task_app = app.clone();
    let handle = AsyncHandler::spawn(move || async move {
        let mut interval = periodic_sync_interval();
        // The first tick fires immediately; the login/restore path already
        // synced, so skip it.
        interval.tick().await;
        loop {
            interval.tick().await;
            if !periodic_sync_continues(&*task_state.lock().await, auth_generation) {
                return;
            }
            // A failing sync never replaces the last verified copy (§3) and
            // never surfaces to the UI beyond the log.
            let _ = sync_with_retries_inner(&task_state, &task_app, auth_generation).await;
            if !periodic_sync_continues(&*task_state.lock().await, auth_generation) {
                return;
            }
            // The cloud traffic policy rides the same cadence (Build 28).
            let _ = crate::tono::policy_sync::sync_with_retries_for_auth_generation(
                &task_state,
                &task_app,
                auth_generation,
            )
            .await;
        }
    });
    let mut inner = state.lock().await;
    if inner.sign_in_generation != auth_generation {
        handle.abort();
        return;
    }
    inner.tasks.abort_catalog_sync();
    inner.tasks.catalog_sync = Some(handle);
}

/// Catalog display names that Chinese networks currently cannot reach. They stay in the
/// list (so the user sees why the previous default disappeared) but sort last and are
/// not auto-selected. Update this list when a node is unblocked or a new exit is walled.
/// Hard-coded blocked exits. Empty for now: the US-VLESS-Reality block was
/// lifted after the node was re-verified live end-to-end (TCP + Reality
/// handshake + traffic, 2026-08). Keep the mechanism — a dead exit must be
/// quarantined faster than a catalog rotation can reach every client.
const BLOCKED_EXIT_NAMES: &[&str] = &[];

/// Preferred default when the user has no selection, or their selection is blocked.
/// First match that is present in the catalog wins.
const PREFERRED_DEFAULT_EXIT_NAMES: &[&str] = &[
    "Salt Lake City · Summit",
    "Salt Lake City - Summit",
    "Buffalo · Niagara",
    "Buffalo - Niagara",
    "Los Angeles · Harbor",
    "Los Angeles - Harbor",
    "JP-VLESS-Reality",
];

/// Whether this catalog display name is known blocked (GFW / dead exit).
pub fn is_exit_blocked(name: &str) -> bool {
    let name = name.trim();
    BLOCKED_EXIT_NAMES
        .iter()
        .any(|blocked| name.eq_ignore_ascii_case(blocked))
}

/// Old catalog wire names (`US-VLESS-Reality`) that a China Mac/Win customer
/// kept selecting. City-form names in the current signed catalog are the
/// fleet they can actually reach.
pub fn is_legacy_wire_name(name: &str) -> bool {
    let compact = compact_exit_name(name);
    compact == "USVLESSREALITY" || compact == "JPVLESSREALITY"
}

fn compact_exit_name(name: &str) -> String {
    name.chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(|ch| ch.to_uppercase())
        .collect()
}

pub fn names_equivalent(left: &str, right: &str) -> bool {
    left == right || compact_exit_name(left) == compact_exit_name(right)
}

fn node_named<'a>(nodes: &'a [ValidatedNode], name: &str) -> Option<&'a ValidatedNode> {
    nodes
        .iter()
        .find(|node| names_equivalent(&node.name, name))
}

/// Next unused signed catalog city. Legacy leftover names are never kept.
/// hy2 is a same-city backup, not another city: city failover must not land
/// on it (G2.8 stays off until T0). The failure card still offers it by hand.
pub fn next_catalog_exit(
    current: Option<&str>,
    nodes: &[ValidatedNode],
    tried: &std::collections::BTreeSet<String>,
) -> Option<String> {
    let names = sort_server_names(nodes);
    names.into_iter().find(|name| {
        if is_exit_blocked(name) || tried.contains(name) || tono_core::is_hy2_catalog_name(name) {
            return false;
        }
        match current {
            None => true,
            Some(current) => !names_equivalent(
                tono_core::catalog_base_name(name),
                tono_core::catalog_base_name(current),
            ),
        }
    })
}

/// Whether the saved selection must move onto a signed usable catalog city.
/// A catalog city the user just picked is never replaced. Only a missing,
/// blocked, or leftover imported name (not in this catalog) is retargeted.
pub fn replacement_for_selection(
    selected: Option<&str>,
    nodes: &[ValidatedNode],
    default_proxy: Option<&str>,
    recent_success: Option<&str>,
) -> Option<String> {
    // Never implicitly switch to a backup transport based on historical success.
    let preferred = recent_success.and_then(|name| node_named(nodes, name))
        .filter(|node| !node.is_hysteria2() && !is_exit_blocked(&node.name))
        .map(|node| node.name.clone())
        .or_else(|| default_usable_exit(nodes, default_proxy))?;
    match selected {
        None => Some(preferred),
        Some(name) if is_exit_blocked(name) => Some(preferred),
        Some(name) if node_named(nodes, name).is_none() => Some(preferred),
        Some(_) => None,
    }
}

/// Pick the best usable exit: the admin-designated `defaultProxy` routing
/// directive first (when it names a catalog node), then the preferred list,
/// then the first unblocked name in sort order.
pub fn default_usable_exit(nodes: &[ValidatedNode], default_proxy: Option<&str>) -> Option<String> {
    if let Some(default) = default_proxy
        && let Some(node) = nodes.iter().find(|node| node.name == default)
    {
        return Some(node.name.clone());
    }
    for preferred in PREFERRED_DEFAULT_EXIT_NAMES {
        if let Some(node) = nodes.iter().find(|node| {
            !is_exit_blocked(&node.name)
                && (node.name == *preferred
                    || node.name.replace('·', "-").replace('–', "-") == preferred.replace('·', "-").replace('–', "-"))
        }) {
            return Some(node.name.clone());
        }
    }
    sort_server_names(nodes)
        .into_iter()
        .find(|name| !is_exit_blocked(name) && !tono_core::is_hy2_catalog_name(name))
        .or_else(|| sort_server_names(nodes).into_iter().find(|name| !is_exit_blocked(name)))
}

/// Direct TCP connect tests prove a VLESS listener. hy2 shares the same
/// IPv4:port over UDP, so a TCP probe would light Tokyo hy2 green while the
/// vendor still drops inbound UDP.
pub fn tcp_probe_socket(node: &ValidatedNode) -> Option<std::net::SocketAddr> {
    if is_exit_blocked(&node.name) || node.is_hysteria2() {
        return None;
    }
    Some(std::net::SocketAddr::new(node.server.into(), node.port))
}

/// If selection is missing or points at a blocked exit, move the user to a usable default
/// and persist. Returns the name that was applied (if any).
pub fn ensure_usable_selection(inner: &mut TonoInner) -> Option<String> {
    let recent_success = crate::tono::state::load_successful_selection(
        &inner.catalog_dir, inner.catalog_tracker.current_revision(),
        crate::tono::commands::epoch_millis(),
    );
    let default_proxy = inner
        .routing
        .as_ref()
        .and_then(|routing| routing.default_proxy.as_deref());
    let Some(replacement) =
        replacement_for_selection(inner.selected_node.as_deref(), &inner.nodes, default_proxy, recent_success.as_deref())
    else {
        return None;
    };
    let replacement = tono_core::catalog::apply_default_selection(
        inner.fsm.status(), &mut inner.selected_node, &mut inner.catalog_requires_choice, replacement,
    )?;
    if let Err(error) = crate::tono::state::save_selection(&inner.catalog_dir, &replacement) {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to persist default exit after blocked-node migration: {error}"
        );
    }
    Some(replacement)
}

/// After a connect that proved the selected city dead, persist the next unused
/// catalog exit. Not called on the live connect path: every US city from one
/// China Windows tester failed the same TLS close, and rotating only jumped
/// the picker.
#[allow(dead_code)]
pub fn rotate_catalog_exit_after_failure(inner: &mut TonoInner) -> Option<(String, String)> {
    let from = inner.selected_node.clone().unwrap_or_default();
    if !from.is_empty() {
        inner.catalog_failover_tried.insert(from.clone());
    }
    let next = next_catalog_exit(
        inner.selected_node.as_deref(),
        &inner.nodes,
        &inner.catalog_failover_tried,
    )?;
    if inner.catalog_failover_tried.contains(&next) {
        return None;
    }
    inner.catalog_failover_tried.insert(next.clone());
    inner.selected_node = Some(next.clone());
    inner.catalog_requires_choice = false;
    if let Err(error) = crate::tono::state::save_selection(&inner.catalog_dir, &next) {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to persist catalog failover exit: {error}"
        );
    }
    Some((from, next))
}

/// Region ordering for the server list: usable nodes first (US → JP → other), blocked last.
/// Within each group, name-sorted (case-insensitive, Unicode-aware).
pub fn sort_server_names(nodes: &[ValidatedNode]) -> Vec<String> {
    let mut names: Vec<String> = nodes.iter().map(|node| node.name.clone()).collect();
    names.sort_by_key(|name| {
        (
            if is_exit_blocked(name) { 1_u8 } else { 0 },
            region_rank(name),
            name.to_lowercase(),
        )
    });
    names
}

/// 0 = US, 1 = JP, 2 = other. Region tokens are matched as whole
/// alphanumeric words so "JPN"-style names do not count as JP. Catalog names
/// without an explicit token are "City · Codename", so fall back to a city
/// lookup — keep the map aligned with `CITY_REGIONS` in
/// app/src/pages/tono/node-meta.ts.
pub fn region_rank(name: &str) -> u8 {
    let mut rank = 2;
    for token in name
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
    {
        if token.eq_ignore_ascii_case("us") {
            return 0;
        }
        if token.eq_ignore_ascii_case("jp") {
            rank = 1;
        }
    }
    if rank != 2 {
        return rank;
    }
    let city = name.split('·').next().unwrap_or(name).trim().to_lowercase();
    match city.as_str() {
        "los angeles" | "salt lake city" | "buffalo" | "new york" | "san jose" | "seattle"
        | "chicago" | "dallas" | "miami" => 0,
        "tokyo" | "osaka" => 1,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SyncFailure, default_usable_exit, install_and_persist, is_exit_blocked, is_legacy_wire_name, names_equivalent,
        next_catalog_exit, periodic_sync_continues, periodic_sync_interval, region_rank, replacement_for_selection,
        run_with_retries, selected_exit_still_present, sort_server_names, suspend_rejected_session, tcp_probe_socket,
    };
    use std::collections::BTreeSet;
    use std::net::Ipv4Addr;
    use std::path::{Path, PathBuf};
    use tono_core::catalog::{CatalogCache, catalog_digest};
    use tono_core::node::{NodeProtocol, ValidatedNode};
    use tono_core::{CatalogError, CatalogTracker, ExitCatalogResponse};

    fn node(name: &str) -> ValidatedNode {
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
            protocol: NodeProtocol::VlessReality,
            tls_fingerprint: None,
        }
    }

    fn hy2(name: &str) -> ValidatedNode {
        ValidatedNode {
            name: name.to_string(),
            server: Ipv4Addr::new(8, 8, 8, 8),
            port: 443,
            uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".to_string(),
            servername: "www.microsoft.com".to_string(),
            flow: None,
            client_fingerprint: None,
            reality_public_key: String::new(),
            reality_short_id: String::new(),
            protocol: NodeProtocol::Hysteria2,
            tls_fingerprint: Some("e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db".to_string()),
        }
    }

    /// H13-F2: waking from an 8 h sleep yields one catch-up sync, not one
    /// authenticated catalog + policy round per missed 300 s period.
    #[tokio::test(start_paused = true)]
    async fn periodic_sync_after_long_sleep_ticks_once_not_per_missed_period() {
        let mut interval = periodic_sync_interval();
        interval.tick().await;
        tokio::time::advance(std::time::Duration::from_secs(8 * 60 * 60)).await;
        interval.tick().await;
        let burst = tokio::time::timeout(std::time::Duration::from_secs(1), interval.tick()).await;
        assert!(burst.is_err(), "missed periods must not fire again after the wake tick");
    }

    /// H13-F3: a session the control plane refuses (expired plan, used-up
    /// allowance, revoked device) costs one attempt, suspends the Ready
    /// account and ends the periodic sync, instead of four refreshes every
    /// 300 s under a UI that still reads Ready. The telemetry uploader shares
    /// `periodic_sync_continues`; the network-log uploader stops too (W2).
    #[tokio::test(start_paused = true)]
    async fn rejected_session_is_not_retried_and_suspends_periodic_sync() {
        let mut attempts = 0;
        let result = run_with_retries(|| {
            attempts += 1;
            async { Err(SyncFailure::SessionRejected) }
        })
        .await;
        assert!(matches!(result, Err(SyncFailure::SessionRejected)));
        assert_eq!(attempts, 1, "a rejected session must not be retried");

        let state = crate::tono::state::TonoState::for_test();
        let mut inner = state.lock().await;
        inner.sign_in_generation = 4;
        inner.account_state = crate::tono::state::AccountState::Ready;
        inner.account = Some(
            serde_json::from_value(serde_json::json!({
                "id": "fixture-owner", "email": "fixture@example.test",
            }))
            .unwrap(),
        );
        assert!(periodic_sync_continues(&inner, 4));
        assert!(crate::tono::log_upload::periodic_upload_continues(&inner, 4, "fixture-owner"));
        assert!(suspend_rejected_session(&mut inner, 4));
        assert_eq!(inner.account_state, crate::tono::state::AccountState::Suspended);
        assert!(!periodic_sync_continues(&inner, 4));
        assert!(!crate::tono::log_upload::periodic_upload_continues(&inner, 4, "fixture-owner"));
    }

    #[test]
    fn region_rank_matches_whole_words_only() {
        assert_eq!(region_rank("🇺🇸 US Reality 01"), 0);
        assert_eq!(region_rank("us west"), 0);
        assert_eq!(region_rank("JP Reality 02"), 1);
        assert_eq!(region_rank("jp"), 1);
        assert_eq!(region_rank("SG Reality 03"), 2);
        // Substrings do not count.
        assert_eq!(region_rank("JPN East"), 2);
        assert_eq!(region_rank("Rust Server"), 2);
        // City names carry the region when no explicit token is present.
        assert_eq!(region_rank("Tokyo · Sakura"), 1);
        assert_eq!(region_rank("Osaka · Wave"), 1);
        assert_eq!(region_rank("Los Angeles · Sunset"), 0);
        assert_eq!(region_rank("Salt Lake City · Summit"), 0);
        assert_eq!(region_rank("Buffalo · Niagara"), 0);
        assert_eq!(region_rank("Paris · Seine"), 2);
        // An explicit token still wins over the city segment.
        assert_eq!(region_rank("Tokyo · US Backup"), 0);
    }

    #[test]
    fn servers_sort_us_then_jp_then_others() {
        let nodes = vec![
            node("SG Reality 03"),
            node("JP Reality 02"),
            node("US Reality 01"),
            node("🇯🇵 JP Reality 01"),
            node("🇺🇸 US Reality 02"),
            node("UK Reality 01"),
        ];
        let sorted = sort_server_names(&nodes);
        assert_eq!(
            sorted,
            vec![
                "US Reality 01",
                "🇺🇸 US Reality 02",
                "JP Reality 02",
                "🇯🇵 JP Reality 01",
                "SG Reality 03",
                "UK Reality 01",
            ]
        );
    }

    #[test]
    fn unblocked_exits_sort_by_region_then_name() {
        // The blocklist is currently empty (the US-VLESS-Reality quarantine was
        // lifted after the node was re-verified live); everything sorts by
        // region then name. Salt Lake City ranks US via the city table.
        let nodes = vec![
            node("US-VLESS-Reality"),
            node("Salt Lake City · Summit"),
            node("JP Reality 02"),
            node("US West 01"),
        ];
        assert!(!is_exit_blocked("US-VLESS-Reality"));
        assert_eq!(
            sort_server_names(&nodes),
            vec![
                "Salt Lake City · Summit",
                "US West 01",
                "US-VLESS-Reality",
                "JP Reality 02",
            ]
        );
        // Preferred default still picks Salt Lake.
        assert_eq!(
            default_usable_exit(&nodes, None).as_deref(),
            Some("Salt Lake City · Summit")
        );
    }

    #[test]
    fn routing_default_proxy_wins_when_present_in_the_catalog() {
        let nodes = vec![
            node("Salt Lake City · Summit"),
            node("Home VPS 01"),
            node("US West 01"),
        ];
        // The admin default beats the preferred list.
        assert_eq!(
            default_usable_exit(&nodes, Some("Home VPS 01")).as_deref(),
            Some("Home VPS 01")
        );
        // A default naming no catalog node falls through to the old logic.
        assert_eq!(
            default_usable_exit(&nodes, Some("No Such Node")).as_deref(),
            Some("Salt Lake City · Summit")
        );
    }

    #[test]
    fn leftover_wire_name_is_replaced_by_the_city_catalog() {
        assert!(is_legacy_wire_name("US-VLESS-Reality"));
        assert!(is_legacy_wire_name("🇺🇸 US-VLESS-Reality"));
        assert!(names_equivalent("🇺🇸 US-VLESS-Reality", "US-VLESS-Reality"));
        assert!(!is_legacy_wire_name("Salt Lake City · Summit"));
        let nodes = vec![
            node("US-VLESS-Reality"),
            node("Salt Lake City · Summit"),
            node("Buffalo · Niagara"),
        ];
        // A leftover name that is still in this catalog stays put. Auto-hopping
        // after every CORE_EXIT made China testers' manual Salt Lake pick jump.
        assert_eq!(
            replacement_for_selection(Some("US-VLESS-Reality"), &nodes, None, None),
            None
        );
        assert_eq!(
            replacement_for_selection(Some("Salt Lake City · Summit"), &nodes, None, None),
            None
        );
        assert_eq!(
            replacement_for_selection(Some("imported leftover"), &nodes, None, None).as_deref(),
            Some("Salt Lake City · Summit")
        );
    }

    #[test]
    fn recent_success_only_replaces_missing_choices_and_never_selects_hy2() {
        let nodes = vec![node("Salt Lake City · Summit"), node("Tokyo · Fuji"), hy2("Tokyo · Fuji · hy2")];
        assert_eq!(replacement_for_selection(None, &nodes, None, Some("Tokyo · Fuji")).as_deref(), Some("Tokyo · Fuji"));
        assert_eq!(replacement_for_selection(Some("Salt Lake City · Summit"), &nodes, None, Some("Tokyo · Fuji")), None);
        assert_eq!(replacement_for_selection(None, &nodes, None, Some("Tokyo · Fuji · hy2")).as_deref(), Some("Salt Lake City · Summit"));
        assert_eq!(replacement_for_selection(None, &nodes, None, Some("removed node")).as_deref(), Some("Salt Lake City · Summit"));
    }

    #[test]
    fn catalog_failover_walks_unused_cities_once() {
        let nodes = vec![
            node("Salt Lake City · Summit"),
            node("Buffalo · Niagara"),
            node("Los Angeles · Harbor"),
        ];
        let mut tried = BTreeSet::new();
        let first = next_catalog_exit(Some("Salt Lake City · Summit"), &nodes, &tried)
            .expect("next city");
        assert_ne!(first, "Salt Lake City · Summit");
        tried.insert("Salt Lake City · Summit".into());
        tried.insert(first.clone());
        let second = next_catalog_exit(Some(&first), &nodes, &tried).expect("third city");
        assert_ne!(second, first);
        tried.insert(second);
        assert_eq!(next_catalog_exit(Some("Los Angeles · Harbor"), &nodes, &tried), None);
    }

    #[test]
    fn catalog_failover_skips_hy2_sibling() {
        let nodes = vec![
            node("Salt Lake City · Summit"),
            hy2("Salt Lake City · Summit · hy2"),
            node("Buffalo · Niagara"),
        ];
        let tried = BTreeSet::new();
        assert_eq!(
            next_catalog_exit(Some("Salt Lake City · Summit"), &nodes, &tried).as_deref(),
            Some("Buffalo · Niagara")
        );
        assert_eq!(
            next_catalog_exit(Some("Salt Lake City · Summit · hy2"), &nodes, &tried).as_deref(),
            Some("Buffalo · Niagara")
        );
        assert!(tcp_probe_socket(&node("Tokyo · Sakura")).is_some());
        assert!(tcp_probe_socket(&hy2("Tokyo · Sakura · hy2")).is_none());
        assert_eq!(
            default_usable_exit(&[hy2("Alpha · hy2"), node("Zulu · TCP")], None).as_deref(),
            Some("Zulu · TCP")
        );
    }

    #[test]
    fn adding_another_city_keeps_the_selected_exit() {
        let nodes = vec![node("Los Angeles · Canyon"), node("Los Angeles · Westwood")];
        assert!(selected_exit_still_present("Los Angeles · Canyon", &nodes));
        assert!(!selected_exit_still_present("Los Angeles · Mesa", &nodes));
    }

    #[test]
    fn server_sort_is_case_insensitive_within_groups() {
        let nodes = vec![node("us beta"), node("US Alpha")];
        assert_eq!(sort_server_names(&nodes), vec!["US Alpha", "us beta"]);
    }

    // ---- install_and_persist (M2) ----

    const NODE_YAML: &str = r#"  - name: "US Reality 01"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d"
    tls: true
    sni: "www.microsoft.com"
    flow: xtls-rprx-vision
    network: tcp
    reality-opts:
      public-key: "0123456789abcdef0123456789abcdef0123456789a"
      short-id: "0123456789abcdef"
"#;

    fn catalog(revision: i64) -> ExitCatalogResponse {
        let yaml = format!("proxies:\n{NODE_YAML}");
        ExitCatalogResponse {
            revision,
            sha256: catalog_digest(&yaml),
            yaml,
            updated_at: None,
            routing: None,
        }
    }

    /// Read-side no-op policy; write hook default (no-op). Store failures
    /// below come from the filesystem layout, not the policy.
    struct NoopCheck;
    impl tono_core::catalog::CacheSafetyCheck for NoopCheck {
        fn check_path(&self, _path: &Path) -> Result<(), CatalogError> {
            Ok(())
        }
        fn check_open(&self, _file: &std::fs::File) -> Result<(), CatalogError> {
            Ok(())
        }
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let serial = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("tono-app-test-{tag}-{}-{serial}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn store_failure_commits_nothing_and_redelivery_retries() {
        let dir = TempDir::new("persist-fail");
        // A cache whose directory cannot be created: its parent is a file.
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"not a directory").unwrap();
        let bad_cache = CatalogCache::new(&blocker.join("tono"), Box::new(NoopCheck));

        let tracker = CatalogTracker::new();
        let response = catalog(7);
        let err = install_and_persist(&tracker, &bad_cache, &response).unwrap_err();
        assert!(matches!(err, CatalogError::Io(_)), "{err}");
        // Nothing committed: the caller's tracker is untouched.
        assert_eq!(tracker.current_revision(), -1);

        // Redelivery of the same revision against a working cache installs
        // fresh — no "Unchanged" black hole (M2).
        let good_dir = TempDir::new("persist-good");
        let good_cache = CatalogCache::new(good_dir.path(), Box::new(NoopCheck));
        let effect = install_and_persist(&tracker, &good_cache, &response).unwrap();
        assert!(effect.installed);
        assert_eq!(effect.tracker.current_revision(), 7);
        assert_eq!(effect.nodes.len(), 1);
    }

    #[test]
    fn successful_install_commits_and_same_revision_is_unchanged() {
        let dir = TempDir::new("persist-ok");
        let cache = CatalogCache::new(dir.path(), Box::new(NoopCheck));
        let tracker = CatalogTracker::new();

        let effect = install_and_persist(&tracker, &cache, &catalog(3)).unwrap();
        assert!(effect.installed);
        assert_eq!(effect.tracker.current_revision(), 3);
        assert_eq!(effect.nodes.len(), 1);
        assert!(cache.path().exists(), "verified bytes must reach the disk cache");

        let effect = install_and_persist(&effect.tracker, &cache, &catalog(3)).unwrap();
        assert!(!effect.installed, "same revision + digest is idempotent");
        assert_eq!(effect.tracker.current_revision(), 3);
    }

    #[test]
    fn invalid_home_keeps_verified_cache_and_tracker_unchanged() {
        let dir = TempDir::new("persist-invalid-home");
        let cache = CatalogCache::new(dir.path(), Box::new(NoopCheck));
        let accepted = install_and_persist(&CatalogTracker::new(), &cache, &catalog(5)).unwrap();
        let verified_bytes = std::fs::read(cache.path()).unwrap();

        let mut rejected = catalog(6);
        rejected.routing = Some(tono_core::CatalogRouting {
            home_proxy: Some("missing required residential node".into()),
            ..Default::default()
        });
        let err = install_and_persist(&accepted.tracker, &cache, &rejected).unwrap_err();
        assert_eq!(err, CatalogError::InvalidResponse);
        assert_eq!(accepted.tracker.current_revision(), 5);
        assert_eq!(std::fs::read(cache.path()).unwrap(), verified_bytes);
        assert_eq!(cache.load().unwrap().response.revision, 5);

        // A corrected redelivery is still installable; rejection did not
        // consume the next revision or poison the previous verified cache.
        let corrected = install_and_persist(&accepted.tracker, &cache, &catalog(6)).unwrap();
        assert!(corrected.installed);
        assert_eq!(corrected.tracker.current_revision(), 6);
    }

    #[test]
    fn stale_revision_is_reported_without_touching_anything() {
        let dir = TempDir::new("persist-stale");
        let cache = CatalogCache::new(dir.path(), Box::new(NoopCheck));
        let tracker = CatalogTracker::new();
        let effect = install_and_persist(&tracker, &cache, &catalog(5)).unwrap();
        assert!(effect.installed);

        let err = install_and_persist(&effect.tracker, &cache, &catalog(4)).unwrap_err();
        assert_eq!(err, CatalogError::StaleRevision);
        assert_eq!(effect.tracker.current_revision(), 5);
    }
}
