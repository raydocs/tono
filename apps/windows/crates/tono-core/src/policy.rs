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
/// v3 added `directSuffixes`, v4 added `tcpEndpoints`. Both are accepted and
/// neither is acted on here: this client does not implement suffix routing, and
/// ignoring a field it cannot use is the difference between routing less than the
/// policy asks for and routing nothing at all.
///
/// Rejecting them was not a conservative default. Validation compares the key set
/// for exact equality, so an unknown version — or a known version carrying one
/// extra key — discards the whole document. The published policy has been v3 with
/// `directSuffixes` since 2026-08-10, which means every fetch since then was
/// thrown away and this client has been running with no traffic policy at all.
pub const POLICY_VERSION_V3: u32 = 3;
pub const POLICY_VERSION_V4: u32 = 4;
/// Limits shared with the Mac validator.
pub const MAX_POLICY_DOMAINS: usize = 32;
pub const MAX_POLICY_MEDIA: usize = 64;
// 32, matching what the control plane accepts and what the macOS client accepts.
// At 16 this rejected the entire published policy — validation is whole-document —
// and the published policy has held 26 web domains for some time, so this client
// has been discarding every policy it fetched rather than routing anything by it.
// A limit below the server's own maximum is not a safety margin; it is a
// guaranteed rejection waiting for the list to grow.
pub const MAX_POLICY_WEB_DOMAINS: usize = 32;

// Exactly the registrable domains the control plane already publishes. The list
// exists so a compromised control plane cannot route an arbitrary domain
// direct, so it is extended to match what is published rather than widened.
// Short of that it rejected the whole document — validation compares the key
// set and every host — and the published policy has carried Xiaohongshu, Feishu
// and Youku's CDN for some time.
pub const ALLOWED_WEB_DOMAIN_SUFFIXES: [&str; 19] = [
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
    "alicdn.com",
    "feishu.cn",
    "larkoffice.com",
    "larksuite.com",
    "xhslink.com",
    "xiaohongshu.com",
];

/// Domain suffixes allowed for DIRECT routing (Mac
/// `validatedManagedDirectDomain` parity). A host must equal a suffix or be
/// a subdomain of it — strict DNS label boundaries, so `evil-qq.com` and
/// `qq.com.evil.com` never qualify.
pub const ALLOWED_DOMAIN_SUFFIXES: [&str; 10] = [
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
];

/// Addresses that may never receive a DIRECT permit (the pinned DoH
/// resolvers ride the tunnel by contract).
/// Public half of the offline policy signing key, standard base64, 32 bytes.
/// Mirrors TRAFFIC_POLICY_PUBLIC_KEY in services/control-plane/wrangler.jsonc and
/// `ManagedTrafficPolicySignature.publicKeyBase64` on macOS.
pub const TRAFFIC_POLICY_PUBLIC_KEY: &str = "Sf2burVHXZWzYikU0FlC+N64BeRZJxJe8XaneblmTkM=";

/// Prefixed to the signed bytes. Domain separation, so a signature this key made
/// over some other document cannot be presented as a policy signature. Every
/// implementation must prefix identically or nothing verifies; the definition
/// lives in services/control-plane/src/crypto.ts.
pub const TRAFFIC_POLICY_SIGNATURE_CONTEXT: &str = "tono-traffic-policy-v1\n";

/// Hosts that must never be routed direct, whatever a policy says and whoever
/// signed it. A signature relaxes which hosts *may* leave the tunnel; it must
/// never relax which hosts may not, or one leaked key would expose this product's
/// own control plane and its users' assistant traffic — strictly worse than the
/// allowlist a signature replaces.
const PROTECTED_FROM_DIRECT: [&str; 4] = ["anthropic.com", "claude.ai", "tono.app", "tono.com"];

/// Whether a policy document was authored by the holder of the signing key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureVerdict {
    /// No signature. Validate against the compiled-in allowlist, which is what
    /// every build did before signing existed, so unsigned policies keep working.
    Unsigned,
    /// Signed by the expected key over exactly these bytes. The allowlist may be
    /// bypassed; the protected list may not.
    Trusted,
    /// A signature is present and does not verify. Deliberately not the same as
    /// `Unsigned`: somebody attached a signature, so authorship is in question and
    /// the caller refuses the whole document. Falling back to the allowlist here
    /// would let anyone strip trust by corrupting one field.
    Untrustworthy,
}

/// Classify a policy document's signature. Every way a signature can be wrong —
/// malformed key, malformed signature, wrong length, right shape over other bytes
/// — is `Untrustworthy`; the distinction is not the caller's to act on.
pub fn policy_signature_verdict(json: &str, signature: Option<&str>) -> SignatureVerdict {
    policy_signature_verdict_with_key(json, signature, TRAFFIC_POLICY_PUBLIC_KEY)
}

