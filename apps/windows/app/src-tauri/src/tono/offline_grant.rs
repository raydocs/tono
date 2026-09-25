//! Offline connection admission (#582).
//!
//! A launch that cannot reach the control plane may still reach `Ready` on a positive,
//! account-bound grant (`offline-grant.json`) that the last verified online session left, when it
//! matches what is installed in memory now. The grant is written only from a catalog the server
//! just confirmed, after the credential store acknowledged the refresh token it binds. It is
//! revoked by overwriting it with a verdict, never by deleting it. The server's answers arrive
//! through tono-core's [`SessionVerdictSink`]; app code never infers a refusal from an error
//! variant. No client file is entitlement (the exit roster is), so there is no client-side offline
//! age limit.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tono_core::{
    CatalogTracker,
    auth::{SessionVerdict, SessionVerdictSink},
    credentials::CredentialStore,
};
use tono_logging::{Type, logging};

use crate::tono::state::{AccountState, TonoInner, TonoState};

/// Beside the catalog cache, in the per-user Tono data directory.
pub const GRANT_FILE_NAME: &str = "offline-grant.json";

/// How long Quit waits for a revocation that has not reached the disk yet. Quit never hangs on a
/// failing disk; past this budget the revocation is lost with the process (a remaining limit).
pub const QUIT_DURABILITY_BUDGET: Duration = Duration::from_secs(3);

/// First retry delay of a tombstone the disk refused; doubles up to [`TOMBSTONE_RETRY_MAX`].
const TOMBSTONE_RETRY_INITIAL: Duration = Duration::from_secs(1);
const TOMBSTONE_RETRY_MAX: Duration = Duration::from_secs(30);

/// How long a catalog sync waits for the credential store to acknowledge the token a grant binds.
/// The sync holds the catalog-sync lock, so a stalled vault must not stall it; a flush past this
/// budget records no grant.
const GRANT_FLUSH_BUDGET: Duration = Duration::from_secs(2);

/// Offline eligibility in memory, ordered by severity. A later `Verified` for the same identity
/// lifts `FORBIDDEN`: the server accepted the session and only refused one request. `REFUSED`
/// lifts only when a sign-in adopts a new identity; the refused session is dead.
const ELIGIBLE: u8 = 0;
const FORBIDDEN: u8 = 1;
const REFUSED: u8 = 2;

const REASON_REFUSED: &str = "refused";
const REASON_FORBIDDEN: &str = "forbidden";

const REVOKED_REJECTION: &str = "Tono did not accept this session; Connect stays blocked until Tono verifies it again";
const OFFLINE_MISMATCH_REJECTION: &str =
    "this session no longer matches what Tono last verified offline; retry when Tono is reachable";

/// What the last verified online session proved: bound to its refresh token and to the exact
/// catalog the server confirmed. Never holds the token itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfflineGrant {
    /// Display only: offline there is no `me()` to confirm it.
    #[serde(default)]
    pub account_id: Option<String>,
    /// [`token_digest`] of the refresh token the credential store acknowledged.
    pub token_sha256: String,
    /// `sha256` of the server response that installed or confirmed the catalog.
    pub catalog_sha256: String,
    /// `routing_digest` of that same response.
    pub routing_sha256: String,
    /// Epoch milliseconds of that server confirmation.
    pub verified_at: i64,
}

/// `offline-grant.json`. Anything else — a missing file, a torn write, an unknown verdict — is
/// unreadable, and unreadable refuses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "lowercase")]
enum GrantFile {
    Granted(OfflineGrant),
    Revoked {
        reason: String,
        at: i64,
        /// [`token_digest`] of the session the server revoked. A record without one (older, or
        /// written with no session token in memory) revokes no session it can name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token_sha256: Option<String>,
    },
}

/// A revocation that the disk has not acknowledged yet.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Tombstone {
    reason: String,
    at: i64,
    token_sha256: Option<String>,
    /// Unique per revocation: a writer or a grant write tells the tombstone it saw from a newer one.
    generation: u64,
}

/// Restore's offline answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfflineAdmission {
    /// Ready on the grant, which is now this session's offline verification.
    Admitted,
    /// The grant records a revocation (its reason): the account is suspended.
    Revoked(String),
    /// No positive grant matching memory: restore keeps its ordinary answer.
    Refused(&'static str),
}

