//! Read-only Chrome/Edge Secure DNS preflight for the Claude residential route.
//!
//! Tono routes browser traffic by destination, not by browser profile. A browser-owned DoH
//! resolver can hide that destination from Mihomo (and ECH can then hide it from TLS sniffing),
//! so a residential Claude guarantee is only honest when the effective browser configuration is
//! provably safe. This module never changes browser or policy settings.

use std::{fs, path::Path};

#[cfg(any(windows, test))]
use std::path::PathBuf;
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

const MAX_CONFIG_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_BROWSER_CONFIG_BYTES: u64 = 16 * 1024 * 1024;
const PREF_MODE: &str = "mode";
const PREF_TEMPLATES: &str = "templates";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BrowserDnsIssue {
    Secure,
    AutomaticCustomProvider,
    UnsupportedMode,
    IncompleteScan,
}

impl BrowserDnsIssue {
    fn detail(self) -> &'static str {
        match self {
            Self::Secure => "Secure DNS is set to Secure",
            Self::AutomaticCustomProvider => "Secure DNS is Automatic with a custom provider",
            Self::UnsupportedMode => "Secure DNS has an unsupported configuration",
            Self::IncompleteScan => "the bounded Secure DNS configuration scan is incomplete",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ManagedPolicy {
    mode: Option<String>,
    templates: Option<String>,
}

#[derive(Clone, Debug, Default)]
struct PreferenceSource {
    mode: Option<Value>,
    templates: Option<Value>,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct BrowserSpec {
    label: &'static str,
    policy_key: &'static str,
    user_data_suffixes: &'static [&'static str],
}

#[cfg(windows)]
const BROWSERS: [BrowserSpec; 2] = [
    BrowserSpec {
        label: "Chrome",
        policy_key: r"SOFTWARE\Policies\Google\Chrome",
        user_data_suffixes: &[
            r"Google\Chrome\User Data",
            r"Google\Chrome Beta\User Data",
            r"Google\Chrome Dev\User Data",
            r"Google\Chrome SxS\User Data",
        ],
    },
    BrowserSpec {
        label: "Edge",
        policy_key: r"SOFTWARE\Policies\Microsoft\Edge",
        user_data_suffixes: &[
            r"Microsoft\Edge\User Data",
            r"Microsoft\Edge Beta\User Data",
            r"Microsoft\Edge Dev\User Data",
            r"Microsoft\Edge SxS\User Data",
        ],
    },
];

/// Check known Chrome/Edge configuration locations for DNS visibility conflicts.
/// This is not proof about portable browsers, command-line overrides, or in-memory state.
///
/// The scan is blocking filesystem/registry work, so keep it off the async runtime. Both the
/// source count and byte count are bounded; the outer timeout handles a filesystem or registry
/// read that the operating system itself does not return from promptly.
#[cfg(windows)]
pub(crate) async fn verify_residential_browser_dns() -> Result<(), String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::task::spawn_blocking(scan_windows_browser_dns),
    )
    .await;
    match result {
        Ok(Ok(verdict)) => verdict,
        Ok(Err(_)) | Err(_) => Err(message("Chrome/Edge", BrowserDnsIssue::IncompleteScan)),
    }
}

#[cfg(windows)]
fn scan_windows_browser_dns() -> Result<(), String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| message("Chrome/Edge", BrowserDnsIssue::IncompleteScan))?;

    for browser in BROWSERS {
        let policy = read_managed_policy(browser).map_err(|issue| message(browser.label, issue))?;
        let mut found_user_data = false;
        let mut total_bytes = 0_u64;
        for suffix in browser.user_data_suffixes {
            let root = local_app_data.join(suffix);
            match root.try_exists() {
                Ok(false) => continue,
                Ok(true) => found_user_data = true,
                Err(_) => return Err(message(browser.label, BrowserDnsIssue::IncompleteScan)),
            }
            scan_user_data_root(&root, &policy, &mut total_bytes).map_err(|issue| message(browser.label, issue))?;
        }

        // A policy can affect a browser that has not created its User Data directory yet. Check
        // it as an otherwise-empty source so a future first launch cannot silently bypass Tono.
        if !found_user_data && (policy.mode.is_some() || policy.templates.is_some()) {
            classify_source(&policy, &PreferenceSource::default()).map_err(|issue| message(browser.label, issue))?;
        }
    }
    Ok(())
}

