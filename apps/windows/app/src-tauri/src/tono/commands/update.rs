//! The App transports untrusted bytes. Only Service admits, consumes, adopts,
//! and commits an update. No Tauri updater installation or App journal authority.
use crate::{
    core::owner_identity::current_owner_credentials,
    tono::{
        bootstrap, connection,
        state::TonoState,
        transport::{PathPreference, RELAY_CONNECT_TIMEOUT, classify},
    },
    utils::dirs,
};
use anyhow::{Context as _, Result, ensure};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    time::Duration,
};
use tono_core::auth::{HttpMethod, should_retry_transport};
use tauri::{AppHandle, ipc::Channel};
use tokio::{io::AsyncWriteExt as _, sync::Mutex};
use tono_logging::{Type, logging};
use tono_core::connection::ConnectionFsm;
use tono_service_protocol::{
    update_contract::{Phase, Protection, ReleaseManifest, TargetId},
    update_wire::{DISCOVERY_URL, RELEASE_ROOT, UpdateRequest, UpdateStatus},
};

static OFFER: Lazy<Mutex<Option<(String, String, ReleaseManifest)>>> = Lazy::new(|| Mutex::new(None));
static INSTALL: Mutex<()> = Mutex::const_new(());
static INCOMPLETE: AtomicBool = AtomicBool::new(false);

pub fn incomplete() -> bool {
    INCOMPLETE.load(Ordering::Acquire)
}

async fn native_capable() -> Result<bool> {
    let version = tono_service_protocol::get_version().await?;
    ensure!(version.code == 0, "Service capability is unavailable");
    Ok(version.data.as_ref().is_some_and(|v| {
        v.supports_client(
            tono_service_protocol::ProtocolVersion::current(),
            tono_service_protocol::MIN_SERVICE_REVISION_FOR_UPDATE_TRANSACTION,
        )
    }))
}

pub async fn request(request: UpdateRequest) -> Result<UpdateStatus> {
    ensure!(
        native_capable().await?,
        "Service does not support protected update v1; Disconnect and manually replace the legacy client"
    );
    let response = tono_service_protocol::update_transaction(&current_owner_credentials()?, request).await?;
    ensure!(response.code == 0, "{}", response.message);
    let status = response.data.context("Service omitted update status")?;
    INCOMPLETE.store(
        status.receipt.as_ref().is_some_and(|r| r.phase != Phase::Committed),
        Ordering::Release,
    );
    Ok(status)
}

/// No byte for this long fails the read, as on macOS (`NativeUpdateDownload.idleBudget`). A
/// transfer whose link died under a sleep or a network change then stops in a minute and resumes
/// (`download_resuming`) instead of holding the install until the 600 s request cap.
const IDLE_BUDGET: Duration = Duration::from_secs(60);

/// How many times a package download that stopped mid-transfer picks up where it stopped.
const DOWNLOAD_RESUMES: u32 = 3;

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .read_timeout(IDLE_BUDGET)
        .timeout(Duration::from_secs(600))
}

fn client() -> Result<reqwest::Client> {
    Ok(builder().build()?)
}

/// One update GET: through the relay the API transport last reached first, when there is one,
/// then direct, then through the Tono relays (decision 077). `preferred` is the API
/// transport's relay preference (`TonoTransport::path_preference`), so a device whose sign-in
/// went through a relay does not pay the dead direct path before every update request.
async fn get(
    client: &reqwest::Client,
    url: &str,
    timeout: Option<Duration>,
    preferred: &PathPreference,
) -> Result<reqwest::Response> {
    get_with_relays(client, url, timeout, &bootstrap::api_relays(), builder, preferred).await
}

/// GET `url` through `relay`: the relayed client resolves the URL's own host to the relay
/// socket and keeps every setting of `builder`, so SNI and the certificate check are those of
/// the direct path. The URL carries the relay's port and the override carries the same one, as
/// in the API transport. `None` when the URL cannot carry a port.
async fn get_via_relay(
    url: &reqwest::Url,
    host: &str,
    relay: SocketAddr,
    timeout: Option<Duration>,
    from: Option<u64>,
    builder: &impl Fn() -> reqwest::ClientBuilder,
) -> Result<Option<Result<reqwest::Response, reqwest::Error>>> {
    let mut relayed = url.clone();
    if relayed.set_port(Some(relay.port())).is_err() {
        return Ok(None);
    }
    let client = builder()
        .connect_timeout(RELAY_CONNECT_TIMEOUT)
        .resolve(host, relay)
        .build()?;
    Ok(Some(prepared(client.get(relayed.as_str()), timeout, from).send().await))
}

