//! Restore internet through the separate release service (PROPOSAL §10 v5, Windows half).
//!
//! The App asks `TonoRelease`, a second LocalSystem service with its own pipe, to release the
//! network. That service runs one worker process in a kill-on-close Job Object, so a release
//! never waits on the main Service, its lifecycle lock or a wedged WFP/DNS call there: the
//! worker quarantines and terminates the main Service and the update executor first, then
//! cleans up and reads every component back. The answer comes within
//! [`RELEASE_ANSWER_SECONDS`] and says, per component, what the read-back saw and whether a
//! late change is still possible. Only a clean, settled, finished read-back is `restored`.

use serde::{Deserialize, Serialize};

/// The SCM name of the release service, per channel.
#[cfg(not(feature = "development-channel"))]
pub const RELEASE_SERVICE_NAME: &str = "TonoRelease";
#[cfg(feature = "development-channel")]
pub const RELEASE_SERVICE_NAME: &str = "TonoReleaseDev";

pub const RELEASE_SERVICE_DISPLAY_NAME: &str = "Tono Restore Network";

/// The image the main Service copies itself to and registers the release service with.
pub const RELEASE_BINARY_NAME: &str = "tono-release.exe";

#[cfg(all(not(feature = "test"), not(feature = "development-channel")))]
pub const RELEASE_IPC_PATH: &str = r"\\.\pipe\tono-release";
#[cfg(all(not(feature = "test"), feature = "development-channel"))]
pub const RELEASE_IPC_PATH: &str = r"\\.\pipe\tono-release-dev";
#[cfg(all(feature = "test", windows))]
pub const RELEASE_IPC_PATH: &str = r"\\.\pipe\tono-release-test";
#[cfg(all(feature = "test", unix))]
pub const RELEASE_IPC_PATH: &str = "/tmp/tono-service-ipc-test/release.sock";

pub const RELEASE_ROUTE: &str = "/release";
pub const RELEASE_STATUS_ROUTE: &str = "/release/status";

/// The worker's state is reported to the App no later than this after the request.
pub const RELEASE_ANSWER_SECONDS: u64 = 25;
/// The release service kills the worker's Job Object at this age, whatever it is doing.
pub const RELEASE_HARD_CAP_SECONDS: u64 = 90;
/// The App's own wait on `/release`, a little past the answer deadline.
pub const RELEASE_CLIENT_TIMEOUT_SECONDS: u64 = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRequest {
    pub request_id: String,
    /// The release generation the App last saw. A machine that has since admitted a newer
    /// session reports `superseded` and touches nothing.
    #[serde(default)]
    pub expected_generation: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseComponent {
    /// `wfp`, `dns`, `dns-policy` or `core`.
    pub name: String,
    /// `restored`, `residual` or `unreadable`.
    pub readback: String,
    /// `settled` when two reads a second apart agree and no writer survived, else `unknown`.
    pub risk: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseReport {
    pub request_id: String,
    /// `restored`, `partial`, `unknown`, `busy`, `superseded`, or `refused` (the protection or
    /// the running connection belongs to another Windows user; nothing was changed).
    pub outcome: String,
    #[serde(default)]
    pub generation: Option<u64>,
    pub finished: bool,
    #[serde(default)]
    pub components: Vec<ReleaseComponent>,
    /// Writers that survived termination, by PID. They keep Connect blocked.
    #[serde(default)]
    pub stuck: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ReleaseReport {
    pub fn without_components(request_id: &str, outcome: &str, detail: Option<String>) -> Self {
        Self {
            request_id: request_id.to_owned(),
            outcome: outcome.to_owned(),
            generation: None,
            finished: true,
            components: Vec::new(),
            stuck: Vec::new(),
            detail,
        }
    }

    /// Only a finished release with nothing stuck and every component read back clean and
    /// settled is `restored`. Any residual is `partial`; anything else, including an answer
    /// given at the deadline, is `unknown`.
    pub fn outcome_of(components: &[ReleaseComponent], stuck: &[u32], finished: bool) -> &'static str {
        if components.iter().any(|component| component.readback == "residual") {
            return "partial";
        }
        let clean = finished
            && stuck.is_empty()
            && !components.is_empty()
            && components
                .iter()
                .all(|component| component.readback == "restored" && component.risk == "settled");
        if clean { "restored" } else { "unknown" }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    /// `secured` or `released`.
    pub mode: String,
    pub generation: u64,
    pub running: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn component(readback: &str, risk: &str) -> ReleaseComponent {
        ReleaseComponent {
            name: "wfp".into(),
            readback: readback.into(),
            risk: risk.into(),
            detail: None,
        }
    }

    #[test]
    fn only_a_clean_settled_finished_readback_is_restored() {
        let clean = component("restored", "settled");
        assert_eq!(ReleaseReport::outcome_of(&[clean.clone()], &[], true), "restored");
        assert_eq!(
            ReleaseReport::outcome_of(&[clean.clone(), component("residual", "settled")], &[], true),
            "partial"
        );
        assert_eq!(
            ReleaseReport::outcome_of(&[clean.clone(), component("restored", "unknown")], &[], true),
            "unknown"
        );
        assert_eq!(ReleaseReport::outcome_of(&[clean.clone()], &[], false), "unknown");
        assert_eq!(ReleaseReport::outcome_of(&[clean], &[7], true), "unknown");
        assert_eq!(ReleaseReport::outcome_of(&[], &[], true), "unknown");
    }
}