/// SHA-256 of the refresh token, base64url without padding (the catalog digest recipe).
pub fn token_digest(refresh_token: &str) -> String {
    tono_core::catalog::catalog_digest(refresh_token)
}

fn read_grant_file(path: &Path) -> Option<GrantFile> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Whether a revocation recorded for `revoked_sha256` names the session whose refresh token is
/// `refresh_token`.
fn revokes_session(revoked_sha256: Option<&str>, refresh_token: Option<&str>) -> bool {
    match (revoked_sha256, refresh_token) {
        (Some(revoked), Some(token)) => token_digest(token) == revoked,
        _ => false,
    }
}

/// Why `grant` does not describe what is in memory, if it does not.
fn grant_mismatch(grant: &OfflineGrant, refresh_token: Option<&str>, tracker: &CatalogTracker) -> Option<&'static str> {
    let Some(token) = refresh_token else {
        return Some("no session token in memory");
    };
    if token_digest(token) != grant.token_sha256 {
        return Some("the grant belongs to another session token");
    }
    if tracker.current_digest() != Some(grant.catalog_sha256.as_str())
        || tracker.current_routing() != Some(grant.routing_sha256.as_str())
    {
        return Some("the catalog in memory is not the one the grant verified");
    }
    None
}

/// Offline eligibility of this process's session, shared with the tono-core verdict sink. The
/// sink runs under tono-core's identity lock, so everything it touches here is an atomic, a
/// short synchronous lock or a spawn; the product mutex is reached only by [`apply_verdicts`].
pub struct OfflineGate {
    path: PathBuf,
    /// The session's credential store, read synchronously (memory) at report time: a tombstone
    /// binds the refresh token it revoked.
    credentials: Arc<dyn CredentialStore>,
    /// `ELIGIBLE`, `FORBIDDEN` or `REFUSED`. Set synchronously at report time, so Connect refuses
    /// before any UI or disk catches up.
    revocation: AtomicU8,
    /// The grant this session was admitted on while no server answer has arrived yet.
    offline: parking_lot::Mutex<Option<OfflineGrant>>,
    /// The newest revocation the disk has not acknowledged. A revocation and a lift change
    /// `revocation` under this lock, so a grant write that checks it here sees either the lift or
    /// the tombstone of a revocation after it.
    tombstone: parking_lot::Mutex<Option<Tombstone>>,
    tombstone_generation: AtomicU64,
    /// One tombstone writer at a time; it always writes the newest pending tombstone.
    tombstone_writer: AtomicBool,
    tombstone_attempts: AtomicU32,
    /// Wakes a writer sleeping in its retry backoff for an immediate attempt.
    retry_now: tokio::sync::Notify,
    /// Serializes every write of the grant file, so a grant whose revocation check passed cannot
    /// land after the tombstone of a revocation that came later.
    file: parking_lot::Mutex<()>,
    /// Woken when the tombstone slot drains.
    durable: tokio::sync::Notify,
    /// Wakes [`apply_verdicts`].
    changed: tokio::sync::Notify,
    /// tono-core identity epoch of the latest refusal not yet applied to the account state.
    pending_refusal: parking_lot::Mutex<Option<u64>>,
    left_offline: AtomicBool,
    /// Whether the answer that ended offline mode was `Verified`: the server accepted a session
    /// admitted without an account, so [`apply_verdicts`] has the account read now.
    left_offline_verified: AtomicBool,
    applier: AtomicBool,
}

