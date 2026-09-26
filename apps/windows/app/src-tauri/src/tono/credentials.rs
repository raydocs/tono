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

#[cfg(not(windows))]
use keyring::Entry;
use std::sync::Arc;
use tono_core::credentials::{CredentialError, CredentialKey, CredentialStore, MemoryCredentialStore};

/// Service suffix of the Windows generic-credential targets, `<account>.tono`: the entries are
/// `refresh-token.tono` and `installation-id.tono` (§2), the names keyring gave them before the
/// Windows vault moved to the Credential Manager API. The uninstaller deletes the first by that
/// name. keyring still serves the development vault on other platforms.
const SERVICE_NAME: &str = "tono";

/// Written when this installation adopts a sign-in. The session lives in Credential Manager,
/// which survives an uninstall that deletes the data directory; a vault refresh token is only
/// this installation's session when the marker says so. On Windows it sits under
/// `%LOCALAPPDATA%` beside the roaming data directory (see [`vault_marker_dir`]): the session it
/// vouches for is bound to this machine, so the marker must not roam either (H11-F2, #409).
const VAULT_SESSION_MARKER: &str = "vault-session.marker";

/// A marker that vouches for the stored session. Every earlier build wrote this, so any content
/// that is not [`PENDING_MARKER`] (an earlier build's marker, or an empty one) still vouches.
const COMMITTED_MARKER: &[u8] = b"1";

/// Prefix of the marker a sign-in writes before it stores its session. It vouches for nothing until
/// that session is durable and the marker is committed: the sign-in may have failed or the process
/// died first, or the vault never accepted the session.
const PENDING_MARKER: &[u8] = b"pending";

/// Where a marker is staged before it replaces [`VAULT_SESSION_MARKER`] ([`replace_marker`]).
const STAGED_MARKER: &str = "vault-session.marker.staged";

/// The directory that holds [`VAULT_SESSION_MARKER`] for `data_dir`. A data directory under the
/// roaming `%APPDATA%` maps to the same relative path under `%LOCALAPPDATA%`, which does not roam.
/// Any other directory (portable installs, test fixtures, other platforms) holds its own marker.
fn vault_marker_dir(data_dir: &std::path::Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let (Some(roaming), Some(local)) = (std::env::var_os("APPDATA"), std::env::var_os("LOCALAPPDATA")) {
            if let Ok(relative) = data_dir.strip_prefix(&roaming) {
                return std::path::PathBuf::from(local).join(relative);
            }
        }
    }
    data_dir.to_path_buf()
}

pub(crate) fn mark_vault_session_owned(data_dir: &std::path::Path) -> std::io::Result<()> {
    let marker_dir = vault_marker_dir(data_dir);
    std::fs::create_dir_all(&marker_dir)?;
    std::fs::write(marker_dir.join(VAULT_SESSION_MARKER), COMMITTED_MARKER)
}

/// What the local marker says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkerState {
    Absent,
    /// A sign-in wrote it and has not committed it ([`PENDING_MARKER`]).
    Pending,
    /// It vouches for the vault session.
    Committed,
}

fn marker_state(data_dir: &std::path::Path) -> std::io::Result<MarkerState> {
    match std::fs::read(vault_marker_dir(data_dir).join(VAULT_SESSION_MARKER)) {
        Ok(content) if content.starts_with(PENDING_MARKER) => Ok(MarkerState::Pending),
        Ok(_) => Ok(MarkerState::Committed),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(MarkerState::Absent),
        Err(error) => Err(error),
    }
}

/// Replaces the local marker with `content` in one step: a crash leaves the old marker or the new
/// one, never a partial file (an empty marker reads as committed).
fn replace_marker(data_dir: &std::path::Path, content: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    let marker_dir = vault_marker_dir(data_dir);
    std::fs::create_dir_all(&marker_dir)?;
    let staged = marker_dir.join(STAGED_MARKER);
    let mut file = std::fs::File::create(&staged)?;
    file.write_all(content)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&staged, marker_dir.join(VAULT_SESSION_MARKER))
}

