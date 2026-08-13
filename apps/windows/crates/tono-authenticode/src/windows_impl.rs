//! Windows Authenticode FFI. Callers must not treat a trusted signature as
//! a substitute for a digest pin.

use std::os::windows::ffi::OsStrExt as _;
use std::path::Path;

use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::Security::Cryptography::{
    CERT_HASH_PROP_ID, CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED, CERT_QUERY_FORMAT_FLAG_BINARY,
    CERT_QUERY_OBJECT_FILE, CERT_SHA256_HASH_PROP_ID, CMSG_SIGNER_ONLY_FLAG, CertCloseStore,
    CertFreeCertificateContext, CertGetCertificateContextProperty, CertGetNameStringW,
    CryptMsgClose, CryptMsgGetAndVerifySigner, CryptQueryObject,
};
use windows_sys::Win32::Security::WinTrust::{
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_FILE_INFO, WTD_CHOICE_FILE,
    WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
};

const TRUST_E_NOSIGNATURE: i32 = -2146762496; // 0x800B_0100
const CERT_NAME_ATTR_TYPE: u32 = 3;
const CERT_NAME_SIMPLE_DISPLAY_TYPE: u32 = 4;
const OID_COMMON_NAME: &[u8] = b"2.5.4.3\0";
const OID_ORGANIZATION_NAME: &[u8] = b"2.5.4.10\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticodeVerdict {
    Signed,
    Unsigned,
    Invalid,
}

pub fn verify(path: &Path) -> AuthenticodeVerdict {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide.as_ptr(),
        hFile: std::ptr::null_mut(),
        pgKnownSubject: std::ptr::null(),
    };
    let mut data: WINTRUST_DATA = unsafe { std::mem::zeroed() };
    data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
    data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.Anonymous.pFile = std::ptr::from_mut(&mut file_info);
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = unsafe {
        WinVerifyTrust(
            INVALID_HANDLE_VALUE,
            std::ptr::from_mut(&mut action),
            std::ptr::from_mut(&mut data).cast(),
        )
    };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    unsafe {
        WinVerifyTrust(
            INVALID_HANDLE_VALUE,
            std::ptr::from_mut(&mut action),
            std::ptr::from_mut(&mut data).cast(),
        );
    }
    if status == 0 {
        AuthenticodeVerdict::Signed
    } else if status == TRUST_E_NOSIGNATURE {
        AuthenticodeVerdict::Unsigned
    } else {
        AuthenticodeVerdict::Invalid
    }
}

pub fn signer_thumbprints(path: &Path) -> Vec<String> {
    with_signer(path, |signer| {
        let mut thumbprints = Vec::new();
        if let Some(sha1) = certificate_hash_hex(signer, CERT_HASH_PROP_ID) {
            thumbprints.push(sha1);
        }
        if let Some(sha256) = certificate_hash_hex(signer, CERT_SHA256_HASH_PROP_ID) {
            thumbprints.push(sha256);
        }
        thumbprints
    })
    .unwrap_or_default()
}

pub fn signer_subjects(path: &Path) -> Vec<String> {
    with_signer(path, |signer| {
        let mut subjects = Vec::new();
        for name in [
            cert_name(signer, CERT_NAME_ATTR_TYPE, OID_COMMON_NAME.as_ptr().cast()),
            cert_name(
                signer,
                CERT_NAME_ATTR_TYPE,
                OID_ORGANIZATION_NAME.as_ptr().cast(),
            ),
            cert_name(signer, CERT_NAME_SIMPLE_DISPLAY_TYPE, std::ptr::null()),
        ]
        .into_iter()
        .flatten()
        {
            if !subjects.iter().any(|existing| existing == &name) {
                subjects.push(name);
            }
        }
        subjects
    })
    .unwrap_or_default()
}

fn with_signer<T>(path: &Path, read: impl FnOnce(*mut windows_sys::Win32::Security::Cryptography::CERT_CONTEXT) -> T) -> Option<T> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut store = std::ptr::null_mut();
    let mut message = std::ptr::null_mut();
    let queried = unsafe {
        CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            wide.as_ptr().cast(),
            CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
            CERT_QUERY_FORMAT_FLAG_BINARY,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut store,
            &mut message,
            std::ptr::null_mut(),
        )
    };
    if queried == 0 || store.is_null() || message.is_null() {
        if !store.is_null() {
            unsafe { CertCloseStore(store, 0) };
        }
        if !message.is_null() {
            unsafe { CryptMsgClose(message) };
        }
        return None;
    }
    let mut signer = std::ptr::null_mut();
    let found = unsafe {
        CryptMsgGetAndVerifySigner(
            message,
            1,
            &store,
            CMSG_SIGNER_ONLY_FLAG,
            &mut signer,
            std::ptr::null_mut(),
        )
    };
    let value = if found != 0 && !signer.is_null() {
        Some(read(signer))
    } else {
        None
    };
    if !signer.is_null() {
        unsafe { CertFreeCertificateContext(signer) };
    }
    unsafe {
        CertCloseStore(store, 0);
        CryptMsgClose(message);
    }
    value
}

fn certificate_hash_hex(
    cert: *mut windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
    prop: u32,
) -> Option<String> {
    let mut length = 0_u32;
    if unsafe { CertGetCertificateContextProperty(cert, prop, std::ptr::null_mut(), &mut length) } == 0
        || length == 0
        || length > 64
    {
        return None;
    }
    let mut bytes = vec![0_u8; length as usize];
    if unsafe {
        CertGetCertificateContextProperty(cert, prop, bytes.as_mut_ptr().cast(), &mut length)
    } == 0
    {
        return None;
    }
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn cert_name(
    cert: *mut windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
    name_type: u32,
    type_para: *const core::ffi::c_void,
) -> Option<String> {
    let needed = unsafe { CertGetNameStringW(cert, name_type, 0, type_para, std::ptr::null_mut(), 0) };
    if needed <= 1 || needed >= 512 {
        return None;
    }
    let mut buffer = vec![0_u16; needed as usize];
    let written =
        unsafe { CertGetNameStringW(cert, name_type, 0, type_para, buffer.as_mut_ptr(), needed) };
    if written <= 1 {
        return None;
    }
    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..end]);
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}