impl OfflineGate {
    pub fn new(dir: PathBuf, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            path: dir.join(GRANT_FILE_NAME),
            credentials,
            revocation: AtomicU8::new(ELIGIBLE),
            offline: parking_lot::Mutex::new(None),
            tombstone: parking_lot::Mutex::new(None),
            tombstone_generation: AtomicU64::new(0),
            tombstone_writer: AtomicBool::new(false),
            tombstone_attempts: AtomicU32::new(0),
            retry_now: tokio::sync::Notify::new(),
            file: parking_lot::Mutex::new(()),
            durable: tokio::sync::Notify::new(),
            changed: tokio::sync::Notify::new(),
            pending_refusal: parking_lot::Mutex::new(None),
            left_offline: AtomicBool::new(false),
            left_offline_verified: AtomicBool::new(false),
            applier: AtomicBool::new(false),
        }
    }

    /// The sink tono-core reports every classified server answer to.
    pub fn verdict_sink(self: &Arc<Self>) -> Arc<dyn SessionVerdictSink> {
        Arc::new(OfflineVerdictSink(Arc::clone(self)))
    }

    /// Whether the server refused or forbade this session since it was adopted.
    pub fn revoked(&self) -> bool {
        self.revocation.load(Ordering::Acquire) != ELIGIBLE
    }

    /// The grant's server confirmation time while this session runs on it offline.
    pub fn offline_verified_at_ms(&self) -> Option<i64> {
        self.offline.lock().as_ref().map(|grant| grant.verified_at)
    }

    /// End offline mode. Returns whether the session was offline.
    pub fn leave_offline(&self) -> bool {
        self.offline.lock().take().is_some()
    }

    /// A sign-in adopted a new identity (tono-core retired the previous one first): nothing the
    /// server told the previous identity applies to it. A tombstone still waiting for the disk
    /// keeps retrying until the new identity's first grant supersedes it.
    pub fn adopt_new_identity(&self) {
        self.revocation.store(ELIGIBLE, Ordering::Release);
        self.leave_offline();
    }

    /// Offline admission (#582 rule 4): compare the grant with what is in memory now — the
    /// hydrated refresh token and the tracker `seed_from_cache` installed. The catalog cache is
    /// never re-read here: memory is what Connect dials. Reading the grant file is the only I/O.
    pub fn admit(&self, refresh_token: Option<&str>, tracker: &CatalogTracker, has_nodes: bool) -> OfflineAdmission {
        match self.revocation.load(Ordering::Acquire) {
            ELIGIBLE => {}
            REFUSED => return OfflineAdmission::Revoked(REASON_REFUSED.to_string()),
            _ => return OfflineAdmission::Refused("the server forbade this session"),
        }
        let grant = match read_grant_file(&self.path) {
            Some(GrantFile::Granted(grant)) => grant,
            // A revocation binds the session it revoked. Another session's, or one that names none,
            // is no positive grant and nothing more: it never suspends this session.
            Some(GrantFile::Revoked { token_sha256, .. })
                if !revokes_session(token_sha256.as_deref(), refresh_token) =>
            {
                return OfflineAdmission::Refused("the revocation belongs to another session token");
            }
            // Another 403 revokes offline eligibility only; it never suspends the account.
            Some(GrantFile::Revoked { reason, .. }) if reason == REASON_FORBIDDEN => {
                return OfflineAdmission::Refused("the server forbade this session");
            }
            Some(GrantFile::Revoked { reason, .. }) => return OfflineAdmission::Revoked(reason),
            None => return OfflineAdmission::Refused("no readable offline grant"),
        };
        if let Some(mismatch) = grant_mismatch(&grant, refresh_token, tracker) {
            return OfflineAdmission::Refused(mismatch);
        }
        if !has_nodes {
            return OfflineAdmission::Refused("no installed exits");
        }
        *self.offline.lock() = Some(grant);
        OfflineAdmission::Admitted
    }

    /// Connect's gate (#582 rule 5): a revoked session is refused whatever its state, and an
    /// offline session must still hold exactly what its admitted grant verified.
    pub fn connect_refusal(&self, refresh_token: Option<&str>, tracker: &CatalogTracker) -> Option<&'static str> {
        if self.revoked() {
            return Some(REVOKED_REJECTION);
        }
        let offline = self.offline.lock();
        let grant = offline.as_ref()?;
        grant_mismatch(grant, refresh_token, tracker).map(|_| OFFLINE_MISMATCH_REJECTION)
    }

    /// Record a server-verified session (#582 rule 1). Skipped while this session is revoked; the
    /// check runs under the file lock, so a grant can never land after a later tombstone. A grant
    /// that lands supersedes a tombstone still waiting from before this session became eligible:
    /// its writer must not land it over this grant.
    pub fn write_grant(&self, grant: &OfflineGrant) -> anyhow::Result<bool> {
        let bytes = serde_json::to_vec(&GrantFile::Granted(grant.clone()))?;
        let _file = self.file.lock();
        let superseded = {
            let pending = self.tombstone.lock();
            if self.revoked() {
                return Ok(false);
            }
            pending.as_ref().map(|tombstone| tombstone.generation)
        };
        crate::tono::state::write_private_file(&self.path, &bytes)?;
        if let Some(generation) = superseded {
            self.drop_tombstone(generation);
        }
        Ok(true)
    }

    /// Wait, bounded, until no revocation is waiting for the disk. The quit path calls it. A writer
    /// sleeping in its retry backoff is woken first for an immediate attempt, so the budget is not
    /// spent on a backoff that outlasts it.
    pub async fn wait_durable(&self, budget: Duration) -> bool {
        let pending = self.tombstone.lock().is_some();
        if pending {
            // A stored permit: a writer between its failed attempt and its sleep still sees it.
            self.retry_now.notify_one();
        }
        tokio::time::timeout(budget, async {
            loop {
                let notified = self.durable.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                let drained = self.tombstone.lock().is_none();
                if drained {
                    return;
                }
                notified.as_mut().await;
            }
        })
        .await
        .is_ok()
    }

    #[cfg(test)]
    pub(crate) fn tombstone_attempts(&self) -> u32 {
        self.tombstone_attempts.load(Ordering::Acquire)
    }

    /// #582 rule 3: memory first (Connect refuses from here on), then the durable overwrite on a
    /// writer that retries until the disk acknowledges it. Never a delete.
    fn revoke(self: &Arc<Self>, level: u8, reason: String) {
        // The session this answer revoked: the refresh token in memory now (a memory read).
        let token_sha256 = self.credentials.refresh_token().ok().flatten().map(|token| token_digest(&token));
        {
            let mut pending = self.tombstone.lock();
            let previous = self.revocation.fetch_max(level, Ordering::AcqRel);
            // A lesser verdict after a stronger one records nothing: another 403 after a refusal
            // must not replace the refusal, pending or on disk.
            if level < previous {
                return;
            }
            let generation = self.tombstone_generation.fetch_add(1, Ordering::AcqRel);
            *pending = Some(Tombstone { reason, at: crate::tono::commands::epoch_millis(), token_sha256, generation });
        }
        if self.tombstone_writer.swap(true, Ordering::AcqRel) {
            // The running writer picks up the newest tombstone.
            return;
        }
        let gate = Arc::clone(self);
        let writer = async move { gate.write_tombstone_until_durable().await };
        // The reporting request runs on the product runtime; spawn there (tests: the test runtime).
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => {
                runtime.spawn(writer);
            }
            Err(_) => {
                tauri::async_runtime::spawn(writer);
            }
        }
    }

    async fn write_tombstone_until_durable(self: Arc<Self>) {
        let mut delay = TOMBSTONE_RETRY_INITIAL;
        loop {
            let drained = self.tombstone.lock().is_none();
            if drained {
                self.tombstone_writer.store(false, Ordering::Release);
                // A revocation recorded between the empty read and the release saw the flag still
                // set and left its tombstone to this writer.
                let stranded = self.tombstone.lock().is_some();
                if stranded && !self.tombstone_writer.swap(true, Ordering::AcqRel) {
                    continue;
                }
                self.durable.notify_waiters();
                return;
            }
            let attempt = self.tombstone_attempts.fetch_add(1, Ordering::AcqRel).saturating_add(1);
            match self.write_pending_tombstone() {
                Ok(()) => {
                    delay = TOMBSTONE_RETRY_INITIAL;
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: the offline revocation is not on disk yet (attempt {attempt}); retrying: {error:#}"
                    );
                    // Ends early when a durability wait asks for an immediate attempt.
                    let _ = tokio::time::timeout(delay, self.retry_now.notified()).await;
                    delay = delay.saturating_mul(2).min(TOMBSTONE_RETRY_MAX);
                }
            }
        }
    }

    /// Write the pending tombstone as it stands under the file lock, so one that a lift or a grant
    /// write has since dropped is never written, and clear it once the disk acknowledged it.
    fn write_pending_tombstone(&self) -> anyhow::Result<()> {
        let _file = self.file.lock();
        let snapshot = self.tombstone.lock().clone();
        let Some(tombstone) = snapshot else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(&GrantFile::Revoked {
            reason: tombstone.reason.clone(),
            at: tombstone.at,
            token_sha256: tombstone.token_sha256.clone(),
        })?;
        crate::tono::state::write_private_file(&self.path, &bytes)?;
        self.drop_tombstone(tombstone.generation);
        Ok(())
    }

    /// Drop the pending tombstone if it is still revocation `generation`.
    fn drop_tombstone(&self, generation: u64) {
        let mut pending = self.tombstone.lock();
        if pending.as_ref().is_some_and(|tombstone| tombstone.generation == generation) {
            *pending = None;
            drop(pending);
            self.durable.notify_waiters();
        }
    }

    /// A later `Verified` for this identity lifts `FORBIDDEN`. The forbidden verdict still waiting
    /// for the disk is stale from then on: dropped, so its writer never lands it over a grant
    /// recorded after the lift.
    fn lift_forbidden(&self) {
        let mut pending = self.tombstone.lock();
        let lifted = self
            .revocation
            .compare_exchange(FORBIDDEN, ELIGIBLE, Ordering::AcqRel, Ordering::Acquire)
            .is_ok();
        if lifted && pending.take().is_some() {
            drop(pending);
            self.durable.notify_waiters();
        }
    }
}

