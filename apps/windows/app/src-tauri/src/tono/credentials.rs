//! Credential plumbing for the Tono account session.
//!
//! Two layers, deliberately separate:
//!
//! - [`TonoCredentialStore`] — the OS vault (Windows Credential Manager in
//!   production, the macOS keychain during development). Its *synchronous*
//!   trait methods must only ever run inside `tokio::task::spawn_blocking`:
//!   a slow or prompting vault (macOS securityd ACL prompts block in
//!   `mach_msg` indefinitely) must never freeze an executor thread, and
//!   **never** the setup main thread (the startup deadlock this layering
//!   fixes).
//! - [`SessionCredentialStore`] — the store handed to tono-core's
//!   `ApiClient`: memory-first, so every sync trait call the client makes
//!   is a memory/queue access. One bounded writer orders vault mutations;
//!   account close awaits its acknowledgement without holding product locks.
//!   A stalled vault never blocks an executor thread or opens login admission.

use keyring::Entry;
use std::sync::Arc;
use tono_core::credentials::{CredentialError, CredentialKey, CredentialStore, MemoryCredentialStore};

/// keyring service name. keyring names a Windows generic credential
/// `<user>.<service>`, so the entries are `refresh-token.tono` and
/// `installation-id.tono` (§2). The uninstaller deletes the first by that name.
const SERVICE_NAME: &str = "tono";

/// Written to the Tono data directory when this installation adopts a sign-in. The session lives
/// in Credential Manager, which survives an uninstall that deletes the data directory; a vault
/// refresh token is only this installation's session when the marker says so.
const VAULT_SESSION_MARKER: &str = "vault-session.marker";

pub(crate) fn mark_vault_session_owned(data_dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(data_dir.join(VAULT_SESSION_MARKER), b"1")
}

/// Whether the refresh token in the vault belongs to this data directory. A directory an earlier
/// build left signed in has no marker but still has that account's verified catalog cache, so it
/// adopts the marker once instead of signing every existing user out. A fresh directory (a new
/// install, or a reinstall after "delete application data") has neither.
pub(crate) fn data_dir_owns_vault_session(data_dir: &std::path::Path, catalog_cache: &std::path::Path) -> bool {
    if data_dir.join(VAULT_SESSION_MARKER).exists() {
        return true;
    }
    if !catalog_cache.exists() {
        return false;
    }
    if let Err(error) = mark_vault_session_owned(data_dir) {
        tono_logging::logging!(warn, tono_logging::Type::Service,
            "Tono: failed to record the vault session marker: {error}");
    }
    true
}

fn account_name(key: CredentialKey) -> &'static str {
    match key {
        CredentialKey::RefreshToken => "refresh-token",
        CredentialKey::InstallationId => "installation-id",
    }
}

/// The OS credential vault behind tono-core's synchronous trait. Only call
/// inside `spawn_blocking` (or the async adapter below).
pub struct TonoCredentialStore;

impl TonoCredentialStore {
    fn entry(key: CredentialKey) -> Result<Entry, CredentialError> {
        Entry::new(SERVICE_NAME, account_name(key)).map_err(|err| CredentialError::Store(err.to_string()))
    }

    /// Async adapter: the synchronous vault call runs on the blocking pool.
    /// Join failures surface as store errors (never panic); a missing entry
    /// is `Ok(None)`, mirroring the trait.
    pub async fn get_async(key: CredentialKey) -> Result<Option<String>, CredentialError> {
        tokio::task::spawn_blocking(move || match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(store_error(err)),
        })
        .await
        .map_err(join_error)?
    }

    /// Async adapter for writes (user-action paths; no timeout needed).
    pub async fn set_async(key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        let value = value.to_string();
        tokio::task::spawn_blocking(move || Self::entry(key)?.set_password(&value).map_err(store_error))
            .await
            .map_err(join_error)?
    }

    /// Async adapter for deletes.
    pub async fn delete_async(key: CredentialKey) -> Result<(), CredentialError> {
        tokio::task::spawn_blocking(move || match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(store_error(err)),
        })
        .await
        .map_err(join_error)?
    }
}

fn store_error(err: keyring::Error) -> CredentialError {
    CredentialError::Store(err.to_string())
}

fn join_error(err: tokio::task::JoinError) -> CredentialError {
    CredentialError::Store(format!("credential task failed: {err}"))
}

impl CredentialStore for TonoCredentialStore {
    fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(store_error(err)),
        }
    }

    fn set(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        Self::entry(key)?.set_password(value).map_err(store_error)
    }

    fn delete(&self, key: CredentialKey) -> Result<(), CredentialError> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(store_error(err)),
        }
    }
}

