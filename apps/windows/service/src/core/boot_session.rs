//! Which Windows boot this process runs in (BRICK-W1).
//!
//! A run intent records the boot that wrote it, and the Service replays it only within that same
//! boot. After a crash, a BSOD or a power loss nothing reconnects by itself: the barrier comes
//! back from its own intent, and the user connects again.
//!
//! The marker lives in a volatile subkey of the Service's own SCM key. Windows does not keep a
//! volatile key across a restart ("not preserved when the system initiates a full shutdown",
//! RegCreateKeyExW), and a crash or a power loss loses memory too. A Fast Startup shutdown keeps
//! both the key and the running Service, which is the same boot as far as the Service can tell.
//! `install_service` never deletes the Service, so a repair or a native update within one boot
//! keeps the marker; a fresh install recreates the Service key and so starts a new one.

use std::sync::OnceLock;

/// The marker of this boot, computed once per process. `None` when it could not be read or
/// created; callers treat that as a different boot, so an intent is held rather than replayed.
pub(crate) fn current() -> Option<String> {
    static CURRENT: OnceLock<Option<String>> = OnceLock::new();
    CURRENT.get_or_init(compute).clone()
}

/// Every test in one process shares one boot.
#[cfg(feature = "test")]
fn compute() -> Option<String> {
    Some("tests-share-one-boot".to_owned())
}

#[cfg(all(not(windows), not(feature = "test")))]
fn compute() -> Option<String> {
    None
}

#[cfg(all(windows, not(feature = "test")))]
fn compute() -> Option<String> {
    match windows_marker() {
        Ok(marker) => Some(marker),
        Err(error) => {
            tracing::warn!(
                "the boot-session marker is unavailable, so a recorded run intent is held rather \
                 than replayed: {error:#}"
            );
            None
        }
    }
}

/// Open the existing Service key (never create it), create its volatile `BootSession` subkey,
/// and read `Id`; a missing or empty `Id` is written once and read back.
#[cfg(all(windows, not(feature = "test")))]
fn windows_marker() -> anyhow::Result<String> {
    use anyhow::Context as _;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, FILETIME};
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_LOCAL_MACHINE, KEY_CREATE_SUB_KEY, KEY_QUERY_VALUE, KEY_SET_VALUE,
        KEY_WOW64_64KEY, REG_OPTION_VOLATILE, REG_SZ, RegCloseKey, RegCreateKeyExW, RegOpenKeyExW,
        RegQueryValueExW, RegSetValueExW,
    };
    use windows_sys::Win32::System::SystemInformation::GetSystemTimeAsFileTime;

    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful open or create and is closed once.
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn check(status: u32, what: &'static str) -> anyhow::Result<()> {
        if status == 0 {
            return Ok(());
        }
        Err(std::io::Error::from_raw_os_error(status as i32)).context(what)
    }

    fn read_id(key: &Key, name: &[u16]) -> anyhow::Result<Option<String>> {
        let mut kind = 0_u32;
        let mut buffer = [0_u16; 128];
        let mut size = (buffer.len() * 2) as u32;
        // SAFETY: valid key handle and NUL-terminated value name; `buffer` holds `size`
        // writable bytes.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        check(status, "failed to read the boot-session marker")?;
        anyhow::ensure!(kind == REG_SZ, "the boot-session marker is not a string");
        let mut units = &buffer[..(size as usize / 2).min(buffer.len())];
        while let [rest @ .., 0] = units {
            units = rest;
        }
        Ok(Some(
            String::from_utf16(units).context("the boot-session marker is not valid UTF-16")?,
        ))
    }

    let service_key = wide(&format!(
        r"SYSTEM\CurrentControlSet\Services\{}",
        crate::WINDOWS_SERVICE_NAME
    ));
    let mut parent = std::ptr::null_mut();
    // SAFETY: NUL-terminated key path under HKLM; `parent` is a valid out-pointer.
    check(
        unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                service_key.as_ptr(),
                0,
                KEY_WOW64_64KEY | KEY_CREATE_SUB_KEY,
                &mut parent,
            )
        },
        "failed to open the Service's registry key",
    )?;
    let parent = Key(parent);

    let subkey = wide("BootSession");
    let mut handle = std::ptr::null_mut();
    let mut disposition = 0_u32;
    // SAFETY: valid parent handle and NUL-terminated subkey; `handle` and `disposition` are
    // valid out-pointers.
    check(
        unsafe {
            RegCreateKeyExW(
                parent.0,
                subkey.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_VOLATILE,
                KEY_WOW64_64KEY | KEY_QUERY_VALUE | KEY_SET_VALUE,
                std::ptr::null(),
                &mut handle,
                &mut disposition,
            )
        },
        "failed to open the volatile boot-session key",
    )?;
    let key = Key(handle);

    let name = wide("Id");
    if let Some(id) = read_id(&key, &name)?.filter(|id| !id.is_empty()) {
        return Ok(id);
    }
    let mut now = FILETIME::default();
    // SAFETY: `now` is a valid out-pointer.
    unsafe { GetSystemTimeAsFileTime(&mut now) };
    let filetime = (u64::from(now.dwHighDateTime) << 32) | u64::from(now.dwLowDateTime);
    let data = wide(&format!("{filetime:016x}-{:x}", std::process::id()));
    // SAFETY: `data` is a live NUL-terminated UTF-16 buffer of the stated byte length.
    check(
        unsafe {
            RegSetValueExW(
                key.0,
                name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        },
        "failed to write the boot-session marker",
    )?;
    read_id(&key, &name)?
        .filter(|id| !id.is_empty())
        .context("the boot-session marker did not read back")
}