fn message(browser: &str, issue: BrowserDnsIssue) -> String {
    let recovery = match issue {
        BrowserDnsIssue::IncompleteScan => {
            "Tono could not verify the configuration; this does not mean Secure DNS is enabled. Fully close the browser and retry connecting. If this persists, ask support to check Local State readability, valid JSON, scan limits, and policy access; do not delete browser data or disable Tono protection"
        }
        _ => {
            "Set Secure DNS to Off or Automatic without a custom provider, fully restart the browser, then reconnect Tono. If the setting is managed, ask your administrator to check DnsOverHttpsMode and DnsOverHttpsTemplates"
        }
    };
    format!(
        "{browser}: {}. Tono routes all Chrome and Edge profiles together; profile-level routing is unavailable. {recovery}",
        issue.detail(),
    )
}

fn scan_user_data_root(root: &Path, policy: &ManagedPolicy, total_bytes: &mut u64) -> Result<(), BrowserDnsIssue> {
    // Chromium registers desktop Secure DNS in browser-wide Local State. The policy metadata is
    // likewise `per_profile: false`; profile `Preferences` are neither authoritative nor scanned.
    match read_json_source(&root.join("Local State"), total_bytes)? {
        Some(local_state) => classify_source(policy, &preference_source(&local_state)?)?,
        None => {
            let managed_off = policy
                .mode
                .as_deref()
                .is_some_and(|mode| mode.trim().eq_ignore_ascii_case("off"));
            if !managed_off {
                return Err(BrowserDnsIssue::IncompleteScan);
            }
        }
    }
    Ok(())
}

fn read_json_source(path: &Path, total_bytes: &mut u64) -> Result<Option<Value>, BrowserDnsIssue> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(BrowserDnsIssue::IncompleteScan),
    };
    if !metadata.is_file()
        || metadata.len() > MAX_CONFIG_FILE_BYTES
        || total_bytes.saturating_add(metadata.len()) > MAX_BROWSER_CONFIG_BYTES
    {
        return Err(BrowserDnsIssue::IncompleteScan);
    }
    let bytes = fs::read(path).map_err(|_| BrowserDnsIssue::IncompleteScan)?;
    if bytes.len() as u64 > MAX_CONFIG_FILE_BYTES
        || total_bytes.saturating_add(bytes.len() as u64) > MAX_BROWSER_CONFIG_BYTES
    {
        return Err(BrowserDnsIssue::IncompleteScan);
    }
    *total_bytes += bytes.len() as u64;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| BrowserDnsIssue::IncompleteScan)
}

fn preference_source(value: &Value) -> Result<PreferenceSource, BrowserDnsIssue> {
    let root = value.as_object().ok_or(BrowserDnsIssue::IncompleteScan)?;
    let dns = root
        .get("dns_over_https")
        .map(|value| value.as_object().ok_or(BrowserDnsIssue::IncompleteScan))
        .transpose()?;
    Ok(PreferenceSource {
        mode: dns.and_then(|settings| settings.get(PREF_MODE)).cloned(),
        templates: dns.and_then(|settings| settings.get(PREF_TEMPLATES)).cloned(),
    })
}

fn classify_source(policy: &ManagedPolicy, source: &PreferenceSource) -> Result<(), BrowserDnsIssue> {
    let mode = effective_value(policy.mode.as_deref(), source.mode.as_ref())?;
    // Chromium's unset desktop default is Automatic. A non-empty template therefore blocks even
    // when no explicit mode has been persisted.
    match mode.unwrap_or("automatic").trim().to_ascii_lowercase().as_str() {
        "off" => Ok(()),
        "secure" => Err(BrowserDnsIssue::Secure),
        "automatic" => {
            let templates = effective_value(policy.templates.as_deref(), source.templates.as_ref())?;
            if templates.is_none_or(|value| value.trim().is_empty()) {
                Ok(())
            } else {
                Err(BrowserDnsIssue::AutomaticCustomProvider)
            }
        }
        _ => Err(BrowserDnsIssue::UnsupportedMode),
    }
}

