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
    Disconnect,
    Adopt,
    Commit,
    Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub receipt: Option<Receipt>,
    pub execution: String,
    pub offer: Option<ReleaseManifest>,
    /// Set only by a Disconnect that already released network protection but
    /// could not prove or archive the update record, which stays pending. An
    /// Err response means no release completed. Absent from older Services.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs_attention: Option<String>,
}
