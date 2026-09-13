//! Stable connection errors and stage outcomes; no orchestration or runtime mutation.

/// Stable error-code prefix the frontend's i18n keys off: the Service has
/// a privileged operation in flight (install/repair pending, possibly a
/// UAC prompt nobody approved).
pub const SERVICE_BUSY_PREFIX: &str = "TONO_SERVICE_BUSY";
/// Disconnect/Sign-out/Quit release is still finishing. Connect must wait — racing would let
/// a late release tear down a fresh StartClash (the P0 fixed in the final review).
pub const RELEASE_RECONCILING_PREFIX: &str = "TONO_RELEASE_RECONCILING";
/// The two guard rejections that clear on their own; see the transient-guard classifier.
/// Named so the classifier and the sites that produce them cannot drift apart.
pub(super) const TRANSITION_IN_FLIGHT_REJECTION: &str = "a connection transition is already in flight";
pub(super) const CATALOG_NOT_READY_REJECTION: &str = "the exit catalog is not available yet";
/// Installed Service is below protocol revision 9 (Test 5 or older).
pub const SERVICE_TOO_OLD_PREFIX: &str = "TONO_SERVICE_TOO_OLD";
/// The Service's WFP engine call did not return inside its budget — the Base Filtering Engine
/// is wedged, typically behind a third-party security product's filter hooks. Distinct from
/// [`BFE_NOT_RUNNING_PREFIX`] because the user action differs (reboot / remove the hook versus
/// simply starting the service). The Service nests these inside its own context string, so
/// they are matched by `contains`, not `starts_with`.
pub const WFP_ENGINE_WEDGED_PREFIX: &str = "TONO_WFP_ENGINE_WEDGED";
/// Windows' Base Filtering Engine service is not running, so no kill switch can be installed.
pub const BFE_NOT_RUNNING_PREFIX: &str = "TONO_BFE_NOT_RUNNING";
/// The Service could not be reached at all, so nothing about protection can be read.
///
/// Distinct from every marker above: those are answers *from* a running Service. This one
/// means TonoService itself is not up. It is AutoStart, and it declares a hard dependency on
/// BFE, so the overwhelmingly common cause is BFE having been turned off by a "network
/// optimiser" — Windows then refuses to start TonoService at boot and never retries. Without
/// this marker the App showed only "protected, not connected" with every diagnostic field
/// reading `(unknown)`, which is unactionable for the customer and for support.
pub const SERVICE_NOT_RUNNING_PREFIX: &str = "TONO_SERVICE_NOT_RUNNING";
/// Stable post-lock classifications. The loopback-proxy cross-check distinguishes a selected
/// node/Core path that works without WinTUN from a failure shared by every Mihomo ingress path.
/// None of these markers relaxes the real TUN proof required for Connected.
pub const TUN_DATA_PLANE_BROKEN_PREFIX: &str = "TONO_TUN_DATA_PLANE_BROKEN";
pub const TUN_INGRESS_BROKEN_PREFIX: &str = "TONO_TUN_INGRESS_BROKEN";
pub const NODE_OR_CORE_UNREACHABLE_PREFIX: &str = "TONO_NODE_OR_CORE_UNREACHABLE";

/// Translate the Service's stable WFP markers into an actionable message. Returns `None` for
/// every other error so callers keep the original diagnostic text.
pub fn map_wfp_engine_error(text: &str) -> Option<String> {
    if text.contains(BFE_NOT_RUNNING_PREFIX) {
        return Some(format!(
            "{BFE_NOT_RUNNING_PREFIX}: Windows 基础筛选引擎 (BFE) 未运行，无法安装网络保护；请以管理员身份运行 `sc start BFE` 后重试"
        ));
    }
    if text.contains(WFP_ENGINE_WEDGED_PREFIX) {
        return Some(format!(
            "{WFP_ENGINE_WEDGED_PREFIX}: Windows 防火墙引擎无响应（常见于第三方安全软件挂钩 WFP）；请重启电脑，若仍然如此请暂时退出杀毒/防火墙软件后重试"
        ));
    }
    None
}

