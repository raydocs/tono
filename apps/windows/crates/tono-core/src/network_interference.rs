//! H21-O-F8: name a captive portal or a TLS-intercepting network.
//!
//! Pure attribution of one control-plane exchange the App already made. The
//! inputs are what the existing TLS stack and the OS already said: the
//! transport marks a certificate the system trust store refused
//! ([`TLS_INTERCEPTED`]), and the caller passes the OS captive-portal verdict
//! (Windows NLM, read only after a failure). Nothing here sends a request,
//! relaxes certificate validation, or changes a route, a WFP filter or the
//! connect decision. Only the error text (its support code) and one
//! diagnostics class token change.

use crate::auth::{ApiError, ApiResponse};

/// Put on a transport failure whose server certificate the system trust store
/// refused for its issuer, signature or name: something between this PC and
/// Tono presented a certificate Tono did not issue. Also the support code.
pub const TLS_INTERCEPTED: &str = "TONO_TLS_INTERCEPTED";

/// Put on a transport failure while the OS reports a captive portal. It
/// contains "captive", so the existing classifier files it as
/// `TONO_AUTH_CAPTIVE` / `TONO_CONNECT_CAPTIVE`.
pub const CAPTIVE_PORTAL: &str = "TONO_CAPTIVE_PORTAL";

/// #588's marker. A clock that cannot date any certificate is the cause to fix
/// first, so it is never re-attributed.
const CLOCK_SKEW: &str = "TONO_CLOCK_SKEW";

/// RFC 6585 "Network Authentication Required": the status a captive portal
/// answers with.
const NETWORK_AUTHENTICATION_REQUIRED: u16 = 511;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkInterference {
    /// The network wants a web sign-in before it carries traffic.
    CaptivePortal,
    /// The network (or local security software) replaced Tono's certificate.
    TlsIntercepted,
}

impl NetworkInterference {
    /// Class token for `DiagnosticsReport::virtual_adapters`. Never a URL, a
    /// host name or certificate content.
    pub fn diagnostics_class(self) -> &'static str {
        match self {
            Self::CaptivePortal => "captivePortal",
            Self::TlsIntercepted => "tlsIntercepted",
        }
    }
}

/// What one control-plane exchange said about the local network.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Observation {
    /// Something answered over a validated connection: no interference now.
    Answered,
    Interfered(NetworkInterference),
    /// A failure that names neither: keep whatever was observed before.
    Unknown,
}

/// Whether the OS captive-portal verdict can change the attribution of
/// `result`, so the caller reads it only after a transport failure.
pub fn wants_os_signal(result: &Result<ApiResponse, ApiError>) -> bool {
    matches!(result, Err(ApiError::Transport { message, .. })
        if !message.contains(CLOCK_SKEW) && !message.contains(CAPTIVE_PORTAL))
}

/// Attribute one exchange. A transport failure while the OS reports a captive
/// portal gains [`CAPTIVE_PORTAL`] ahead of its text; the kind is unchanged,
/// so the retry and offline-admission rules are unchanged. A clock failure is
/// never re-attributed.
pub fn attribute(
    result: Result<ApiResponse, ApiError>,
    os_reports_captive_portal: bool,
) -> (Result<ApiResponse, ApiError>, Observation) {
    match result {
        Ok(response) if response.status == NETWORK_AUTHENTICATION_REQUIRED => (
            Ok(response),
            Observation::Interfered(NetworkInterference::CaptivePortal),
        ),
        Ok(response) => (Ok(response), Observation::Answered),
        Err(ApiError::Transport { kind, message }) => {
            if message.contains(CLOCK_SKEW) {
                return (
                    Err(ApiError::Transport { kind, message }),
                    Observation::Unknown,
                );
            }
            if message.contains(CAPTIVE_PORTAL) || os_reports_captive_portal {
                let message = if message.contains(CAPTIVE_PORTAL) {
                    message
                } else {
                    format!("{CAPTIVE_PORTAL}: {message}")
                };
                return (
                    Err(ApiError::Transport { kind, message }),
                    Observation::Interfered(NetworkInterference::CaptivePortal),
                );
            }
            let observation = if message.contains(TLS_INTERCEPTED) {
                Observation::Interfered(NetworkInterference::TlsIntercepted)
            } else {
                Observation::Unknown
            };
            (Err(ApiError::Transport { kind, message }), observation)
        }
        Err(other) => (Err(other), Observation::Unknown),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::TransportKind;
    use crate::customer_failure::auth_support_prefix;

    #[test]
    fn a_refused_certificate_or_an_os_captive_portal_names_the_network() {
        let failure = |message: &str| ApiError::Transport {
            kind: TransportKind::Connect,
            message: message.to_string(),
        };
        let plain = "pinned[connect: error sending request]; system-dns[connect: refused]";
        let (result, seen) = attribute(Err(failure(plain)), false);
        assert_eq!(seen, Observation::Unknown);
        assert_eq!(auth_support_prefix(&result.unwrap_err()), "TONO_AUTH_TCP");

        let intercepted =
            format!("pinned[{TLS_INTERCEPTED}: connect: invalid peer certificate: UnknownIssuer]");
        let (result, seen) = attribute(Err(failure(&intercepted)), false);
        assert_eq!(
            seen,
            Observation::Interfered(NetworkInterference::TlsIntercepted)
        );
        assert_eq!(auth_support_prefix(&result.unwrap_err()), TLS_INTERCEPTED);
        assert_eq!(
            NetworkInterference::TlsIntercepted.diagnostics_class(),
            "tlsIntercepted"
        );

        let (result, seen) = attribute(Err(failure(plain)), true);
        assert_eq!(
            seen,
            Observation::Interfered(NetworkInterference::CaptivePortal)
        );
        let error = result.unwrap_err();
        assert!(
            error
                .to_string()
                .contains(&format!("{CAPTIVE_PORTAL}: pinned[")),
            "{error}"
        );
        assert_eq!(auth_support_prefix(&error), "TONO_AUTH_CAPTIVE");

        let portal = ApiResponse {
            status: 511,
            body: b"<html>login</html>".to_vec(),
        };
        assert_eq!(
            attribute(Ok(portal), false).1,
            Observation::Interfered(NetworkInterference::CaptivePortal)
        );
        let answered = ApiResponse {
            status: 401,
            body: Vec::new(),
        };
        assert_eq!(attribute(Ok(answered), true).1, Observation::Answered);

        let clock = failure("TONO_CLOCK_SKEW: connect: certificate expired");
        assert!(!wants_os_signal(&Err(clock.clone())));
        let (result, seen) = attribute(Err(clock), true);
        assert_eq!(seen, Observation::Unknown);
        assert_eq!(auth_support_prefix(&result.unwrap_err()), "TONO_CLOCK_SKEW");
    }
}
