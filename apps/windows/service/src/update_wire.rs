//! Requests carry untrusted inputs, never proof phases or trust keys.
use crate::update_contract::{Receipt, ReleaseManifest};
use serde::{Deserialize, Serialize};

pub const DISCOVERY_URL: &str = "https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json";
pub const RELEASE_ROOT: &str = "https://releases.afk.ccwu.cc/desktop/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum UpdateRequest {
    Check {
        manifest: String,
        signature: String,
    },
    Prepare {
        manifest: String,
        signature: String,
        package_path: String,
    },
    Install {
        attempt_id: String,
    },
    /// `release_generation` names the session this Disconnect tears down (Sol R2-F4 on PR #1569):
    /// once a Restore internet or a newer admitted Connect moved the generation on, it is refused
    /// like any other old teardown.
    Disconnect {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_generation: Option<u64>,
    },
    /// Automatic failed-update recovery releases general traffic with the AI hold.
    /// A separate operation makes an older Service refuse instead of silently dropping intent.
    DisconnectApplyingNarrow {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_generation: Option<u64>,
    },
    Adopt,
    Commit,
    Status,
}

impl UpdateRequest {
    pub fn disconnect(apply_narrow: bool, release_generation: Option<u64>) -> Self {
        if apply_narrow {
            Self::DisconnectApplyingNarrow { release_generation }
        } else {
            Self::Disconnect { release_generation }
        }
    }

    pub fn applies_narrow_on_disconnect(&self) -> bool {
        matches!(self, Self::DisconnectApplyingNarrow { .. })
    }

    pub fn is_disconnect(&self) -> bool {
        matches!(self, Self::Disconnect { .. } | Self::DisconnectApplyingNarrow { .. })
    }

    /// The session a Disconnect names; `None` for every other operation.
    pub fn release_generation(&self) -> Option<u64> {
        match self {
            Self::Disconnect { release_generation } | Self::DisconnectApplyingNarrow { release_generation } => {
                *release_generation
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub receipt: Option<Receipt>,
    pub execution: String,
    pub offer: Option<ReleaseManifest>,
    /// Set by a Disconnect that already released network protection but
    /// could not prove or archive the update record, which stays pending. A
    /// Disconnect Err response means no release completed. Also set while a pending
    /// record's automatic recovery is exhausted (#1292). Absent from older Services.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs_attention: Option<String>,
    /// Set only by an Adopt from any App but the incarnation the update executor launched, such
    /// as the first App after a restart. That App does not reconnect by itself. Absent from
    /// older Services, which reads as false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub successor_relaunched: bool,
}

#[cfg(test)]
#[test]
fn a_disconnect_carries_the_session_it_tears_down() {
    let wire = serde_json::to_string(&UpdateRequest::disconnect(false, Some(7))).unwrap();
    let back: UpdateRequest = serde_json::from_str(&wire).unwrap();
    assert_eq!(back.release_generation(), Some(7));
    let without: UpdateRequest = serde_json::from_str(r#"{"operation":"disconnect"}"#).unwrap();
    assert!(without.is_disconnect() && without.release_generation().is_none());
}
