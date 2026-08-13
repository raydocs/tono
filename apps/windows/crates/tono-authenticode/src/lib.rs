//! WinVerifyTrust plus signer identity. Used by the Service core-pin gate
//! and by the App's WeChat publisher check. Digest pinning stays elsewhere.

#[cfg(windows)]
mod windows_impl;

#[cfg(windows)]
pub use windows_impl::{
    AuthenticodeVerdict, signer_subjects, signer_thumbprints, verify,
};