/// As [`policy_signature_verdict`], against a caller-supplied key. Exists so the
/// verification logic can be tested against a throwaway keypair; the app always
/// uses the compiled-in key.
pub fn policy_signature_verdict_with_key(
    json: &str,
    signature: Option<&str>,
    public_key: &str,
) -> SignatureVerdict {
    use base64::Engine as _;
    let Some(signature) = signature.filter(|value| !value.is_empty()) else {
        return SignatureVerdict::Unsigned;
    };
    let engine = base64::engine::general_purpose::STANDARD;
    let Ok(key_bytes) = engine.decode(public_key) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(key_bytes) = <[u8; 32]>::try_from(key_bytes.as_slice()) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(&key_bytes) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(signature_bytes) = engine.decode(signature) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(signature_bytes) = <[u8; 64]>::try_from(signature_bytes.as_slice()) else {
        return SignatureVerdict::Untrustworthy;
    };
    let message = format!("{TRAFFIC_POLICY_SIGNATURE_CONTEXT}{json}");
    match key.verify_strict(message.as_bytes(), &ed25519_dalek::Signature::from_bytes(&signature_bytes)) {
        Ok(()) => SignatureVerdict::Trusted,
        Err(_) => SignatureVerdict::Untrustworthy,
    }
}

/// Strict hostname syntax, independent of any allowlist.
///
/// Extracted because list membership *was* the syntax guarantee: every accepted
/// host had to appear on a list of well-formed names. A trusted path bypasses the
/// list, so without this it would bypass syntax checking too and hand the runtime
/// a host it cannot parse.
pub fn is_valid_direct_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host == host.trim()
        && !host.ends_with('.')
        && host.split('.').count() >= 2
        && !host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                || !label.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
                || !label.as_bytes().last().is_some_and(u8::is_ascii_alphanumeric)
        })
}