/// `request` with its own total `timeout`, when given, and asking only for the bytes from
/// `from` on, when given (a resumed package download).
fn prepared(request: reqwest::RequestBuilder, timeout: Option<Duration>, from: Option<u64>) -> reqwest::RequestBuilder {
    let request = match timeout {
        Some(limit) => request.timeout(limit),
        None => request,
    };
    match from {
        Some(offset) => request.header(reqwest::header::RANGE, format!("bytes={offset}-")),
        None => request,
    }
}

/// GET `url`. When `preferred` names a relay (index + 1; the API transport sets it when one of
/// this process's requests went through that relay), the GET goes there first, as the API
/// transport's own requests do; a failure that delivered nothing clears the preference and the
/// GET goes on as below. Then `direct`; when that failed before any response arrived, the same
/// GET goes once through each relay not yet tried, in order, until one answers, and the one
/// that answered becomes the preference.
///
/// The relay passes the TLS session through unterminated. Only the transport is changed: what
/// comes back is checked exactly as a direct answer is (signature by the Service, size here).
/// An HTTP status is an answer and is never re-sent. The relays sit outside the WFP bootstrap
/// permit, so while protection is armed a relay attempt fails like any other blocked address.
async fn get_with_relays(
    direct: &reqwest::Client,
    url: &str,
    timeout: Option<Duration>,
    relays: &[SocketAddr],
    builder: impl Fn() -> reqwest::ClientBuilder,
    preferred: &PathPreference,
) -> Result<reqwest::Response> {
    get_with_relays_from(direct, url, timeout, relays, builder, preferred, None).await
}

/// [`get_with_relays`] for the bytes from `from` on (`Range`), when given.
async fn get_with_relays_from(
    direct: &reqwest::Client,
    url: &str,
    timeout: Option<Duration>,
    relays: &[SocketAddr],
    builder: impl Fn() -> reqwest::ClientBuilder,
    preferred: &PathPreference,
    from: Option<u64>,
) -> Result<reqwest::Response> {
    let parsed = reqwest::Url::parse(url)?;
    let host = parsed.host_str().map(str::to_owned);
    let mut failures = Vec::new();
    let mut tried = None;
    let first = preferred
        .relay()
        .checked_sub(1)
        .filter(|index| *index < relays.len());
    if let (Some(index), Some(host)) = (first, host.as_deref()) {
        let relay = relays[index];
        tried = Some(index);
        match get_via_relay(&parsed, host, relay, timeout, from, &builder).await? {
            Some(Ok(response)) => return Ok(response),
            Some(Err(error)) => {
                // The transport's rule for an undelivered GET (`should_retry_transport`), and the
                // API transport's reaction to it: forget the relay and take the usual path.
                if !should_retry_transport(HttpMethod::Get, classify(&error)) {
                    return Err(error.into());
                }
                failures.push(format!("relay {relay}: {error}"));
            }
            None => {}
        }
        preferred.set_relay(0);
    }
    let direct_error = match prepared(direct.get(url), timeout, from).send().await {
        Ok(response) => return Ok(response),
        Err(error) => error,
    };
    // The transport's rule for an undelivered GET (`should_retry_transport`).
    if !should_retry_transport(HttpMethod::Get, classify(&direct_error)) {
        return Err(direct_error.into());
    }
    let Some(host) = host.as_deref() else {
        return Err(direct_error.into());
    };
    for index in (0..relays.len()).filter(|index| Some(*index) != tried) {
        let relay = relays[index];
        match get_via_relay(&parsed, host, relay, timeout, from, &builder).await? {
            Some(Ok(response)) => {
                preferred.set_relay(index + 1);
                return Ok(response);
            }
            Some(Err(error)) => failures.push(format!("relay {relay}: {error}")),
            None => {}
        }
    }
    preferred.set_relay(0);
    if failures.is_empty() {
        return Err(direct_error.into());
    }
    Err(anyhow::Error::new(direct_error).context(failures.join("; ")))
}

/// What a package download reports to the progress channel.
enum DownloadEvent {
    /// The first response arrived.
    Started,
    /// This many more bytes were written.
    Chunk(usize),
}

