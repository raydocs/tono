use super::*;

pub(super) const SNAPSHOT_VERSION: u32 = 1;
/// Sidecar next to `protected-dns.json`. Written *before* Encrypted DNS is
/// mutated so a crash still has the user's `EnableAutoDoh` value to put back.
pub(super) const ENCRYPTED_DNS_CAPTURE_FILE: &str = "protected-secure-dns.json";
/// Sidecar for per-adapter DoH templates (Settings → DNS encryption). Separate
/// from the EnableAutoDoh file so a mid-session upgrade can still restore
/// a DWORD capture written by an older build.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) const INTERFACE_DOH_CAPTURE_FILE: &str = "protected-interface-doh.json";
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const INTERFACE_DOH_CAPTURE_VERSION: u32 = 1;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE_AUTO`
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const DNS_DOH_ENABLE_AUTO: u64 = 0x1;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE` (manual template).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const DNS_DOH_ENABLE: u64 = 0x2;
/// `DNS_DOH_SERVER_SETTINGS_FALLBACK_TO_UDP`
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const DNS_DOH_FALLBACK_TO_UDP: u64 = 0x4;
/// `EnableAutoDoh` off. 2 is opportunistic (Win11 default), 3 is required.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) const ENABLE_AUTO_DOH_OFF: u32 = 0;

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn encrypted_dns_capture_path() -> PathBuf {
    #[cfg(all(windows, test, not(feature = "test")))]
    if let Some(path) = engine::test_io::with(|io| io.capture_dir.join(ENCRYPTED_DNS_CAPTURE_FILE))
    {
        return path;
    }
    crate::service_paths()
        .persistent_state_dir()
        .join(ENCRYPTED_DNS_CAPTURE_FILE)
}

/// File body: a decimal DWORD, or `absent` when the value was not set.
pub(super) fn format_encrypted_dns_capture(enable_auto_doh: Option<u32>) -> String {
    match enable_auto_doh {
        Some(value) => format!("{value}\n"),
        None => "absent\n".to_owned(),
    }
}

pub(super) fn parse_encrypted_dns_capture(body: &str) -> Result<Option<u32>, String> {
    let trimmed = body.trim();
    if trimmed == "absent" {
        return Ok(None);
    }
    trimmed
        .parse::<u32>()
        .map(Some)
        .map_err(|error| format!("encrypted DNS capture is not a DWORD ({error})"))
}