fn effective_value<'a>(
    policy: Option<&'a str>,
    preference: Option<&'a Value>,
) -> Result<Option<&'a str>, BrowserDnsIssue> {
    if let Some(policy) = policy {
        return Ok(Some(policy));
    }
    preference
        .map(|value| value.as_str().ok_or(BrowserDnsIssue::IncompleteScan))
        .transpose()
}

fn merge_policy(machine: ManagedPolicy, user: ManagedPolicy) -> ManagedPolicy {
    ManagedPolicy {
        mode: machine.mode.or(user.mode),
        templates: machine.templates.or(user.templates),
    }
}

#[cfg(windows)]
fn read_managed_policy(browser: BrowserSpec) -> Result<ManagedPolicy, BrowserDnsIssue> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let machine = read_policy_scope(&RegKey::predef(HKEY_LOCAL_MACHINE), browser.policy_key)?;
    let user = read_policy_scope(&RegKey::predef(HKEY_CURRENT_USER), browser.policy_key)?;
    Ok(merge_policy(machine, user))
}

#[cfg(windows)]
fn read_policy_scope(root: &winreg::RegKey, policy_key: &str) -> Result<ManagedPolicy, BrowserDnsIssue> {
    use winreg::enums::KEY_READ;

    let key = match root.open_subkey_with_flags(policy_key, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ManagedPolicy::default());
        }
        Err(_) => return Err(BrowserDnsIssue::IncompleteScan),
    };
    Ok(ManagedPolicy {
        mode: read_policy_string(&key, "DnsOverHttpsMode")?,
        templates: read_policy_string(&key, "DnsOverHttpsTemplates")?,
    })
}