/// Stream the package at `url` into `sink`: exactly `expected` bytes, the signed size.
///
/// A transfer that stops after its response started (a reset, a stall past `IDLE_BUDGET`, the
/// request cap, a body that ends short) asks again, through the same path walk and so first
/// through the relay the API last reached, for the bytes not yet written (`Range: bytes=<n>-`),
/// up to `DOWNLOAD_RESUMES` times. A resumed answer counts only as `206` for exactly that offset
/// and the signed size, so what is on disk stays one contiguous copy. Before, any stop after the
/// first byte failed the install and the next try started again from zero, on the same flaky
/// cross-border link. Nothing here is trusted: the Service checks the size and SHA-256 against
/// the signed manifest before anything runs.
#[allow(clippy::too_many_arguments)]
async fn download_resuming(
    direct: &reqwest::Client,
    url: &str,
    relays: &[SocketAddr],
    builder: impl Fn() -> reqwest::ClientBuilder,
    preferred: &PathPreference,
    expected: u64,
    sink: &mut (impl tokio::io::AsyncWrite + Unpin),
    mut progress: impl FnMut(DownloadEvent) -> Result<()>,
) -> Result<()> {
    let mut written = 0u64;
    let mut resumes = 0u32;
    loop {
        let from = (written > 0).then_some(written);
        let mut response = get_with_relays_from(direct, url, None, relays, &builder, preferred, from)
            .await?
            .error_for_status()?;
        match from {
            None => progress(DownloadEvent::Started)?,
            Some(offset) => ensure!(
                resumed_at(&response, offset, expected),
                "package resume was not answered from byte {offset}"
            ),
        }
        let stopped = loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    written += chunk.len() as u64;
                    ensure!(written <= expected, "package exceeds signed size");
                    sink.write_all(&chunk).await?;
                    progress(DownloadEvent::Chunk(chunk.len()))?;
                }
                Ok(None) => break None,
                Err(error) => break Some(error),
            }
        };
        if stopped.is_none() && written == expected {
            return Ok(());
        }
        if written >= expected || resumes >= DOWNLOAD_RESUMES {
            return match stopped {
                Some(error) => Err(error.into()),
                None => Err(anyhow::anyhow!("package is truncated")),
            };
        }
        resumes += 1;
        logging!(
            warn,
            Type::Tono,
            "Tono: update download stopped at {written}/{expected} bytes ({}); resuming ({resumes}/{DOWNLOAD_RESUMES})",
            stopped.map_or_else(|| "body ended early".to_owned(), |error| error.to_string())
        );
    }
}

/// Whether `response` is the `206` for the bytes from `offset` to the end of a file of
/// `expected` bytes.
fn resumed_at(response: &reqwest::Response, offset: u64, expected: u64) -> bool {
    let Some(range) = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes "))
    else {
        return false;
    };
    let Some((span, total)) = range.split_once('/') else {
        return false;
    };
    let Some((start, end)) = span.split_once('-') else {
        return false;
    };
    response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        && digits(start) == Some(offset)
        && digits(end) == expected.checked_sub(1)
        && (total == "*" || digits(total) == Some(expected))
}

/// A `Content-Range` number: ASCII digits only. `u64::from_str` also takes a leading `+`, and a
/// sign or whitespace is not the grammar of RFC 9110 `complete-length` / `first-pos`.
fn digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

async fn bounded(client: &reqwest::Client, url: &str, limit: usize, preferred: &PathPreference) -> Result<String> {
    let mut response = get(client, url, Some(Duration::from_secs(30)), preferred)
        .await?
        .error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(bytes.len() + chunk.len() <= limit, "update document exceeds limit");
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8(bytes)?)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    version: String,
    manifest_sha256: String,
}

#[tauri::command]
pub async fn tono_check_update(state: tauri::State<'_, Arc<TonoState>>) -> Result<Option<Offer>, String> {
    async {
        let client = client()?;
        // The sign-in's relay preference: a device whose API requests reach only a relay
        // starts its update GETs there too (decision 077).
        let api = state.lock().await.client.clone();
        let preferred = api.transport().path_preference();
        let manifest = bounded(&client, DISCOVERY_URL, 16_384, preferred).await?;
        let decoded = ReleaseManifest::decode(manifest.as_bytes())?;
        let hash = decoded.sha256()?;
        let signature = bounded(
            &client,
            &format!("{RELEASE_ROOT}/{hash}/manifest.windows-x86_64.sig"),
            4096,
            preferred,
        )
        .await?;
        // Service verifies the signature and compiled/durable floor even when
        // the offer would be reported as "up to date". TLS/JSON is not authority.
        let status = request(UpdateRequest::Check {
            manifest: manifest.clone(),
            signature: signature.clone(),
        })
        .await?;
        let Some(verified) = status.offer else {
            *OFFER.lock().await = None;
            return Ok(None);
        };
        ensure!(verified == decoded, "Service verified a different manifest");
        let offer = Offer {
            version: verified.app_version.clone(),
            manifest_sha256: hash,
        };
        *OFFER.lock().await = Some((manifest, signature, verified));
        Ok::<_, anyhow::Error>(Some(offer))
    }
    .await
    .map_err(|e| format!("Protected update discovery failed: {e:#}"))
}