struct OfflineVerdictSink(Arc<OfflineGate>);

impl SessionVerdictSink for OfflineVerdictSink {
    /// Runs under tono-core's identity lock, for the current identity only: atomics, short
    /// synchronous locks and a spawn. Never the product mutex, never the client.
    fn report(&self, identity_epoch: u64, verdict: SessionVerdict) {
        let gate = &self.0;
        let refused = matches!(verdict, SessionVerdict::Refused { .. });
        let verified = matches!(verdict, SessionVerdict::Verified);
        match verdict {
            SessionVerdict::Verified => gate.lift_forbidden(),
            SessionVerdict::Forbidden => gate.revoke(FORBIDDEN, REASON_FORBIDDEN.to_string()),
            SessionVerdict::Refused { code } => {
                let reason = code.map_or_else(|| REASON_REFUSED.to_string(), |code| format!("{REASON_REFUSED}: {code}"));
                gate.revoke(REFUSED, reason);
                *gate.pending_refusal.lock() = Some(identity_epoch);
            }
        }
        // #582 rule 5: offline mode ends at the first server answer, whatever it says.
        let left_offline = gate.leave_offline();
        if left_offline {
            // Before the flag it qualifies, so the applier that takes the flag also sees it.
            gate.left_offline_verified.store(verified, Ordering::Release);
            gate.left_offline.store(true, Ordering::Release);
        }
        if left_offline || refused {
            gate.changed.notify_one();
        }
    }
}