/// What a sign-in's session marker step found ([`record_sign_in_marker`]). Either way the marker is
/// now this sign-in's pending one.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SignInMarker {
    /// A marker was already there, with its content. `None`: it could not be read, so an undo
    /// leaves the marker pending and the next launch asks for a sign-in.
    Existing { previous: Option<Vec<u8>> },
    /// No marker was there.
    Created,
}

/// The pending marker sign-in `generation` writes ([`PENDING_MARKER`]).
fn pending_marker(generation: u64) -> Vec<u8> {
    [PENDING_MARKER, format!(":{generation}").as_bytes()].concat()
}

/// Whether the local marker still reads sign-in `generation`'s pending content. Other content, or
/// no marker, is `false`. A marker that cannot be read is an error, not an answer.
fn holds_pending_marker(data_dir: &std::path::Path, generation: u64) -> std::io::Result<bool> {
    match std::fs::read(vault_marker_dir(data_dir).join(VAULT_SESSION_MARKER)) {
        Ok(content) => Ok(content == pending_marker(generation)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Writes the local marker pending for sign-in `generation`, before the sign-in does anything it
/// cannot undo (retiring the previous account's connection, dropping its catalog). Only a committed
/// local marker vouches for a vault session ([`data_dir_owns_vault_session`]), and this one vouches
/// only once [`SessionMarker::commit`] runs after the session is durable. It replaces whatever
/// marker was there, a committed one included: once a switch has stored its session, a session
/// that never lands must not leave the previous account's marker to restore that account on the
/// next launch. A marker that cannot be written refuses the sign-in.
fn record_sign_in_marker(data_dir: &std::path::Path, generation: u64) -> Result<SignInMarker, String> {
    let found = match std::fs::read(vault_marker_dir(data_dir).join(VAULT_SESSION_MARKER)) {
        Ok(previous) => SignInMarker::Existing { previous: Some(previous) },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SignInMarker::Created,
        Err(_) => SignInMarker::Existing { previous: None },
    };
    sign_in_marker_verdict(found, || replace_marker(data_dir, &pending_marker(generation)))
}

/// [`record_sign_in_marker`]'s decision: `write` must succeed, whatever marker was `found`.
fn sign_in_marker_verdict(
    found: SignInMarker,
    write: impl FnOnce() -> std::io::Result<()>,
) -> Result<SignInMarker, String> {
    write().map(|()| found).map_err(|error| {
        format!("TONO_SIGN_IN_NOT_SAVED: could not record this installation's session, so this sign-in was not adopted: {error}")
    })
}

/// This process's side of the local marker, kept in `TonoInner` so every step runs under the Tono
/// state lock; the file is what a relaunch reads ([`data_dir_owns_vault_session`]). While the
/// process runs, every pending marker it writes has exactly one owner: the sign-in in flight,
/// which either adopts or puts back what the marker held before any sign-in was in flight, or
/// else the adopted sign-in awaiting its commit, whose commit task ends only once the file holds a
/// committed marker, a newer sign-in adopts, or the process exits. Outside this type only the
/// load's one-time upgrade writes the marker, and only an absent one.
#[derive(Debug, Default)]
pub(crate) struct SessionMarker {
    /// The sign-in whose pending marker the file holds and which has stored no session yet, with
    /// what the marker goes back to if it never does.
    in_flight: Option<(u64, Restore)>,
    /// The adopted sign-in whose marker is not committed on disk yet.
    awaiting_commit: Option<u64>,
}

/// What an undone sign-in puts back ([`SessionMarker::undo`]).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Restore {
    /// No marker was there.
    Remove,
    /// This content was there. A pending one still vouches for nothing.
    Content(Vec<u8>),
    /// It could not be read: the marker stays pending, and the next launch asks for a sign-in.
    KeepPending,
}

impl SessionMarker {
    /// Marks the local marker pending for sign-in `generation` ([`record_sign_in_marker`]: a marker
    /// that cannot be written refuses the sign-in, and nothing here changes). If this sign-in
    /// stores no session, the marker goes back to what it held before any sign-in was in flight. A
    /// sign-in this one displaces never stored a session and can no longer adopt (its generation is
    /// gone), so this one takes over its undo. An adopted sign-in still awaiting its commit gets
    /// its pending marker back, which its commit task still answers for.
    pub(crate) fn begin(&mut self, data_dir: &std::path::Path, generation: u64) -> Result<(), String> {
        let found = record_sign_in_marker(data_dir, generation)?;
        let restore = match (self.in_flight.take(), self.awaiting_commit) {
            (Some((_, restore)), _) => restore,
            (None, Some(adopted)) => Restore::Content(pending_marker(adopted)),
            (None, None) => match found {
                SignInMarker::Created => Restore::Remove,
                SignInMarker::Existing { previous: Some(previous) } => Restore::Content(previous),
                SignInMarker::Existing { previous: None } => Restore::KeepPending,
            },
        };
        self.in_flight = Some((generation, restore));
        Ok(())
    }

    /// Sign-in `generation` handed its session to the vault (`client.adopt`, under the same lock):
    /// its marker now waits for that session to be durable. An earlier adopted sign-in's commit is
    /// moot, as its session is no longer the vault's.
    pub(crate) fn adopted(&mut self, generation: u64) {
        self.in_flight = None;
        self.awaiting_commit = Some(generation);
    }

    /// Whether adopted sign-in `generation`'s marker still waits for its commit.
    pub(crate) fn awaits_commit(&self, generation: u64) -> bool {
        self.awaiting_commit == Some(generation)
    }

    /// Sign-in `generation` stored no session (`client.adopt` fails before queuing the vault write),
    /// so the vault still holds what the marker described before any sign-in was in flight. If this
    /// is still the sign-in in flight and the marker still reads its exact pending content, that
    /// marker is put back. A sign-in a newer one displaced leaves the marker to that one.
    pub(crate) fn undo(&mut self, data_dir: &std::path::Path, generation: u64) {
        if !matches!(&self.in_flight, Some((in_flight, _)) if *in_flight == generation) {
            return;
        }
        let Some((_, restore)) = self.in_flight.take() else { return };
        if !matches!(holds_pending_marker(data_dir, generation), Ok(true)) {
            return;
        }
        let undone = match restore {
            Restore::Remove => std::fs::remove_file(vault_marker_dir(data_dir).join(VAULT_SESSION_MARKER)),
            Restore::Content(content) => replace_marker(data_dir, &content),
            Restore::KeepPending => Ok(()),
        };
        if let Err(error) = undone {
            // Still pending, so it vouches for nothing.
            tono_logging::logging!(warn, tono_logging::Type::Service,
                "Tono: failed to undo the session marker of a sign-in that was not adopted: {error}");
        }
    }

    /// Adopted sign-in `generation`'s session is durable (the vault writer acknowledged every
    /// earlier write), so its marker commits. `Ok(true)`: nothing is left to do, as the file holds a
    /// committed marker or a newer sign-in adopted. `Ok(false)`: a sign-in is in flight and the
    /// marker is that one's to write. It now puts back a committed marker if it stores no session,
    /// and this sign-in keeps the commit until the file shows it: a write-back that fails leaves a
    /// pending marker, which the next try commits. `Err`: the marker could not be read or written.
    /// Until `Ok(true)` the commit task tries again.
    pub(crate) fn commit(&mut self, data_dir: &std::path::Path, generation: u64) -> std::io::Result<bool> {
        if !self.awaits_commit(generation) {
            return Ok(true);
        }
        if let Some((_, restore)) = &mut self.in_flight {
            *restore = Restore::Content(COMMITTED_MARKER.to_vec());
            return Ok(false);
        }
        // No sign-in in flight answers for a pending marker, so it is this one's.
        if marker_state(data_dir)? == MarkerState::Pending {
            replace_marker(data_dir, COMMITTED_MARKER)?;
        }
        self.awaiting_commit = None;
        Ok(true)
    }
}

/// Whether the refresh token in the vault belongs to this data directory. Only the local marker
/// answers for it: the account traces live in the roaming data directory, so they vouch only in the
/// one-time upgrade [`adopts_unmarked_vault_session`] allows, and a directory that adopts writes
/// the local marker. A fresh directory (a new install, or a reinstall after "delete application
/// data") adopts nothing. A marker an earlier Windows build wrote into the roaming data directory
/// is rewritten to the local marker directory, and the roaming copy is removed only after that
/// write succeeded.
pub(crate) fn data_dir_owns_vault_session(
    data_dir: &std::path::Path,
    account_traces: &[std::path::PathBuf],
    legacy_roaming_session: bool,
) -> VaultSessionOwnership {
    let marker = vault_marker_dir(data_dir).join(VAULT_SESSION_MARKER);
    match marker_state(data_dir) {
        Ok(MarkerState::Committed) => return VaultSessionOwnership::Owned { rebind: legacy_roaming_session },
        // No sign-in committed it (the sign-in failed or the process ended first, or its session
        // never became durable): it vouches for nothing the vault holds.
        Ok(MarkerState::Pending) => return VaultSessionOwnership::NotOwned,
        Ok(MarkerState::Absent) => {}
        Err(error) => {
            tono_logging::logging!(warn, tono_logging::Type::Service,
                "Tono: failed to read the vault session marker: {error}");
            return VaultSessionOwnership::Unrecorded;
        }
    }
    let legacy_marker = data_dir.join(VAULT_SESSION_MARKER);
    let legacy_marker = (legacy_marker != marker && legacy_marker.exists()).then_some(legacy_marker);
    let traces = account_traces.iter().any(|trace| trace.exists());
    unmarked_vault_session_ownership(legacy_marker.is_some(), legacy_roaming_session, traces, || {
        match mark_vault_session_owned(data_dir) {
            Ok(()) => {
                if let Some(legacy_marker) = &legacy_marker {
                    let _ = std::fs::remove_file(legacy_marker);
                }
                true
            }
            Err(error) => {
                tono_logging::logging!(warn, tono_logging::Type::Service,
                    "Tono: failed to record the vault session marker: {error}");
                false
            }
        }
    })
}

/// What a load does with the vault session ([`data_dir_owns_vault_session`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VaultSessionOwnership {
    /// Not this installation's session: sign in again.
    NotOwned,
    /// This installation's session. `rebind`: an earlier build stored it roaming, and now that a
    /// marker vouches for it, it is rewritten local-machine
    /// ([`TonoCredentialStore::bind_session_to_machine_async`]).
    Owned { rebind: bool },
    /// The one-time upgrade from a roaming session could not write the local marker. That roaming
    /// credential is its only evidence and the first refresh-token rotation would rewrite it
    /// local-machine, so the load answers nothing: a retry, or the next launch, upgrades again
    /// instead of signing the user out. The same answer when the local marker cannot be read: it
    /// may vouch, or be a sign-in's pending marker that must not.
    Unrecorded,
}

/// [`adopts_unmarked_vault_session`], settled by `record_marker` (the local marker write, asked
/// only when adopting). The session is rebound to this machine only once a marker vouches for it:
/// a rewrite that outran the marker (in a load that timed out or lost to a concurrent one, or
/// before a failed marker write) would destroy the upgrade's evidence and sign the user out on the
/// next load. A roaming marker still answers after a failed write, as it is removed only after the
/// local one is written.
fn unmarked_vault_session_ownership(
    legacy_marker: bool,
    legacy_roaming_session: bool,
    account_traces: bool,
    record_marker: impl FnOnce() -> bool,
) -> VaultSessionOwnership {
    if !adopts_unmarked_vault_session(legacy_marker, legacy_roaming_session, account_traces) {
        VaultSessionOwnership::NotOwned
    } else if record_marker() || legacy_marker {
        VaultSessionOwnership::Owned { rebind: legacy_roaming_session }
    } else {
        VaultSessionOwnership::Unrecorded
    }
}

/// Whether a data directory without the local marker adopts the vault session (H11-F2, #409).
/// Both signals roam, so they only upgrade an installation from before the local marker, once: a
/// marker an earlier Windows build left in the roaming data directory, or account traces (files
/// only a signed-in account writes, even when its catalog sync never succeeded) beside a session an
/// earlier build stored roaming ([`StoredSession::legacy_roaming`]). Such a build may have signed
/// in before any marker existed, and its upgrade must not sign that user out and release their
/// protection. Beside any other session the traces may have roamed in from another PC: a missing
/// local marker then means sign in again.
const fn adopts_unmarked_vault_session(legacy_marker: bool, legacy_roaming_session: bool, account_traces: bool) -> bool {
    legacy_marker || (legacy_roaming_session && account_traces)
}

/// The refresh token as the vault stored it.
pub struct StoredSession {
    pub token: String,
    /// An earlier build stored it roaming (`CRED_PERSIST_ENTERPRISE`, before #632). This read
    /// leaves it roaming; it is rebound to this machine once a marker vouches for it
    /// ([`VaultSessionOwnership::Owned`]).
    pub legacy_roaming: bool,
}

fn account_name(key: CredentialKey) -> &'static str {
    match key {
        CredentialKey::RefreshToken => "refresh-token",
        CredentialKey::InstallationId => "installation-id",
    }
}