#[cfg(windows)]
fn read_policy_string(key: &winreg::RegKey, name: &str) -> Result<Option<String>, BrowserDnsIssue> {
    match key.get_value(name) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(BrowserDnsIssue::IncompleteScan),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(mode: Option<Value>, templates: Option<Value>) -> PreferenceSource {
        PreferenceSource { mode, templates }
    }

    fn string(value: &str) -> Option<Value> {
        Some(Value::String(value.to_owned()))
    }

    fn temp_root(test: &str) -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("tono-browser-dns-{test}-{nonce}"))
    }

    #[test]
    fn unset_off_and_automatic_without_templates_are_clear() {
        let policy = ManagedPolicy::default();
        assert_eq!(classify_source(&policy, &source(None, None)), Ok(()));
        assert_eq!(
            classify_source(&policy, &source(string("off"), string("https://ignored"))),
            Ok(())
        );
        assert_eq!(classify_source(&policy, &source(string("automatic"), None)), Ok(()));
        assert_eq!(
            classify_source(&policy, &source(string("AUTOMATIC"), string("   "))),
            Ok(())
        );
    }

    #[test]
    fn secure_and_automatic_custom_provider_are_blocked() {
        let policy = ManagedPolicy::default();
        assert_eq!(
            classify_source(&policy, &source(string("secure"), None)),
            Err(BrowserDnsIssue::Secure)
        );
        assert_eq!(
            classify_source(
                &policy,
                &source(string("automatic"), string("https://resolver.example/dns-query"))
            ),
            Err(BrowserDnsIssue::AutomaticCustomProvider)
        );
        assert_eq!(
            classify_source(&policy, &source(None, string("https://resolver.example/dns-query"))),
            Err(BrowserDnsIssue::AutomaticCustomProvider)
        );
    }

    #[test]
    fn machine_policy_wins_for_each_preference_independently() {
        let effective = merge_policy(
            ManagedPolicy {
                mode: Some("automatic".to_owned()),
                templates: None,
            },
            ManagedPolicy {
                mode: Some("secure".to_owned()),
                templates: Some("https://resolver.example".to_owned()),
            },
        );
        assert_eq!(effective.mode.as_deref(), Some("automatic"));
        assert_eq!(effective.templates.as_deref(), Some("https://resolver.example"));
        assert_eq!(
            classify_source(&effective, &PreferenceSource::default()),
            Err(BrowserDnsIssue::AutomaticCustomProvider)
        );
    }

    #[test]
    fn managed_policy_overrides_an_invalid_local_value() {
        let policy = ManagedPolicy {
            mode: Some("off".to_owned()),
            templates: None,
        };
        assert_eq!(classify_source(&policy, &source(Some(Value::Bool(true)), None)), Ok(()));
        assert_eq!(
            classify_source(&ManagedPolicy::default(), &source(Some(Value::Bool(true)), None)),
            Err(BrowserDnsIssue::IncompleteScan)
        );
    }

    #[test]
    fn bounded_scan_checks_only_browser_wide_local_state() {
        let root = temp_root("local-state");
        let mut total_bytes = 0;
        fs::create_dir_all(root.join("Profile 2")).unwrap();
        fs::write(root.join("Local State"), r#"{"dns_over_https":{"mode":"off"}}"#).unwrap();
        fs::write(
            root.join("Profile 2").join("Preferences"),
            r#"{"dns_over_https":{"mode":"secure","templates":"https://resolver.example"}}"#,
        )
        .unwrap();

        assert_eq!(
            scan_user_data_root(&root, &ManagedPolicy::default(), &mut total_bytes),
            Ok(())
        );

        fs::write(
            root.join("Local State"),
            r#"{"dns_over_https":{"mode":"automatic","templates":"https://resolver.example"}}"#,
        )
        .unwrap();
        assert_eq!(
            scan_user_data_root(&root, &ManagedPolicy::default(), &mut total_bytes),
            Err(BrowserDnsIssue::AutomaticCustomProvider)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_or_oversized_configuration_is_incomplete() {
        let root = temp_root("invalid");
        let mut total_bytes = 0;
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Local State"), b"not json").unwrap();
        assert_eq!(
            scan_user_data_root(&root, &ManagedPolicy::default(), &mut total_bytes),
            Err(BrowserDnsIssue::IncompleteScan)
        );

        fs::write(root.join("Local State"), vec![b' '; MAX_CONFIG_FILE_BYTES as usize + 1]).unwrap();
        assert_eq!(
            scan_user_data_root(&root, &ManagedPolicy::default(), &mut total_bytes),
            Err(BrowserDnsIssue::IncompleteScan)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_root_without_local_state_is_incomplete_unless_managed_off() {
        let root = temp_root("missing-local-state");
        fs::create_dir_all(&root).unwrap();

        assert_eq!(
            scan_user_data_root(&root, &ManagedPolicy::default(), &mut 0),
            Err(BrowserDnsIssue::IncompleteScan)
        );
        assert_eq!(
            scan_user_data_root(
                &root,
                &ManagedPolicy {
                    mode: Some("off".to_owned()),
                    templates: None,
                },
                &mut 0,
            ),
            Ok(())
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_preference_shapes_are_incomplete() {
        let root = temp_root("malformed-shapes");
        fs::create_dir_all(&root).unwrap();
        for body in ["null", "[]", r#"{"dns_over_https":null}"#, r#"{"dns_over_https":true}"#] {
            fs::write(root.join("Local State"), body).unwrap();
            assert_eq!(
                scan_user_data_root(&root, &ManagedPolicy::default(), &mut 0),
                Err(BrowserDnsIssue::IncompleteScan),
                "shape should be rejected: {body}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn incomplete_scan_does_not_prescribe_changing_dns_settings() {
        let text = message("Chrome/Edge", BrowserDnsIssue::IncompleteScan);
        assert!(text.contains("does not mean Secure DNS is enabled"));
        assert!(text.contains("retry connecting"));
        assert!(text.contains("Local State readability"));
        assert!(!text.contains("Set Secure DNS to Off"));
    }

    #[test]
    fn error_message_never_contains_profile_or_template_values() {
        let text = message("Chrome", BrowserDnsIssue::AutomaticCustomProvider);
        assert!(text.contains("all Chrome and Edge profiles"));
        assert!(text.contains("fully restart the browser"));
        assert!(text.contains("ask your administrator"));
        assert!(!text.contains("resolver.example"));
    }
}