#[tauri::command]
pub async fn tono_install_update(
    app: AppHandle,
    state: tauri::State<'_, Arc<TonoState>>,
    manifest_sha256: String,
    progress: Channel<serde_json::Value>,
) -> Result<(), String> {
    let _install = INSTALL
        .try_lock()
        .map_err(|_| "An update request is already running".to_string())?;
    // The generation this update retired, if it got that far. Convergence may
    // only fold the attempt this update invalidated, never a live one.
    let mut invalidated = None;
    let mut preparation_complete = false;
    let outcome = async {
        let (manifest, signature, decoded) = OFFER.lock().await.clone().context("Check for updates again")?;
        ensure!(
            decoded.sha256()? == manifest_sha256,
            "selected update changed; check again"
        );
        let target = decoded
            .targets
            .iter()
            .find(|t| t.id == TargetId::WindowsX86_64)
            .context("no Windows target")?;
        let root = dirs::app_home_dir()?.join("update-downloads");
        tokio::fs::create_dir_all(&root).await?;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).context("download nonce failed")?;
        let nonce = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let path = root.join(format!("{nonce}.exe"));
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .await?;
        let api = state.lock().await.client.clone();
        download_resuming(
            &client()?,
            &format!("{RELEASE_ROOT}/{manifest_sha256}/package.windows-x86_64.exe"),
            &bootstrap::api_relays(),
            builder,
            api.transport().path_preference(),
            target.artifact_size_bytes,
            &mut file,
            |event| {
                progress.send(match event {
                    DownloadEvent::Started => serde_json::json!(
                        {"event":"Started", "data":{"contentLength":target.artifact_size_bytes}}
                    ),
                    DownloadEvent::Chunk(length) => serde_json::json!(
                        {"event":"Progress", "data":{"chunkLength":length}}
                    ),
                })?;
                Ok(())
            },
        )
        .await?;
        file.sync_all().await?;
        drop(file);
        progress.send(serde_json::json!({"event":"Finished"}))?;
        // These are user-context conveniences, not proof. Service independently
        // reads this authenticated user's proxy registry after private staging.
        crate::core::proxy_control::stop_guard().await;
        crate::core::proxy_control::clear_for_update().await?;
        {
            let mut inner = state.lock().await;
            inner.invalidate_connection(false);
            invalidated = Some(inner.connect_generation);
            inner.tasks.abort_catalog_sync();
        }
        INCOMPLETE.store(true, Ordering::Release);
        let prepared = request(UpdateRequest::Prepare {
            manifest,
            signature,
            package_path: path.to_string_lossy().into_owned(),
        })
        .await?;
        let receipt = prepared.receipt.context("Service omitted durable receipt")?;
        ensure!(
            receipt.phase == Phase::InstallationAuthorized && receipt.manifest_sha256 == manifest_sha256,
            "update preparation is incomplete; retained evidence needs recovery"
        );
        preparation_complete = true;
        let attempt_id = receipt.attempt_id;
        if let Err(error) = request(UpdateRequest::Install {
            attempt_id: attempt_id.clone(),
        })
        .await
        {
            // Never retry execution after a lost acknowledgement. Query only.
            let status = request(UpdateRequest::Status).await?;
            ensure!(
                status.receipt.as_ref().is_some_and(|r| r.attempt_id == attempt_id)
                    && matches!(status.execution.as_str(), "Launching" | "Consumed" | "Replaced"),
                "{error:#}"
            );
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    // Success exits via the independent executor, never JS install()/quit.
    // A refusal before reservation is different from a lost response after it.
    // Query, never infer absence or replay installation after either failure.
    if outcome.is_err() && incomplete() {
        let _ = request(UpdateRequest::Status).await;
    }
    // A failed Prepare may leave Core running after its supervision was aborted.
    // An unreadable snapshot still must not strand the retired Connecting attempt.
    let core_running = crate::core::service::tono_service_status_snapshot()
        .await
        .ok()
        .map(|snapshot| snapshot.core_pid.is_some());
    let prepare_failed = outcome.is_err() && !preparation_complete;
    let release = {
        let mut inner = state.lock().await;
        let current = inner.connect_generation;
        let release = quiesce_connection_after_update(&mut inner.fsm, core_running, prepare_failed, invalidated, current);
        super::emit_status(&app, &super::status_of(&inner));
        release
    };
    if release {
        if let Err(error) = connection::disconnect_for_generation(
            Arc::clone(state.inner()), app.clone(), invalidated,
        ).await {
            logging!(warn, Type::Service, "Tono: failed update preparation could not restore internet: {error}");
        }
    }
    super::quit::resync_after_cancelled_quit(app).await;
    // The Service error already says whether traffic was released or the barrier
    // stayed. Do not wrap every failure, including a released spawn failure, as
    // "protection retained".
    outcome.map_err(|e| format!("Protected update stopped: {e:#}"))
}

/// Fold the connection FSM once a native update has taken over, whatever the
/// update outcome then turns out to be.
///
/// `tono_install_update` invalidates the connection generation before talking
/// to the Service, so a connect transaction in flight unwinds with
/// `Attempt::Stale`, which by contract leaves the FSM untouched — the flow
/// that bumped the generation owns the cleanup, and this convergence is that
/// cleanup. An attempt that never armed goes back to Not Connected; an armed
/// one keeps the blocked latch and lands in Protected Offline: an update is
/// not a Disconnect and must not loosen protection. A Connected session is
/// folded when Core stopped. If Prepare failed with Core still running, its
/// retired supervision cannot renew DIRECT under the pending-update fence;
/// return true to restore internet through the update-aware release worker.
/// An unreadable snapshot is not evidence that Core stopped.
///
/// Connecting is folded only when `invalidated` (the generation this update
/// left behind) is still `current`: an update that failed before invalidating
/// (download, proxy clear) or an attempt admitted after the invalidation
/// (which bumps the generation) is live and owns its own FSM transitions.
fn quiesce_connection_after_update(
    fsm: &mut ConnectionFsm,
    core_running: Option<bool>,
    prepare_failed: bool,
    invalidated: Option<u64>,
    current: u64,
) -> bool {
    let release = prepare_failed && core_running == Some(true) && invalidated == Some(current)
        && fsm.status().is_connected;
    if fsm.status().is_connecting && invalidated == Some(current) {
        // Unarmed → Not Connected; armed → Protected Offline, latch retained.
        fsm.initial_release_failed();
    } else if fsm.status().is_connected && (core_running == Some(false) || release) {
        fsm.tunnel_died();
    }
    release
}

/// Whether this App process may run update recovery's automatic Connect (BRICK-W1).
///
/// After a restart mid-update every App is a later incarnation, and each one reconnected by
/// itself at every logon until the update committed. Only a certain answer that this process is
/// the executor's own successor opens the recovery Connect. A failed or uncertain Adopt, or a
/// relaunch, holds it for the rest of the process: a retried restore may then read the
/// incarnation the first Adopt already rebound, and must not take that as the answer. The
/// user's own Connect still finishes the update, and Restore internet still releases it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Adoption {
    Undecided = 0,
    Allowed = 1,
    Held = 2,
}