/// Layer the Run State's raw English onto a stable, actionable message.
/// Everything else keeps the original detail for diagnostics.
pub fn map_service_ready_error(err: &anyhow::Error) -> String {
    let text = format!("{err:#}");
    if text.contains(crate::core::runstate::SERVICE_OPERATION_BUSY)
        || text.contains(crate::core::runstate::PRIVILEGED_OUTCOME_UNCERTAIN)
    {
        return format!(
            "{SERVICE_BUSY_PREFIX}: Tono Service 正在安装/修复中，请检查是否有待授权的管理员提示；若无反应请重启 Tono"
        );
    }
    // Everything that reaches here is "the Service did not answer", which the App used to
    // render as raw English with the internal error appended. The detail stays for
    // diagnostics, but the marker lets the UI say the one thing that actually fixes it.
    format!("{SERVICE_NOT_RUNNING_PREFIX}: Tono Service is not ready: {text}")
}

/// Whether a lock failure is the expected "WinTUN still coming up" class that must be
/// retried, versus a permanent failure that would only burn the connect budget if looped.
///
/// Permanent errors (owner mismatch, not armed, WFP engine failure, auth) must not be
/// retried: each attempt is a full Service lifecycle IPC (up to 65 s), and blind retries
/// after a transport timeout can also race a still-running lock on the Service side.
pub fn is_retryable_lock_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    // Primary: ConvertInterfaceAliasToLuid failed because the adapter is not registered yet.
    if lower.contains("did not resolve to a luid") {
        return true;
    }
    // validate_tunnel_luid refuses a non-tunnel LUID while WinTUN is still renaming/initializing.
    if lower.contains("is not a tunnel device") {
        return true;
    }
    // Transient service lifecycle contention while StartClash is still materializing.
    if lower.contains("service unavailable") || lower.contains("operation already") || lower.contains("busy") {
        return true;
    }
    false
}

/// Why `run_stages` ended.
#[derive(Debug)]
pub(super) enum StageFailure {
    /// The owning connection generation moved; no further mutation is admitted.
    Stale,
    /// The shared transaction deadline elapsed. The generation is retired before failure
    /// handling so any detached privileged IPC completion performs the stale-commit repair.
    TimedOut(String),
    Error(String),
}

impl StageFailure {
    /// Every stage funnels its errors through here, so the Service's stable WFP markers are
    /// translated once — whichever stage (arm, lock, release) surfaced them.
    pub(super) fn error(err: impl std::fmt::Display) -> Self {
        let text = err.to_string();
        StageFailure::Error(map_wfp_engine_error(&text).unwrap_or(text))
    }
}

/// First `TONO_*` / `CORE_*` token in a diagnostic string. The connectFail
/// event and the immediate `telemetry/failures` POST copy this onto `code`
/// so the customer timeline has a stable token, not just the prose error.
pub(super) fn stable_error_code(raw: &str) -> Option<&str> {
    for (index, _) in raw.match_indices(|ch: char| ch == 'T' || ch == 'C') {
        let slice = &raw[index..];
        let prefix_len = if slice.starts_with("TONO_") {
            5
        } else if slice.starts_with("CORE_") {
            5
        } else {
            continue;
        };
        let rest = &slice[prefix_len..];
        let extra = rest
            .chars()
            .take_while(|ch| matches!(ch, 'A'..='Z' | '0'..='9' | '_'))
            .map(char::len_utf8)
            .sum::<usize>();
        if extra == 0 {
            continue;
        }
        return Some(&slice[..prefix_len + extra]);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::stable_error_code;

    #[test]
    fn stable_error_code_picks_the_first_tono_or_core_token() {
        assert_eq!(
            stable_error_code(
                "TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]"
            ),
            Some("TONO_NODE_OR_CORE_UNREACHABLE")
        );
        assert_eq!(
            stable_error_code("dial failed CORE_EXIT_UNREACHABLE"),
            Some("CORE_EXIT_UNREACHABLE")
        );
        assert_eq!(stable_error_code("tls handshake eof"), None);
    }
}
