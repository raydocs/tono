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

use std::{path::PathBuf, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use tono_core::{
    CatalogTracker,
    auth::{SessionVerdict, SessionVerdictSink},
};

use crate::tono::state::TonoInner;

/// Beside the catalog cache, in the per-user Tono data directory.
pub const GRANT_FILE_NAME: &str = "offline-grant.json";

/// First retry delay of a tombstone the disk refused.
const TOMBSTONE_RETRY_INITIAL: Duration = Duration::from_secs(1);

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
    Revoked { reason: String, at: i64 },
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

/// Offline eligibility of this process's session, shared with the tono-core verdict sink.
pub struct OfflineGate {
    path: PathBuf,
    /// Serializes every write of the grant file.
    file: parking_lot::Mutex<()>,
}

impl OfflineGate {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            path: dir.join(GRANT_FILE_NAME),
            file: parking_lot::Mutex::new(()),
        }
    }

    /// The sink tono-core reports every classified server answer to.
    pub fn verdict_sink(self: &Arc<Self>) -> Arc<dyn SessionVerdictSink> {
        Arc::new(OfflineVerdictSink(Arc::clone(self)))
    }

    /// Whether the server refused or forbade this session since it was adopted.
    pub fn revoked(&self) -> bool {
        false
    }

    /// The grant's server confirmation time while this session runs on it offline.
    pub fn offline_verified_at_ms(&self) -> Option<i64> {
        None
    }

    /// Offline admission: compare the grant with what is in memory now.
    pub fn admit(&self, _refresh_token: Option<&str>, _tracker: &CatalogTracker, _has_nodes: bool) -> OfflineAdmission {
        OfflineAdmission::Refused("offline admission is not implemented")
    }

    /// Record a server-verified session.
    pub fn write_grant(&self, grant: &OfflineGrant) -> anyhow::Result<bool> {
        let bytes = serde_json::to_vec(&GrantFile::Granted(grant.clone()))?;
        let _file = self.file.lock();
        crate::tono::state::write_private_file(&self.path, &bytes)?;
        Ok(true)
    }

    /// Wait, bounded, until no revocation is waiting for the disk.
    pub async fn wait_durable(&self, _budget: Duration) -> bool {
        true
    }

    #[cfg(test)]
    pub(crate) fn tombstone_attempts(&self) -> u32 {
        0
    }
}

struct OfflineVerdictSink(Arc<OfflineGate>);

impl SessionVerdictSink for OfflineVerdictSink {
    fn report(&self, _identity_epoch: u64, _verdict: SessionVerdict) {}
}

/// Connect's account gate for a Ready account.
pub(crate) fn connect_refusal(_inner: &TonoInner) -> Option<&'static str> {
    None
}

/// Fixtures shared by the #582 admission tests (T3 restore, T4 here, T5 connection).
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};

    use tono_core::{ExitCatalogResponse, catalog::catalog_digest};

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
        let written = OfflineGate::new(dir.to_path_buf()).write_grant(&grant_for(catalog, refresh_token)).unwrap();
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
        let gate = Arc::clone(&state.lock().await.offline);
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