/// Whether a host may never route direct. Enforced on every path, trusted or not.
pub fn is_protected_from_direct(host: &str) -> bool {
    PROTECTED_FROM_DIRECT
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

pub fn is_permanently_protected(address: Ipv4Addr) -> bool {
    address == Ipv4Addr::new(1, 1, 1, 1) || address == Ipv4Addr::new(8, 8, 8, 8)
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
    /// Ed25519 signature over `"tono-traffic-policy-v1\n" + json`, standard
    /// base64, made offline by the holder of the signing key. Absent for every
    /// policy published before signing existed, and those must keep working.
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

/// The exact-domain gate under a verified signature.
///
/// Stricter than `is_allowed_direct_domain`, not looser: that function checks only
/// a character range, because membership of `ALLOWED_DOMAIN_SUFFIXES` supplied the
/// rest. With the list bypassed the full label check has to be applied here, or a
/// signed policy could carry a name the runtime cannot parse.
pub fn is_signed_direct_domain(host: &str) -> bool {
    is_valid_direct_host(host) && !is_protected_from_direct(host)
}

/// Exact-web hosts use a separate, deliberately narrow suffix allowlist.
pub fn is_allowed_web_domain(host: &str) -> bool {
    if !is_valid_direct_host(host) || is_protected_from_direct(host) {
        return false;
    }
    host == "ykimg.alicdn.com"
        || ALLOWED_WEB_DOMAIN_SUFFIXES
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// The web-host gate under a verified signature: syntax and the protected list
/// still apply, the allowlist does not. This is what makes adding a domain a
/// change to the control plane alone.
pub fn is_signed_web_domain(host: &str) -> bool {
    is_valid_direct_host(host) && !is_protected_from_direct(host)
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
/// per-entry admission. `protected` carries the currently protected
/// addresses (the selected node's IP at sync time); media endpoints must
/// also avoid the permanently protected resolvers.
/// What was accepted and what was not.
///
/// Degrading instead of refusing only helps if the degradation is visible.
/// Replacing "silently discarded everything" with "silently discarded some" would
/// be the same fault with a smaller blast radius, so every entry that does not
/// survive is named here and the caller is expected to record it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PolicyAcceptance {
    /// Hosts and addresses this build refused to route. A newer policy naming
    /// something not in the compiled allowlist lands here.
    pub dropped: Vec<String>,
    /// Entries removed as duplicates of one already accepted.
    pub duplicates: usize,
    /// True when the published list was longer than this build's limit and the
    /// remainder was cut. Means the limit is stale, not that the policy is wrong.
    pub truncated: bool,
    /// Set when the document declared a version this build does not know, which it
    /// then read as the newest version it does.
    pub newer_version: Option<u32>,
    /// Whether a verified signature admitted hosts the compiled-in allowlist does
    /// not contain. Without this, a signed policy whose new hosts were dropped
    /// anyway is indistinguishable from an unsigned one.
    pub trusted: bool,
}

pub fn validate_policy(
    response: &TonoTrafficPolicyResponse,
    protected: &BTreeSet<Ipv4Addr>,
) -> Result<TonoTrafficPolicy, PolicyError> {
    validate_policy_reporting(response, protected).map(|(policy, _)| policy)
}

/// As `validate_policy`, and also reports what did not survive.
pub fn validate_policy_reporting(
    response: &TonoTrafficPolicyResponse,
    protected: &BTreeSet<Ipv4Addr>,
) -> Result<(TonoTrafficPolicy, PolicyAcceptance), PolicyError> {
    validate_policy_reporting_with_key(response, protected, TRAFFIC_POLICY_PUBLIC_KEY)
}

/// As [`validate_policy_reporting`], against a caller-supplied signing key. Exists
/// so the trusted path can be tested against a real signature; the app always uses
/// the compiled-in key, and a caller able to choose the key could equally skip the
/// check, so this weakens nothing.
pub fn validate_policy_reporting_with_key(
    response: &TonoTrafficPolicyResponse,
    protected: &BTreeSet<Ipv4Addr>,
    public_key: &str,
) -> Result<(TonoTrafficPolicy, PolicyAcceptance), PolicyError> {
    let mut dropped: Vec<String> = Vec::new();
    if response.revision < 0 || response.json.len() > MAX_POLICY_JSON_BYTES {
        return Err(PolicyError::InvalidResponse);
    }
    if response.sha256 != catalog_digest(&response.json) {
        return Err(PolicyError::InvalidResponse);
    }
    // Refused whole, unlike an entry this build does not understand. A dropped
    // entry comes from a document whose author is known and whose contents are
    // partly unsupported; a signature that does not verify means the author is not
    // known at all, and honouring any of it would make the signature decorative.
    let verdict = policy_signature_verdict_with_key(
        &response.json,
        response.signature.as_deref(),
        public_key,
    );
    if verdict == SignatureVerdict::Untrustworthy {
        return Err(PolicyError::InvalidResponse);
    }
    let trusted = verdict == SignatureVerdict::Trusted;
    let shape: serde_json::Value =
        serde_json::from_str(&response.json).map_err(|_| PolicyError::InvalidResponse)?;
    let object = shape.as_object().ok_or(PolicyError::InvalidResponse)?;
    let version = object
        .get("version")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(PolicyError::InvalidResponse)?;
    // Forward compatible on purpose. A version this build has not heard of used to
    // discard the whole document, so every policy revision needed a client release
    // and a missed release looked exactly like an empty policy. Unknown versions
    // are treated as the newest known one, and unknown keys are ignored rather
    // than fatal — an additive revision reaches every client without a release.
    if version < POLICY_VERSION_V1 {
        return Err(PolicyError::InvalidResponse);
    }
    let required: BTreeSet<&str> = if version == POLICY_VERSION_V1 {
        ["version", "domains", "mediaEndpoints"].into_iter().collect()
    } else if version == POLICY_VERSION_V2 {
        ["version", "domains", "mediaEndpoints", "webDomains"]
            .into_iter()
            .collect()
    } else if version == POLICY_VERSION_V3 {
        ["version", "domains", "mediaEndpoints", "webDomains", "directSuffixes"]
            .into_iter()
            .collect()
    } else {
        // v4 and anything newer: the v4 shape is what this build understands, and
        // whatever a newer revision adds is carried without being acted on.
        [
            "version",
            "domains",
            "mediaEndpoints",
            "webDomains",
            "directSuffixes",
            "tcpEndpoints",
        ]
        .into_iter()
        .collect()
    };
    let present: BTreeSet<&str> = object.keys().map(String::as_str).collect();
    // Missing a field this version promises is a malformed document. Carrying an
    // extra one is a newer server, which is not this client's problem to refuse.
    if !required.is_subset(&present) {
        return Err(PolicyError::InvalidResponse);
    }
    let document: TonoTrafficPolicy =
        serde_json::from_str(&response.json).map_err(|_| PolicyError::InvalidResponse)?;
    // Truncated rather than refused. A published list longer than this build's
    // limit means the limit is stale, and answering that by routing nothing is a
    // worse outcome than routing the part that fits.
    let over_capacity = document.domains.len() > MAX_POLICY_DOMAINS
        || document.media_endpoints.len() > MAX_POLICY_MEDIA
        || document.web_domains.len() > MAX_POLICY_WEB_DOMAINS;

    let mut domains: Vec<PolicyDomain> = Vec::with_capacity(document.domains.len());
    for entry in &document.domains {
        // Mac parity: the entry must already be in canonical form
        // (lowercase, no trailing dot) — normalization is not repair.
        let normalized = entry.host.trim().to_lowercase();
        let normalized = normalized.strip_suffix('.').unwrap_or(&normalized);
        if normalized != entry.host {
            dropped.push(entry.host.clone());
            continue;
        }
        let admitted = if trusted {
            is_signed_direct_domain(normalized)
        } else {
            is_allowed_direct_domain(&entry.host)
        };
        if !admitted {
            dropped.push(entry.host.clone());
            continue;
        }
        let Some(ports) = sorted_unique_ports(&entry.ports, [80, 443]) else {
            dropped.push(entry.host.clone());
            continue;
        };
        domains.push(PolicyDomain {
            host: normalized.to_string(),
            ports,
        });
    }
    domains.sort_by(|left, right| left.host.cmp(&right.host));
    let before = domains.len();
    domains.dedup_by(|left, right| left.host == right.host);
    let duplicate_domains = before - domains.len();
    domains.truncate(MAX_POLICY_DOMAINS);

    // A version that does not declare web domains does not get them, even if the
    // document carries the field. Ignoring what a version does not promise keeps
    // the old invariant — v1 never routes web hosts — without discarding a
    // document over it.
    let declared_web: &[PolicyDomain] = if version >= POLICY_VERSION_V2 {
        &document.web_domains
    } else {
        &[]
    };
    let mut web_domains = Vec::with_capacity(declared_web.len());
    for entry in declared_web {
        let admitted = if trusted {
            is_signed_web_domain(&entry.host)
        } else {
            is_allowed_web_domain(&entry.host)
        };
        if !admitted
            || entry.ports != [443]
            || domains.iter().any(|domain| domain.host == entry.host)
        {
            dropped.push(entry.host.clone());
            continue;
        }
        web_domains.push(entry.clone());
    }
    web_domains.sort_by(|a, b| a.host.cmp(&b.host));
    let before = web_domains.len();
    web_domains.dedup_by(|a, b| a.host == b.host);
    let duplicate_web = before - web_domains.len();
    web_domains.truncate(MAX_POLICY_WEB_DOMAINS);

    let mut media: Vec<PolicyMedia> = Vec::with_capacity(document.media_endpoints.len());
    for entry in &document.media_endpoints {
        let Ok(address) = entry.address.parse::<Ipv4Addr>() else {
            dropped.push(entry.address.clone());
            continue;
        };
        if !is_public_ipv4(address)
            || is_permanently_protected(address)
            || protected.contains(&address)
        {
            dropped.push(entry.address.clone());
            continue;
        }
        let Some(ports) = sorted_unique_ports(&entry.ports, [443, 8000]) else {
            dropped.push(entry.address.clone());
            continue;
        };
        media.push(PolicyMedia {
            address: address.to_string(),
            ports,
        });
    }
    media.sort_by(|left, right| left.address.cmp(&right.address));
    let before = media.len();
    media.dedup_by(|left, right| left.address == right.address);
    let duplicate_media = before - media.len();
    media.truncate(MAX_POLICY_MEDIA);

    dropped.sort();
    dropped.dedup();
    Ok((
        TonoTrafficPolicy {
            version,
            domains,
            media_endpoints: media,
            web_domains,
        },
        PolicyAcceptance {
            dropped,
            duplicates: duplicate_domains + duplicate_web + duplicate_media,
            truncated: over_capacity,
            newer_version: (version > POLICY_VERSION_V4).then_some(version),
            trusted,
        },
    ))
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
        }
    }

    /// Seed from a previously verified cache so a download can never roll
    /// back across restarts.
    pub fn from_installed(revision: i64, digest: String) -> Self {
        Self {
            current_revision: revision,
            current_digest: Some(digest),
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
        let policy = validate_policy(response, protected)?;
        if response.revision < self.current_revision {
            return Err(PolicyError::StaleRevision);
        }
        if response.revision == self.current_revision {
            return if self.current_digest.as_deref() == Some(response.sha256.as_str()) {
                Ok(PolicyInstallOutcome::Unchanged)
            } else {
                Err(PolicyError::InvalidResponse)
            };
        }
        self.current_revision = response.revision;
        self.current_digest = Some(response.sha256.clone());
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
        let policy = validate_policy(&response, protected).ok()?;
        Some(CachedPolicy { response, policy })
    }

    /// Atomically persist a policy. Re-validates before writing so the
    /// "only verified copies reach disk" invariant holds by construction.
    pub fn store(
        &self,
        response: &TonoTrafficPolicyResponse,
        protected: &BTreeSet<Ipv4Addr>,
    ) -> Result<(), PolicyError> {
        validate_policy(response, protected)?;
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

    /// The same document with a signature attached, valid under `key`.
    fn signed_response(
        revision: i64,
        json: &str,
        key: &ed25519_dalek::SigningKey,
    ) -> TonoTrafficPolicyResponse {
        use base64::Engine as _;
        use ed25519_dalek::Signer as _;
        let message = format!("{TRAFFIC_POLICY_SIGNATURE_CONTEXT}{json}");
        let signature = key.sign(message.as_bytes());
        TonoTrafficPolicyResponse {
            signature: Some(
                base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            ),
            ..response(revision, json)
        }
    }

    fn test_signing_key() -> ed25519_dalek::SigningKey {
        // Fixed bytes: a test that generates a key needs an rng feature this crate
        // does not enable, and a constant is reproducible.
        ed25519_dalek::SigningKey::from_bytes(&[7u8; 32])
    }

    fn test_public_key(key: &ed25519_dalek::SigningKey) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(key.verifying_key().to_bytes())
    }

    /// A host on no allowlist becomes routable once the document is signed. This
    /// is the whole point: adding a domain stops requiring a client release, which
    /// is what this client's version gate cost for days.
    #[test]
    fn a_signed_policy_carries_a_host_no_allowlist_contains() {
        let key = test_signing_key();
        let json = r#"{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"www.dianping.com","ports":[443]}]}"#;
        assert!(
            !is_allowed_web_domain("www.dianping.com"),
            "the host must be off the allowlist or this proves nothing",
        );

        let unsigned = validate_policy_reporting(&response(1, json), &no_protected())
            .expect("an unknown host must be dropped, not fatal");
        assert!(unsigned.0.web_domains.is_empty());
        assert!(!unsigned.1.trusted);
        assert_eq!(unsigned.1.dropped, vec!["www.dianping.com".to_string()]);

        let (policy, report) = validate_policy_reporting_with_key(
            &signed_response(1, json, &key),
            &no_protected(),
            &test_public_key(&key),
        )
        .expect("a signed policy must be accepted");
        assert!(report.trusted);
        assert!(report.dropped.is_empty(), "{:?}", report.dropped);
        assert_eq!(policy.web_domains.len(), 1);
        assert_eq!(policy.web_domains[0].host, "www.dianping.com");
    }

    /// A signature that does not verify refuses the document outright rather than
    /// degrading to the allowlist. Degrading would let anyone strip trust by
    /// corrupting one field, and the allowlist would silently decide instead.
    #[test]
    fn a_signature_that_does_not_verify_refuses_the_whole_document() {
        use base64::Engine as _;
        use ed25519_dalek::Signer as _;
        let key = test_signing_key();
        let public = test_public_key(&key);
        // Hosts the allowlist *does* accept, so a fallback would visibly succeed.
        let json = r#"{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"www.bilibili.com","ports":[443]}]}"#;
        let engine = base64::engine::general_purpose::STANDARD;
        let sign = |message: &str| engine.encode(key.sign(message.as_bytes()).to_bytes());

        let bad = [
            ("no context prefix", sign(json)),
            ("different document", sign(&format!("{TRAFFIC_POLICY_SIGNATURE_CONTEXT}{json} "))),
            (
                "another key",
                engine.encode(
                    ed25519_dalek::SigningKey::from_bytes(&[9u8; 32])
                        .sign(format!("{TRAFFIC_POLICY_SIGNATURE_CONTEXT}{json}").as_bytes())
                        .to_bytes(),
                ),
            ),
            ("not base64", "not-a-signature".to_string()),
            ("wrong length", engine.encode([0u8; 32])),
        ];
        for (reason, signature) in bad {
            let mut document = response(1, json);
            document.signature = Some(signature);
            assert_eq!(
                validate_policy_reporting_with_key(&document, &no_protected(), &public),
                Err(PolicyError::InvalidResponse),
                "a signature with {reason} was accepted or silently downgraded",
            );
        }

        // And the same document with no signature at all is still fine, so the
        // refusal above is about the signature and not about the document.
        assert!(validate_policy_reporting(&response(1, json), &no_protected()).is_ok());
    }

    /// The invariant that must survive a leaked key. If this ever fails, one stolen
    /// key pulls this product's own control plane and its users' assistant traffic
    /// out of the tunnel — strictly worse than the allowlist trust replaces.
    #[test]
    fn no_signature_pulls_a_protected_host_out_of_the_tunnel() {
        let key = test_signing_key();
        let public = test_public_key(&key);
        for host in [
            "api.anthropic.com", "anthropic.com", "claude.ai", "www.claude.ai",
            "tono.app", "api.tono.app", "tono.com", "www.tono.com",
        ] {
            assert!(!is_signed_web_domain(host), "web gate admitted {host}");
            assert!(!is_signed_direct_domain(host), "exact gate admitted {host}");
            let json = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"{host}","ports":[443]}}]}}"#
            );
            let (policy, report) = validate_policy_reporting_with_key(
                &signed_response(1, &json, &key),
                &no_protected(),
                &public,
            )
            .expect("the document is well formed; only the entry must be refused");
            assert!(report.trusted);
            assert!(policy.web_domains.is_empty(), "a signed policy routed {host}");
            assert_eq!(report.dropped, vec![host.to_string()]);
        }
    }

    /// Syntax is still enforced under a signature. Before trust existed, list
    /// membership *was* the syntax guarantee — bypassing the list without this
    /// would hand the runtime hosts it cannot parse.
    #[test]
    fn a_signature_does_not_excuse_a_malformed_host() {
        let key = test_signing_key();
        let public = test_public_key(&key);
        for host in [
            "*.dianping.com", "dianping", "-dianping.com", "dianping-.com",
            "a..b.com", "dianping.com.", "DIANPING.com", " dianping.com",
        ] {
            assert!(!is_signed_web_domain(host), "web gate admitted {host}");
            let json = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"{host}","ports":[443]}}]}}"#
            );
            let (policy, report) = validate_policy_reporting_with_key(
                &signed_response(1, &json, &key),
                &no_protected(),
                &public,
            )
            .expect("a malformed entry is dropped, not fatal");
            assert!(policy.web_domains.is_empty(), "a signed policy routed {host}");
            assert_eq!(report.dropped, vec![host.to_string()]);
        }
    }

    /// The compiled-in key must be a usable Ed25519 key, and the signed byte layout
    /// must match what the control plane produces. A typo in either makes every
    /// signed policy untrustworthy, and because that path refuses the document,
    /// managed direct routing stops fleet-wide the moment one is published.
    #[test]
    fn the_compiled_in_signing_contract_matches_the_control_plane() {
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(TRAFFIC_POLICY_PUBLIC_KEY)
            .expect("the compiled-in public key must be standard base64");
        let bytes = <[u8; 32]>::try_from(bytes.as_slice())
            .expect("an Ed25519 public key is 32 bytes");
        ed25519_dalek::VerifyingKey::from_bytes(&bytes)
            .expect("the compiled-in public key must be a valid Ed25519 point");
        assert_eq!(TRAFFIC_POLICY_SIGNATURE_CONTEXT, "tono-traffic-policy-v1\n");
        assert_eq!(
            policy_signature_verdict("{}", None),
            SignatureVerdict::Unsigned,
            "an absent signature must read as unsigned, not as a failure",
        );
    }

    /// The published policy, at the size it actually is. Validation is
    /// whole-document, so a client limit below the server's own maximum does not
    /// degrade — it discards everything. This client sat at 16 while the
    /// published list held 26, which means every policy it fetched was thrown
    /// away and nothing was ever routed by one.
    #[test]
    fn accepts_a_policy_at_the_size_the_control_plane_publishes() {
        let web: Vec<String> = (0..26)
            .map(|index| format!(r#"{{"host":"host{index}.bilibili.com","ports":[443]}}"#))
            .collect();
        // The live shape: v3 carries `directSuffixes`, and the key set is compared
        // for exact equality, so omitting it here would test a document the
        // control plane does not publish.
        let json = format!(
            r#"{{"version":3,"domains":[{{"host":"wxs.qq.com","ports":[443]}}],"mediaEndpoints":[],"webDomains":[{}],"directSuffixes":[{{"host":"edu.cn","ports":[80,443]}}]}}"#,
            web.join(","),
        );
        let parsed = validate_policy(&response(7, &json), &no_protected())
            .expect("a policy the control plane would publish must be usable");
        assert_eq!(parsed.web_domains.len(), 26);
    }

    /// The document the control plane is serving right now, verbatim. Every other
    /// test here builds a policy that this file believes is valid; this one asks
    /// whether the published one is, which is the question that mattered and the
    /// one nothing was asking.
    #[test]
    fn accepts_the_document_the_control_plane_is_serving() {
        let json = r##"{"version":3,"domains":[{"host":"mmbiz.qpic.cn","ports":[443]},{"host":"mmhead.c2c.wechat.com","ports":[443]},{"host":"mmhead.hk.wechat.com","ports":[443]},{"host":"mp.weixin.qq.com","ports":[443]},{"host":"res.wx.qq.com","ports":[443]},{"host":"shortcloud.weixin.com","ports":[443]},{"host":"weishi.qq.com","ports":[443]},{"host":"wx.qlogo.cn","ports":[443]},{"host":"wxa.wxs.qq.com","ports":[443]}],"mediaEndpoints":[{"address":"43.146.27.17","ports":[443,8000]},{"address":"43.146.27.19","ports":[443,8000]},{"address":"43.146.27.30","ports":[443,8000]},{"address":"43.175.144.12","ports":[443,8000]},{"address":"43.175.144.13","ports":[443]},{"address":"43.175.144.32","ports":[443,8000]},{"address":"43.175.144.34","ports":[443,8000]},{"address":"43.175.144.37","ports":[443]},{"address":"43.175.144.38","ports":[443,8000]},{"address":"43.175.144.40","ports":[443,8000]},{"address":"43.175.144.47","ports":[443,8000]}],"webDomains":[{"host":"acs.youku.com","ports":[443]},{"host":"api.bilibili.com","ports":[443]},{"host":"cache.video.iqiyi.com","ports":[443]},{"host":"data.video.iqiyi.com","ports":[443]},{"host":"edith.xiaohongshu.com","ports":[443]},{"host":"feishu.cn","ports":[443]},{"host":"larkoffice.com","ports":[443]},{"host":"larksuite.com","ports":[443]},{"host":"mesh.if.iqiyi.com","ports":[443]},{"host":"pbaccess.video.qq.com","ports":[443]},{"host":"upos-sz-mirrorali.bilivideo.com","ports":[443]},{"host":"upos-sz-mirrorcos.bilivideo.com","ports":[443]},{"host":"ups.youku.com","ports":[443]},{"host":"v.qq.com","ports":[443]},{"host":"vm.gtimg.cn","ports":[443]},{"host":"vv.video.qq.com","ports":[443]},{"host":"wetype.weixin.qq.com","ports":[443]},{"host":"www.bilibili.com","ports":[443]},{"host":"www.feishu.cn","ports":[443]},{"host":"www.iqiyi.com","ports":[443]},{"host":"www.larksuite.com","ports":[443]},{"host":"www.xhslink.com","ports":[443]},{"host":"www.xiaohongshu.com","ports":[443]},{"host":"www.youku.com","ports":[443]},{"host":"xiaohongshu.com","ports":[443]},{"host":"ykimg.alicdn.com","ports":[443]}],"directSuffixes":[{"host":"100ppi.com","ports":[80,443]},{"host":"10jqka.com.cn","ports":[80,443]},{"host":"aliyuncs.com","ports":[80,443]},{"host":"awtmt.com","ports":[80,443]},{"host":"baidu.com","ports":[80,443]},{"host":"baidubcs.com","ports":[80,443]},{"host":"baidupcs.com","ports":[80,443]},{"host":"baostock.com","ports":[80,443]},{"host":"bcebos.com","ports":[80,443]},{"host":"bdimg.com","ports":[80,443]},{"host":"bdstatic.com","ports":[80,443]},{"host":"bilibili.com","ports":[80,443]},{"host":"bilivideo.com","ports":[80,443]},{"host":"ccxe.com.cn","ports":[80,443]},{"host":"cls.cn","ports":[80,443]},{"host":"cninfo.com.cn","ports":[80,443]},{"host":"dfcfw.com","ports":[80,443]},{"host":"eastmoney.com","ports":[80,443]},{"host":"edu.cn","ports":[80,443]},{"host":"feishu.cn","ports":[80,443]},{"host":"feishucdn.com","ports":[80,443]},{"host":"iqiyi.com","ports":[80,443]},{"host":"iwencai.com","ports":[80,443]},{"host":"larkoffice.com","ports":[80,443]},{"host":"larksuite.com","ports":[80,443]},{"host":"legulegu.com","ports":[80,443]},{"host":"optbbs.com","ports":[80,443]},{"host":"oray.com","ports":[80,443]},{"host":"pushplus.plus","ports":[80,443]},{"host":"sina.com.cn","ports":[80,443]},{"host":"sinajs.cn","ports":[80,443]},{"host":"sse.com.cn","ports":[80,443]},{"host":"sunlogin.com","ports":[80,443]},{"host":"szse.cn","ports":[80,443]},{"host":"xhslink.com","ports":[80,443]},{"host":"xiaohongshu.com","ports":[80,443]},{"host":"youku.com","ports":[80,443]},{"host":"zoom.com","ports":[80,443]},{"host":"zoom.us","ports":[80,443]},{"host":"zoomgov.com","ports":[80,443]}]}"##;
        validate_policy(&response(7, json), &no_protected())
            .expect("the published policy must be usable by this client");
    }

    /// The point of the whole change: a revision this build has never heard of is
    /// usable. Without this, every policy change needs a client release, and a
    /// missed release is indistinguishable from an empty policy.
    #[test]
    fn a_future_version_with_unknown_fields_is_still_usable() {
        let json = r#"{"version":9,"domains":[{"host":"qq.com","ports":[443]}],"mediaEndpoints":[],"webDomains":[{"host":"bilibili.com","ports":[443]}],"directSuffixes":[],"tcpEndpoints":[],"somethingAddedLater":{"nested":true}}"#;
        let (policy, report) = validate_policy_reporting(&response(9, json), &no_protected())
            .expect("a newer revision must not be discarded");
        assert_eq!(policy.domains.len(), 1);
        assert_eq!(policy.web_domains.len(), 1);
        // Recorded, so an operator can see the client is behind rather than guess.
        assert_eq!(report.newer_version, Some(9));
        assert!(report.dropped.is_empty());
    }

    /// Missing what the declared version promises is still a malformed document.
    /// Tolerating extra fields is not the same as tolerating absent ones.
    #[test]
    fn a_document_missing_a_promised_field_is_refused() {
        let json = r#"{"version":2,"domains":[],"webDomains":[]}"#;
        assert_eq!(
            validate_policy(&response(1, json), &no_protected()),
            Err(PolicyError::InvalidResponse),
        );
    }

    /// The limit must not drop below what the control plane accepts, or the same
    /// silent discard returns as soon as the list grows again.
    #[test]
    fn the_web_domain_limit_is_not_below_the_control_planes_maximum() {
        const CONTROL_PLANE_MAXIMUM: usize = 32;
        assert!(
            MAX_POLICY_WEB_DOMAINS >= CONTROL_PLANE_MAXIMUM,
            "the server accepts {CONTROL_PLANE_MAXIMUM} web domains; accepting fewer here \
             rejects the whole document rather than part of it",
        );
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
        ] {
            assert!(!is_allowed_direct_domain(bad), "{bad}");
        }
    }

    #[test]
    fn document_hosts_must_be_canonical() {
        // The predicate normalizes ("Qpic.CN." is an allowed *domain*), but
        // a document entry must already be canonical (Mac `host == entry.host`).
        assert!(is_allowed_direct_domain("Qpic.CN."));
        for host in ["Qpic.CN", "qpic.cn.", " qpic.cn"] {
            let doc = policy_json(&format!(r#"{{"host":"{host}","ports":[443]}}"#), "");
            // Dropped, not fatal. The entry is still not routed — which is what
            // "canonical or nothing" was protecting — but one malformed host no
            // longer costs every other route in the document.
            let (policy, report) = validate_policy_reporting(&response(0, &doc), &no_protected())
                .expect("one bad host must not discard the document");
            assert!(policy.domains.is_empty(), "{host}");
            assert_eq!(report.dropped, vec![host.to_string()], "{host}");
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
    }

    #[test]
    fn accepts_v2_exact_web_and_rejects_v1_web() {
        let v2 = r#"{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"video.bilibili.com","ports":[443]},{"host":"ykimg.alicdn.com","ports":[443]}]}"#;
        let policy = validate_policy(&response(1, v2), &no_protected()).unwrap();
        assert_eq!(policy.version, 2);
        assert_eq!(policy.web_domains.len(), 2);
        // A v1 document carrying web domains is accepted and its web list ignored:
        // a version does not get what it does not declare, and discarding the whole
        // document over an extra field is how a client ends up with no policy at
        // all.
        let v1_web = v2.replace("\"version\":2", "\"version\":1");
        let v1 = validate_policy(&response(1, &v1_web), &no_protected())
            .expect("an extra field must not discard the document");
        assert!(v1.web_domains.is_empty(), "v1 must not route web hosts");
    }

    #[test]
    fn web_boundaries_fail_closed() {
        for host in [
            "Claude.ai",
            "claude.ai",
            "x.claude.ai",
            "anthropic.com",
            "tono.app",
            "evilbilibili.com",
        ] {
            let doc = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"{host}","ports":[443]}}]}}"#
            );
            // Still fails closed for that host — it is not routed — but a host this
            // build has not been told about no longer takes the document with it.
            let (policy, report) = validate_policy_reporting(&response(1, &doc), &no_protected())
                .expect("an unknown web host must not discard the document");
            assert!(policy.web_domains.is_empty(), "{host}");
            assert_eq!(report.dropped, vec![host.to_string()], "{host}");
        }
        for ports in ["[]", "[80]", "[443,443]"] {
            let doc = format!(
                r#"{{"version":2,"domains":[],"mediaEndpoints":[],"webDomains":[{{"host":"bilibili.com","ports":{ports}}}]}}"#
            );
            let (policy, report) = validate_policy_reporting(&response(1, &doc), &no_protected())
                .expect("bad web ports must not discard the document");
            assert!(policy.web_domains.is_empty(), "{ports}");
            assert_eq!(report.dropped, vec!["bilibili.com".to_string()], "{ports}");
        }
        // A host already claimed by `domains` must not also appear as a web domain:
        // two rules for one host is ambiguous, so the web copy is dropped and the
        // WeChat-path entry — the narrower one — is what survives.
        let duplicate = r#"{"version":2,"domains":[{"host":"qq.com","ports":[443]}],"mediaEndpoints":[],"webDomains":[{"host":"qq.com","ports":[443]}]}"#;
        let (policy, report) = validate_policy_reporting(&response(1, duplicate), &no_protected())
            .expect("an ambiguous host must not discard the document");
        assert_eq!(policy.domains.len(), 1);
        assert!(policy.web_domains.is_empty());
        assert_eq!(report.dropped, vec!["qq.com".to_string()]);
    }

    #[test]
    fn rejects_domain_port_violations() {
        for ports in ["[80,80]", "[8080]", "[]", "[443,8000]"] {
            let doc = policy_json(&format!(r#"{{"host":"qq.com","ports":{ports}}}"#), "");
            // The entry is refused; the document is not. A port list this build will
            // not honour still routes nothing, and now costs nothing else.
            let (policy, report) = validate_policy_reporting(&response(0, &doc), &no_protected())
                .expect("bad ports on one entry must not discard the document");
            assert!(policy.domains.is_empty(), "{ports}");
            assert_eq!(report.dropped, vec!["qq.com".to_string()], "{ports}");
        }
    }

    #[test]
    fn rejects_media_port_and_duplicate_violations() {
        for ports in ["[443,443]", "[80]", "[]"] {
            let doc = policy_json("", &format!(r#"{{"address":"9.0.0.9","ports":{ports}}}"#));
            let (policy, report) = validate_policy_reporting(&response(0, &doc), &no_protected())
                .expect("bad ports on one endpoint must not discard the document");
            assert!(policy.media_endpoints.is_empty(), "{ports}");
            assert_eq!(report.dropped, vec!["9.0.0.9".to_string()], "{ports}");
        }
        let dup_domain = policy_json(
            r#"{"host":"qq.com","ports":[80]},{"host":"QQ.com","ports":[80]}"#,
            "",
        );
        // One survivor, one counted duplicate: a repeated host is the server saying
        // the same thing twice, not a reason to route nothing.
        let (policy, report) = validate_policy_reporting(&response(0, &dup_domain), &no_protected())
            .expect("a duplicate must not discard the document");
        assert_eq!(policy.domains.len(), 1);
        // `QQ.com` never reaches the duplicate check: it is not canonical, so it is
        // dropped first. Asserting the count rather than the reason would have
        // passed for the wrong reason.
        assert_eq!(report.dropped, vec!["QQ.com".to_string()]);
    }

    #[test]
    fn rejects_disallowed_and_protected_addresses() {
        for address in ["10.0.0.1", "198.18.0.1", "1.1.1.1", "8.8.8.8", "not-an-ip"] {
            let doc = policy_json("", &format!(r#"{{"address":"{address}","ports":[443]}}"#));
            // What matters is that it is never routed. Dropping achieves that, and
            // the drop is named so it cannot happen unnoticed.
            let (policy, report) = validate_policy_reporting(&response(0, &doc), &no_protected())
                .expect("a refused address must not discard the document");
            assert!(policy.media_endpoints.is_empty(), "{address}");
            assert_eq!(report.dropped, vec![address.to_string()], "{address}");
        }
        // The selected node's IP is protected at sync time.
        let mut protected = BTreeSet::new();
        protected.insert(Ipv4Addr::new(9, 0, 0, 7));
        let doc = policy_json("", r#"{"address":"9.0.0.7","ports":[443]}"#);
        let (policy, report) = validate_policy_reporting(&response(0, &doc), &protected)
            .expect("a protected address must not discard the document");
        assert!(policy.media_endpoints.is_empty());
        assert_eq!(report.dropped, vec!["9.0.0.7".to_string()]);
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
        // Wrong version.
        let wrong_version = policy_json("", "").replace(r#""version":1"#, r#""version":2"#);
        assert_eq!(
            validate_policy(&response(1, &wrong_version), &no_protected()),
            Err(PolicyError::InvalidResponse)
        );
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