/// Connect's account gate for a Ready account, run by `connect` and `guard_snapshot` against the
/// session token in memory and the tracker Connect is about to dial from.
pub(crate) fn connect_refusal(inner: &TonoInner) -> Option<&'static str> {
    let token = inner.credentials.refresh_token().ok().flatten();
    inner.offline.connect_refusal(token.as_deref(), &inner.catalog_tracker)
}

/// Record the grant for a catalog the server has just installed or confirmed (`sync_once_inner`,
/// Installed or Unchanged). The digests come from that server response, never from the disk
/// cache, and the grant binds only a refresh token the credential store acknowledged. Tokens
/// rotate on refresh, so a grant is stale after a rotation until the next sync rewrites it; a
/// stale grant fails closed.
pub(crate) async fn record_server_verified_catalog(
    state: &Arc<TonoState>, auth_generation: u64, response: &tono_core::ExitCatalogResponse,
) {
    let catalog_sha256 = response.sha256.clone();
    let routing_sha256 = tono_core::catalog::routing_digest(response.routing.as_ref());
    let (credentials, token) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != auth_generation {
            return;
        }
        (Arc::clone(&inner.credentials), inner.credentials.refresh_token().ok().flatten())
    };
    let Some(token) = token else {
        return;
    };
    // Every mutation before this barrier, including the write of `token`, is acknowledged.
    match tokio::time::timeout(GRANT_FLUSH_BUDGET, credentials.flush()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            logging!(warn, Type::Service, "Tono: offline grant not recorded; the session token is not durable: {error}");
            return;
        }
        Err(_) => {
            logging!(warn, Type::Service, "Tono: offline grant not recorded; the credential store did not acknowledge in time");
            return;
        }
    }
    let inner = state.lock().await;
    let token_now = inner.credentials.refresh_token().ok().flatten();
    if inner.sign_in_generation != auth_generation
        || token_now.as_deref() != Some(token.as_str())
        || inner.catalog_tracker.current_digest() != Some(catalog_sha256.as_str())
        || inner.catalog_tracker.current_routing() != Some(routing_sha256.as_str())
    {
        return;
    }
    let grant = OfflineGrant {
        account_id: inner.account.as_ref().map(|user| user.id.clone()),
        token_sha256: token_digest(&token),
        catalog_sha256,
        routing_sha256,
        verified_at: crate::tono::commands::epoch_millis(),
    };
    if let Err(error) = inner.offline.write_grant(&grant) {
        logging!(warn, Type::Service, "Tono: failed to record the offline grant: {error:#}");
    }
}

