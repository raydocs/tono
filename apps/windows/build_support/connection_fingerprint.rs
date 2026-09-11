//! Build-time, non-cryptographic source identifier for support only, NOT binary attestation,
//! authorization or an applied-runtime proof. Read only the caller's explicit source allow-list.
//! Do not walk the worktree or read runtime/config/catalog/credential files. No source is emitted.

use std::{io, path::Path};

const OFFSET: u64 = 0xcbf29ce484222325;
const PRIME: u64 = 0x100000001b3;

fn feed(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash = (*hash ^ u64::from(*byte)).wrapping_mul(PRIME);
    }
}

fn source(hash: &mut u64, label: &str, bytes: &[u8]) {
    // CRLF checkout and LF checkout of the same sources must have the same identifier.
    let normalized = bytes
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            if *b == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
                None
            } else {
                Some(*b)
            }
        })
        .collect::<Vec<_>>();
    feed(hash, &(label.len() as u64).to_le_bytes());
    feed(hash, label.as_bytes());
    feed(hash, &(normalized.len() as u64).to_le_bytes());
    feed(hash, &normalized);
}

pub fn emit(variable: &str, inputs: &[&str]) -> io::Result<()> {
    let root = std::env::var_os("CARGO_MANIFEST_DIR")
        .ok_or_else(|| io::Error::other("CARGO_MANIFEST_DIR is not set"))?;
    let mut hash = OFFSET;
    // A schema tag for the hash algorithm, not a product version. Input ordering is explicit.
    feed(&mut hash, b"tono-connection-sources-fnv1a64\0");
    // Cargo supplies these build-context keys. Read only named keys, never enumerate the
    // process environment; a test/development build must not share the production identifier.
    for key in [
        "CARGO_CFG_TARGET_OS",
        "CARGO_CFG_TARGET_ARCH",
        "CARGO_CFG_TARGET_ENV",
        "PROFILE",
        "CARGO_FEATURE_STANDALONE",
        "CARGO_FEATURE_CLIENT",
        "CARGO_FEATURE_TEST",
        "CARGO_FEATURE_DEVELOPMENT_CHANNEL",
        "CARGO_FEATURE_CLIPPY",
        "CARGO_FEATURE_WINDOWS_INTEGRATION_TEST",
        "CARGO_FEATURE_TRACING",
    ] {
        source(
            &mut hash,
            key,
            std::env::var(key).unwrap_or_default().as_bytes(),
        );
    }
    for relative in inputs {
        if !is_source_input(relative) {
            return Err(io::Error::other(
                "connection fingerprint input is not a relative Rust source",
            ));
        }
        let bytes = std::fs::read(Path::new(&root).join(relative))?;
        source(&mut hash, relative, &bytes);
        println!("cargo:rerun-if-changed={relative}");
    }
    println!("cargo:rustc-env={variable}={hash:016x}");
    Ok(())
}

fn is_source_input(value: &str) -> bool {
    let path = Path::new(value);
    // Cargo allow-lists use forward-slash relative labels on every host. On Windows,
    // `/source.rs` has a root but is not absolute (it has no drive); `C:source.rs`
    // is drive-relative, and `source.rs:stream.rs` names an alternate data stream.
    // Reject all of those without giving the host platform a different input policy.
    !path.has_root()
        && !value.contains(['\\', ':'])
        && path.extension() == Some(std::ffi::OsStr::new("rs"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(inputs: &[(&str, &[u8])]) -> u64 {
        let mut hash = OFFSET;
        for (label, bytes) in inputs {
            source(&mut hash, label, bytes);
        }
        hash
    }

    #[test]
    fn unchanged_checkout_is_deterministic_and_crlf_is_normalized() {
        assert_eq!(
            id(&[("a.rs", b"one\ntwo\n")]),
            id(&[("a.rs", b"one\r\ntwo\r\n")])
        );
        assert_eq!(id(&[("a.rs", b"one")]), id(&[("a.rs", b"one")]));
        assert_ne!(id(&[("a.rs", b"one")]), id(&[("a.rs", b"two")]));
    }

    #[test]
    fn names_and_boundaries_participate_without_emitting_input_text() {
        assert_ne!(id(&[("a", b"bc")]), id(&[("ab", b"c")]));
        assert_ne!(
            id(&[("a", b"x"), ("b", b"y")]),
            id(&[("b", b"y"), ("a", b"x")])
        );
        let mut hash = OFFSET;
        feed(&mut hash, b"a");
        assert_eq!(hash, 0xaf63dc4c8601ec8c);
    }

    #[test]
    fn only_explicit_relative_rust_sources_are_eligible() {
        assert!(is_source_input("src/tono/connection.rs"));
        assert!(is_source_input(
            "../build_support/connection_fingerprint.rs"
        ));
        for rejected in [
            "runtime/config.yaml",
            "data/catalog.json",
            ".env",
            "credentials",
            "/tmp/source.rs",
            "C:/source.rs",
            "C:source.rs",
            r"\source.rs",
            r"\\server\share\source.rs",
            r"src\source.rs",
            "source.rs:stream.rs",
        ] {
            assert!(!is_source_input(rejected));
        }
        assert_ne!(
            id(&[("CARGO_FEATURE_TEST", b"1")]),
            id(&[("CARGO_FEATURE_TEST", b"")])
        );
    }
}
