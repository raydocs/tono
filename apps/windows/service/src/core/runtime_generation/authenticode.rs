//! Authenticode check used *in addition to* the SHA-256 pin, never instead of it.
//!
//! The WinVerifyTrust / signer-certificate FFI lives in `tono-authenticode`
//! so the App's WeChat publisher check cannot drift from this core gate.

#![cfg(windows)]

pub(super) use tono_authenticode::{
    AuthenticodeVerdict, signer_thumbprints as authenticode_thumbprints, verify as verify_authenticode,
};
