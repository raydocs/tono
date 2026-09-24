//! Local traffic audit (macOS `LocalTrafficAudit`
//! parity subset): a JSONL protection/connection event log with size-capped
//! rotation, owner-only file protection, and regex redaction for
//! credentials/URL patterns.
//!
//! Non-blocking by contract: `Audit::log` is a `try_send` into a bounded
//! channel — a full channel drops the event (counted), and nothing here
//! ever panics or stalls the connect path. Redaction happens on the raw
//! payload fields *before* serialization (M1), so escaping can never
//! corrupt the JSON. Out of scope for this subset: export bundles, mihomo
//! connection 5-tuples, and anything carrying a token, a secret, or
//! catalog YAML.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use anyhow::{Context as _, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

use crate::{process::AsyncHandler, tono::state};

/// Log file name inside `app_home_dir()/tono/logs` (§8).
pub const AUDIT_FILE_NAME: &str = "traffic-audit.jsonl";
/// The single retained backup generation.
pub const AUDIT_BACKUP_FILE_NAME: &str = "traffic-audit.1.jsonl";
/// §8 size cap: rotate at 10 MiB, keeping 2 generations.
pub const MAX_AUDIT_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// Settings file (`{audit_enabled: bool}`) inside the Tono data dir.
pub const SETTINGS_FILE_NAME: &str = "settings.json";
/// Bounded channel capacity; overflow drops events (counted).
const CHANNEL_CAPACITY: usize = 256;

// ---- Event model (§8): one JSON object per line, `{ts, kind, ...}` ----

/// One audit record: epoch-millis timestamp plus the flattened event, so a
/// line reads `{"ts":…,"kind":"connectBegin","node":"…"}`.
#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub ts: i64,
    /// Captured before queuing: a late disk write cannot acquire a new owner.
    #[serde(rename = "_uploadScope", skip_serializing_if = "Option::is_none")]
    pub upload_scope: Option<String>,
    #[serde(flatten)]
    pub event: AuditEvent,
}

impl AuditRecord {
    pub fn now(event: AuditEvent) -> Self {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        Self { ts, event, upload_scope: None }
    }
}

/// Audit events. Tokens, verification codes, controller secrets, and
/// catalog YAML never appear in any payload; emails are recorded verbatim
/// (this is a local-only log).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AuditEvent {
    // account
    SignInStart {
        email: String,
    },
    SignInOk {
        email: String,
    },
    /// A sign-in step that failed, with the raw transport detail.
    ///
    /// The user is shown a mapped, actionable message instead of the error chain, so this is
    /// where the detail that support actually needs survives — which path failed, and whether
    /// the network reset the connection, timed it out, or could not resolve the name. Those
    /// mean different things and only the raw text distinguishes them.
    SignInFail {
        stage: &'static str,
        error: String,
    },
    SignOut,
    RevokeDevice {
        id: String,
    },
    RetryRestore,
    // catalog
    SyncOk {
        revision: i64,
        node_count: usize,
    },
    SyncFail {
        error: String,
    },
    SelectionVanished {
        node: String,
    },
    RequiresChoiceCleared,
    // protection
    ConnectBegin {
        node: String,
        transport: &'static str,
    },
    Stage {
        stage: &'static str,
        elapsed_ms: u64,
    },
    ConnectFail {
        stage: Option<&'static str>,
        error: String,
        action: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        transport: Option<&'static str>,
        /// First `TONO_*` / `CORE_*` token, so the customer timeline has a
        /// stable code even before the next periodic window upload.
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        /// Catalog display name at the moment of failure. Flattening would
        /// otherwise attribute the row to whatever `selectedServer` is at
        /// upload time.
        #[serde(skip_serializing_if = "Option::is_none")]
        node: Option<String>,
    },
    ConnectOk {
        node: String,
        elapsed_ms: u64,
        transport: &'static str,
    },
    /// One destination the DIRECT overlay actually dialled, recorded once per distinct
    /// `(address, port, protocol)` per session.
    ///
    /// This is the evidence the reviewed-port permit is scored against. That permit lets the
    /// staged core reach *any* address on a small port set, which is what makes WeChat's
    /// HTTPDNS-derived endpoints work; the cost is that the firewall no longer bounds the
    /// destination. Narrowing it back needs to know where WeChat actually goes, and no pin
    /// list can answer that — measured on macOS, 21.2 MB of WeChat upload went to addresses
    /// no pin knew and 95 KB to the pinned ones. So the client records what it dialled and
    /// the prefix set is computed from real traffic rather than guessed.
    ///
    /// Two of these fields are alarms rather than statistics: a `process` that is not a
    /// reviewed WeChat binary means the routing layer sent something it should not have, and
    /// an address outside China means the overlay leaked. Classification is deliberately left
    /// to the server — the client reports the address it used and nothing interprets it here.
    DirectDial {
        address: String,
        host: String,
        port: u16,
        protocol: &'static str,
        process: String,
        chain: String,
        rule: String,
    },
    /// Cumulative, mutually-exclusive route evidence for protected Claude destinations in one
    /// connected session. Unlike `DirectDial`, this deliberately contains no host, IP, URL,
    /// process, path, profile, rule payload, proxy name, or browser template. The sampler is
    /// capped in memory and emits at most one aggregate row per controller poll.
    ProtectedRouteEvidence {
        generation: u64,
        residential_connection_count: u32,
        direct_connection_count: u32,
        proxied_connection_count: u32,
        blocked_connection_count: u32,
        unknown_connection_count: u32,
        invariant_violation_count: u32,
        latest_route: &'static str,
        latest_destination: &'static str,
        sampling_capped: bool,
    },
    DisconnectBegin {
        cause: &'static str,
    },
    DisconnectOk {
        #[serde(skip_serializing_if = "Option::is_none")]
        elapsed_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bytes_up: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bytes_down: Option<u64>,
    },
    ReleaseFail {
        error: String,
    },
    ReconnectScheduled {
        delay_ms: u64,
    },
    NodeSwitch {
        from: String,
        to: String,
        transport: &'static str,
    },
    /// Connect proved the selected city dead; the next unused catalog city
    /// will be used on the fail-closed reconnect.
    ConnectCatalogFailover {
        from: String,
        to: String,
    },
    ProtectedOffline {
        reason: &'static str,
    },
    // service
    KillSwitchSnapshot {
        wanted: bool,
        live: bool,
        mode: &'static str,
        endpoints: usize,
    },
    NetworkChange {
        counter: u64,
    },
    CoreRestart {
        old_pid: Option<u32>,
        new_pid: Option<u32>,
        restart_count: u32,
    },
    HealthProbeFail {
        probe: &'static str,
        error: String,
    },
    /// Dashboard telemetry could not be pointed at this connection's controller.
    ///
    /// Deliberately non-fatal — a verified tunnel must not be failed over a dashboard — but the
    /// warning it used to raise went only to the local app log, which is not the file that
    /// uploads. The symptom reaching support was "the tunnel works, the dashboard says it cannot
    /// reach the core", with nothing on our side to explain it. This rides the audit log so the
    /// next occurrence is answerable without asking the customer for a file.
    TelemetryConfigFail {
        error: String,
    },
    // cloud traffic policy (Build 28)
    PolicySyncOk {
        revision: i64,
        domains: usize,
        media: usize,
        web_domains: usize,
    },
    PolicyActivated {
        wechat_tcp: usize,
        web_tcp: usize,
        udp: usize,
    },
    /// Optional DIRECT acceleration could not be activated. No DIRECT
    /// permits were installed, so the protected tunnel remains the only
    /// usable path.
    PolicyActivationSkipped {
        reason: String,
    },
    PolicySyncFail {
        error: String,
    },
    // diagnostics (user-initiated upload only)
    /// The user uploaded a diagnostics report and the intake accepted it.
    /// Recorded locally so the machine's own trail shows that a report left
    /// it, and with which support reference.
    DiagnosticsUploaded {
        reference: String,
    },
    /// The user asked for an upload and it failed.
    DiagnosticsUploadFail {
        error: String,
    },
    /// Periodic testing timeline window accepted by the control plane.
    PeriodicTelemetryUploaded {
        event_count: u32,
        bytes: u32,
    },
    /// Periodic testing timeline upload failed (never fails closed).
    PeriodicTelemetryUploadFail {
        error: String,
    },
    /// One gzip segment of this log accepted by the control plane. Recorded into
    /// the very file being uploaded, which is deliberate: the next segment then
    /// carries the receipt for the previous one, so a gap in the sequence is
    /// visible from the uploaded data alone.
    NetworkLogSegmentUploaded {
        sequence: u32,
        line_count: u32,
        bytes: u32,
    },
    /// A segment upload failed (never fails closed; the cursor does not advance).
    NetworkLogSegmentUploadFail {
        error: String,
    },
    // lifecycle
    AuditEnabled,
    AuditDisabled,
    PeriodicTelemetryEnabled,
    PeriodicTelemetryDisabled,
    NetworkLogUploadEnabled,
    NetworkLogUploadDisabled,
}

