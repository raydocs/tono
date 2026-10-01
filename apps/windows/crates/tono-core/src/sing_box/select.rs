//! Which core a connect may start, decided before WFP is armed.
//!
//! Automatic mihomo is only for a missing or unauthenticated sing-box binary
//! while protection is not armed. After arm, and when the Service cannot run
//! sing-box, the caller must not swap cores.

use super::flag::PreferredCore;
use sha2::{Digest as _, Sha256};
use std::io::Read as _;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SingBoxBinaryProof {
    Authenticated,
    Missing,
    AuthenticationFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreChoice {
    SingBox,
    Mihomo { automatic_fallback: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreSelection {
    Run(CoreChoice),
    ArmedRefusesFallback,
    ServiceRefusesSingBox,
}

pub fn resolve(
    preferred: PreferredCore,
    proof: SingBoxBinaryProof,
    protection_armed: bool,
    service_can_run_sing_box: bool,
) -> CoreSelection {
    if preferred == PreferredCore::Mihomo {
        return CoreSelection::Run(CoreChoice::Mihomo {
            automatic_fallback: false,
        });
    }
    match proof {
        SingBoxBinaryProof::Authenticated if service_can_run_sing_box => {
            CoreSelection::Run(CoreChoice::SingBox)
        }
        SingBoxBinaryProof::Authenticated => CoreSelection::ServiceRefusesSingBox,
        SingBoxBinaryProof::Missing | SingBoxBinaryProof::AuthenticationFailed
            if !protection_armed =>
        {
            CoreSelection::Run(CoreChoice::Mihomo {
                automatic_fallback: true,
            })
        }
        SingBoxBinaryProof::Missing | SingBoxBinaryProof::AuthenticationFailed => {
            CoreSelection::ArmedRefusesFallback
        }
    }
}

/// Compiled pin wins. An absent or unreadable file is not a pin.
pub fn sing_box_pin_from_env_or_file(pin_file: &Path) -> Option<String> {
    if let Some(pin) = option_env!("TONO_SING_BOX_SHA256") {
        return Some(pin.to_owned());
    }
    std::fs::read_to_string(pin_file).ok()
}

pub fn prove_sing_box_binary(binary: &Path, pin: Option<&str>) -> SingBoxBinaryProof {
    if !binary.is_file() {
        return SingBoxBinaryProof::Missing;
    }
    let Ok(measured) = sha256_hex(binary) else {
        return SingBoxBinaryProof::AuthenticationFailed;
    };
    match classify_digest(pin, &measured) {
        DigestClass::Verified => SingBoxBinaryProof::Authenticated,
        DigestClass::Unpinned | DigestClass::Mismatched | DigestClass::PinMalformed => {
            SingBoxBinaryProof::AuthenticationFailed
        }
    }
}

enum DigestClass {
    Verified,
    Mismatched,
    Unpinned,
    PinMalformed,
}

fn classify_digest(pin: Option<&str>, measured: &str) -> DigestClass {
    let Some(pin) = pin else {
        return DigestClass::Unpinned;
    };
    let Some(expected) = normalize_digest(pin) else {
        return DigestClass::PinMalformed;
    };
    match normalize_digest(measured) {
        Some(measured) if measured == expected => DigestClass::Verified,
        _ => DigestClass::Mismatched,
    }
}

fn normalize_digest(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let trimmed = trimmed.strip_prefix("sha256:").unwrap_or(trimmed).trim();
    (trimmed.len() == 64 && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| trimmed.to_ascii_lowercase())
}

fn sha256_hex(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        CoreChoice, CoreSelection, PreferredCore, SingBoxBinaryProof, prove_sing_box_binary,
        resolve,
    };

    #[test]
    fn automatic_mihomo_only_before_arm_on_a_missing_or_unauthenticated_binary() {
        assert_eq!(
            resolve(
                PreferredCore::SingBox,
                SingBoxBinaryProof::Missing,
                false,
                true
            ),
            CoreSelection::Run(CoreChoice::Mihomo {
                automatic_fallback: true
            })
        );
        assert_eq!(
            resolve(
                PreferredCore::SingBox,
                SingBoxBinaryProof::AuthenticationFailed,
                false,
                true
            ),
            CoreSelection::Run(CoreChoice::Mihomo {
                automatic_fallback: true
            })
        );
        assert_eq!(
            resolve(
                PreferredCore::SingBox,
                SingBoxBinaryProof::Missing,
                true,
                true
            ),
            CoreSelection::ArmedRefusesFallback
        );
        assert_eq!(
            resolve(
                PreferredCore::SingBox,
                SingBoxBinaryProof::Authenticated,
                false,
                false
            ),
            CoreSelection::ServiceRefusesSingBox
        );
        assert_eq!(
            resolve(
                PreferredCore::SingBox,
                SingBoxBinaryProof::Authenticated,
                false,
                true
            ),
            CoreSelection::Run(CoreChoice::SingBox)
        );
        assert_eq!(
            resolve(
                PreferredCore::Mihomo,
                SingBoxBinaryProof::Authenticated,
                false,
                true
            ),
            CoreSelection::Run(CoreChoice::Mihomo {
                automatic_fallback: false
            })
        );
    }

    #[test]
    fn an_unpinned_sing_box_binary_is_not_authenticated() {
        let path = std::env::temp_dir().join(format!(
            "tono-singbox-unpinned-{}.exe",
            std::process::id()
        ));
        std::fs::write(&path, b"not-a-core").unwrap();
        assert_eq!(
            prove_sing_box_binary(&path, None),
            SingBoxBinaryProof::AuthenticationFailed
        );
        let missing = path.with_file_name("tono-singbox-absent.exe");
        let _ = std::fs::remove_file(&missing);
        assert_eq!(
            prove_sing_box_binary(&missing, Some("ab".repeat(32).as_str())),
            SingBoxBinaryProof::Missing
        );
        let _ = std::fs::remove_file(&path);
    }
}
