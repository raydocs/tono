//! Cloud traffic policy (WeChat DIRECT) — wire models, validation, revision
//! tracking, and the verified on-disk cache (product-contract.md §3 parity,
//! Mac `ManagedTrafficPolicyProcessor` parity).
//!
//! Trust model: the policy is server-managed but untrusted input. Everything
//! is validated before install — digest, shape, size, domain suffix
//! whitelist (strict label boundaries), public-IP admission, and port
//! allowlists — and a failing download never replaces the last verified
//! copy. Revision monotonicity matches the exit catalog's: strictly newer
//! installs, same-revision same-digest is idempotent, same-revision
//! different-digest is invalid, older is a benign no-op.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read as _, Write as _};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::catalog::{CacheSafetyCheck, catalog_digest};
use crate::node::is_public_ipv4;

/// Maximum accepted policy JSON size (Mac parity: 64 KiB).
pub const MAX_POLICY_JSON_BYTES: usize = 64 * 1024;
/// Maximum accepted on-disk cache size.
pub const MAX_POLICY_CACHE_BYTES: u64 = 256 * 1024;
/// Cache file name inside the Tono data dir.
pub const POLICY_CACHE_FILE_NAME: &str = "managed-traffic-policy.json";
pub const POLICY_VERSION_V1: u32 = 1;
pub const POLICY_VERSION_V2: u32 = 2;
pub const POLICY_VERSION_V3: u32 = 3;
/// Limits shared with the Mac validator.
pub const MAX_POLICY_DOMAINS: usize = 32;
pub const MAX_POLICY_MEDIA: usize = 64;
pub const MAX_POLICY_WEB_DOMAINS: usize = 32;
pub const MAX_POLICY_DIRECT_SUFFIXES: usize = 64;

pub const ALLOWED_WEB_DOMAIN_SUFFIXES: &[&str] = &[
    "bilibili.com",
    "biliapi.net",
    "bilivideo.com",
    "hdslb.com",
    "qq.com",
    "gtimg.cn",
    "gtimg.com",
    "iqiyi.com",
    "qiyi.com",
    "qiyipic.com",
    "iqiyipic.com",
    "youku.com",
    "ykimg.com",
    "xiaohongshu.com",
    "xhslink.com",
    "xhscdn.com",
    "feishu.cn",
    "feishucdn.com",
    "larksuite.com",
    "larkoffice.com",
    "feishu.net",
    "feishuapp.cn",
    "feishuapp.com",
    "feishudoc.cn",
    "feishudoc.com",
    "feishumeetings.cn",
    "feishumeetings.com",
    "feishuimg.com",
    "feishukacdn.com",
    "larkofficecdn.com",
    "larkofficeimg.com",
    "larkcloud.com",
    "larkcloud.net",
    "getfeishu.cn",
    "getfeishu.com",
    "feishupkg.com",
    "feishuvc.cn",
    "feishuvc.com",
    "securityfeishu.cn",
    "securityfs.cn",
    "statusfeishu.cn",
    "dingtalk.cn",
    "dingtalk.com",
    "dingtalk.net",
    "dingtalkapps.com",
    "dingtalkcloud.com",
    "dingding.xin",
    "ztna-dingtalk.com",
    "ddurl.to",
    "baidu.com",
    "baidupcs.com",
    "bcebos.com",
    "baidubcs.com",
    "bdstatic.com",
    "bdimg.com",
    "aliyuncs.com",
    "10jqka.com.cn",
    "iwencai.com",
    "eastmoney.com",
    "dfcfw.com",
    "sina.com.cn",
    "sinajs.cn",
    "legulegu.com",
    "optbbs.com",
    "100ppi.com",
    "awtmt.com",
    "cls.cn",
    "cninfo.com.cn",
    "ccxe.com.cn",
    "pushplus.plus",
    "baostock.com",
    "sse.com.cn",
    "szse.cn",
    "zoom.us",
    "zoom.com",
    "zoomgov.com",
    "oray.com",
    "sunlogin.com",
    "edu.cn",
];