impl AuditEvent {
    /// Redact every free-text payload field before serialization (M1):
    /// raw strings only, so the serde escaping afterwards stays intact and
    /// adversarial content (embedded quotes, JSON fragments) cannot corrupt
    /// the line.
    pub fn redacted(self) -> Self {
        use AuditEvent::*;
        match self {
            SignInStart { email } => SignInStart { email: redact(&email) },
            SignInOk { email } => SignInOk { email: redact(&email) },
            RevokeDevice { id } => RevokeDevice { id: redact(&id) },
            SyncFail { error } => SyncFail { error: redact(&error) },
            SelectionVanished { node } => SelectionVanished { node: redact(&node) },
            ConnectBegin { node, transport } => ConnectBegin {
                node: redact(&node),
                transport,
            },
            ConnectFail { stage, error, action, transport, code, node } => ConnectFail {
                stage,
                error: redact(&error),
                action,
                transport,
                code,
                node: node.as_deref().map(redact),
            },
            ConnectOk { node, elapsed_ms, transport } => ConnectOk {
                node: redact(&node),
                elapsed_ms,
                transport,
            },
            ReleaseFail { error } => ReleaseFail { error: redact(&error) },
            NodeSwitch { from, to, transport } => NodeSwitch {
                from: redact(&from),
                to: redact(&to),
                transport,
            },
            ConnectCatalogFailover { from, to } => ConnectCatalogFailover {
                from: redact(&from),
                to: redact(&to),
            },
            HealthProbeFail { probe, error } => HealthProbeFail {
                probe,
                error: redact(&error),
            },
            TelemetryConfigFail { error } => TelemetryConfigFail { error: redact(&error) },
            PolicyActivationSkipped { reason } => PolicyActivationSkipped {
                reason: redact(&reason),
            },
            PolicySyncFail { error } => PolicySyncFail { error: redact(&error) },
            DiagnosticsUploadFail { error } => DiagnosticsUploadFail { error: redact(&error) },
            NetworkLogSegmentUploadFail { error } => {
                NetworkLogSegmentUploadFail { error: redact(&error) }
            }
            PeriodicTelemetryUploadFail { error } => {
                PeriodicTelemetryUploadFail { error: redact(&error) }
            }
            other => other,
        }
    }
}

// ---- Redaction (§8, macOS LocalTrafficAudit pattern parity) ----

