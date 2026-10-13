//! Evidence that the Service stopped itself after an accepted owner goodbye with nothing armed
//! (#1300, decision 114).
//!
//! A stopped Service alone proves nothing: Tono keeps a persistent WFP floor, so a crashed
//! Service can leave filters behind and the App must read "the Service does not answer" as
//! possibly armed. A Service that stopped because an owner said goodbye is different. The goodbye
//! is accepted only with no barrier wanted and no core desired, and the Service records that fact
//! on its way out. The App treats "SCM reports Stopped, and this record exists" as proof that
//! nothing is armed, so it does not show Protected Offline or ask for a UAC prompt on the next
//! Quit. Everything else (a crash, an SCM stop, a missing or unreadable record) stays unknown.
//!
//! The record is a volatile key under `HKLM\SOFTWARE`: only SYSTEM and administrators can write
//! it, any user can read it, it disappears at reboot (when the Service autostarts anyway), and
//! every Service start deletes it before anything can be armed.

#[cfg(feature = "standalone")]
use std::io;

/// Whether the previous Service instance recorded a clean goodbye and nothing started since.
pub fn recorded() -> bool {
    imp::recorded()
}

/// Record that the Service is stopping after an accepted owner goodbye with nothing armed.
#[cfg(feature = "standalone")]
pub fn record() -> io::Result<()> {
    imp::record()
}

/// Forget a recorded goodbye. Every Service start calls this before it restores or arms anything.
#[cfg(feature = "standalone")]
pub fn clear() -> io::Result<()> {
    imp::clear()
}

/// Make a previous record unreadable, and prove it. Every Service start calls this before it
/// restores or arms anything, and refuses to go on if it fails: a record that outlives a start
/// would let a crash of that instance be read as a clean stop with nothing armed. Success means
/// the record no longer reads as present, whatever the delete itself reported.
#[cfg(feature = "standalone")]
pub fn invalidate() -> io::Result<()> {
    let cleared = imp::clear();
    if imp::recorded() {
        return Err(cleared
            .err()
            .unwrap_or_else(|| io::Error::other("the clean-goodbye record is still present after it was cleared")));
    }
    Ok(())
}

#[cfg(all(windows, not(any(test, feature = "test"))))]
#[cfg_attr(not(feature = "standalone"), allow(dead_code))]
mod imp {
    use std::io;
    use windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WOW64_64KEY,
        REG_OPTION_VOLATILE, REG_SZ, RegCloseKey, RegCreateKeyExW, RegDeleteKeyExW,
        RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    };

    const VALUE_NAME: &str = "Goodbye";

    /// Where the record lives under `HKLM`, named after the Service so channels do not share it.
    fn key_path() -> String {
        format!(r"SOFTWARE\{}CleanGoodbye", crate::WINDOWS_SERVICE_NAME)
    }

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

    fn check(status: u32) -> io::Result<()> {
        if status == 0 {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(status as i32))
        }
    }

    pub(super) fn recorded() -> bool {
        let path = wide(&key_path());
        let mut handle = std::ptr::null_mut();
        // SAFETY: NUL-terminated key path under HKLM; `handle` is a valid out-pointer.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                0,
                KEY_WOW64_64KEY | KEY_QUERY_VALUE,
                &mut handle,
            )
        };
        if status != 0 {
            // Missing, or unreadable: neither is evidence.
            return false;
        }
        let key = Key(handle);
        let name = wide(VALUE_NAME);
        let mut kind = 0_u32;
        let mut size = 0_u32;
        // SAFETY: valid key handle and NUL-terminated value name; only the type and size are
        // requested, so no data buffer is passed.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        status == 0 && kind == REG_SZ && size > 2
    }

    pub(super) fn record() -> io::Result<()> {
        let path = wide(&key_path());
        let mut handle = std::ptr::null_mut();
        let mut disposition = 0_u32;
        // SAFETY: NUL-terminated key path under HKLM; `handle` and `disposition` are valid
        // out-pointers. The null security attributes inherit the parent's access list.
        check(unsafe {
            RegCreateKeyExW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_VOLATILE,
                KEY_WOW64_64KEY | KEY_SET_VALUE,
                std::ptr::null(),
                &mut handle,
                &mut disposition,
            )
        })?;
        let key = Key(handle);
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        let name = wide(VALUE_NAME);
        let data = wide(&at.to_string());
        // SAFETY: `data` is a live NUL-terminated UTF-16 buffer of the stated byte length.
        check(unsafe {
            RegSetValueExW(
                key.0,
                name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        })
    }

    pub(super) fn clear() -> io::Result<()> {
        let path = wide(&key_path());
        // SAFETY: NUL-terminated key path under HKLM.
        let status =
            unsafe { RegDeleteKeyExW(HKEY_LOCAL_MACHINE, path.as_ptr(), KEY_WOW64_64KEY, 0) };
        if status == ERROR_FILE_NOT_FOUND || status == 0 {
            return Ok(());
        }
        // The key itself could not be deleted (a subkey, or no DELETE access). The record is
        // the value, so removing just the value invalidates it.
        let mut handle = std::ptr::null_mut();
        // SAFETY: NUL-terminated key path under HKLM; `handle` is a valid out-pointer.
        let opened = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                0,
                KEY_WOW64_64KEY | KEY_SET_VALUE,
                &mut handle,
            )
        };
        if opened != 0 {
            return check(status);
        }
        let key = Key(handle);
        let name = wide(VALUE_NAME);
        // SAFETY: valid key handle and NUL-terminated value name.
        let removed = unsafe { RegDeleteValueW(key.0, name.as_ptr()) };
        if removed == 0 || removed == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            check(removed)
        }
    }
}

