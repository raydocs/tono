//! Wire tokens from #706 `CustomerFailureCode` / `FailureStage`.
//!
//! This is a lookup, not a second classifier. Connect code still comes from
//! the token the failure path already put on the report. When that token is
//! one of #706's codes and the caller did not name a stage, the stage string
//! is `FailureStage::as_str`. #703's `StageBudget.stage` names are budgets,
//! not observed steps; observed step keys stay `commands::stage_key`.

/// Stage for a #706 support code, or `None` when the code is not in that enum.
pub fn stage_for_support_code(code: &str) -> Option<&'static str> {
    match code {
        "TONO_AUTH_DNS" | "TONO_CONNECT_DNS" => Some("dns"),
        "TONO_AUTH_TCP" | "TONO_CONNECT_TCP" => Some("tcp"),
        "TONO_AUTH_TLS" | "TONO_CONNECT_TLS" => Some("tls"),
        "TONO_AUTH_QUIC" | "TONO_CONNECT_QUIC" => Some("quic"),
        "TONO_AUTH_TIMEOUT" | "TONO_CONNECT_TIMEOUT" => Some("timeout"),
        "TONO_CLOCK_SKEW" => Some("clock"),
        "TONO_AUTH_CAPTIVE" | "TONO_CONNECT_CAPTIVE" => Some("captive"),
        "TONO_AUTH_API" => Some("api"),
        "TONO_AUTH_RATE_LIMITED"
        | "TONO_AUTH_DEVICE_LIMIT"
        | "TONO_AUTH_INVALID_CODE"
        | "TONO_AUTH_UNAUTHORIZED"
        | "TONO_AUTH_FORBIDDEN"
        | "TONO_AUTH_UNREACHABLE"
        | "TONO_AUTH_STORE" => Some("auth"),
        "TONO_AUTH_LOCAL_CONFLICT" | "TONO_CONNECT_LOCAL_CONFLICT" => Some("local_conflict"),
        "TONO_CONNECT_TUN" => Some("tunnel"),
        "UNKNOWN_CLASSIFIED_FAILURE" => Some("auth"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_706_code_has_the_stage_that_enum_returns() {
        let pairs = [
            ("TONO_AUTH_DNS", "dns"),
            ("TONO_CONNECT_TLS", "tls"),
            ("TONO_CONNECT_TUN", "tunnel"),
            ("TONO_CLOCK_SKEW", "clock"),
            ("UNKNOWN_CLASSIFIED_FAILURE", "auth"),
        ];
        for (code, stage) in pairs {
            assert_eq!(stage_for_support_code(code), Some(stage));
        }
        assert_eq!(stage_for_support_code("TONO_SERVICE_BUSY"), None);
    }
}