static REDACTIONS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        // Authorization / Cookie header values (up to quote/comma/newline,
        // so a "Bearer <token>" value is consumed whole).
        (
            Regex::new(r#"(?i)Authorization\s*:\s*[^\n",]*"#).unwrap(),
            "Authorization: ***",
        ),
        (Regex::new(r#"(?i)Cookie\s*:\s*[^"\n]*"#).unwrap(), "Cookie: ***"),
        // Bearer tokens (case-insensitive).
        (Regex::new(r#"(?i)Bearer\s+\S+"#).unwrap(), "Bearer ***"),
        // JSON-ish token shapes: "token":"…", token=…, accessToken / refreshToken.
        (
            Regex::new(r#"(?i)((?:access_|refresh_)?token)["\\]*\s*[:=]\s*["\\]*[^\s"\\,&]+"#).unwrap(),
            "${1}=***",
        ),
        // token= / password= values (case-insensitive).
        (Regex::new(r#"(?i)token=[^&\s"]+"#).unwrap(), "token=***"),
        (Regex::new(r#"(?i)password=[^&\s"]+"#).unwrap(), "password=***"),
        // URL query strings.
        (Regex::new(r#"\?[^\s"]+"#).unwrap(), "?***"),
        // userinfo (creds@host) inside URLs.
        (Regex::new(r#"://[^/@\s"]+@"#).unwrap(), "://***@"),
    ]
});

/// Redact credentials, tokens, and URL-borne secrets from a raw payload
/// fragment. Pure; applied to every String event field before serde ever
/// sees it.
pub fn redact(input: &str) -> String {
    let mut output = input.to_string();
    for (pattern, replacement) in REDACTIONS.iter() {
        output = pattern.replace_all(&output, *replacement).into_owned();
    }
    output
}

// ---- Rotating writer ----

/// Appends JSONL lines to `path`, rotating into a single backup generation
/// when the cap is exceeded. Files are created owner-only (0600 / private
/// DACL) via the shared helpers.
struct RotatingWriter {
    file: std::fs::File,
    path: PathBuf,
    written: u64,
    cap: u64,
}

impl RotatingWriter {
    fn open(path: &Path, cap: u64) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = state::open_private_append(path)?;
        let written = file.metadata()?.len();
        Ok(Self {
            file,
            path: path.to_path_buf(),
            written,
            cap,
        })
    }

    fn backup_path(&self) -> PathBuf {
        self.path.with_file_name(AUDIT_BACKUP_FILE_NAME)
    }

    /// Live lines flush per write (low volume, immediately observable);
    /// the quit drain passes `flush = false` and flushes once at the end
    /// (L4: WM_ENDSESSION gives the process a bounded budget).
    fn write_line(&mut self, line: &str, flush: bool) -> std::io::Result<()> {
        use std::io::Write as _;

        let incoming = line.len() as u64 + 1;
        if self.written > 0 && self.written + incoming > self.cap {
            self.rotate()?;
        }
        writeln!(self.file, "{line}")?;
        if flush {
            self.file.flush()?;
        }
        self.written += incoming;
        Ok(())
    }

    /// current → `.1` (single retained generation), fresh current file.
    fn rotate(&mut self) -> std::io::Result<()> {
        use std::io::Write as _;

        self.file.flush()?;
        let backup = self.backup_path();
        match std::fs::remove_file(&backup) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
        std::fs::rename(&self.path, &backup)?;
        self.file = state::open_private_append(&self.path).map_err(|err| std::io::Error::other(err.to_string()))?;
        self.written = 0;
        Ok(())
    }

    /// Final flush + durable sync (used once at drain end, L4).
    fn sync(&mut self) -> std::io::Result<()> {
        self.file.sync_all()
    }
}

/// The blocking writer loop: drains the channel until every sender is gone
/// (the quit path drops the last one to flush), then syncs once and exits.
/// Live lines flush per write; drain-phase lines (channel closed) batch.
fn writer_loop(mut receiver: tokio::sync::mpsc::Receiver<AuditRecord>, path: PathBuf) {
    let mut writer = match RotatingWriter::open(&path, MAX_AUDIT_FILE_BYTES) {
        Ok(writer) => writer,
        Err(_) => {
            // Drain anyway so senders never see a full channel with no
            // reader; the events are simply lost.
            while receiver.blocking_recv().is_some() {}
            return;
        }
    };
    while let Some(record) = receiver.blocking_recv() {
        let Ok(line) = serde_json::to_string(&record) else {
            continue;
        };
        // A disk error drops the line; the loop must keep draining so the
        // bounded channel never backs up into the product paths.
        let _ = writer.write_line(&line, !receiver.is_closed());
    }
    let _ = writer.sync();
}

// ---- Settings (`tono/settings.json`) ----

fn default_true() -> bool {
    true
}

/// One-line revert point for the network-log-upload default. Flip to `false`
/// if the owner decides this must not stay default-on.
pub const NETWORK_LOG_UPLOAD_DEFAULT: bool = true;

/// Internal candidate build: `TONO_BUILD_CHANNEL=internal` at compile time,
/// which only the Windows candidate workflow sets. Release builds never carry
/// it, so their consent defaults stay as they are.
pub fn internal_build() -> bool {
    option_env!("TONO_BUILD_CHANNEL") == Some("internal")
}

/// What an immediate connect-failure report (`telemetry/failures`) may carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureReportScope {
    /// The user opted into the diagnostic timeline: the redacted error text
    /// rides along, as before.
    Full,
    /// Internal-build default (owner decision 2026-09-24): stage, error code,
    /// version and node only. No error text, URLs, addresses or account data.
    Classified,
}

/// Whether a connect failure is reported, and with what. The local log switch
/// still stops every report. Release builds report only after the timeline
/// opt-in; internal builds also send the classified record without it. That
/// default comes from the build, not from `settings.json`, so the one-shot v2
/// reset of the timeline switch cannot turn it off on upgrade.
pub fn failure_report_scope(
    internal_build: bool,
    audit_enabled: bool,
    timeline_opted_in: bool,
) -> Option<FailureReportScope> {
    if !audit_enabled {
        None
    } else if timeline_opted_in {
        Some(FailureReportScope::Full)
    } else if internal_build {
        Some(FailureReportScope::Classified)
    } else {
        None
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct SettingsFile {
    #[serde(default = "default_true")]
    audit_enabled: bool,
    /// Default OFF: short diagnostic timelines still create durable D1 rows
    /// and therefore require an explicit opt-in. Unchanged by the v3 log-upload flip.
    #[serde(default)]
    periodic_telemetry_enabled: bool,
    /// One-shot migration from the former default-on policy. New defaults set
    /// this immediately; an old settings file lacks it and is reset once.
    #[serde(default)]
    periodic_telemetry_default_v2: bool,
    /// Uploads the audit log itself (hostnames, process names, routes, byte
    /// totals). Default follows [`NETWORK_LOG_UPLOAD_DEFAULT`].
    #[serde(default)]
    network_log_upload_enabled: bool,
    /// Legacy migration marker; stored choices must survive the new default.
    #[serde(default)]
    network_log_default_v2: bool,
    /// v3 records adoption without overriding legacy opt-outs.
    #[serde(default)]
    network_log_default_v3: bool,
    /// Set when the user (or a later setter call) actually toggles the switch.
    /// Older clients never wrote this marker; its absence is not consent.
    #[serde(default)]
    network_log_upload_user_chosen: bool,
    #[serde(default)]
    network_log_upload_scope: Option<PersistedUploadScope>,
}

#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct PersistedUploadScope {
    owner: String,
    id: String,
}

#[derive(Clone)]
pub(crate) struct LogUploadScope {
    pub id: String,
    pub cancelled: tokio_util::sync::CancellationToken,
}

#[derive(Default)]
struct UploadOwner {
    owner: Option<String>,
    scope: Option<LogUploadScope>,
}

// Serialize all settings read/modify/write operations, including migration.
// Otherwise a telemetry toggle can resurrect a revoked upload scope.
static SETTINGS_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());


impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            audit_enabled: true,
            periodic_telemetry_enabled: false,
            periodic_telemetry_default_v2: true,
            network_log_upload_enabled: NETWORK_LOG_UPLOAD_DEFAULT,
            network_log_default_v2: true,
            network_log_default_v3: true,
            network_log_upload_user_chosen: false,
            network_log_upload_scope: None,
        }
    }
}

fn load_settings(dir: &Path) -> SettingsFile {
    let _guard = SETTINGS_LOCK.lock();
    load_settings_locked(dir)
}

fn load_settings_locked(dir: &Path) -> SettingsFile {
    let mut settings = match std::fs::read_to_string(dir.join(SETTINGS_FILE_NAME)) {
        Ok(body) => match serde_json::from_str::<SettingsFile>(&body) {
            Ok(settings) => settings,
            Err(_) => return SettingsFile { network_log_upload_enabled: false, ..SettingsFile::default() },
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SettingsFile::default(),
        Err(_) => return SettingsFile { network_log_upload_enabled: false, ..SettingsFile::default() },
    };
    let mut migrated = false;
    if !settings.network_log_default_v2 {
        settings.network_log_default_v2 = true;
        migrated = true;
    }
    if !settings.periodic_telemetry_default_v2 {
        settings.periodic_telemetry_enabled = false;
        settings.periodic_telemetry_default_v2 = true;
        migrated = true;
    }
    if !settings.network_log_default_v3 {
        settings.network_log_default_v3 = true;
        migrated = true;
    }
    if migrated {
        let _ = save_settings(dir, &settings);
    }
    settings
}

/// Default is ON (macOS parity): a missing or corrupt settings file reads
/// as enabled.
pub fn audit_enabled_from_settings(dir: &Path) -> bool {
    load_settings(dir).audit_enabled
}

/// Default OFF; legacy default-on settings are reset exactly once by v2.
pub fn periodic_telemetry_enabled_from_settings(dir: &Path) -> bool {
    load_settings(dir).periodic_telemetry_enabled
}

/// Default follows [`NETWORK_LOG_UPLOAD_DEFAULT`]. v2 wrote false for every
/// existing install; v3 flips those users once unless they have since chosen.
pub fn network_log_upload_enabled_from_settings(dir: &Path) -> bool {
    load_settings(dir).network_log_upload_enabled
}

/// Atomic settings write (L3): temp file with owner-only protection, then
/// rename over the live one.
fn save_settings(dir: &Path, settings: &SettingsFile) -> Result<()> {
    let body = serde_json::to_string(settings).context("failed to serialize settings")?;
    let temp = dir.join(format!(".{SETTINGS_FILE_NAME}.tmp-{}", std::process::id()));
    let write_result = state::write_private_file(&temp, body.as_bytes());
    let result = write_result
        .and_then(|()| std::fs::rename(&temp, dir.join(SETTINGS_FILE_NAME)).context("failed to publish settings"));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn save_audit_enabled(dir: &Path, enabled: bool) -> Result<()> {
    let _guard = SETTINGS_LOCK.lock();
    let mut settings = load_settings_locked(dir);
    settings.audit_enabled = enabled;
    if !enabled { settings.network_log_upload_scope = None; }
    save_settings(dir, &settings)
}

fn save_periodic_telemetry_enabled(dir: &Path, enabled: bool) -> Result<()> {
    let _guard = SETTINGS_LOCK.lock();
    let mut settings = load_settings_locked(dir);
    settings.periodic_telemetry_enabled = enabled;
    save_settings(dir, &settings)
}

fn save_network_log_upload_enabled(dir: &Path, enabled: bool) -> Result<()> {
    let _guard = SETTINGS_LOCK.lock();
    let mut settings = load_settings_locked(dir);
    settings.network_log_upload_enabled = enabled;
    if !enabled { settings.network_log_upload_scope = None; }
    settings.network_log_upload_user_chosen = true;
    save_settings(dir, &settings)
}

// ---- Audit handle ----

/// The product-wide audit handle: an atomic enable flag plus a bounded
/// channel feeding the writer task. The writer self-heals when its task
/// died unexpectedly (L1); after `close_sender` (quit) it never revives.
pub struct Audit {
    upload_owner: parking_lot::Mutex<UploadOwner>,
    sender: parking_lot::Mutex<Option<tokio::sync::mpsc::Sender<AuditRecord>>>,
    writer: parking_lot::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    enabled: AtomicBool,
    periodic_telemetry_enabled: AtomicBool,
    /// Set by the quit path: permanently silences logging and blocks the
    /// self-heal respawn (L1's "closed is not dead" distinction).
    closed: AtomicBool,
    /// L1: whether a dead writer task may be respawned (false in tests,
    /// where the channel is wired externally).
    self_heal: bool,
    /// Events dropped because the channel was full (L2).
    dropped: AtomicU64,
    settings_dir: PathBuf,
    log_path: PathBuf,
}

impl Audit {
    /// Open the log under `logs_dir`, load the toggle from `settings_dir`,
    /// and spawn the writer task.
    pub fn new(logs_dir: &Path, settings_dir: &Path) -> Arc<Self> {
        let settings = load_settings(settings_dir);
        let audit = Arc::new(Self {
            upload_owner: parking_lot::Mutex::new(UploadOwner::default()),
            sender: parking_lot::Mutex::new(None),
            writer: parking_lot::Mutex::new(None),
            enabled: AtomicBool::new(settings.audit_enabled),
            periodic_telemetry_enabled: AtomicBool::new(settings.periodic_telemetry_enabled),
            closed: AtomicBool::new(false),
            self_heal: true,
            dropped: AtomicU64::new(0),
            settings_dir: settings_dir.to_path_buf(),
            log_path: logs_dir.join(AUDIT_FILE_NAME),
        });
        audit.ensure_writer();
        audit
    }

    /// A diskless instance for tests: events go to `sender`, nothing is
    /// written to disk, settings persist into `settings_dir`, and the
    /// writer never respawns over the external wiring.
    #[cfg(test)]
    pub fn for_test(sender: tokio::sync::mpsc::Sender<AuditRecord>, settings_dir: &Path, enabled: bool) -> Arc<Self> {
        Arc::new(Self {
            upload_owner: parking_lot::Mutex::new(UploadOwner::default()),
            sender: parking_lot::Mutex::new(Some(sender)),
            writer: parking_lot::Mutex::new(None),
            enabled: AtomicBool::new(enabled),
            periodic_telemetry_enabled: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            self_heal: false,
            dropped: AtomicU64::new(0),
            settings_dir: settings_dir.to_path_buf(),
            log_path: settings_dir.join(AUDIT_FILE_NAME),
        })
    }

    /// Spawn a fresh channel + writer when the previous task died (crash)
    /// and the handle was never closed. No-op while alive, after close, or
    /// without self-heal (tests).
    fn ensure_writer(&self) {
        if self.closed.load(Ordering::Acquire) || !self.self_heal {
            return;
        }
        let mut writer = self.writer.lock();
        let alive = writer.as_ref().is_some_and(|handle| !handle.inner().is_finished());
        if alive {
            return;
        }
        let (sender, receiver) = tokio::sync::mpsc::channel(CHANNEL_CAPACITY);
        *self.sender.lock() = Some(sender);
        let path = self.log_path.clone();
        *writer = Some(AsyncHandler::spawn_blocking(move || {
            writer_loop(receiver, path);
        }));
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub fn periodic_telemetry_enabled(&self) -> bool {
        self.periodic_telemetry_enabled.load(Ordering::Acquire)
    }

    /// [`failure_report_scope`] for this build and the current switches.
    pub fn failure_report_scope(&self) -> Option<FailureReportScope> {
        failure_report_scope(internal_build(), self.enabled(), self.periodic_telemetry_enabled())
    }

    pub fn log_path(&self) -> &Path {
        &self.log_path
    }

    /// Read from the settings file rather than cached in an atomic like the two
    /// flags above: the uploader consults this once per sweep, minutes apart, so
    /// there is nothing to gain from a cache and a stale one would keep sending
    /// after the user switched it off.
    pub fn network_log_upload_enabled(&self) -> bool {
        network_log_upload_enabled_from_settings(&self.settings_dir)
    }

    /// Only a verified account can own future records. Startup/legacy records
    /// without a scope are retained locally, never silently attributed at upload.
    pub(crate) fn activate_log_upload_owner(&self, account: &str) {
        let mut owner = self.upload_owner.lock();
        owner.owner = Some(account.to_string());
        self.refresh_upload_scope(&mut owner);
    }

    pub(crate) fn abandon_log_upload_owner(&self) {
        let mut owner = self.upload_owner.lock();
        owner.owner = None;
        self.refresh_upload_scope(&mut owner);
    }

    fn refresh_upload_scope(&self, owner: &mut UploadOwner) {
        let _settings_guard = SETTINGS_LOCK.lock();
        let mut settings = load_settings_locked(&self.settings_dir);
        let desired = owner.owner.as_ref().filter(|_| {
            self.enabled() && settings.network_log_upload_enabled
        }).map(|account| {
            settings.network_log_upload_scope.as_ref()
                .filter(|saved| saved.owner == *account)
                .cloned()
                .unwrap_or_else(|| PersistedUploadScope {
                    owner: account.clone(), id: tono_core::auth::new_installation_id(),
                })
        });
        let changed = settings.network_log_upload_scope != desired;
        settings.network_log_upload_scope = desired.clone();
        // A failed durable boundary must not grant any new upload authority.
        // A no-op must not rewrite an unreadable/malformed settings file.
        let desired = if !changed || save_settings(&self.settings_dir, &settings).is_ok() { desired } else { None };
        let same = owner.scope.as_ref().zip(desired.as_ref())
            .is_some_and(|(current, wanted)| current.id == wanted.id);
        if !same {
            if let Some(previous) = owner.scope.take() { previous.cancelled.cancel(); }
            owner.scope = desired.map(|saved| LogUploadScope {
                id: saved.id, cancelled: tokio_util::sync::CancellationToken::new(),
            });
        }
    }

    pub(crate) fn log_upload_scope(&self) -> Option<LogUploadScope> {
        self.upload_owner.lock().scope.clone()
    }

    /// Linearize cursor acknowledgement with consent/owner changes. The caller
    /// also holds the app account-generation lock; never acquire it from here.
    pub(crate) fn with_log_upload_scope<R>(&self, scope: &LogUploadScope, action: impl FnOnce() -> R) -> Option<R> {
        let owner = self.upload_owner.lock();
        if scope.cancelled.is_cancelled() || !self.enabled() || !self.network_log_upload_enabled()
            || !owner.scope.as_ref().is_some_and(|current| current.id == scope.id) {
            return None;
        }
        Some(action())
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Non-blocking, best-effort, never panics: disabled, closed, or a full
    /// channel drops the event (the last one counted).
    pub fn log(&self, event: AuditEvent) {
        if !self.enabled() || self.closed.load(Ordering::Acquire) {
            return;
        }
        self.ensure_writer();
        self.record(event);
    }

    /// Bypasses the toggle — used only for the lifecycle markers
    /// (`auditDisabled` must land as the last line before silence).
    fn record(&self, event: AuditEvent) {
        let owner = self.upload_owner.lock();
        let mut record = AuditRecord::now(event.redacted());
        record.upload_scope = owner.scope.as_ref().map(|scope| scope.id.clone());
        let sender = self.sender.lock();
        if let Some(sender) = sender.as_ref()
            && sender.try_send(record).is_err()
        {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Toggle the switch (L3): persist first — the in-memory flag flips
    /// only on success, so the two never diverge — then emit the matching
    /// lifecycle marker (§8).
    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if self.enabled() == enabled {
            return Ok(());
        }
        let mut owner = self.upload_owner.lock();
        save_audit_enabled(&self.settings_dir, enabled).map_err(|err| err.to_string())?;
        self.enabled.store(enabled, Ordering::Release);
        self.refresh_upload_scope(&mut owner);
        drop(owner);
        if enabled {
            self.record(AuditEvent::AuditEnabled);
        } else {
            self.record(AuditEvent::AuditDisabled);
        }
        Ok(())
    }

    /// Toggle cloud periodic telemetry (explicit opt-in, default OFF).
    pub fn set_periodic_telemetry_enabled(&self, enabled: bool) -> Result<(), String> {
        if self.periodic_telemetry_enabled() == enabled {
            return Ok(());
        }
        save_periodic_telemetry_enabled(&self.settings_dir, enabled).map_err(|err| err.to_string())?;
        self.periodic_telemetry_enabled
            .store(enabled, Ordering::Release);
        if enabled {
            self.record(AuditEvent::PeriodicTelemetryEnabled);
        } else {
            self.record(AuditEvent::PeriodicTelemetryDisabled);
        }
        Ok(())
    }

    /// Toggle the upload of the raw audit log.
    ///
    /// Default follows [`NETWORK_LOG_UPLOAD_DEFAULT`]. Always persist
    /// `network_log_upload_user_chosen` so a later default flip cannot override
    /// an explicit confirmation of the current value.
    pub fn set_network_log_upload_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut owner = self.upload_owner.lock();
        let previous = self.network_log_upload_enabled();
        save_network_log_upload_enabled(&self.settings_dir, enabled).map_err(|err| err.to_string())?;
        self.refresh_upload_scope(&mut owner);
        drop(owner);
        if previous == enabled {
            return Ok(());
        }
        if enabled {
            self.record(AuditEvent::NetworkLogUploadEnabled);
        } else {
            self.record(AuditEvent::NetworkLogUploadDisabled);
        }
        Ok(())
    }

    /// Quit path: mark closed (no self-heal resurrection) and drop the
    /// sender so the writer drains and exits; the caller then awaits the
    /// task handle from `take_writer`.
    pub fn close_sender(&self) {
        self.closed.store(true, Ordering::Release);
        // Stop in-flight requests, but retain the same-owner durable scope so
        // the next authenticated launch can catch up its own offline records.
        if let Some(scope) = self.upload_owner.lock().scope.take() { scope.cancelled.cancel(); }
        self.sender.lock().take();
    }

    pub fn take_writer(&self) -> Option<tauri::async_runtime::JoinHandle<()>> {
        self.writer.lock().take()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Audit, AuditEvent, AuditRecord, FailureReportScope, MAX_AUDIT_FILE_BYTES, RotatingWriter,
        audit_enabled_from_settings, failure_report_scope, network_log_upload_enabled_from_settings,
        periodic_telemetry_enabled_from_settings, redact, save_network_log_upload_enabled,
        save_periodic_telemetry_enabled,
    };
    use std::path::{Path, PathBuf};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let serial = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("tono-audit-test-{tag}-{}-{serial}", std::process::id()));
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

    // ---- redaction: one case per pattern group ----

    #[tokio::test]
    async fn queued_records_keep_their_original_upload_owner() {
        let dir = TempDir::new("upload-scope");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let audit = Audit::for_test(sender, dir.path(), true);
        audit.activate_log_upload_owner("account-a");
        let first = audit.log_upload_scope().unwrap();
        audit.log(AuditEvent::NetworkChange { counter: 1 });
        audit.activate_log_upload_owner("account-b");
        let second = audit.log_upload_scope().unwrap();
        audit.log(AuditEvent::NetworkChange { counter: 2 });
        assert!(first.cancelled.is_cancelled());
        assert_ne!(first.id, second.id);
        assert_eq!(receiver.recv().await.unwrap().upload_scope, Some(first.id));
        assert_eq!(receiver.recv().await.unwrap().upload_scope, Some(second.id));
    }

    #[tokio::test]
    async fn revoked_upload_scope_cannot_ack_and_reenable_uses_a_new_scope() {
        let dir = TempDir::new("upload-scope");
        let (sender, _receiver) = tokio::sync::mpsc::channel(8);
        let audit = Audit::for_test(sender, dir.path(), true);
        audit.activate_log_upload_owner("account-a");
        let pending = audit.log_upload_scope().unwrap();
        audit.set_network_log_upload_enabled(false).unwrap();
        assert!(pending.cancelled.is_cancelled());
        let mut advanced = false;
        assert!(audit.with_log_upload_scope(&pending, || advanced = true).is_none());
        assert!(!advanced);
        audit.set_network_log_upload_enabled(true).unwrap();
        assert_ne!(audit.log_upload_scope().unwrap().id, pending.id);
        assert!(audit.with_log_upload_scope(&pending, || ()).is_none());
    }

    #[test]
    fn redact_authorization_header() {
        // The value runs to quote/comma/newline: prose after it is consumed
        // too — over-redaction is deliberate, leaking is not an option.
        assert_eq!(
            redact("failed: Authorization: abc.def.ghi rejected"),
            "failed: Authorization: ***"
        );
        assert_eq!(redact("authorization: xyz"), "Authorization: ***");
    }

    #[test]
    fn redact_cookie_header() {
        assert_eq!(redact("Cookie: session=abc; theme=dark"), "Cookie: ***");
    }

    #[test]
    fn redact_bearer_token() {
        assert_eq!(redact("Authorization: Bearer abc123.def456"), "Authorization: ***");
        assert_eq!(redact("sent Bearer abc123"), "sent Bearer ***");
        // Case-insensitive (M1).
        assert_eq!(redact("sent BEARER abc123"), "sent Bearer ***");
    }

    #[test]
    fn redact_token_and_password_params() {
        assert_eq!(redact("refresh?token=abc123&ok=1"), "refresh?***");
        assert_eq!(redact("body token=abc123 end"), "body token=*** end");
        assert_eq!(redact("body password=hunter2 end"), "body password=*** end");
        // Case-insensitive (M1).
        assert_eq!(redact("body Token=abc123 end"), "body token=*** end");
        assert_eq!(redact("body PASSWORD=hunter2 end"), "body password=*** end");
    }

    #[test]
    fn redact_json_token_shapes() {
        // M1: `"token":"…"` / accessToken / refreshToken JSON forms.
        assert_eq!(redact(r#"payload {"token":"abc"}"#), r#"payload {"token=***"}"#);
        assert!(!redact(r#"{"accessToken":"zzz"}"#).contains("zzz"));
        assert!(!redact(r#"{"refreshToken": "yyy"}"#).contains("yyy"));
    }

    #[test]
    fn redact_url_query() {
        assert_eq!(
            redact("GET https://api.example.com/devices?token=abc&x=1 failed"),
            "GET https://api.example.com/devices?*** failed"
        );
    }

    #[test]
    fn redact_userinfo() {
        assert_eq!(
            redact("dial https://user:pass@example.com/path"),
            "dial https://***@example.com/path"
        );
    }

    #[test]
    fn redacted_fields_keep_the_serialized_line_valid_json() {
        // Adversarial (M1): raw field with an embedded quote — redaction
        // happens before serde, so escaping stays correct.
        let record = AuditRecord::now(
            AuditEvent::SyncFail {
                error:
                    "GET https://x.test/a?token=abc failed: token=abc\"x Authorization: secret Bearer zzz password=p"
                        .to_string(),
            }
            .redacted(),
        );
        let line = serde_json::to_string(&record).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["kind"], "syncFail");
        let error = parsed["error"].as_str().unwrap();
        for secret in ["secret", "zzz", "abc"] {
            assert!(!error.contains(secret), "leaked {secret} in {error}");
        }
    }

    #[test]
    fn redacted_covers_every_string_field() {
        let events = vec![
            AuditEvent::SignInStart {
                email: "a?token=x@b.co".to_string(),
            },
            AuditEvent::SignInOk {
                email: "a?token=x@b.co".to_string(),
            },
            AuditEvent::RevokeDevice {
                id: "id token=abc".to_string(),
            },
            AuditEvent::SyncFail {
                error: "token=abc".to_string(),
            },
            AuditEvent::SelectionVanished {
                node: "n token=abc".to_string(),
            },
            AuditEvent::ConnectBegin {
                node: "n token=abc".to_string(),
                transport: "tcp",
            },
            AuditEvent::ConnectFail {
                stage: None,
                error: "token=abc".to_string(),
                action: "fullRelease",
                transport: None,
                code: None,
                node: Some("n token=abc".to_string()),
            },
            AuditEvent::ConnectOk {
                node: "n token=abc".to_string(),
                elapsed_ms: 1,
                transport: "tcp",
            },
            AuditEvent::ReleaseFail {
                error: "token=abc".to_string(),
            },
            AuditEvent::NodeSwitch {
                from: "a token=abc".to_string(),
                to: "b token=abc".to_string(),
                transport: "tcp",
            },
            AuditEvent::ConnectCatalogFailover {
                from: "a token=abc".to_string(),
                to: "b token=abc".to_string(),
            },
            AuditEvent::PolicyActivationSkipped {
                reason: "GET https://resolver.test/dns-query?token=abc failed".to_string(),
            },
        ];
        for event in events {
            let line = serde_json::to_string(&AuditRecord::now(event.redacted())).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
            let text = serde_json::to_string(&parsed).unwrap();
            assert!(!text.contains("abc"), "unredacted field in {text}");
            assert!(!text.contains("token=x"), "unredacted field in {text}");
        }
    }

    // ---- rotation ----

    fn log_path(dir: &TempDir) -> PathBuf {
        dir.path().join(super::AUDIT_FILE_NAME)
    }

    #[test]
    fn rotation_keeps_two_generations_and_parseable_lines() {
        let dir = TempDir::new("rotate");
        let path = log_path(&dir);
        let cap = 512_u64;
        let mut writer = RotatingWriter::open(&path, cap).unwrap();
        for index in 0..40 {
            let line = serde_json::to_string(&AuditRecord::now(AuditEvent::NetworkChange { counter: index })).unwrap();
            writer.write_line(&line, true).unwrap();
        }
        writer.sync().unwrap();

        let backup = dir.path().join(super::AUDIT_BACKUP_FILE_NAME);
        assert!(backup.exists(), "rotation must produce the backup generation");
        assert!(path.exists());
        // The fresh generation starts small; the backup holds the overflow.
        assert!(std::fs::metadata(&path).unwrap().len() < cap + 256);
        assert!(std::fs::metadata(&backup).unwrap().len() <= cap + 256);
        // Exactly two generations exist.
        let entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(entries.len(), 2);
        // Every line in both files is a parseable record.
        for file in [&path, &backup] {
            for line in std::fs::read_to_string(file).unwrap().lines() {
                let value: serde_json::Value = serde_json::from_str(line).unwrap();
                assert_eq!(value["kind"], "networkChange");
                assert!(value["ts"].is_number());
                assert!(value["counter"].is_number());
            }
        }
        // Unix: both generations are owner-only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            for file in [&path, &backup] {
                assert_eq!(std::fs::metadata(file).unwrap().permissions().mode() & 0o777, 0o600);
            }
        }
    }

    #[test]
    fn rotation_size_cap_constant_is_10_mib() {
        assert_eq!(MAX_AUDIT_FILE_BYTES, 10 * 1024 * 1024);
    }

    // ---- toggle behaviour ----

    #[tokio::test]
    async fn disabled_drops_events_but_audit_disabled_is_the_last_line() {
        let dir = TempDir::new("toggle");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let audit = Audit::for_test(sender, dir.path(), true);

        audit.log(AuditEvent::SignOut);
        assert!(receiver.try_recv().is_ok(), "enabled: events flow");

        audit.set_enabled(false).unwrap();
        let last = receiver
            .try_recv()
            .expect("auditDisabled must be written before silence");
        assert_eq!(
            serde_json::to_value(&last).unwrap()["kind"],
            serde_json::json!("auditDisabled")
        );
        audit.log(AuditEvent::SignOut);
        assert!(receiver.try_recv().is_err(), "disabled: events are dropped");

        audit.set_enabled(true).unwrap();
        let marker = receiver.try_recv().expect("auditEnabled must be written on re-enable");
        assert_eq!(
            serde_json::to_value(&marker).unwrap()["kind"],
            serde_json::json!("auditEnabled")
        );
        audit.log(AuditEvent::RetryRestore);
        assert!(receiver.try_recv().is_ok(), "re-enabled: events flow again");

        // The toggle round-tripped through settings.json.
        let body = std::fs::read_to_string(dir.path().join(super::SETTINGS_FILE_NAME)).unwrap();
        let settings: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(settings["audit_enabled"], true);
    }

    #[tokio::test]
    async fn set_enabled_failure_keeps_flag_and_reports_error() {
        // L3: settings dir is a regular file — persistence must fail, the
        // flag must not flip, and the error must surface.
        let dir = TempDir::new("settings-fail");
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"not a directory").unwrap();
        let (sender, _receiver) = tokio::sync::mpsc::channel(8);
        let audit = Audit::for_test(sender, &blocker, true);

        assert!(audit.set_enabled(false).is_err());
        assert!(audit.enabled(), "failed persistence must not flip the flag");
        // The marker must not have been emitted either.
        assert_eq!(audit.dropped_count(), 0);
    }

    #[test]
    fn dropped_events_are_counted() {
        // L2: capacity-1 channel with no reader — the overflow is counted.
        let dir = TempDir::new("dropped");
        let (sender, _receiver) = tokio::sync::mpsc::channel(1);
        let audit = Audit::for_test(sender, dir.path(), true);
        assert_eq!(audit.dropped_count(), 0);
        audit.log(AuditEvent::SignOut);
        audit.log(AuditEvent::SignOut);
        audit.log(AuditEvent::SignOut);
        assert_eq!(audit.dropped_count(), 2);
    }

    #[test]
    fn corrupt_or_missing_settings_defaults_to_enabled() {
        let dir = TempDir::new("settings");
        assert!(audit_enabled_from_settings(dir.path()), "missing file defaults to true");
        std::fs::write(dir.path().join(super::SETTINGS_FILE_NAME), "{not json").unwrap();
        assert!(audit_enabled_from_settings(dir.path()), "corrupt file defaults to true");
        std::fs::write(dir.path().join(super::SETTINGS_FILE_NAME), r#"{"audit_enabled":false}"#).unwrap();
        assert!(!audit_enabled_from_settings(dir.path()));
        // Unknown extra fields are tolerated.
        std::fs::write(
            dir.path().join(super::SETTINGS_FILE_NAME),
            r#"{"audit_enabled":false,"future":1}"#,
        )
        .unwrap();
        assert!(!audit_enabled_from_settings(dir.path()));
    }

    #[test]
    fn periodic_telemetry_defaults_off_and_migrates_legacy_true_once() {
        let fresh = TempDir::new("periodic-fresh");
        assert!(
            !periodic_telemetry_enabled_from_settings(fresh.path()),
            "a new installation must not opt into periodic D1 writes"
        );

        let legacy = TempDir::new("periodic-legacy");
        std::fs::write(
            legacy.path().join(super::SETTINGS_FILE_NAME),
            r#"{"audit_enabled":true,"periodic_telemetry_enabled":true,"network_log_default_v2":true}"#,
        )
        .unwrap();
        assert!(
            !periodic_telemetry_enabled_from_settings(legacy.path()),
            "the v2 migration must reset a legacy default-on installation"
        );
        let migrated: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(legacy.path().join(super::SETTINGS_FILE_NAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(migrated["periodic_telemetry_enabled"], false);
        assert_eq!(migrated["periodic_telemetry_default_v2"], true);

        save_periodic_telemetry_enabled(legacy.path(), true).unwrap();
        assert!(periodic_telemetry_enabled_from_settings(legacy.path()));
        assert!(
            periodic_telemetry_enabled_from_settings(legacy.path()),
            "a post-migration explicit opt-in must survive every later load"
        );
    }

    #[test]
    fn internal_builds_keep_classified_failure_reports_through_the_timeline_reset() {
        // An upgraded install: the v2 migration resets the legacy default-on timeline switch.
        let upgraded = TempDir::new("failure-report-upgrade");
        std::fs::write(
            upgraded.path().join(super::SETTINGS_FILE_NAME),
            r#"{"audit_enabled":true,"periodic_telemetry_enabled":true,"network_log_default_v2":true}"#,
        )
        .unwrap();
        let timeline = periodic_telemetry_enabled_from_settings(upgraded.path());
        let audit = audit_enabled_from_settings(upgraded.path());
        assert!(!timeline && audit);
        assert_eq!(
            failure_report_scope(true, audit, timeline),
            Some(FailureReportScope::Classified),
            "an internal build must keep reporting classified failures after the upgrade reset"
        );
        assert_eq!(
            failure_report_scope(false, audit, timeline),
            None,
            "release builds keep the opt-in"
        );
        assert_eq!(failure_report_scope(false, audit, true), Some(FailureReportScope::Full));
        assert_eq!(
            failure_report_scope(true, false, true),
            None,
            "the local log switch stops every report"
        );
    }

    #[test]
    fn network_log_upload_fresh_file_follows_default_and_snapshot_stays_off() {
        let fresh = TempDir::new("nlog-fresh");
        assert!(
            network_log_upload_enabled_from_settings(fresh.path()),
            "a new installation must follow NETWORK_LOG_UPLOAD_DEFAULT (currently on)"
        );
        assert!(
            !periodic_telemetry_enabled_from_settings(fresh.path()),
            "the periodic snapshot default must stay off"
        );
    }

    #[test]
    fn unreadable_network_log_preference_does_not_enable_upload_or_overwrite_evidence() {
        let dir = TempDir::new("nlog-corrupt");
        let path = dir.path().join(super::SETTINGS_FILE_NAME);
        std::fs::write(&path, b"{broken").unwrap();
        assert!(!network_log_upload_enabled_from_settings(dir.path()));
        assert_eq!(std::fs::read(&path).unwrap(), b"{broken");
    }

    #[test]
    fn network_log_upload_preserves_legacy_opt_out_without_a_chosen_marker() {
        let legacy = TempDir::new("nlog-v2");
        std::fs::write(
            legacy.path().join(super::SETTINGS_FILE_NAME),
            r#"{"audit_enabled":true,"periodic_telemetry_enabled":false,"periodic_telemetry_default_v2":true,"network_log_upload_enabled":false,"network_log_default_v2":true}"#,
        )
        .unwrap();
        assert!(
            !network_log_upload_enabled_from_settings(legacy.path()),
            "a legacy opt-out must not be mistaken for absence of consent"
        );
        let migrated: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(legacy.path().join(super::SETTINGS_FILE_NAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(migrated["network_log_upload_enabled"], false);
        assert_eq!(migrated["network_log_default_v3"], true);
        assert_eq!(migrated["network_log_upload_user_chosen"], false);
        assert_eq!(migrated["periodic_telemetry_enabled"], false);
    }

    #[test]
    fn network_log_upload_v3_user_chosen_false_stays_off() {
        let chosen = TempDir::new("nlog-chosen");
        std::fs::write(
            chosen.path().join(super::SETTINGS_FILE_NAME),
            r#"{"audit_enabled":true,"network_log_upload_enabled":false,"network_log_default_v2":true,"network_log_default_v3":true,"network_log_upload_user_chosen":true}"#,
        )
        .unwrap();
        assert!(
            !network_log_upload_enabled_from_settings(chosen.path()),
            "an explicit off after v3 must not be flipped again"
        );
        let body: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(chosen.path().join(super::SETTINGS_FILE_NAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(body["network_log_upload_enabled"], false);
        assert_eq!(body["network_log_upload_user_chosen"], true);
    }

    #[test]
    fn network_log_upload_setter_marks_user_chosen_and_the_choice_sticks() {
        let dir = TempDir::new("nlog-set");
        assert!(network_log_upload_enabled_from_settings(dir.path()));
        save_network_log_upload_enabled(dir.path(), false).unwrap();
        assert!(!network_log_upload_enabled_from_settings(dir.path()));
        let body: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join(super::SETTINGS_FILE_NAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(body["network_log_upload_user_chosen"], true);
        assert_eq!(body["network_log_upload_enabled"], false);
        assert!(
            !network_log_upload_enabled_from_settings(dir.path()),
            "a post-v3 explicit off must survive every later load"
        );
    }
}