/// Unit tests and test-feature builds share one in-memory record instead of touching `HKLM`.
#[cfg(not(all(windows, not(any(test, feature = "test")))))]
mod imp {
    #[cfg(feature = "standalone")]
    use std::io;
    use std::sync::atomic::{AtomicBool, Ordering};

    static RECORDED: AtomicBool = AtomicBool::new(false);
    /// Test hooks for a delete that fails: whether `clear` reports an error, and whether it
    /// removes the record anyway.
    #[cfg(test)]
    pub(super) static CLEAR_REPORTS_ERROR: AtomicBool = AtomicBool::new(false);
    #[cfg(test)]
    pub(super) static CLEAR_REMOVES_RECORD: AtomicBool = AtomicBool::new(true);

    pub(super) fn recorded() -> bool {
        RECORDED.load(Ordering::SeqCst)
    }

    #[cfg(feature = "standalone")]
    pub(super) fn record() -> io::Result<()> {
        RECORDED.store(true, Ordering::SeqCst);
        Ok(())
    }

    #[cfg(feature = "standalone")]
    pub(super) fn clear() -> io::Result<()> {
        #[cfg(test)]
        {
            if CLEAR_REMOVES_RECORD.load(Ordering::SeqCst) {
                RECORDED.store(false, Ordering::SeqCst);
            }
            if CLEAR_REPORTS_ERROR.load(Ordering::SeqCst) {
                return Err(io::Error::other("simulated registry failure"));
            }
            return Ok(());
        }
        #[cfg(not(test))]
        {
            RECORDED.store(false, Ordering::SeqCst);
            Ok(())
        }
    }
}

#[cfg(all(test, feature = "standalone"))]
mod tests {
    use super::{imp, invalidate, record, recorded};
    use serial_test::serial;
    use std::sync::atomic::Ordering;

    fn reset() {
        imp::CLEAR_REPORTS_ERROR.store(false, Ordering::SeqCst);
        imp::CLEAR_REMOVES_RECORD.store(true, Ordering::SeqCst);
        imp::clear().expect("clear");
    }

    /// Codex block on #1624: a delete that fails must never leave a record that a later crash
    /// would be read through. Only "the record no longer reads" counts as invalidated.
    #[test]
    #[serial]
    fn a_record_that_survives_the_delete_is_not_invalidated() {
        reset();
        record().unwrap();
        imp::CLEAR_REPORTS_ERROR.store(true, Ordering::SeqCst);
        imp::CLEAR_REMOVES_RECORD.store(false, Ordering::SeqCst);
        assert!(invalidate().is_err(), "the delete failed and the record is still there");
        assert!(recorded());

        // A delete that claims success but leaves the record is not trusted either.
        imp::CLEAR_REPORTS_ERROR.store(false, Ordering::SeqCst);
        assert!(invalidate().is_err(), "success without effect must still be refused");

        reset();
    }

    #[test]
    #[serial]
    fn a_record_gone_by_any_route_is_invalidated() {
        reset();
        record().unwrap();
        // The key delete reported an error but the value fallback removed the record.
        imp::CLEAR_REPORTS_ERROR.store(true, Ordering::SeqCst);
        imp::CLEAR_REMOVES_RECORD.store(true, Ordering::SeqCst);
        invalidate().expect("the record no longer reads, so it is invalidated");
        assert!(!recorded());

        reset();
        invalidate().expect("nothing recorded is already invalidated");
    }
}