/// Domain suffixes allowed for DIRECT routing (Mac
/// `validatedManagedDirectDomain` parity). A host must equal a suffix or be
/// a subdomain of it — strict DNS label boundaries, so `evil-qq.com` and
/// `qq.com.evil.com` never qualify.
pub const ALLOWED_DOMAIN_SUFFIXES: &[&str] = &[
    "qq.com",
    "qq.com.cn",
    "qpic.cn",
    "qlogo.cn",
    "gtimg.cn",
    "gtimg.com",
    "wechat.com",
    "weixin.com",
    "weixinbridge.com",
    "wxs.qq.com",
    "feishu.cn",
    "feishucdn.com",
    "larksuite.com",
    "larkoffice.com",
    "feishu.net",
    "feishuapp.cn",
    "feishuapp.com",
    "feishudoc.cn",
    "feishudoc.com",
    "feishumeetings.cn",
    "feishumeetings.com",
    "feishuimg.com",
    "feishukacdn.com",
    "larkofficecdn.com",
    "larkofficeimg.com",
    "larkcloud.com",
    "larkcloud.net",
    "getfeishu.cn",
    "getfeishu.com",
    "feishupkg.com",
    "feishuvc.cn",
    "feishuvc.com",
    "securityfeishu.cn",
    "securityfs.cn",
    "statusfeishu.cn",
    // Feishu's official client firewall list also includes these shared
    // ByteDance/Feishu service namespaces. Keep them in the native-app
    // allowlist only; the web suffix list remains narrower by design.
    "zjurl.cn",
    "snssdk.com",
    "pstatp.com",
    "byteimg.com",
    "bytedance.net",
    "bytedance.com",
    "byted-static.com",
    "bytegoofy.com",
    "feishu-3rd-party-services.com",
    "bytehwm.com",
    "ttwebview.com",
    "bytegecko.com",
    "bytescm.com",
    "kundou.cn",
    "bytetos.com",
    "zijieapi.com",
    "byteeffecttos.com",
    "bytednsdoc.com",
    "bytedanceapi.com",
    "volcvideo.com",
    "feelgood.cn",
    "baseopendev.com",
    "bytedapm.com",
    "ibytedapm.com",
    "larkenterprise.com",
    "aiforce.cloud",
    "aiforce.run",
    "dingtalk.cn",
    "dingtalk.com",
    "dingtalk.net",
    "dingtalkapps.com",
    "dingtalkcloud.com",
    "dingding.xin",
    "ztna-dingtalk.com",
    "ddurl.to",
];

/// Addresses that may never receive a DIRECT permit (the pinned DoH
/// resolvers ride the tunnel by contract).
pub fn is_permanently_protected(address: Ipv4Addr) -> bool {
    address == Ipv4Addr::new(1, 1, 1, 1) || address == Ipv4Addr::new(8, 8, 8, 8)
}

/// Claude's first-party, login/challenge, telemetry and update hosts must never
/// be moved to the physical interface, even by an otherwise trusted policy.
/// Keep this in parity with the control-plane and macOS protected lists.
const PROTECTED_DIRECT_SUFFIXES: &[&str] = &[
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "anthropic.ai",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "servd-anthropic-website.b-cdn.net",
    "challenges.cloudflare.com",
    "cf-assets.www.cloudflare.com",
    "cloudflareinsights.com",
    "browser-intake-datadoghq.com",
    "browser-intake-us5-datadoghq.com",
    "browser-intake-us3-datadoghq.com",
    "browser-intake-ap1-datadoghq.com",
    "browser-intake-ap2-datadoghq.com",
    "browser-intake-datadoghq.eu",
    "browser-intake-ddog-gov.com",
    "datadoghq.com",
    "statsig.com",
    "statsigapi.net",
    "featuregates.org",
    "growthbook.io",
    "stripe.network",
    "storage.googleapis.com",
    "registry.npmjs.org",
    "raw.githubusercontent.com",
    "formulae.brew.sh",
    "sentry.io",
    "tono.app",
    "tono.com",
];