impl Adoption {
    /// The state after one Adopt request. `answered` is the Service's `successor_relaunched`
    /// when the request succeeded, `None` when it failed.
    ///
    /// Only the first certain answer may allow recovery Connect. `adopt_successor` reports
    /// `relaunched == false` again after it has rebound the record to this process, so a
    /// retried restore in the same process would otherwise look like a fresh successor and
    /// start another automatic Connect.
    pub(crate) fn after(self, answered: Option<bool>) -> Adoption {
        match (self, answered) {
            (Adoption::Undecided, Some(false)) => Adoption::Allowed,
            _ => Adoption::Held,
        }
    }

    fn from_u8(value: u8) -> Adoption {
        match value {
            0 => Adoption::Undecided,
            1 => Adoption::Allowed,
            _ => Adoption::Held,
        }
    }
}

static ADOPTION: AtomicU8 = AtomicU8::new(Adoption::Undecided as u8);

pub(crate) fn recovery_adoption() -> Adoption {
    Adoption::from_u8(ADOPTION.load(Ordering::Acquire))
}

fn record_adoption(answered: Option<bool>) {
    let _ = ADOPTION.fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
        Some(Adoption::from_u8(current).after(answered) as u8)
    });
}

pub async fn adopt() -> Result<Option<Protection>> {
    // A known legacy Service uses normal verified Disconnect/manual replacement.
    // A failed v1 adoption, unlike a proven absent attempt, must remain visible.
    if !native_capable().await? {
        return Ok(None);
    }
    INCOMPLETE.store(true, Ordering::Release);
    let adopted = request(UpdateRequest::Adopt).await;
    record_adoption(adopted.as_ref().ok().map(|status| status.successor_relaunched));
    let status = match adopted {
        Ok(status) => status,
        Err(error) => {
            // The refusal may be about the request (a manual installer lease, the store or
            // repair lock, the App image), not about an attempt. Ask the Service's read-only
            // update status; anything but a certain "none pending" keeps recovery incomplete.
            // Hold INSTALL across the read and the store: an install running beside this
            // restore set INCOMPLETE for its own Prepare, which this older answer must not clear.
            if let Ok(_install) = INSTALL.try_lock() {
                let pending = crate::core::service::tono_service_status_snapshot()
                    .await
                    .ok()
                    .and_then(|snapshot| snapshot.update_attempt_pending);
                INCOMPLETE.store(incomplete_after_refused_adopt(pending), Ordering::Release);
            }
            return Err(error);
        }
    };
    let Some(receipt) = status.receipt.filter(|r| r.phase != Phase::Committed) else {
        return Ok(None);
    };
    if receipt.required_recovery != Protection::Connected {
        request(UpdateRequest::Commit).await?;
    }
    Ok(Some(receipt.required_recovery))
}