/// Which persistence a stored session credential needs (H11-F2, #409). The session must stay on
/// the machine that created it, so this build writes `CRED_PERSIST_LOCAL_MACHINE`. keyring 3.6.3,
/// which earlier builds used, hard-codes `CRED_PERSIST_ENTERPRISE`: that copy roams with a roaming
/// user profile, and a second PC would present the same device and single-use refresh token.
#[cfg_attr(not(windows), allow(dead_code))]
mod vault_migration {
    /// `CREDENTIALW.Persist` values (wincred.h). Local copies keep the decision a pure function
    /// that tests on every platform; the Windows vault asserts they match the windows crate.
    pub(super) const CRED_PERSIST_LOCAL_MACHINE_RAW: u32 = 2;
    pub(super) const CRED_PERSIST_ENTERPRISE_RAW: u32 = 3;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) enum VaultReadAction {
        /// Nothing is stored under the target.
        Absent,
        /// Stored in a form this build keeps: use it as is.
        Use,
        /// Stored roaming by an earlier build. Rewrite the same target local-machine and use the
        /// value either way; a failed rewrite is retried on the next read, never dropped.
        MigrateToLocalMachine,
    }

    pub(super) const fn vault_read_action(stored_persist: Option<u32>) -> VaultReadAction {
        match stored_persist {
            None => VaultReadAction::Absent,
            Some(CRED_PERSIST_ENTERPRISE_RAW) => VaultReadAction::MigrateToLocalMachine,
            Some(_) => VaultReadAction::Use,
        }
    }
}

