//! Inactive Tono Update Protocol v1 value contract. No authentication, storage,
//! installer or protection effects. A decoded record is NOT a trusted receipt.
//! See docs/UPDATE_PROTOCOL_V1.md before integrating a privileged adapter.

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};

const MAX_BYTES: usize = 16_384;
const MAX_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ContractError {
    #[error("invalid update contract document")]
    Document,
    #[error("update binding mismatch")]
    Binding,
    #[error("update clock or expiry refused")]
    Time,
    #[error("update generation refused")]
    Generation,
    #[error("update phase refused")]
    Phase,
    #[error("update evidence missing or mismatched")]
    Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetId {
    #[serde(rename = "macos-arm64")]
    MacosArm64,
    #[serde(rename = "windows-x86_64")]
    WindowsX86_64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Components {
    pub app_sha256: String,
    pub core_sha256: String,
    pub privileged_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub artifact_sha256: String,
    pub artifact_size_bytes: u64,
    pub components: Components,
    pub id: TargetId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub app_version: String,
    pub build_commit: String,
    pub kind: String,
    pub protocol_version: u32,
    pub release_id: String,
    pub targets: Vec<Target>,
}

impl ReleaseManifest {
    /// Shape validation only. Native publisher/artifact signature verification
    /// and downgrade policy MUST precede any privileged use of this value.
    pub fn decode(bytes: &[u8]) -> Result<Self, ContractError> {
        let value: Self = decode_canonical(bytes)?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        if self.kind != "tonoUpdateManifest"
            || self.protocol_version != 1
            || !identifier(&self.app_version, 64)
            || !identifier(&self.release_id, 128)
            || !hex(&self.build_commit, 40)
            || self.targets.len() != 2
            || self.targets[0].id == self.targets[1].id
            || self.targets.iter().any(|t| {
                !hex(&t.artifact_sha256, 64)
                    || t.artifact_size_bytes == 0
                    || t.artifact_size_bytes > 4_294_967_296
                    || !hex(&t.components.app_sha256, 64)
                    || !hex(&t.components.core_sha256, 64)
                    || !hex(&t.components.privileged_sha256, 64)
            })
        {
            return Err(ContractError::Document);
        }
        Ok(())
    }

    pub fn sha256(&self) -> Result<String, ContractError> {
        self.validate()?;
        Ok(format!("{:x}", Sha256::digest(canonical(self)?)))
    }

    fn target(&self, id: TargetId) -> Result<&Target, ContractError> {
        self.targets
            .iter()
            .find(|t| t.id == id)
            .ok_or(ContractError::Binding)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Preparing,
    InstallationAuthorized,
    InstalledIdentityVerified,
    RecoveryVerified,
    Committed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Protection {
    Unknown,
    Unprotected,
    ProtectedOffline,
    Connected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockReason {
    PreparationFailed,
    InstallationUncertain,
    RecoveryFailed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub attempt_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<BlockReason>,
    pub created_at_unix: u64,
    pub expires_at_unix: u64,
    pub initiating_generation: u64,
    pub installed_location_sha256: String,
    pub kind: String,
    pub manifest_sha256: String,
    pub owner: String,
    pub phase: Phase,
    pub protocol_version: u32,
    pub required_recovery: Protection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_generation: Option<u64>,
    pub target_id: TargetId,
    pub updated_at_unix: u64,
}

/// Local observation supplied by a privileged adapter after native verification,
/// NEVER deserialized from an App request. This type itself confers no authority.
pub enum Observation {
    PreparationVerified {
        artifact_sha256: String,
        protection: Protection,
    },
    InstalledIdentityVerified {
        components: Components,
    },
    RecoveryVerified {
        components: Components,
        protection: Protection,
    },
    CommitVerified {
        components: Components,
        protection: Protection,
    },
    ApplicationContinuationRequested,
    Block(BlockReason),
}

/// Independently authenticated native context, not fields echoed from a request
/// or copied from the receipt being checked. No Deserialize implementation.
pub struct Context<'a> {
    pub attempt_id: &'a str,
    pub owner: &'a str,
    pub installed_location_sha256: &'a str,
    pub target_id: TargetId,
    pub generation: u64,
    pub now_unix: u64,
}

impl Receipt {
    pub fn decode(bytes: &[u8], manifest: &ReleaseManifest) -> Result<Self, ContractError> {
        let value: Self = decode_canonical(bytes)?;
        value.validate(manifest)?;
        Ok(value)
    }

    fn validate(&self, manifest: &ReleaseManifest) -> Result<(), ContractError> {
        let needs_successor = matches!(
            self.phase,
            Phase::InstalledIdentityVerified | Phase::RecoveryVerified | Phase::Committed
        );
        if self.kind != "tonoUpdateReceipt"
            || self.protocol_version != 1
            || !hex(&self.attempt_id, 64)
            || !hex(&self.installed_location_sha256, 64)
            || !identifier(&self.owner, 128)
            || self.manifest_sha256 != manifest.sha256()?
            || self.created_at_unix == 0
            || self.created_at_unix > self.updated_at_unix
            || self.updated_at_unix >= self.expires_at_unix
            || self.expires_at_unix > MAX_INTEGER
            || self.expires_at_unix - self.created_at_unix > 172_800
            || self.initiating_generation == 0
            || self.initiating_generation > MAX_INTEGER
            || needs_successor != self.successor_generation.is_some()
            || self
                .successor_generation
                .is_some_and(|g| g <= self.initiating_generation || g > MAX_INTEGER)
            || (self.phase != Phase::Preparing && self.required_recovery == Protection::Unknown)
            || (self.phase == Phase::Committed && self.blocked_reason.is_some())
        {
            return Err(ContractError::Document);
        }
        manifest.target(self.target_id)?;
        Ok(())
    }

    /// Pure proposal, NOT a durable advance. The coordinator must serialize,
    /// atomically persist and acknowledge this exact value before any effect.
    /// Rejection leaves the original value unchanged, including its last proof.
    pub fn propose(
        &self,
        manifest: &ReleaseManifest,
        context: &Context<'_>,
        observation: Observation,
    ) -> Result<Self, ContractError> {
        self.validate(manifest)?;
        if context.attempt_id != self.attempt_id
            || context.owner != self.owner
            || context.installed_location_sha256 != self.installed_location_sha256
            || context.target_id != self.target_id
        {
            return Err(ContractError::Binding);
        }
        if context.now_unix < self.updated_at_unix || context.now_unix >= self.expires_at_unix {
            return Err(ContractError::Time);
        }
        if self.blocked_reason.is_some() || self.phase == Phase::Committed {
            return Err(ContractError::Phase);
        }
        let adopting = matches!(observation, Observation::InstalledIdentityVerified { .. })
            && self.phase == Phase::InstallationAuthorized;
        if context.generation == 0
            || context.generation > MAX_INTEGER
            || if adopting {
                context.generation <= self.initiating_generation
            } else {
                context.generation
                    != self
                        .successor_generation
                        .unwrap_or(self.initiating_generation)
            }
        {
            return Err(ContractError::Generation);
        }
        let target = manifest.target(self.target_id)?;
        let mut next = self.clone();
        match (self.phase, observation) {
            (
                Phase::Preparing,
                Observation::PreparationVerified {
                    artifact_sha256,
                    protection,
                },
            ) => {
                let expected = match self.required_recovery {
                    Protection::Connected | Protection::ProtectedOffline => {
                        Protection::ProtectedOffline
                    }
                    Protection::Unprotected => Protection::Unprotected,
                    Protection::Unknown => return Err(ContractError::Evidence),
                };
                if artifact_sha256 != target.artifact_sha256 || protection != expected {
                    return Err(ContractError::Evidence);
                }
                next.phase = Phase::InstallationAuthorized;
            }
            (
                Phase::InstallationAuthorized,
                Observation::InstalledIdentityVerified { components },
            ) => {
                if components != target.components {
                    return Err(ContractError::Evidence);
                }
                next.phase = Phase::InstalledIdentityVerified;
                next.successor_generation = Some(context.generation);
            }
            (
                Phase::InstalledIdentityVerified,
                Observation::RecoveryVerified {
                    components,
                    protection,
                },
            )
            | (
                Phase::RecoveryVerified,
                Observation::CommitVerified {
                    components,
                    protection,
                },
            ) => {
                if components != target.components || protection != self.required_recovery {
                    return Err(ContractError::Evidence);
                }
                next.phase = if self.phase == Phase::RecoveryVerified {
                    Phase::Committed
                } else {
                    Phase::RecoveryVerified
                };
            }
            (_, Observation::Block(reason)) => next.blocked_reason = Some(reason),
            (_, Observation::ApplicationContinuationRequested) => {
                return Err(ContractError::Evidence);
            }
            _ => return Err(ContractError::Phase),
        }
        next.updated_at_unix = context.now_unix;
        Ok(next)
    }
}

/// Compact, ASCII-only model JSON with recursively sorted keys and one LF.
/// Re-encoding detects ignored keys, duplicate keys, null optionals, floats,
/// alternate escapes and trailing data instead of accepting decoder drift.
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>, ContractError> {
    let mut value = serde_json::to_value(value).map_err(|_| ContractError::Document)?;
    value.sort_all_objects();
    let mut bytes = serde_json::to_vec(&value).map_err(|_| ContractError::Document)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn decode_canonical<T: DeserializeOwned + Serialize>(bytes: &[u8]) -> Result<T, ContractError> {
    if bytes.len() > MAX_BYTES {
        return Err(ContractError::Document);
    }
    let value = serde_json::from_slice(bytes).map_err(|_| ContractError::Document)?;
    if canonical(&value)? != bytes {
        return Err(ContractError::Document);
    }
    Ok(value)
}

fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