/// Carry what the sink recorded into the product state: a refusal suspends the account (from any
/// state but signed out, mid-sign-in or closing; never touching protection) and leaving offline
/// mode republishes the status. When the server's acceptance ended offline mode for a Ready
/// session that has no account yet, `complete_account` is handed its sign-in generation to read
/// it. Started once per `TonoState` by the startup restore.
pub(crate) async fn apply_verdicts<E, C>(state: Arc<TonoState>, emit: E, complete_account: C)
where
    E: Fn(&TonoInner),
    C: Fn(u64),
{
    let gate = Arc::clone(&state.lock().await.offline);
    if gate.applier.swap(true, Ordering::AcqRel) {
        return;
    }
    loop {
        gate.changed.notified().await;
        let refused = gate.pending_refusal.lock().take();
        let left_offline = gate.left_offline.swap(false, Ordering::AcqRel);
        // Taken only with its flag, so an earlier wake cannot consume it ahead of that flag.
        let left_on_verified = left_offline && gate.left_offline_verified.swap(false, Ordering::AcqRel);
        let mut inner = state.lock().await;
        // A refusal of an identity a sign-in has since replaced is not this account's.
        let current = inner.client.diagnostics_log_identity().await;
        let suspended = refused == Some(current) && suspend_refused_session(&mut inner);
        if suspended {
            logging!(warn, Type::Service, "Tono: the control plane refused this session; account suspended, protection kept");
        }
        if suspended || left_offline {
            emit(&inner);
        }
        if left_on_verified && inner.account.is_none() && inner.account_state == AccountState::Ready {
            complete_account(inner.sign_in_generation);
        }
    }
}

fn suspend_refused_session(inner: &mut TonoInner) -> bool {
    if inner.account_close.is_some()
        || matches!(
            inner.account_state,
            AccountState::SignedOut | AccountState::Authenticating | AccountState::Suspended
        )
    {
        return false;
    }
    inner.account_state = AccountState::Suspended;
    true
}

/// Fixtures shared by the #582 admission tests (T3 restore, T4 here, T5 connection).
#[cfg(test)]
pub(crate) mod test_support {
    use std::{
        path::{Path, PathBuf},
        sync::Arc,
    };

    use tono_core::{ExitCatalogResponse, catalog::catalog_digest, credentials::MemoryCredentialStore};

    use super::{OfflineGate, OfflineGrant, token_digest};

    pub(crate) const ACCOUNT_A_UUID: &str = "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d";
    pub(crate) const ACCOUNT_B_UUID: &str = "11111111-2222-4333-8444-555555555555";

    /// A fresh data directory. A second `TonoState` over it is a relaunch.
    pub(crate) fn data_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tono-offline-{tag}-{}", tono_core::auth::new_installation_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// One valid exit, issued to the account whose client UUID is `uuid`.
    pub(crate) fn account_catalog(uuid: &str) -> ExitCatalogResponse {
        let yaml = format!(
            "proxies:\n  - name: \"US Reality 01\"\n    type: vless\n    server: 8.8.8.8\n    port: 443\n    uuid: \"{uuid}\"\n    tls: true\n    sni: \"www.microsoft.com\"\n    flow: xtls-rprx-vision\n    network: tcp\n    reality-opts:\n      public-key: \"0123456789abcdef0123456789abcdef0123456789a\"\n      short-id: \"0123456789abcdef\"\n"
        );
        ExitCatalogResponse {
            revision: 7,
            sha256: catalog_digest(&yaml),
            yaml,
            updated_at: None,
            routing: None,
            routing_sha256: None,
        }
    }