/// The store `ApiClient` actually holds (§2): every sync trait call is a
/// memory/queue access. Reads are hydrated by startup; writes are ordered by the
/// same short mutex as their memory commit. FIFO is the persistence revision order:
/// an old write/delete cannot land after a newer accepted mutation. No OS I/O under locks.
pub struct SessionCredentialStore {
    memory: MemoryCredentialStore,
    vault: Option<Arc<dyn CredentialStore>>,
    writer: parking_lot::Mutex<Option<tokio::sync::mpsc::Sender<VaultCommand>>>,
}

enum VaultCommand {
    Write(CredentialKey, Option<String>),
    Flush(tokio::sync::oneshot::Sender<Result<(), CredentialError>>),
}

impl SessionCredentialStore {
    pub fn new() -> Self {
        Self {
            memory: MemoryCredentialStore::new(),
            vault: Some(Arc::new(TonoCredentialStore)),
            writer: Default::default(),
        }
    }

    /// Memory-only instance for tests (write-through disabled).
    #[cfg(test)]
    pub fn for_test() -> Self {
        Self {
            memory: MemoryCredentialStore::new(),
            vault: None,
            writer: Default::default(),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_vault(vault: Arc<dyn CredentialStore>) -> Self {
        Self { vault: Some(vault), ..Self::for_test() }
    }

    /// Memory-only write, skipping the vault write-through. Used by the
    /// startup load task to hydrate from the vault without writing the same
    /// bytes straight back.
    pub fn set_local(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        let _writer = self.writer.lock();
        self.memory.set(key, value)
    }

    fn mutate(&self, key: CredentialKey, value: Option<String>) -> Result<(), CredentialError> {
        let mut writer = self.writer.lock();
        if let Some(vault) = self.vault.clone() {
            if writer.is_none() {
                let runtime = tokio::runtime::Handle::try_current()
                    .map_err(|_| CredentialError::Store("credential writer runtime unavailable".into()))?;
                // At most 64 pending mutations and one OS operation, even if the vault stalls.
                let (sender, mut receiver) = tokio::sync::mpsc::channel(64);
                *writer = Some(sender);
                runtime.spawn(async move {
                    let mut failures = std::collections::HashMap::new();
                    while let Some(command) = receiver.recv().await {
                        match command {
                            VaultCommand::Write(key, value) => {
                                let vault = vault.clone();
                                let result = tokio::task::spawn_blocking(move || match value {
                                    Some(value) => vault.set(key, &value),
                                    None => vault.delete(key),
                                }).await.map_err(join_error).and_then(|result| result);
                                match result {
                                    Ok(()) => { failures.remove(&key); }
                                    Err(error) => {
                                        tono_logging::logging!(warn, tono_logging::Type::Service,
                                            "Tono: credential persistence failed; durable state is unknown");
                                        failures.insert(key, error);
                                    }
                                }
                            }
                            VaultCommand::Flush(done) => {
                                let result = failures.values().next().cloned().map_or(Ok(()), Err);
                                let _ = done.send(result);
                            }
                        }
                    }
                });
            }
            writer.as_ref().expect("writer initialized").try_send(VaultCommand::Write(key, value.clone()))
                .map_err(|_| CredentialError::Store("credential persistence queue full or closed".into()))?;
        }
        match value {
            Some(value) => self.memory.set(key, &value),
            None => self.memory.delete(key),
        }
    }

    /// Acknowledge all accepted mutations preceding this barrier. A caller's timeout must not
    /// cancel the owner waiting here; sign-out retains account admission until this settles.
    pub async fn flush(&self) -> Result<(), CredentialError> {
        let writer = self.writer.lock().clone();
        let Some(writer) = writer else { return Ok(()); };
        let (done, result) = tokio::sync::oneshot::channel();
        writer.send(VaultCommand::Flush(done)).await
            .map_err(|_| CredentialError::Store("credential writer stopped before acknowledgement".into()))?;
        result.await.map_err(|_| CredentialError::Store("credential acknowledgement lost".into()))?
    }
}

impl CredentialStore for SessionCredentialStore {
    fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> {
        self.memory.get(key)
    }

    fn set(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        self.mutate(key, Some(value.to_string()))
    }

    fn delete(&self, key: CredentialKey) -> Result<(), CredentialError> {
        self.mutate(key, None)
    }
}

#[cfg(test)]
mod tests {
    use super::{SERVICE_NAME, SessionCredentialStore, account_name};
    use tono_core::credentials::{CredentialKey, CredentialStore};

    #[tokio::test]
    async fn delayed_vault_mutations_cannot_resurrect_or_erase_a_replacement_token() {
        use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
        use tono_core::credentials::{CredentialError, MemoryCredentialStore};
        struct Vault {
            durable: MemoryCredentialStore,
            entered: tokio::sync::Notify,
            changed: tokio::sync::Notify,
            calls: AtomicUsize,
            held_call: AtomicUsize,
            completed: AtomicUsize,
            gate: Mutex<std::sync::mpsc::Receiver<()>>,
        }
        impl Vault {
            fn mutate(&self, value: Option<&str>) -> Result<(), CredentialError> {
                if self.calls.fetch_add(1, Ordering::SeqCst) == self.held_call.load(Ordering::SeqCst) {
                    self.entered.notify_one();
                    self.gate.lock().unwrap().recv_timeout(std::time::Duration::from_secs(5)).unwrap();
                }
                match value {
                    Some(value) => self.durable.set_refresh_token(value)?,
                    None => self.durable.delete_refresh_token()?,
                }
                self.completed.fetch_add(1, Ordering::SeqCst);
                self.changed.notify_one();
                Ok(())
            }
            async fn completed(&self, count: usize) {
                while self.completed.load(Ordering::SeqCst) < count {
                    self.changed.notified().await;
                }
            }
        }
        impl CredentialStore for Vault {
            fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> { self.durable.get(key) }
            fn set(&self, _: CredentialKey, value: &str) -> Result<(), CredentialError> { self.mutate(Some(value)) }
            fn delete(&self, _: CredentialKey) -> Result<(), CredentialError> { self.mutate(None) }
        }
        let (release, gate) = std::sync::mpsc::channel();
        let vault = Arc::new(Vault {
            durable: MemoryCredentialStore::new(), entered: Default::default(), changed: Default::default(),
            calls: AtomicUsize::new(0), held_call: AtomicUsize::new(0),
            completed: AtomicUsize::new(0), gate: Mutex::new(gate),
        });
        let store = SessionCredentialStore::with_test_vault(vault.clone());
        store.set_refresh_token("old-account").unwrap();
        vault.entered.notified().await;
        store.delete_refresh_token().unwrap();
        store.set_refresh_token("replacement").unwrap();
        // A deliberately stalled OS write: unordered persistence lets both successors finish
        // here; an ordered owner cannot. This deadline bounds fault injection, not a sleep race.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(1), vault.completed(2)).await;
        release.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), vault.completed(3)).await.unwrap();
        assert_eq!(store.refresh_token().unwrap().as_deref(), Some("replacement"));
        assert_eq!(vault.durable.refresh_token().unwrap().as_deref(), Some("replacement"));
        // The converse: a delayed delete cannot erase a subsequent replacement write.
        vault.held_call.store(3, Ordering::SeqCst);
        store.delete_refresh_token().unwrap();
        vault.entered.notified().await;
        store.set_refresh_token("second-replacement").unwrap();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(1), vault.completed(4)).await;
        release.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), store.flush()).await.unwrap().unwrap();
        assert_eq!(vault.durable.refresh_token().unwrap().as_deref(), Some("second-replacement"));
        // Deletion must be ordered after every preceding write as well.
        store.delete_refresh_token().unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), store.flush()).await.unwrap().unwrap();
        assert_eq!(vault.completed.load(Ordering::SeqCst), 6);
        assert_eq!(vault.durable.refresh_token().unwrap(), None);
    }

    #[test]
    fn account_names_are_stable() {
        // keyring's Windows target is `<user>.<service>`; the uninstaller deletes this name.
        assert_eq!(
            format!("{}.{SERVICE_NAME}", account_name(CredentialKey::RefreshToken)),
            tono_core::credentials::WINDOWS_CRED_TARGET_REFRESH_TOKEN
        );
        assert_eq!(account_name(CredentialKey::InstallationId), "installation-id");
    }

    #[test]
    fn session_store_is_memory_first_and_vault_free_in_tests() {
        // Everything the ApiClient can do stays in memory; `for_test` never
        // reaches the OS vault (this test would otherwise hang on macOS
        // securityd prompts the same way the startup did).
        let store = SessionCredentialStore::for_test();
        assert_eq!(store.refresh_token().unwrap(), None);
        store.set_refresh_token("rt-1").unwrap();
        assert_eq!(store.refresh_token().unwrap().as_deref(), Some("rt-1"));
        // Rotation replaces the memory copy.
        store.set_refresh_token("rt-2").unwrap();
        assert_eq!(store.refresh_token().unwrap().as_deref(), Some("rt-2"));
        // set_local hydrates without any write-through.
        store
            .set_local(CredentialKey::InstallationId, "2f5b1f2a-0000-4c81-8d2b-3f2d0a1b2c3d")
            .unwrap();
        assert_eq!(
            store.installation_id().unwrap().as_deref(),
            Some("2f5b1f2a-0000-4c81-8d2b-3f2d0a1b2c3d")
        );
        store.delete_refresh_token().unwrap();
        assert_eq!(store.refresh_token().unwrap(), None);
        store.delete_refresh_token().unwrap();
    }
}
