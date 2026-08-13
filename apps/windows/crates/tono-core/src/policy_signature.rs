//! Ed25519 verification for managed traffic policies (Mac
//! `ManagedTrafficPolicySignature` parity).

use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Public half of the production signing key, standard base64, 32 bytes.
pub const TRAFFIC_POLICY_PUBLIC_KEY: &str = "Sf2burVHXZWzYikU0FlC+N64BeRZJxJe8XaneblmTkM=";
/// Prefixed to the signed bytes. Mirrors TRAFFIC_POLICY_SIGNATURE_CONTEXT.
pub const TRAFFIC_POLICY_SIGNATURE_CONTEXT: &str = "tono-traffic-policy-v1\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureVerdict {
    Unsigned,
    Trusted,
    Untrustworthy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameRevisionTransition {
    Unchanged,
    UpgradeToTrusted,
    DowngradeAttempt,
    ReplacementAttempt,
}

pub fn same_revision_transition(
    current: Option<&str>,
    candidate: Option<&str>,
) -> SameRevisionTransition {
    let current = normalize(current);
    let candidate = normalize(candidate);
    match (current, candidate) {
        (None, None) => SameRevisionTransition::Unchanged,
        (None, Some(_)) => SameRevisionTransition::UpgradeToTrusted,
        (Some(_), None) => SameRevisionTransition::DowngradeAttempt,
        (Some(current), Some(candidate)) if current == candidate => {
            SameRevisionTransition::Unchanged
        }
        (Some(_), Some(_)) => SameRevisionTransition::ReplacementAttempt,
    }
}

pub fn verdict(json: &str, signature: Option<&str>) -> SignatureVerdict {
    verdict_with_key(json, signature, TRAFFIC_POLICY_PUBLIC_KEY)
}

pub fn verdict_with_key(json: &str, signature: Option<&str>, public_key_base64: &str) -> SignatureVerdict {
    let Some(signature) = signature.filter(|value| !value.is_empty()) else {
        return SignatureVerdict::Unsigned;
    };
    let Ok(key_bytes) = base64::engine::general_purpose::STANDARD.decode(public_key_base64) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(signature_bytes) = base64::engine::general_purpose::STANDARD.decode(signature) else {
        return SignatureVerdict::Untrustworthy;
    };
    if signature_bytes.len() != 64 {
        return SignatureVerdict::Untrustworthy;
    }
    let Ok(key_bytes): Result<[u8; 32], _> = key_bytes.try_into() else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key_bytes) else {
        return SignatureVerdict::Untrustworthy;
    };
    let Ok(signature_bytes): Result<[u8; 64], _> = signature_bytes.try_into() else {
        return SignatureVerdict::Untrustworthy;
    };
    let signature = Signature::from_bytes(&signature_bytes);
    let mut message = TRAFFIC_POLICY_SIGNATURE_CONTEXT.as_bytes().to_vec();
    message.extend_from_slice(json.as_bytes());
    if key.verify(&message, &signature).is_ok() {
        SignatureVerdict::Trusted
    } else {
        SignatureVerdict::Untrustworthy
    }
}

fn normalize(value: Option<&str>) -> Option<&str> {
    value.filter(|item| !item.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{
        SignatureVerdict, TRAFFIC_POLICY_SIGNATURE_CONTEXT, same_revision_transition, verdict,
        verdict_with_key,
    };
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn unsigned_and_garbage_signatures() {
        assert_eq!(verdict("{}", None), SignatureVerdict::Unsigned);
        assert_eq!(verdict("{}", Some("")), SignatureVerdict::Unsigned);
        assert_eq!(
            verdict("{}", Some("not-base64")),
            SignatureVerdict::Untrustworthy
        );
    }

    #[test]
    fn trusted_signature_verifies_only_for_the_matching_key() {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let public = signing.verifying_key();
        let public_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            public.as_bytes(),
        );
        let json = r#"{"version":1,"domains":[],"mediaEndpoints":[]}"#;
        let mut message = TRAFFIC_POLICY_SIGNATURE_CONTEXT.as_bytes().to_vec();
        message.extend_from_slice(json.as_bytes());
        let signature = signing.sign(&message);
        let signature_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signature.to_bytes(),
        );
        assert_eq!(
            verdict_with_key(json, Some(&signature_b64), &public_b64),
            SignatureVerdict::Trusted
        );
        assert_eq!(
            verdict(json, Some(&signature_b64)),
            SignatureVerdict::Untrustworthy
        );
    }

    #[test]
    fn trust_only_moves_forward() {
        use super::SameRevisionTransition::*;
        assert_eq!(same_revision_transition(None, None), Unchanged);
        assert_eq!(same_revision_transition(None, Some("sig")), UpgradeToTrusted);
        assert_eq!(
            same_revision_transition(Some("sig"), None),
            DowngradeAttempt
        );
        assert_eq!(
            same_revision_transition(Some("sig"), Some("sig")),
            Unchanged
        );
        assert_eq!(
            same_revision_transition(Some("old"), Some("new")),
            ReplacementAttempt
        );
    }
}