/// Win10/11 Settings "Encrypted only" = DoH enabled and UDP fallback off.
/// Encrypted-preferred still tries HTTPS first (the 5 s `securingDNS` hang).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn interface_doh_is_enabled(flags: u64) -> bool {
    flags & (DNS_DOH_ENABLE_AUTO | DNS_DOH_ENABLE) != 0
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn interface_doh_is_encrypted_only(flags: u64) -> bool {
    interface_doh_is_enabled(flags) && flags & DNS_DOH_FALLBACK_TO_UDP == 0
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct InterfaceDohCapture {
    v: u32,
    entries: Vec<InterfaceDohEntry>,
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct InterfaceDohEntry {
    pub(super) guid: String,
    pub(super) family: String,
    pub(super) server: String,
    pub(super) flags: u64,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn interface_doh_capture_path() -> PathBuf {
    #[cfg(all(windows, test, not(feature = "test")))]
    if let Some(path) = engine::test_io::with(|io| io.capture_dir.join(INTERFACE_DOH_CAPTURE_FILE))
    {
        return path;
    }
    crate::service_paths()
        .persistent_state_dir()
        .join(INTERFACE_DOH_CAPTURE_FILE)
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn format_interface_doh_capture(entries: &[InterfaceDohEntry]) -> Result<String, String> {
    serde_json::to_string(&InterfaceDohCapture {
        v: INTERFACE_DOH_CAPTURE_VERSION,
        entries: entries.to_vec(),
    })
    .map_err(|error| format!("interface DoH capture could not be written ({error})"))
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn parse_interface_doh_capture(body: &str) -> Result<Vec<InterfaceDohEntry>, String> {
    let parsed: InterfaceDohCapture = serde_json::from_str(body)
        .map_err(|error| format!("interface DoH capture is not JSON ({error})"))?;
    if parsed.v != INTERFACE_DOH_CAPTURE_VERSION {
        return Err(format!(
            "interface DoH capture version {} is not {}",
            parsed.v, INTERFACE_DOH_CAPTURE_VERSION
        ));
    }
    for entry in &parsed.entries {
        if entry.family != "Doh" && entry.family != "Doh6" {
            return Err(format!(
                "interface DoH capture family {} is not Doh or Doh6",
                entry.family
            ));
        }
        if entry.guid.is_empty() || entry.server.is_empty() {
            return Err("interface DoH capture is missing guid or server".to_owned());
        }
    }
    Ok(parsed.entries)
}

/// One adapter's original DNS values. `None` means the registry value was absent — the
/// typical DHCP state — and restore must delete rather than rewrite it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub(crate) struct AdapterDnsSnapshot {
    pub interface_guid: String,
    /// Runtime-only interface identity from IP Helper. This is used to distinguish the
    /// currently permitted Tono WinTUN adapter from a physical adapter that was accidentally
    /// left on our protected DNS endpoint. LUIDs are not stable across reboot/reinstall, so
    /// they must never become part of the durable recovery snapshot.
    #[serde(skip)]
    pub interface_luid: Option<u64>,
    /// Runtime-only connection name from the adapter's Network-class `Connection` key (e.g.
    /// "Ethernet" or "Tono"). Same persistence rule as the LUID: names are operator-controlled
    /// and must never become part of the durable recovery snapshot. This exists so the tunnel
    /// exclusion in [`without_current_tunnel`] keeps working after the core — and with it the
    /// WFP-validated LUID — is gone.
    #[serde(skip)]
    pub connection_name: Option<String>,
    pub ipv4_name_server: Option<String>,
    pub ipv4_profile_name_server: Option<String>,
    pub ipv6_name_server: Option<String>,
    pub ipv6_profile_name_server: Option<String>,
    /// An apply is unfinished or failed, so the running resolver cannot be trusted to match
    /// the registry until effective verification succeeds. Set before mutation in memory and
    /// the snapshot, including rounds that return Err without per-adapter results. It forces
    /// replay while this adapter is active, not while absent, and survives reappearance.
    /// It is also why the restore proof insists on live evidence —
    /// but it does **not** by itself refuse a restore whose live state is verifiably correct
    /// (see [`restore_is_proven`] and the module docs).
    #[serde(default)]
    pub live_apply_failed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DnsSnapshot {
    pub version: u32,
    pub taken_at: u64,
    pub adapters: Vec<AdapterDnsSnapshot>,
}

pub(super) fn snapshot_path() -> PathBuf {
    #[cfg(all(windows, test, not(feature = "test")))]
    if let Some(path) = engine::test_io::with(|io| io.snapshot_path.clone()) {
        return path;
    }
    crate::service_paths()
        .persistent_state_dir()
        .join("protected-dns.json")
}

pub(super) fn snapshot_retirement_path() -> PathBuf {
    snapshot_path().with_extension("restored.sha256")
}

pub(super) fn snapshot_fingerprint(bytes: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).to_vec()
}

/// A retained file is housekeeping only after this exact snapshot's restore committed.
/// Binding the record to its bytes keeps a stale/late record from retiring a newer session.
pub(super) async fn snapshot_was_restored(bytes: &[u8]) -> bool {
    match tokio::fs::read(snapshot_retirement_path()).await {
        Ok(record) => record == snapshot_fingerprint(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            tracing::warn!("dns: snapshot retirement record could not be read; using full restore proof: {error}");
            false
        }
    }
}

pub(super) async fn clear_snapshot_retirement() -> Result<()> {
    match tokio::fs::remove_file(snapshot_retirement_path()).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to clear DNS snapshot retirement record"),
    }
}

/// Parse and version-check `protected-dns.json`, returning the reason it is unusable rather
/// than an opaque error.
///
/// `version` exists so that a schema change is a *migration*, not a brick: a file written by a
/// newer build cannot be reinterpreted by this one — its `None`/`Some` distinction is what
/// decides between deleting a value and rewriting it — so it is reported unreadable and goes
/// through the same recovery path as a corrupt file. Older versions stay readable: every field
/// added since carries `#[serde(default)]`.
pub(super) fn parse_snapshot(bytes: &[u8]) -> std::result::Result<DnsSnapshot, String> {
    let snapshot: DnsSnapshot =
        serde_json::from_slice(bytes).map_err(|error| format!("the file is corrupt ({error})"))?;
    if snapshot.version > SNAPSHOT_VERSION {
        return Err(format!(
            "the file was written by a newer build (version {}, this build understands up to \
             {SNAPSHOT_VERSION})",
            snapshot.version
        ));
    }
    Ok(snapshot)
}

pub(super) fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(super) async fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    // Native facade tests use a private temporary directory, not the installed Service root.
    #[cfg(all(windows, test, not(feature = "test")))]
    let isolated = engine::test_io::active();
    #[cfg(not(all(windows, test, not(feature = "test"))))]
    let isolated = false;
    if !isolated {
        crate::core::paths::ensure_persistent_state_layout()?;
    }
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    let temporary = path.with_extension("tmp");
    if std::fs::symlink_metadata(&temporary).is_ok() {
        std::fs::remove_file(&temporary)?;
    }
    tokio::fs::write(&temporary, bytes).await?;
    crate::core::platform_security::secure_private_service_file_if_exists(&temporary)?;
    crate::core::atomic_file::replace(&temporary, path).await?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    Ok(())
}