    /// The grant a verified online session for `catalog` and `refresh_token` leaves behind.
    pub(crate) fn grant_for(catalog: &ExitCatalogResponse, refresh_token: &str) -> OfflineGrant {
        OfflineGrant {
            account_id: Some("account-a".to_string()),
            token_sha256: token_digest(refresh_token),
            catalog_sha256: catalog.sha256.clone(),
            routing_sha256: tono_core::catalog::routing_digest(catalog.routing.as_ref()),
            verified_at: 1_000,
        }
    }

    /// Persist `catalog` through the product's platform cache, as a verified sync does.
    pub(crate) async fn store_catalog(dir: &Path, catalog: &ExitCatalogResponse) {
        let state = crate::tono::state::TonoState::for_test_in(dir.to_path_buf());
        state.lock().await.catalog_cache().store(catalog).unwrap();
    }

    /// What a verified online session leaves on disk: the catalog cache and its grant.
    pub(crate) async fn leave_verified_session(dir: &Path, catalog: &ExitCatalogResponse, refresh_token: &str) {
        store_catalog(dir, catalog).await;
        let gate = OfflineGate::new(dir.to_path_buf(), Arc::new(MemoryCredentialStore::new()));
        let written = gate.write_grant(&grant_for(catalog, refresh_token)).unwrap();
        assert!(written, "a session nothing revoked records its grant");
    }
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc, time::Duration};

    use tono_core::{
        CredentialKey,
        auth::SessionVerdict,
        credentials::CredentialStore as _,
    };

    use super::{
        GRANT_FILE_NAME, OfflineAdmission, TOMBSTONE_RETRY_INITIAL,
        test_support::{ACCOUNT_A_UUID, account_catalog, data_dir, leave_verified_session},
    };
    use crate::tono::state::TonoState;

    fn file_verdict(path: &Path) -> String {
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        value["verdict"].as_str().unwrap().to_string()
    }

    /// Test seam for a failing disk: a read-only grant file refuses the private writer on every
    /// platform, while it still reads back as whatever it said before.
    fn set_readonly(path: &Path, readonly: bool) {
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(readonly);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    /// #582 T4: a refusal revokes offline admission in memory at report time, while the disk
    /// refuses the tombstone; the retry lands it, and a relaunch over the same directory (fresh
    /// memory, same disk) is refused.
    #[tokio::test(start_paused = true)]
    async fn refusal_revokes_memory_at_once_and_retries_the_tombstone_until_it_lands() {
        let dir = data_dir("t4");
        let catalog = account_catalog(ACCOUNT_A_UUID);
        leave_verified_session(&dir, &catalog, "session-a").await;
        let path = dir.join(GRANT_FILE_NAME);
        assert_eq!(file_verdict(&path), "granted");

        let state = TonoState::for_test_in(dir.clone());
        let gate = {
            let inner = state.lock().await;
            inner.credentials.set_local(CredentialKey::RefreshToken, "session-a").unwrap();
            Arc::clone(&inner.offline)
        };
        set_readonly(&path, true);
        gate.verdict_sink().report(1, SessionVerdict::Refused { code: Some("INVALID_REFRESH_TOKEN".to_string()) });
        assert!(gate.revoked(), "the refusal must block offline admission in memory at report time");
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }
        assert!(gate.tombstone_attempts() >= 1, "the first durable write ran and the disk refused it");
        assert_eq!(file_verdict(&path), "granted", "the disk still grants: only the retry can revoke it");

        set_readonly(&path, false);
        tokio::time::advance(TOMBSTONE_RETRY_INITIAL * 2).await;
        assert!(gate.wait_durable(Duration::from_secs(60)).await, "the retry must land the tombstone");
        assert_eq!(file_verdict(&path), "revoked");

        let relaunch = TonoState::for_test_in(dir.clone());
        let mut inner = relaunch.lock().await;
        inner.credentials.set_local(CredentialKey::RefreshToken, "session-a").unwrap();
        crate::tono::catalog_sync::seed_from_cache(&mut inner);
        let token = inner.credentials.refresh_token().unwrap();
        let admission = inner.offline.admit(token.as_deref(), &inner.catalog_tracker, !inner.nodes.is_empty());
        assert!(matches!(admission, OfflineAdmission::Revoked(_)), "{admission:?}");
        drop(inner);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