/// INCOMPLETE after the Service refused Adopt (BRICK-W10). `read_only_pending` is `/status`'s
/// `update_attempt_pending`: `None` when the read failed or the Service predates it. Only a
/// certain "no attempt pending" clears the flag; unknown stays incomplete.
fn incomplete_after_refused_adopt(read_only_pending: Option<bool>) -> bool {
    read_only_pending != Some(false)
}

pub async fn disconnect_if_pending(apply_narrow: bool) -> Result<Option<tono_service_protocol::KillSwitchStatus>> {
    if !incomplete() {
        return Ok(None);
    }
    let pending = request(UpdateRequest::Status).await?;
    if !pending.receipt.is_some_and(|r| r.phase != Phase::Committed) {
        return Ok(None);
    }
    crate::core::proxy_control::stop_guard().await;
    crate::core::proxy_control::clear_for_update().await?;
    // A lost reply can follow a committed release; the caller treats errors as unconfirmed.
    // A release whose update record could not be proven or archived returns Ok with
    // `needs_attention`: the machine is open, so it must not read as armed.
    let released = request(UpdateRequest::disconnect(apply_narrow)).await?;
    if let Some(reason) = released.needs_attention.as_deref() {
        logging!(warn, Type::Service, "Tono: update Disconnect released protection; update record still pending: {reason}");
    }
    // The Service command proves and records cleanup; this ordinary read also
    // supplies the released protection projection to the existing UI worker.
    let status = crate::core::service::tono_kill_switch_status().await?;
    crate::core::service::record_verified_release(&status);
    Ok(Some(status))
}

pub async fn commit_if_pending() -> Result<()> {
    if incomplete() {
        request(UpdateRequest::Commit).await?;
    }
    Ok(())
}

#[cfg(test)]
mod update_quiesce_tests {
    use super::*;
    use tono_core::connection::UiState;

    /// R2-F3: a connecting attempt the update invalidated must never stay
    /// Connecting. `Attempt::Stale` does not touch the FSM, `connect()` then
    /// refuses "already connecting", and Retry treats connecting as a no-op,
    /// so this convergence is the attempt's only exit short of the user
    /// clicking Disconnect.
    #[test]
    fn update_quiesce_never_strands_connecting() {
        // Cancelled before StartClash armed the WFP policy.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 7);
        assert!(!fsm.status().is_connecting);
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());

        // Cancelled after arm: the update is not a Disconnect — the blocked
        // latch survives and the machine lands in Protected Offline.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 7);
        assert!(!fsm.status().is_connecting);
        assert!(fsm.kill_switch_armed());
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);

        // The update failed before invalidating (e.g. the download broke), or
        // a new attempt was admitted after it (generation moved on): that
        // attempt is live and must not be touched.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        quiesce_connection_after_update(&mut fsm, Some(false), false, None, 7);
        assert!(fsm.status().is_connecting);
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 8);
        assert!(fsm.status().is_connecting);
    }

    #[test]
    fn failed_prepare_with_running_core_releases_only_the_unsupervised_session() {
        let mut connected = ConnectionFsm::new();
        connected.begin_connect();
        connected.mark_kill_switch_armed();
        connected.mark_session_verified();
        connected.connect_succeeded().unwrap();

        let mut fsm = connected.clone();
        assert!(quiesce_connection_after_update(&mut fsm, Some(true), true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        // The worker, not this local fold, must prove DNS/Core/WFP release.
        assert!(fsm.kill_switch_armed());
        assert!(fsm.session_verified());

        let mut fsm = connected;
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), true, None, 7));
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), true, Some(7), 8));
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), false, Some(7), 7));
        assert!(fsm.status().is_connected);
    }

    #[test]
    fn failed_prepare_with_unreadable_snapshot_still_folds_connecting() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);

        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        assert!(fsm.kill_switch_armed());

        // Neither a newer live attempt nor Connected is disproven by missing IPC.
        fsm.begin_connect();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 8));
        assert!(fsm.status().is_connecting);
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(8), 8));
        assert!(fsm.status().is_connected);
    }

    /// BRICK-W10: a refusal for a reason that is not an update (manual lease, store or repair
    /// lock, App image) used to leave "update recovery incomplete" set with nothing pending.
    #[test]
    fn a_non_update_adopt_refusal_with_nothing_pending_is_not_incomplete() {
        assert!(!incomplete_after_refused_adopt(Some(false)));
        assert!(incomplete_after_refused_adopt(Some(true)));
        assert!(incomplete_after_refused_adopt(None), "an unreadable status cleared the flag");
    }

    #[test]
    fn a_retried_adopt_of_the_rebound_successor_does_not_stay_allowed() {
        let first = Adoption::Undecided.after(Some(false));
        assert_eq!(first, Adoption::Allowed);
        assert_eq!(
            first.after(Some(false)),
            Adoption::Held,
            "a second not-relaunched answer after the record was rebound started another recovery Connect"
        );
        assert_eq!(
            Adoption::Undecided.after(None).after(Some(false)),
            Adoption::Held
        );
    }
}