/// Windows Credential Manager, called directly: keyring cannot write any persistence but
/// `CRED_PERSIST_ENTERPRISE`. Targets, `UserName` and the UTF-16LE blob match what keyring wrote,
/// so entries from earlier builds read back unchanged.
#[cfg(windows)]
mod win_vault {
    use super::vault_migration::{
        CRED_PERSIST_ENTERPRISE_RAW, CRED_PERSIST_LOCAL_MACHINE_RAW, VaultReadAction, vault_read_action,
    };
    use tono_core::credentials::CredentialError;
    use windows::{
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{
                CRED_FLAGS, CRED_PERSIST_ENTERPRISE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW,
                CredDeleteW, CredFree, CredReadW, CredWriteW,
            },
        },
        core::{HRESULT, PCWSTR, PWSTR},
    };

    const _: () = assert!(CRED_PERSIST_LOCAL_MACHINE.0 == CRED_PERSIST_LOCAL_MACHINE_RAW);
    const _: () = assert!(CRED_PERSIST_ENTERPRISE.0 == CRED_PERSIST_ENTERPRISE_RAW);

    /// Orders a read-and-migrate against this process's writes and deletes, so a migration can
    /// never write back a value that a newer write (a rotated refresh token) already replaced.
    /// Only ever taken on the blocking pool, like every call in this module.
    static VAULT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn vault_lock() -> std::sync::MutexGuard<'static, ()> {
        VAULT_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn is_not_found(error: &windows::core::Error) -> bool {
        error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0)
    }

    fn store_error(action: &str, error: &windows::core::Error) -> CredentialError {
        CredentialError::Store(format!("Credential Manager {action} failed: {error}"))
    }

    fn decode(blob: &[u8]) -> Result<String, CredentialError> {
        let not_utf16 = || CredentialError::Store("stored credential is not UTF-16".into());
        if blob.len() % 2 != 0 {
            return Err(not_utf16());
        }
        let units: Vec<u16> = blob.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        String::from_utf16(&units).map_err(|_| not_utf16())
    }

    /// The stored value and its `Persist`, or `None` when nothing is stored.
    fn read(target: &str) -> Result<Option<(String, u32)>, CredentialError> {
        let target = wide(target);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: `target` is NUL-terminated and outlives the call; on success the OS allocates
        // `credential`, which is freed below.
        if let Err(error) = unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut credential) } {
            return if is_not_found(&error) { Ok(None) } else { Err(store_error("read", &error)) };
        }
        // SAFETY: CredReadW succeeded, so `credential` points at a CREDENTIALW whose blob holds
        // `CredentialBlobSize` bytes. The blob is copied out and wiped before CredFree releases it.
        let (blob, persist) = unsafe {
            let stored = &*credential;
            let size = stored.CredentialBlobSize as usize;
            let blob = if size == 0 || stored.CredentialBlob.is_null() {
                Vec::new()
            } else {
                let blob = std::slice::from_raw_parts(stored.CredentialBlob, size).to_vec();
                std::ptr::write_bytes(stored.CredentialBlob, 0, size);
                blob
            };
            let persist = stored.Persist.0;
            CredFree(credential as *const std::ffi::c_void);
            (blob, persist)
        };
        decode(&blob).map(|value| Some((value, persist)))
    }

    fn write_local_machine(target: &str, user: &str, value: &str) -> Result<(), CredentialError> {
        let mut target = wide(target);
        let mut user = wide(user);
        let mut blob: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let blob_size = u32::try_from(blob.len())
            .map_err(|_| CredentialError::Store("credential value is too large".into()))?;
        let credential = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob_size,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: every pointer in `credential` borrows a buffer that outlives the call. An entry
        // with the same target and type is replaced, including a roaming copy.
        let result = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        result.map_err(|error| store_error("write", &error))
    }

    pub(super) fn get(target: &str, user: &str) -> Result<Option<String>, CredentialError> {
        let _guard = vault_lock();
        let stored = read(target)?;
        match vault_read_action(stored.as_ref().map(|(_, persist)| *persist)) {
            VaultReadAction::MigrateToLocalMachine => {
                if let Some((value, _)) = stored.as_ref() {
                    // Rewriting the same target replaces the roaming copy; a CredDelete here would
                    // erase the session just rewritten. On failure the session is still returned
                    // and the next read retries.
                    if let Err(error) = write_local_machine(target, user, value) {
                        tono_logging::logging!(warn, tono_logging::Type::Service,
                            "Tono: could not bind the stored session to this machine: {error}");
                    }
                }
            }
            VaultReadAction::Absent | VaultReadAction::Use => {}
        }
        Ok(stored.map(|(value, _)| value))
    }

    /// The stored value and whether an earlier build stored it roaming, left as stored: for the
    /// session, that roaming copy is the one-time upgrade's evidence until a marker vouches for it.
    pub(super) fn read_unmigrated(target: &str) -> Result<Option<(String, bool)>, CredentialError> {
        Ok(read(target)?.map(|(value, persist)| {
            (value, vault_read_action(Some(persist)) == VaultReadAction::MigrateToLocalMachine)
        }))
    }

    pub(super) fn set(target: &str, user: &str, value: &str) -> Result<(), CredentialError> {
        let _guard = vault_lock();
        write_local_machine(target, user, value)
    }

    pub(super) fn delete(target: &str) -> Result<(), CredentialError> {
        let _guard = vault_lock();
        let target = wide(target);
        // SAFETY: `target` is NUL-terminated and outlives the call.
        match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if is_not_found(&error) => Ok(()),
            Err(error) => Err(store_error("delete", &error)),
        }
    }
}