fn is_protected_from_direct(host: &str) -> bool {
    PROTECTED_DIRECT_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

fn direct_suffix_overlaps_protected(host: &str) -> bool {
    is_protected_from_direct(host)
        || PROTECTED_DIRECT_SUFFIXES
            .iter()
            .any(|protected| protected.ends_with(&format!(".{host}")))
}

/// Wire shape of `GET traffic-policy` (digest semantics identical to the
/// exit catalog: SHA-256 of the JSON's UTF-8 bytes, base64url, no padding).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TonoTrafficPolicyResponse {
    pub revision: i64,
    pub json: String,
    pub sha256: String,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    /// Detached Ed25519 signature over `tono-traffic-policy-v1\n` + `json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// The validated policy document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TonoTrafficPolicy {
    pub version: u32,
    #[serde(default)]
    pub domains: Vec<PolicyDomain>,
    #[serde(rename = "mediaEndpoints", default)]
    pub media_endpoints: Vec<PolicyMedia>,
    #[serde(rename = "webDomains", default)]
    pub web_domains: Vec<PolicyDomain>,
    #[serde(rename = "directSuffixes", default)]
    pub direct_suffixes: Vec<PolicyDomain>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyDomain {
    pub host: String,
    pub ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyMedia {
    pub address: String,
    pub ports: Vec<u16>,
}

/// Why a policy document (or its cache) was rejected.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PolicyError {
    /// Any contract violation that maps to the API client's
    /// `invalidResponse` (digest, size, shape, version, limits).
    #[error("traffic policy response is invalid")]
    InvalidResponse,
    /// Revision lower than the installed one: benign out-of-order delivery,
    /// never an error and never counted toward retries (catalog L5 parity).
    #[error("traffic policy revision regressed")]
    StaleRevision,
    /// A domain failed the suffix whitelist.
    #[error("managed direct domain rejected: {0}")]
    Domain(String),
    /// An endpoint address failed admission (not public IPv4, or protected).
    #[error("managed endpoint address rejected: {0}")]
    Address(String),
    #[error("policy cache I/O failed: {0}")]
    Io(String),
}

/// Strict label-boundary suffix test (`host == suffix || host` ends with
/// `.suffix`), after light normalization (trim, lowercase, strip one
/// trailing dot).
pub fn is_allowed_direct_domain(host: &str) -> bool {
    let host = host.trim().to_lowercase();
    let host = host.strip_suffix('.').unwrap_or(&host);
    if host.is_empty()
        || host.len() > 253
        || host.bytes().any(|byte| !(0x21..=0x7E).contains(&byte))
    {
        return false;
    }
    ALLOWED_DOMAIN_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Shared direct-route host hygiene: strict DNS label shape plus the
/// protected-suffix rejection. Does not consult any allowlist.
fn is_well_formed_direct_host(host: &str) -> bool {
    if host.is_empty()
        || host.len() > 253
        || host != host.trim()
        || host.ends_with('.')
        || host.split('.').count() < 2
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                || !label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                || !label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
    {
        return false;
    }
    if is_protected_from_direct(host) {
        return false;
    }
    true
}

/// Exact-web hosts use a separate, deliberately narrow suffix allowlist.
pub fn is_allowed_web_domain(host: &str) -> bool {
    if !is_well_formed_direct_host(host) {
        return false;
    }
    host == "ykimg.alicdn.com"
        || ALLOWED_WEB_DOMAIN_SUFFIXES
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Suffix-level direct entries carry the suffix value itself: exact
/// allowlist table membership, never a host under one of the suffixes.
pub fn is_allowed_direct_suffix(suffix: &str) -> bool {
    is_well_formed_direct_host(suffix) && ALLOWED_WEB_DOMAIN_SUFFIXES.contains(&suffix)
}

fn sorted_unique_ports(ports: &[u16], allowed: [u16; 2]) -> Option<Vec<u16>> {
    if ports.is_empty() {
        return None;
    }
    let mut unique: Vec<u16> = ports.to_vec();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != ports.len() || !unique.iter().all(|port| allowed.contains(port)) {
        return None;
    }
    Some(unique)
}

/// Full document validation (Mac `validate` parity): envelope checks, then
/// per-entry admission. Unknown keys and entries this build will not honour
/// are skipped rather than discarding the whole document. `trusted` skips
/// the compiled host allowlist after a verified signature.
pub fn validate_policy(
    response: &TonoTrafficPolicyResponse,
    protected: &BTreeSet<Ipv4Addr>,
) -> Result<TonoTrafficPolicy, PolicyError> {
    validate_policy_with_trust(response, protected, false)
}

pub fn validate_policy_with_trust(
    response: &TonoTrafficPolicyResponse,
    protected: &BTreeSet<Ipv4Addr>,
    trusted: bool,
) -> Result<TonoTrafficPolicy, PolicyError> {
    if response.revision < 0 || response.json.len() > MAX_POLICY_JSON_BYTES {
        return Err(PolicyError::InvalidResponse);
    }
    if response.sha256 != catalog_digest(&response.json) {
        return Err(PolicyError::InvalidResponse);
    }
    let shape: serde_json::Value =
        serde_json::from_str(&response.json).map_err(|_| PolicyError::InvalidResponse)?;
    let object = shape.as_object().ok_or(PolicyError::InvalidResponse)?;
    let version = object
        .get("version")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(PolicyError::InvalidResponse)?;
    if version < POLICY_VERSION_V1 {
        return Err(PolicyError::InvalidResponse);
    }
    let document: TonoTrafficPolicy =
        serde_json::from_str(&response.json).map_err(|_| PolicyError::InvalidResponse)?;
    let policy_domains: Vec<PolicyDomain> = document
        .domains
        .into_iter()
        .take(MAX_POLICY_DOMAINS)
        .collect();
    let policy_media: Vec<PolicyMedia> = document
        .media_endpoints
        .into_iter()
        .take(MAX_POLICY_MEDIA)
        .collect();
    let policy_web: Vec<PolicyDomain> = if version >= POLICY_VERSION_V2 {
        document
            .web_domains
            .into_iter()
            .take(MAX_POLICY_WEB_DOMAINS)
            .collect()
    } else {
        Vec::new()
    };
    let policy_suffixes: Vec<PolicyDomain> = if version >= POLICY_VERSION_V3 {
        document
            .direct_suffixes
            .into_iter()
            .take(MAX_POLICY_DIRECT_SUFFIXES)
            .collect()
    } else {
        Vec::new()
    };

    let mut domains: Vec<PolicyDomain> = Vec::new();
    for entry in policy_domains {
        let normalized = entry.host.trim().to_lowercase();
        let normalized = normalized.strip_suffix('.').unwrap_or(&normalized);
        if normalized != entry.host || !is_well_formed_direct_host(&entry.host) {
            continue;
        }
        if !trusted && !is_allowed_direct_domain(&entry.host) {
            continue;
        }
        let Some(ports) = sorted_unique_ports(&entry.ports, [80, 443]) else {
            continue;
        };
        if domains.iter().any(|domain| domain.host == normalized) {
            continue;
        }
        domains.push(PolicyDomain {
            host: normalized.to_string(),
            ports,
        });
    }
    domains.sort_by(|left, right| left.host.cmp(&right.host));

    let mut web_domains = Vec::new();
    for entry in policy_web {
        if !is_well_formed_direct_host(&entry.host) {
            continue;
        }
        if !trusted && !is_allowed_web_domain(&entry.host) {
            continue;
        }
        if entry.ports != [443] {
            continue;
        }
        if domains.iter().any(|domain| domain.host == entry.host)
            || web_domains.iter().any(|domain: &PolicyDomain| domain.host == entry.host)
        {
            continue;
        }
        web_domains.push(entry);
    }
    web_domains.sort_by(|a, b| a.host.cmp(&b.host));

    let mut direct_suffixes = Vec::new();
    for entry in policy_suffixes {
        if !is_well_formed_direct_host(&entry.host)
            || direct_suffix_overlaps_protected(&entry.host)
        {
            continue;
        }
        if !trusted && !is_allowed_direct_suffix(&entry.host) {
            continue;
        }
        let Some(ports) = sorted_unique_ports(&entry.ports, [80, 443]) else {
            continue;
        };
        if direct_suffixes
            .iter()
            .any(|domain: &PolicyDomain| domain.host == entry.host)
        {
            continue;
        }
        direct_suffixes.push(PolicyDomain {
            host: entry.host,
            ports,
        });
    }
    direct_suffixes.sort_by(|a, b| a.host.cmp(&b.host));

    let mut media: Vec<PolicyMedia> = Vec::new();
    for entry in policy_media {
        let Ok(address) = entry.address.parse::<Ipv4Addr>() else {
            continue;
        };
        if !is_public_ipv4(address)
            || is_permanently_protected(address)
            || protected.contains(&address)
        {
            continue;
        }
        let Some(ports) = sorted_unique_ports(&entry.ports, [443, 8000]) else {
            continue;
        };
        if media.iter().any(|item| item.address == address.to_string()) {
            continue;
        }
        media.push(PolicyMedia {
            address: address.to_string(),
            ports,
        });
    }
    media.sort_by(|left, right| left.address.cmp(&right.address));

    Ok(TonoTrafficPolicy {
        version,
        domains,
        media_endpoints: media,
        web_domains,
        direct_suffixes,
    })
}

/// Result of a [`PolicyTracker::install`] call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyInstallOutcome {
    /// Newer revision: validated policy, ready to swap in.
    Installed(TonoTrafficPolicy),
    /// Same revision and digest: idempotent accept.
    Unchanged,
}

/// Revision monotonicity for the traffic policy (catalog tracker parity).
/// The monotonicity check runs after full validation, inside `install`, so
/// concurrently reordered downloads cannot regress the committed revision.
#[derive(Debug, Clone)]
pub struct PolicyTracker {
    current_revision: i64,
    current_digest: Option<String>,
    current_signature: Option<String>,
}

impl Default for PolicyTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyTracker {
    /// Nothing installed yet: any non-negative revision is newer.
    pub fn new() -> Self {
        Self {
            current_revision: -1,
            current_digest: None,
            current_signature: None,
        }
    }

    /// Seed from a previously verified cache so a download can never roll
    /// back across restarts.
    pub fn from_installed(revision: i64, digest: String) -> Self {
        Self::from_installed_with_signature(revision, digest, None)
    }

    pub fn from_installed_with_signature(
        revision: i64,
        digest: String,
        signature: Option<String>,
    ) -> Self {
        Self {
            current_revision: revision,
            current_digest: Some(digest),
            current_signature: signature,
        }
    }

    pub fn current_revision(&self) -> i64 {
        self.current_revision
    }

    pub fn current_digest(&self) -> Option<&str> {
        self.current_digest.as_deref()
    }

    /// Validate `response` and commit it if its revision is strictly newer.
    /// Equal revision with a different digest is invalid; equal revision
    /// with the same digest is an idempotent no-op; older is benign.
    pub fn install(
        &mut self,
        response: &TonoTrafficPolicyResponse,
        protected: &BTreeSet<Ipv4Addr>,
    ) -> Result<PolicyInstallOutcome, PolicyError> {
        match crate::policy_signature::verdict(&response.json, response.signature.as_deref()) {
            crate::policy_signature::SignatureVerdict::Untrustworthy => {
                return Err(PolicyError::InvalidResponse);
            }
            crate::policy_signature::SignatureVerdict::Unsigned => {}
            crate::policy_signature::SignatureVerdict::Trusted => {}
        }
        let trusted = crate::policy_signature::verdict(
            &response.json,
            response.signature.as_deref(),
        ) == crate::policy_signature::SignatureVerdict::Trusted;
        let policy = validate_policy_with_trust(response, protected, trusted)?;
        if response.revision < self.current_revision {
            return Err(PolicyError::StaleRevision);
        }
        if response.revision == self.current_revision {
            if self.current_digest.as_deref() != Some(response.sha256.as_str()) {
                return Err(PolicyError::InvalidResponse);
            }
            return match crate::policy_signature::same_revision_transition(
                self.current_signature.as_deref(),
                response.signature.as_deref(),
            ) {
                crate::policy_signature::SameRevisionTransition::Unchanged => {
                    Ok(PolicyInstallOutcome::Unchanged)
                }
                crate::policy_signature::SameRevisionTransition::UpgradeToTrusted => {
                    self.current_signature = response.signature.clone();
                    Ok(PolicyInstallOutcome::Installed(policy))
                }
                crate::policy_signature::SameRevisionTransition::DowngradeAttempt
                | crate::policy_signature::SameRevisionTransition::ReplacementAttempt => {
                    Ok(PolicyInstallOutcome::Unchanged)
                }
            };
        }
        self.current_revision = response.revision;
        self.current_digest = Some(response.sha256.clone());
        self.current_signature = response.signature.clone();
        Ok(PolicyInstallOutcome::Installed(policy))
    }
}

/// A cache entry that survived safety checks and full re-validation.
#[derive(Debug, Clone)]
pub struct CachedPolicy {
    pub response: TonoTrafficPolicyResponse,
    pub policy: TonoTrafficPolicy,
}

/// On-disk policy cache (`managed-traffic-policy.json`). Only fully
/// verified documents are ever written; writes are atomic (temp file +
/// rename), and every read re-runs safety checks and re-validation.
pub struct PolicyCache {
    path: PathBuf,
    safety: Box<dyn CacheSafetyCheck>,
}

impl PolicyCache {
    pub fn new(dir: &Path, safety: Box<dyn CacheSafetyCheck>) -> Self {
        Self {
            path: dir.join(POLICY_CACHE_FILE_NAME),
            safety,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Load and re-validate the cached policy. Any safety or validation
    /// failure yields `None` — a corrupt cache is treated as absent.
    pub fn load(&self, protected: &BTreeSet<Ipv4Addr>) -> Option<CachedPolicy> {
        self.safety.check_path(&self.path).ok()?;
        let mut file = fs::File::open(&self.path).ok()?;
        self.safety.check_open(&file).ok()?;
        let mut body = String::new();
        std::io::Read::by_ref(&mut file)
            .take(MAX_POLICY_CACHE_BYTES + 1)
            .read_to_string(&mut body)
            .ok()?;
        let response: TonoTrafficPolicyResponse = serde_json::from_str(&body).ok()?;
        let trusted = crate::policy_signature::verdict(
            &response.json,
            response.signature.as_deref(),
        ) == crate::policy_signature::SignatureVerdict::Trusted;
        if crate::policy_signature::verdict(&response.json, response.signature.as_deref())
            == crate::policy_signature::SignatureVerdict::Untrustworthy
        {
            return None;
        }
        let policy = validate_policy_with_trust(&response, protected, trusted).ok()?;
        Some(CachedPolicy { response, policy })
    }

    /// Atomically persist a policy. Re-validates before writing so the
    /// "only verified copies reach disk" invariant holds by construction.
    pub fn store(
        &self,
        response: &TonoTrafficPolicyResponse,
        protected: &BTreeSet<Ipv4Addr>,
    ) -> Result<(), PolicyError> {
        let trusted = crate::policy_signature::verdict(
            &response.json,
            response.signature.as_deref(),
        ) == crate::policy_signature::SignatureVerdict::Trusted;
        if crate::policy_signature::verdict(&response.json, response.signature.as_deref())
            == crate::policy_signature::SignatureVerdict::Untrustworthy
        {
            return Err(PolicyError::InvalidResponse);
        }
        validate_policy_with_trust(response, protected, trusted)?;
        let body =
            serde_json::to_string(response).map_err(|err| PolicyError::Io(err.to_string()))?;
        if body.len() as u64 > MAX_POLICY_CACHE_BYTES {
            return Err(PolicyError::Io(
                "serialized policy exceeds the cache limit".to_string(),
            ));
        }
        let dir = self
            .path
            .parent()
            .ok_or_else(|| PolicyError::Io("cache path has no parent".to_string()))?;
        fs::create_dir_all(dir).map_err(|err| PolicyError::Io(err.to_string()))?;
        let temp = dir.join(format!(
            ".{POLICY_CACHE_FILE_NAME}.tmp-{}",
            std::process::id()
        ));
        let write_result = (|| -> Result<(), PolicyError> {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temp)
                .map_err(|err| PolicyError::Io(err.to_string()))?;
            file.write_all(body.as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|err| PolicyError::Io(err.to_string()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
                    .map_err(|err| PolicyError::Io(err.to_string()))?;
            }
            // Give the platform policy the chance to tighten the temp file
            // (Windows DACL), symmetric with the read-side checks.
            self.safety
                .secure_written_file(&temp)
                .map_err(|err| PolicyError::Io(err.to_string()))?;
            fs::rename(&temp, &self.path).map_err(|err| PolicyError::Io(err.to_string()))?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        write_result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::catalog_digest;

    fn policy_json(domains: &str, media: &str) -> String {
        format!(r#"{{"version":1,"domains":[{domains}],"mediaEndpoints":[{media}]}}"#)
    }

    fn response(revision: i64, json: &str) -> TonoTrafficPolicyResponse {
        TonoTrafficPolicyResponse {
            revision,
            json: json.to_string(),
            sha256: catalog_digest(json),
            updated_at: None,
            signature: None,
        }
    }

    fn no_protected() -> BTreeSet<Ipv4Addr> {
        BTreeSet::new()
    }

    fn good_document() -> String {
        policy_json(
            r#"{"host":"wxs.qq.com","ports":[80,443]},{"host":"qpic.cn","ports":[443]}"#,
            r#"{"address":"9.0.0.9","ports":[443,8000]}"#,
        )
    }

    #[test]
    fn digest_shape_matches_catalog_algorithm() {
        let digest = catalog_digest("");
        assert_eq!(digest.len(), 43);
        assert!(!digest.contains(['=', '+', '/']));
    }

    #[test]
    fn domain_suffix_boundaries_are_strict() {
        for good in [
            "qq.com",
            "wxs.qq.com",
            "a.qpic.cn",
            "cdn.a.gtimg.com",
            "Qpic.CN.",
            "a.b.wxs.qq.com",
            "open.dingtalk.com",
            "open.feishu.cn",
            "open.larksuite.com",
            "api.snssdk.com",
        ] {
            assert!(is_allowed_direct_domain(good), "{good}");
        }
        for bad in [
            "evil-qq.com",
            "qq.com.evil.com",
            "qq.com.cn.evil.com",
            "notqq.com",
            "qq.co",
            "",
            "qq .com",
            "q q.com",
            "evil-dingtalk.com",
            "dingtalk.com.evil.com",
        ] {
            assert!(!is_allowed_direct_domain(bad), "{bad}");
        }
    }

    #[test]
    fn accepts_reviewed_office_app_domains() {
        let document = policy_json(
            r#"{"host":"open.dingtalk.com","ports":[80,443]},{"host":"open.feishu.cn","ports":[443]},{"host":"api.snssdk.com","ports":[443]}"#,
            "",
        );
        let policy = validate_policy(&response(1, &document), &no_protected()).unwrap();
        assert_eq!(
            policy.domains.iter().map(|entry| entry.host.as_str()).collect::<Vec<_>>(),
            ["api.snssdk.com", "open.dingtalk.com", "open.feishu.cn"]
        );
        assert!(is_allowed_direct_suffix("dingtalk.com"));
        assert!(is_allowed_direct_suffix("feishu.cn"));
        assert!(!is_allowed_direct_suffix("snssdk.com"));
        assert!(!is_allowed_direct_suffix("evil-dingtalk.com"));
    }

    #[test]
    fn document_hosts_must_be_canonical() {
        // The predicate normalizes ("Qpic.CN." is an allowed *domain*), but
        // a document entry must already be canonical (Mac `host == entry.host`).
        assert!(is_allowed_direct_domain("Qpic.CN."));
        for host in ["Qpic.CN", "qpic.cn.", " qpic.cn"] {
            let doc = policy_json(&format!(r#"{{"host":"{host}","ports":[443]}}"#), "");
            let policy = validate_policy(&response(0, &doc), &no_protected()).unwrap();
            assert!(policy.domains.is_empty(), "{host}");
        }
    }

    #[test]
    fn accepts_valid_document_and_normalizes() {
        let policy = validate_policy(&response(3, &good_document()), &no_protected()).unwrap();
        assert_eq!(policy.version, 1);
        // Sorted by host; ports sorted.
        assert_eq!(policy.domains[0].host, "qpic.cn");
        assert_eq!(policy.domains[0].ports, vec![443]);
        assert_eq!(policy.domains[1].host, "wxs.qq.com");
        assert_eq!(policy.domains[1].ports, vec![80, 443]);
        assert_eq!(policy.media_endpoints[0].address, "9.0.0.9");
        assert_eq!(policy.media_endpoints[0].ports, vec![443, 8000]);
        assert!(
            policy.web_domains.is_empty(),
            "old v1 decodes with no web list"
        );
        assert!(
            policy.direct_suffixes.is_empty(),
            "old v1 decodes with no suffix list"
        );
    }

    #[test]
    fn accepts_v2_exact_web_and_rejects_v1_web() {
        let v2 = r#"{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"video.bilibili.com","ports":[443]},{"host":"ykimg.alicdn.com","ports":[443]}]}"#;
        let policy = validate_policy(&response(1, v2), &no_protected()).unwrap();
        assert_eq!(policy.version, 2);
        assert_eq!(policy.web_domains.len(), 2);
        let v1_web = v2.replace("\"version\":2", "\"version\":1");
        let v1_policy = validate_policy(&response(1, &v1_web), &no_protected()).unwrap();
        assert!(
            v1_policy.web_domains.is_empty(),
            "v1 ignores webDomains rather than discarding the document"
        );
    }

    #[test]
    fn accepts_v3_direct_suffixes_and_rejects_bad_ones() {
        let v3 = r#"{"version":3,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"video.bilibili.com","ports":[443]}],"directSuffixes":[{"host":"baidu.com","ports":[443,80]},{"host":"zoom.us","ports":[443]}]}"#;
        let policy = validate_policy(&response(1, v3), &no_protected()).unwrap();
        assert_eq!(policy.version, 3);
        assert_eq!(policy.direct_suffixes.len(), 2);
        // Sorted by host; ports canonicalized.
        assert_eq!(policy.direct_suffixes[0].host, "baidu.com");
        assert_eq!(policy.direct_suffixes[0].ports, vec![80, 443]);
        assert_eq!(policy.direct_suffixes[1].host, "zoom.us");
        // v2 documents must not carry the suffix list.
        let v2_suffix = v3.replace("\"version\":3", "\"version\":2");
        let v2_policy = validate_policy(&response(1, &v2_suffix), &no_protected()).unwrap();
        assert!(v2_policy.direct_suffixes.is_empty());

        // Bad suffix entries are skipped, not fatal.
        for host in [
            "example.com",
            "www.baidu.com",
            "anthropic.com",
            "x.claude.ai",
            "claude.com",
            "cdn.claudeusercontent.com",
            "challenges.cloudflare.com",
            "events.statsig.com",
            "browser-intake-us5.datadoghq.com",
            "sentry.io",
            "Baidu.com",
            "baidu.com.",
        ] {
            let doc = format!(
                r#"{{"version":3,"domains":[],"mediaEndpoints":[],"webDomains":[],"directSuffixes":[{{"host":"{host}","ports":[443]}}]}}"#
            );
            let policy = validate_policy(&response(1, &doc), &no_protected()).unwrap();
            assert!(policy.direct_suffixes.is_empty(), "{host}");
        }
        for ports in ["[]", "[8080]", "[443,443]", "[80,8000]"] {
            let doc = format!(
                r#"{{"version":3,"domains":[],"mediaEndpoints":[],"webDomains":[],"directSuffixes":[{{"host":"baidu.com","ports":{ports}}}]}}"#
            );
            let policy = validate_policy(&response(1, &doc), &no_protected()).unwrap();
            assert!(policy.direct_suffixes.is_empty(), "{ports}");
        }
        let duplicate = r#"{"version":3,"domains":[],"mediaEndpoints":[],"webDomains":[],"directSuffixes":[{"host":"baidu.com","ports":[443]},{"host":"baidu.com","ports":[80]}]}"#;
        let policy = validate_policy(&response(1, duplicate), &no_protected()).unwrap();
        assert_eq!(policy.direct_suffixes.len(), 1);
    }

    #[test]
    fn trusted_policy_cannot_direct_protected_assistant_hosts() {
        let document = r#"{"version":3,"domains":[{"host":"api.claude.com","ports":[443]},{"host":"browser-intake-ap1-datadoghq.com","ports":[443]}],"mediaEndpoints":[],"webDomains":[{"host":"challenges.cloudflare.com","ports":[443]}],"directSuffixes":[{"host":"browser-intake-us5-datadoghq.com","ports":[443]},{"host":"googleapis.com","ports":[443]},{"host":"githubusercontent.com","ports":[443]},{"host":"npmjs.org","ports":[443]},{"host":"brew.sh","ports":[443]},{"host":"b-cdn.net","ports":[443]},{"host":"www.cloudflare.com","ports":[443]}]}"#;
        let policy =
            validate_policy_with_trust(&response(1, document), &no_protected(), true).unwrap();

        assert!(policy.domains.is_empty());
        assert!(policy.web_domains.is_empty());
        assert!(policy.direct_suffixes.is_empty());
    }

    #[test]
    fn trusted_policy_still_rejects_malformed_hosts() {
        let document = r#"{"version":3,"domains":[{"host":"evil_domain.example","ports":[443]}],"mediaEndpoints":[],"webDomains":[{"host":"evil web.example","ports":[443]}],"directSuffixes":[{"host":"evil),DIRECT.example","ports":[443]}]}"#;
        let policy =
            validate_policy_with_trust(&response(1, document), &no_protected(), true).unwrap();

        assert!(policy.domains.is_empty());
        assert!(policy.web_domains.is_empty());
        assert!(policy.direct_suffixes.is_empty());
    }

    #[test]
    fn trusted_policy_still_requires_https_for_web_direct() {
        let document = r#"{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"example.com","ports":[80]}]}"#;
        let policy =
            validate_policy_with_trust(&response(1, document), &no_protected(), true).unwrap();

        assert!(policy.web_domains.is_empty());
    }

    #[test]
    fn web_boundaries_fail_closed() {
        for host in [
            "Claude.ai",
            "claude.ai",
            "x.claude.ai",
            "anthropic.com",
            "claude.com",
            "cdn.claudeusercontent.com",
            "challenges.cloudflare.com",
            "events.statsig.com",
            "browser-intake-us5.datadoghq.com",
            "sentry.io",
            "tono.app",
            "evilbilibili.com",
        ] {
            let doc = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"{host}","ports":[443]}}]}}"#
            );
            let policy = validate_policy(&response(1, &doc), &no_protected()).unwrap();
            assert!(policy.web_domains.is_empty(), "{host}");
        }
        for ports in ["[]", "[80]", "[443,443]"] {
            let doc = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"bilibili.com","ports":{ports}}}]}}"#
            );
            let policy = validate_policy(&response(1, &doc), &no_protected()).unwrap();
            assert!(policy.web_domains.is_empty());
        }
        let duplicate = r#"{"version":2,"domains":[{"host":"qq.com","ports":[443]}],"mediaEndpoints":[],"webDomains":[{"host":"qq.com","ports":[443]}]}"#;
        let policy = validate_policy(&response(1, duplicate), &no_protected()).unwrap();
        assert_eq!(policy.domains.len(), 1);
        assert!(policy.web_domains.is_empty());
    }

    #[test]
    fn rejects_domain_port_violations() {
        for ports in ["[80,80]", "[8080]", "[]", "[443,8000]"] {
            let doc = policy_json(&format!(r#"{{"host":"qq.com","ports":{ports}}}"#), "");
            let policy = validate_policy(&response(0, &doc), &no_protected()).unwrap();
            assert!(policy.domains.is_empty(), "{ports}");
        }
    }

    #[test]
    fn rejects_media_port_and_duplicate_violations() {
        for ports in ["[443,443]", "[80]", "[]"] {
            let doc = policy_json("", &format!(r#"{{"address":"9.0.0.9","ports":{ports}}}"#));
            let policy = validate_policy(&response(0, &doc), &no_protected()).unwrap();
            assert!(policy.media_endpoints.is_empty(), "{ports}");
        }
        let dup_domain = policy_json(
            r#"{"host":"qq.com","ports":[80]},{"host":"QQ.com","ports":[80]}"#,
            "",
        );
        let policy = validate_policy(&response(0, &dup_domain), &no_protected()).unwrap();
        assert_eq!(policy.domains.len(), 1);
    }

    #[test]
    fn rejects_disallowed_and_protected_addresses() {
        for address in ["10.0.0.1", "198.18.0.1", "1.1.1.1", "8.8.8.8", "not-an-ip"] {
            let doc = policy_json("", &format!(r#"{{"address":"{address}","ports":[443]}}"#));
            let policy = validate_policy(&response(0, &doc), &no_protected()).unwrap();
            assert!(policy.media_endpoints.is_empty(), "{address}");
        }
        // The selected node's IP is protected at sync time.
        let mut protected = BTreeSet::new();
        protected.insert(Ipv4Addr::new(9, 0, 0, 7));
        let doc = policy_json("", r#"{"address":"9.0.0.7","ports":[443]}"#);
        let policy = validate_policy(&response(0, &doc), &protected).unwrap();
        assert!(policy.media_endpoints.is_empty());
    }

    #[test]
    fn rejects_envelope_violations() {
        // Negative revision.
        assert_eq!(
            validate_policy(&response(-1, &good_document()), &no_protected()),
            Err(PolicyError::InvalidResponse)
        );
        // Tampered digest.
        let mut tampered = response(1, &good_document());
        tampered.sha256 = catalog_digest("forged");
        assert_eq!(
            validate_policy(&tampered, &no_protected()),
            Err(PolicyError::InvalidResponse)
        );
        // A newer declared version is read as the newest shape this build knows.
        let newer_version = policy_json("", "").replace(r#""version":1"#, r#""version":4"#);
        assert!(validate_policy(&response(1, &newer_version), &no_protected()).is_ok());
        // Oversize JSON.
        let big = format!("{}//{}", good_document(), "x".repeat(MAX_POLICY_JSON_BYTES));
        assert_eq!(
            validate_policy(&response(1, &big), &no_protected()),
            Err(PolicyError::InvalidResponse)
        );
    }

    #[test]
    fn tracker_enforces_revision_monotonicity() {
        let mut tracker = PolicyTracker::new();
        let outcome = tracker
            .install(&response(5, &good_document()), &no_protected())
            .unwrap();
        assert!(matches!(outcome, PolicyInstallOutcome::Installed(_)));
        assert_eq!(tracker.current_revision(), 5);
        // Same revision + digest: idempotent.
        assert_eq!(
            tracker
                .install(&response(5, &good_document()), &no_protected())
                .unwrap(),
            PolicyInstallOutcome::Unchanged
        );
        // Older: benign stale.
        assert_eq!(
            tracker.install(&response(4, &good_document()), &no_protected()),
            Err(PolicyError::StaleRevision)
        );
        // Same revision, different digest: invalid.
        let conflicting = response(5, &policy_json(r#"{"host":"qpic.cn","ports":[443]}"#, ""));
        assert_eq!(
            tracker.install(&conflicting, &no_protected()),
            Err(PolicyError::InvalidResponse)
        );
        assert_eq!(tracker.current_revision(), 5);
        // Newer installs.
        let newer = policy_json(
            r#"{"host":"qq.com","ports":[80,443]},{"host":"qpic.cn","ports":[443]}"#,
            "",
        );
        assert!(matches!(
            tracker
                .install(&response(6, &newer), &no_protected())
                .unwrap(),
            PolicyInstallOutcome::Installed(_)
        ));
        assert_eq!(tracker.current_revision(), 6);
        // Seeded tracker keeps monotonicity across restarts.
        let mut seeded = PolicyTracker::from_installed(6, response(6, &newer).sha256);
        assert_eq!(
            seeded.install(&response(5, &good_document()), &no_protected()),
            Err(PolicyError::StaleRevision)
        );
    }
}