#[cfg(test)]
mod update_relay_tests {
    use super::*;
    use std::net::SocketAddr;

    /// Decision 077 follow-up: an update GET whose direct path delivered nothing is sent once
    /// through the relays in order, keeps its hostname (so the certificate check is the same),
    /// and the relay that answered is remembered.
    #[tokio::test]
    async fn an_undelivered_discovery_get_falls_back_to_a_relay() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let relay = listener.local_addr().expect("addr");
        // The Host header of every request the relay received.
        let (host_tx, host_rx) = std::sync::mpsc::channel::<String>();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::{BufRead as _, BufReader, Write as _};
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(match stream.try_clone() {
                    Ok(clone) => clone,
                    Err(_) => continue,
                });
                let mut line = String::new();
                let mut host = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':')
                        && name.eq_ignore_ascii_case("host")
                    {
                        host = value.trim().to_owned();
                    }
                    line.clear();
                }
                let _ = host_tx.send(host);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nmanifest",
                );
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });

        // The direct path drops packets (unroutable RFC1918), so its connect delivers nothing.
        let direct = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_millis(700))
            .resolve("releases.test", SocketAddr::from(([10, 255, 255, 1], 80)))
            .build()
            .expect("direct client");
        // The first relay refuses, so the walk must go on to the second in order.
        let refused = SocketAddr::from(([127, 0, 0, 1], 1));
        let preferred = PathPreference::default();
        let response = get_with_relays(
            &direct,
            "http://releases.test/desktop/v1/latest/manifest.json",
            Some(Duration::from_secs(5)),
            &[refused, relay],
            || reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()),
            &preferred,
        )
        .await
        .expect("the relay must carry the GET");
        assert_eq!(response.status(), 200);
        assert_eq!(response.text().await.expect("body"), "manifest");
        let host = host_rx.recv_timeout(Duration::from_secs(1)).expect("the relay saw the GET");
        assert!(
            host == "releases.test" || host.starts_with("releases.test:"),
            "the relayed GET must keep the release hostname, got {host:?}"
        );
        assert_eq!(preferred.relay(), 2, "the relay that answered is remembered");
    }

    /// A package transfer cut off mid-body (a reset, a stall, a network change; simulated here
    /// by a server that closes after half the bytes) picks up from the bytes already written
    /// with `Range`, and the file ends as the one contiguous copy. Before, the install failed and
    /// the next try started again from byte 0. A resumed answer whose `Content-Range` numbers are
    /// not plain ASCII digits (`bytes +5-+9/+10`) is refused.
    #[tokio::test]
    async fn a_package_download_cut_off_mid_body_resumes_from_the_bytes_written() {
        const PACKAGE: &[u8] = b"0123456789";
        // A server that cuts the first transfer off halfway and answers a `Range` request with a
        // 206, its `Content-Range` numbers written with a leading `+` when `signed`. The Range
        // header of every request goes to the receiver, empty when absent.
        fn serve(signed: bool) -> (SocketAddr, std::sync::mpsc::Receiver<String>) {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let address = listener.local_addr().expect("addr");
            let (range_tx, range_rx) = std::sync::mpsc::channel::<String>();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    use std::io::{BufRead as _, BufReader, Write as _};
                    let Ok(mut stream) = stream else { continue };
                    let Ok(clone) = stream.try_clone() else { continue };
                    let mut reader = BufReader::new(clone);
                    let mut line = String::new();
                    let mut range = String::new();
                    while reader.read_line(&mut line).unwrap_or(0) > 0 && line != "\r\n" && line != "\n" {
                        if let Some((name, value)) = line.split_once(':')
                            && name.eq_ignore_ascii_case("range")
                        {
                            range = value.trim().to_owned();
                        }
                        line.clear();
                    }
                    let _ = range_tx.send(range.clone());
                    if let Some(from) = range.strip_prefix("bytes=").and_then(|v| v.strip_suffix('-')) {
                        let from: usize = from.parse().expect("offset");
                        let sign = if signed { "+" } else { "" };
                        let _ = write!(
                            stream,
                            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {sign}{from}-{sign}{}/{sign}{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            PACKAGE.len() - 1,
                            PACKAGE.len(),
                            PACKAGE.len() - from
                        );
                        let _ = stream.write_all(&PACKAGE[from..]);
                    } else {
                        // The whole length is announced; half of it arrives, then the link is gone.
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            PACKAGE.len()
                        );
                        let _ = stream.write_all(&PACKAGE[..PACKAGE.len() / 2]);
                    }
                    let _ = stream.flush();
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                }
            });
            (address, range_rx)
        }
        async fn download(address: SocketAddr, written: &mut Vec<u8>) -> (Result<()>, usize, usize) {
            let direct = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .resolve("releases.test", address)
                .build()
                .expect("direct client");
            let (mut started, mut reported) = (0, 0);
            let result = download_resuming(
                &direct,
                &format!("http://releases.test:{}/desktop/v1/package.windows-x86_64.exe", address.port()),
                &[],
                || reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()),
                &PathPreference::default(),
                PACKAGE.len() as u64,
                written,
                |event| {
                    match event {
                        DownloadEvent::Started => started += 1,
                        DownloadEvent::Chunk(length) => reported += length,
                    }
                    Ok(())
                },
            )
            .await;
            (result, started, reported)
        }

        let (address, range_rx) = serve(false);
        let mut written = Vec::new();
        let (result, started, reported) = download(address, &mut written).await;
        result.expect("the cut-off download must resume");
        assert_eq!(written, PACKAGE, "the bytes on disk must be one contiguous copy");
        assert_eq!((started, reported), (1, PACKAGE.len()));
        assert_eq!(range_rx.recv_timeout(Duration::from_secs(1)).expect("first request"), "");
        assert_eq!(
            range_rx.recv_timeout(Duration::from_secs(1)).expect("the resumed request"),
            format!("bytes={}-", PACKAGE.len() / 2)
        );

        // `bytes +5-+9/+10`: `u64::from_str` would take each number; the resume must not.
        let (signed, _ranges) = serve(true);
        let mut written = Vec::new();
        let (result, _, _) = download(signed, &mut written).await;
        let error = result.expect_err("a signed Content-Range must not be accepted");
        assert!(
            error.to_string().contains("package resume was not answered from byte 5"),
            "{error:#}"
        );
        assert_eq!(written, &PACKAGE[..PACKAGE.len() / 2], "nothing after the refused answer is written");
    }

    /// Backlog A1: once a sign-in went through a relay, the update GET starts at that relay
    /// instead of first paying the direct path (about 21 s of SYN retries on a dead Windows
    /// route). The direct path here answers, so a GET that tried it first reads "direct".
    #[tokio::test]
    async fn a_relay_that_carried_the_sign_in_is_the_first_hop_of_an_update_get() {
        fn serve(body: &'static str) -> SocketAddr {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let address = listener.local_addr().expect("addr");
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    use std::io::{BufRead as _, BufReader, Write as _};
                    let Ok(mut stream) = stream else { continue };
                    let Ok(clone) = stream.try_clone() else { continue };
                    let mut reader = BufReader::new(clone);
                    let mut line = String::new();
                    while reader.read_line(&mut line).unwrap_or(0) > 0 && line != "\r\n" && line != "\n" {
                        line.clear();
                    }
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.flush();
                    let _ = stream.shutdown(std::net::Shutdown::Write);
                }
            });
            address
        }
        let direct_address = serve("direct");
        let relay = serve("relay");
        let direct = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve("releases.test", direct_address)
            .build()
            .expect("direct client");
        // What the API transport leaves after a sign-in through the second relay.
        let preferred = PathPreference::new(false, 2);
        let response = get_with_relays(
            &direct,
            "http://releases.test/desktop/v1/latest/manifest.json",
            Some(Duration::from_secs(5)),
            &[SocketAddr::from(([127, 0, 0, 1], 1)), relay],
            || reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()),
            &preferred,
        )
        .await
        .expect("the preferred relay must carry the GET");
        assert_eq!(
            response.text().await.expect("body"),
            "relay",
            "the update GET went to the direct path before the relay the sign-in used"
        );
        assert_eq!(preferred.relay(), 2, "an answering relay stays preferred");
    }
}