/// The OS credential vault behind tono-core's synchronous trait. Only call
/// inside `spawn_blocking` (or the async adapter below).
pub struct TonoCredentialStore;

impl TonoCredentialStore {
    #[cfg(not(windows))]
    fn entry(key: CredentialKey) -> Result<Entry, CredentialError> {
        Entry::new(SERVICE_NAME, account_name(key)).map_err(|err| CredentialError::Store(err.to_string()))
    }

    #[cfg(windows)]
    fn target(key: CredentialKey) -> String {
        format!("{}.{SERVICE_NAME}", account_name(key))
    }

    /// Async adapter: the synchronous vault call runs on the blocking pool.
    /// Join failures surface as store errors (never panic); a missing entry
    /// is `Ok(None)`, mirroring the trait.
    pub async fn get_async(key: CredentialKey) -> Result<Option<String>, CredentialError> {
        tokio::task::spawn_blocking(move || Self.get(key))
            .await
            .map_err(join_error)?
    }

    /// Async read of the refresh token that also reports whether an earlier build stored it
    /// roaming ([`StoredSession`]). Same blocking-pool rule as [`Self::get_async`].
    pub async fn get_session_async() -> Result<Option<StoredSession>, CredentialError> {
        tokio::task::spawn_blocking(Self::get_session)
            .await
            .map_err(join_error)?
    }

    #[cfg(windows)]
    fn get_session() -> Result<Option<StoredSession>, CredentialError> {
        Ok(win_vault::read_unmigrated(&Self::target(CredentialKey::RefreshToken))?
            .map(|(token, legacy_roaming)| StoredSession { token, legacy_roaming }))
    }

    /// The development vault never stored a roaming session.
    #[cfg(not(windows))]
    fn get_session() -> Result<Option<StoredSession>, CredentialError> {
        Ok(Self.get(CredentialKey::RefreshToken)?.map(|token| StoredSession { token, legacy_roaming: false }))
    }

    /// Rebinds a session an earlier build stored roaming to this machine, once a marker vouches
    /// for it ([`VaultSessionOwnership::Owned`]). It rewrites whatever the vault holds under the
    /// vault lock, so it cannot restore a token a newer write or delete replaced; on failure the
    /// session stays roaming and the next load rebinds it.
    pub async fn bind_session_to_machine_async() -> Result<(), CredentialError> {
        tokio::task::spawn_blocking(Self::bind_session_to_machine)
            .await
            .map_err(join_error)?
    }

    #[cfg(windows)]
    fn bind_session_to_machine() -> Result<(), CredentialError> {
        let key = CredentialKey::RefreshToken;
        win_vault::get(&Self::target(key), account_name(key)).map(drop)
    }

    /// The development vault never stored a roaming session.
    #[cfg(not(windows))]
    fn bind_session_to_machine() -> Result<(), CredentialError> {
        Ok(())
    }

    /// Async adapter for writes (user-action paths; no timeout needed).
    pub async fn set_async(key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        let value = value.to_string();
        tokio::task::spawn_blocking(move || Self.set(key, &value))
            .await
            .map_err(join_error)?
    }

    /// Async adapter for deletes.
    pub async fn delete_async(key: CredentialKey) -> Result<(), CredentialError> {
        tokio::task::spawn_blocking(move || Self.delete(key))
            .await
            .map_err(join_error)?
    }
}

#[cfg(not(windows))]
fn store_error(err: keyring::Error) -> CredentialError {
    CredentialError::Store(err.to_string())
}

fn join_error(err: tokio::task::JoinError) -> CredentialError {
    CredentialError::Store(format!("credential task failed: {err}"))
}

#[cfg(windows)]
impl CredentialStore for TonoCredentialStore {
    fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> {
        win_vault::get(&Self::target(key), account_name(key))
    }

    fn set(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> {
        win_vault::set(&Self::target(key), account_name(key), value)
    }

    fn delete(&self, key: CredentialKey) -> Result<(), CredentialError> {
        win_vault::delete(&Self::target(key))
    }
}

#[cfg(not(windows))]
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
    fn a_roaming_session_credential_is_rewritten_local_machine() {
        use super::vault_migration::{
            CRED_PERSIST_ENTERPRISE_RAW, CRED_PERSIST_LOCAL_MACHINE_RAW, VaultReadAction, vault_read_action,
        };
        // keyring 3.6.3 wrote every session entry as CRED_PERSIST_ENTERPRISE, which roams with a
        // roaming profile: a read keeps the session and rebinds it to this machine.
        assert_eq!(vault_read_action(Some(CRED_PERSIST_ENTERPRISE_RAW)), VaultReadAction::MigrateToLocalMachine);
        assert_eq!(vault_read_action(Some(CRED_PERSIST_LOCAL_MACHINE_RAW)), VaultReadAction::Use);
        assert_eq!(vault_read_action(None), VaultReadAction::Absent);
    }

    #[test]
    fn roaming_account_traces_vouch_only_for_a_session_an_earlier_build_stored_roaming() {
        use super::adopts_unmarked_vault_session as adopts;
        // Arguments: legacy roaming marker, session stored CRED_PERSIST_ENTERPRISE, account traces.
        // The traces live in the roaming data directory: without the local marker they cannot make
        // this machine the owner of a local-machine session.
        assert!(!adopts(false, false, true), "roaming account traces alone adopted a vault session");
        // The one-time upgrade: a build before the local marker stored the session roaming.
        assert!(adopts(false, true, true));
        // A roaming session on a fresh data directory is a previous installation's.
        assert!(!adopts(false, true, false));
        // A marker an earlier build left in the roaming data directory still answers once.
        assert!(adopts(true, false, false));
    }

    #[test]
    fn a_roaming_session_upgrade_is_rebound_only_once_a_marker_vouches_for_it() {
        use super::{VaultSessionOwnership as Ownership, unmarked_vault_session_ownership as ownership};
        // Arguments: legacy roaming marker, session stored CRED_PERSIST_ENTERPRISE, account traces,
        // and the local marker write. The roaming credential is the upgrade's only evidence and the
        // first token rotation rewrites it local-machine: without the local marker the load answers
        // nothing, so a retry upgrades again (protection kept) instead of signing the user out.
        assert_eq!(ownership(false, true, true, || false), Ownership::Unrecorded,
            "the upgrade adopted a session it could not record");
        assert_eq!(ownership(false, true, true, || true), Ownership::Owned { rebind: true });
        // The roaming marker is removed only after the local one is written, so it still answers.
        assert_eq!(ownership(true, true, false, || false), Ownership::Owned { rebind: true });
        assert_eq!(ownership(false, false, true, || true), Ownership::NotOwned);
    }

    #[test]
    fn a_sign_in_whose_local_marker_cannot_be_written_is_refused() {
        // Only the local marker vouches for a vault session (#635). A sign-in that stored its
        // session without one was disowned by the next launch: signed out, protection released.
        use super::{SignInMarker, sign_in_marker_verdict as verdict};
        let unwritable = || -> std::io::Result<()> { Err(std::io::Error::other("marker directory is read-only")) };
        assert!(verdict(SignInMarker::Created, unwritable).is_err(), "a sign-in stored a session its next launch will not own");
        assert_eq!(verdict(SignInMarker::Created, || Ok(())), Ok(SignInMarker::Created));
        // A marker this machine already held is replaced by the pending one too, so a switch that
        // cannot write it is refused like any other sign-in.
        let held = SignInMarker::Existing { previous: Some(b"1".to_vec()) };
        assert!(verdict(held.clone(), unwritable).is_err(), "a switch left the previous account's marker vouching");
        assert_eq!(verdict(held.clone(), || Ok(())), Ok(held));
    }

    #[test]
    fn a_durable_session_keeps_its_commit_when_a_refused_switch_cannot_put_its_marker_back() {
        use super::{STAGED_MARKER, SessionMarker, VaultSessionOwnership, data_dir_owns_vault_session};
        let directory = std::env::temp_dir().join(format!("tono-marker-{}", tono_core::auth::new_installation_id()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut marker = SessionMarker::default();
        // Sign-in 1 adopted its session, and switch 2 is in flight when 1's session proves durable.
        marker.begin(&directory, 1).unwrap();
        marker.adopted(1);
        marker.begin(&directory, 2).unwrap();
        let _ = marker.commit(&directory, 1);
        // The Service refuses switch 2, and putting the marker back fails once: the staged marker
        // cannot be created.
        let staged = directory.join(STAGED_MARKER);
        std::fs::create_dir(&staged).unwrap();
        marker.undo(&directory, 2);
        std::fs::remove_dir(&staged).unwrap();
        // Sign-in 1's commit task tries again.
        let _ = marker.commit(&directory, 1);
        let ownership = data_dir_owns_vault_session(&directory, &[], false);
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(ownership, VaultSessionOwnership::Owned { rebind: false },
            "a session proven durable must not lose its marker to one failed write");
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
