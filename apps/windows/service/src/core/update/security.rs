//! Windows-native image and filesystem proofs. No Authenticode provisioning;
//! unsigned installed images are permitted only inside the protected registered
//! installation. Update bytes additionally require the pinned manifest signature.
use crate::update_transaction::{Image, file_digest};
use anyhow::{Context, Result, ensure};
use std::os::windows::{
    ffi::OsStrExt,
    fs::{MetadataExt, OpenOptionsExt},
    io::AsRawHandle,
};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::Registry::*,
};

pub fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

/// Pin every ancestor against rename and reject all reparse components. The
/// final file denies concurrent write/delete for the whole private-copy read.
pub fn pin_path(path: &Path, protected: bool) -> Result<Vec<File>> {
    ensure!(path.is_absolute(), "update path must be absolute");
    let mut held = Vec::new();
    let mut parts = path.ancestors().collect::<Vec<_>>();
    parts.reverse();
    for part in parts {
        let meta = std::fs::symlink_metadata(part)?;
        ensure!(
            meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0,
            "reparse update path refused"
        );
        let file = OpenOptions::new()
            .read(true)
            .access_mode(
                READ_CONTROL
                    | FILE_READ_ATTRIBUTES
                    | if meta.is_file() { FILE_READ_DATA } else { 0 },
            )
            .share_mode(if meta.is_dir() {
                FILE_SHARE_READ | FILE_SHARE_WRITE
            } else {
                FILE_SHARE_READ
            })
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(part)?;
        ensure!(
            file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0,
            "update path changed to reparse point"
        );
        // Ancestors such as C:\ may grant create-child; the protected root and
        // every descendant must deny replacement by ordinary users.
        if protected && part == path {
            verify_acl(&file)?;
        }
        held.push(file);
    }
    Ok(held)
}

fn verify_acl(file: &File) -> Result<()> {
    let mut owner = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    ensure!(
        status == 0 && !descriptor.is_null(),
        "cannot inspect image security"
    );
    struct Descriptor(*mut std::ffi::c_void);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0) };
        }
    }
    let _descriptor = Descriptor(descriptor);
    verify_owner_and_dacl(owner, dacl)
}

/// `NT SERVICE\TrustedInstaller`. `C:\Program Files` hands it `(CI)(IO)(F)`, so every directory
/// an installer creates beneath it carries an effective, inherited `TrustedInstaller:(I)(F)`; the
/// installer does not rewrite that ACL. It is the Windows servicing identity, which no ordinary
/// user holds, and administrators could already take ownership, so trusting it widens nothing.
const TRUSTED_INSTALLER_SID: &str =
    "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";

/// Only SYSTEM, BUILTIN\Administrators and TrustedInstaller may own or be granted write access
/// to the installed tree; Users, Authenticated Users, Everyone or the owner user may not.
/// `CREATOR OWNER` needs no entry: Program Files passes it only as an inherit-only ACE, which is
/// skipped below, and inheritance substitutes the creator's owner SID — the owner this function
/// already requires to be trusted.
fn verify_owner_and_dacl(owner: PSID, dacl: *const ACL) -> Result<()> {
    struct LocalSid(PSID);
    impl Drop for LocalSid {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0) };
        }
    }
    let mut installer = std::ptr::null_mut();
    ensure!(
        unsafe { ConvertStringSidToSidW(wide(TRUSTED_INSTALLER_SID).as_ptr(), &mut installer) }
            != 0,
        "SID creation failed"
    );
    let installer = LocalSid(installer);
    let trusted = |sid| -> Result<bool> {
        if unsafe { EqualSid(sid, installer.0) } != 0 {
            return Ok(true);
        }
        for kind in [WinLocalSystemSid, WinBuiltinAdministratorsSid] {
            let mut bytes = [0_u64; 9];
            let mut length = std::mem::size_of_val(&bytes) as u32;
            ensure!(
                unsafe {
                    CreateWellKnownSid(
                        kind,
                        std::ptr::null_mut(),
                        bytes.as_mut_ptr().cast(),
                        &mut length,
                    )
                } != 0,
                "SID creation failed"
            );
            if unsafe { EqualSid(sid, bytes.as_mut_ptr().cast()) } != 0 {
                return Ok(true);
            }
        }
        Ok(false)
    };
    ensure!(
        !owner.is_null() && trusted(owner)? && !dacl.is_null(),
        "image has untrusted owner or null DACL"
    );
    for i in 0..unsafe { (*dacl).AceCount } {
        let mut ace = std::ptr::null_mut();
        ensure!(
            unsafe { GetAce(dacl, i.into(), &mut ace) } != 0,
            "image DACL unreadable"
        );
        let header = unsafe { &*(ace as *const ACE_HEADER) };
        if u32::from(header.AceFlags) & INHERIT_ONLY_ACE != 0 {
            continue;
        }
        if header.AceType == 1 {
            continue;
        } // ACCESS_DENIED_ACE only narrows.
        ensure!(header.AceType == 0, "unsupported image allow ACE");
        let allowed = unsafe { &*(ace as *const ACCESS_ALLOWED_ACE) };
        let writes = FILE_WRITE_DATA
            | FILE_APPEND_DATA
            | FILE_WRITE_EA
            | FILE_WRITE_ATTRIBUTES
            | FILE_DELETE_CHILD
            | DELETE
            | WRITE_DAC
            | WRITE_OWNER
            | GENERIC_WRITE
            | GENERIC_ALL;
        if allowed.Mask & writes != 0 {
            let sid = (&allowed.SidStart as *const u32).cast_mut().cast();
            ensure!(
                trusted(sid)?,
                "ordinary users can modify installed image/dependency"
            );
        }
    }
    Ok(())
}

pub fn program_files() -> Result<PathBuf> {
    use windows_sys::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath},
    };
    let mut raw = std::ptr::null_mut();
    ensure!(
        unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramFiles, 0, std::ptr::null_mut(), &mut raw) }
            >= 0
            && !raw.is_null(),
        "Program Files unavailable"
    );
    let mut n = 0;
    while unsafe { *raw.add(n) } != 0 {
        n += 1;
    }
    let path = PathBuf::from(String::from_utf16(unsafe {
        std::slice::from_raw_parts(raw, n)
    })?);
    unsafe { CoTaskMemFree(raw.cast()) };
    Ok(path)
}

pub fn registry_string(root: HKEY, key: &str, name: &str) -> Result<Option<String>> {
    let (key, name) = (wide(key), wide(name));
    let mut bytes = [0_u16; 16_384];
    let mut size = std::mem::size_of_val(&bytes) as u32;
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            std::ptr::null_mut(),
            bytes.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    ensure!(status == 0, "registry identity unavailable ({status})");
    Ok(Some(String::from_utf16(
        &bytes[..(size as usize / 2).saturating_sub(1)],
    )?))
}

pub fn install_root() -> Result<PathBuf> {
    let expected = program_files()?.join("Tono");
    let registered = registry_string(
        HKEY_LOCAL_MACHINE,
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tono",
        "InstallLocation",
    )?
    .context("Tono has no registered installation")?;
    ensure!(
        Path::new(registered.trim_matches('"')).canonicalize()? == expected.canonicalize()?,
        "registered installation mismatch"
    );
    let _pin = pin_path(&expected, true)?;
    Ok(expected.canonicalize()?)
}

pub fn image(pid: u32) -> Result<Image> {
    let identity = super::super::process::process_identity(pid)?.context("peer exited")?;
    let path = PathBuf::from(&identity.executable);
    let _pins = pin_path(&path, true)?;
    let sha256 = file_digest(&path)?;
    ensure!(
        super::super::process::process_identity(pid)?.as_ref() == Some(&identity),
        "peer incarnation changed"
    );
    Ok(Image {
        pid,
        started_at: identity.started_at,
        path,
        sha256,
    })
}

pub fn app_image(pid: u32) -> Result<Image> {
    let root = install_root()?;
    verify_tree(&root, 0)?;
    let image = image(pid)?;
    if image.path != root.join("Tono.exe") {
        return Err(NotRegisteredApp.into());
    }
    Ok(image)
}

/// The one verdict [`app_image`] reaches about the caller itself: its image is not the registered
/// installation's `Tono.exe`. Every other `app_image` error means the proof could not be completed
/// (registry, ACL or file reads, a file held open, the tree changing), not that the caller is not
/// the App.
#[derive(Debug)]
pub struct NotRegisteredApp;

impl std::fmt::Display for NotRegisteredApp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("peer is not the registered App image")
    }
}

impl std::error::Error for NotRegisteredApp {}

pub fn verify_tree(root: &Path, depth: usize) -> Result<()> {
    ensure!(depth < 12, "installation tree too deep");
    let _held = pin_path(root, true)?;
    if root.is_dir() {
        for (i, entry) in std::fs::read_dir(root)?.enumerate() {
            ensure!(i < 512, "installation tree too large");
            verify_tree(&entry?.path(), depth + 1)?;
        }
    }
    Ok(())
}

pub fn no_proxy(sid: &str) -> Result<()> {
    let key = format!("{sid}\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
    let mut enabled: u32 = 0;
    let mut size = 4;
    let status = unsafe {
        RegGetValueW(
            HKEY_USERS,
            wide(&key).as_ptr(),
            wide("ProxyEnable").as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut enabled as *mut u32).cast(),
            &mut size,
        )
    };
    ensure!(
        status == 0 || status == ERROR_FILE_NOT_FOUND,
        "proxy state unknown"
    );
    ensure!(
        enabled == 0
            && registry_string(HKEY_USERS, &key, "AutoConfigURL")?.is_none_or(|s| s.is_empty()),
        "active user proxy must be cleared before update"
    );
    Ok(())
}

/// Enumerate successfully before claiming absence. A failed alias lookup can
/// also mean API/access failure or a same-named non-TUN adapter, not removal.
pub fn tunnel_absent(name: &str) -> Result<()> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2};
    let mut table = std::ptr::null_mut();
    let status = unsafe { GetIfTable2(&mut table) };
    ensure!(
        status == 0 && !table.is_null(),
        "adapter enumeration failed ({status})"
    );
    struct Table(*mut std::ffi::c_void);
    impl Drop for Table {
        fn drop(&mut self) {
            unsafe { FreeMibTable(self.0) };
        }
    }
    let _table = Table(table.cast());
    let count = unsafe { (*table).NumEntries } as usize;
    ensure!(count <= 4096, "adapter enumeration exceeds limit");
    for row in unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), count) } {
        let end = row
            .Alias
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(row.Alias.len());
        ensure!(
            !String::from_utf16(&row.Alias[..end])?.eq_ignore_ascii_case(name),
            "TUN adapter is still present"
        );
    }
    Ok(())
}

pub fn decode_base64(value: &str) -> Result<String> {
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_STRING_BASE64, CRYPT_STRING_STRICT, CryptStringToBinaryW,
    };
    ensure!(
        value.len() <= 4096 && value.is_ascii(),
        "signature box exceeds limit"
    );
    let value = wide(value.trim());
    let mut size = 4096;
    let mut bytes = vec![0_u8; size as usize];
    ensure!(
        unsafe {
            CryptStringToBinaryW(
                value.as_ptr(),
                (value.len() - 1) as u32,
                CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT,
                bytes.as_mut_ptr(),
                &mut size,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } != 0,
        "invalid signature base64"
    );
    bytes.truncate(size as usize);
    Ok(String::from_utf8(bytes)?)
}

pub fn random_id() -> Result<String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
    };
    let mut bytes = [0_u8; 32];
    ensure!(
        unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                bytes.as_mut_ptr(),
                32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        } >= 0,
        "random attempt identity failed"
    );
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

pub fn process_matches(expected: &Image) -> Result<()> {
    let actual =
        super::super::process::process_identity(expected.pid)?.context("process exited")?;
    ensure!(
        actual.started_at == expected.started_at && Path::new(&actual.executable) == expected.path,
        "process incarnation changed"
    );
    Ok(())
}

/// Manual installers may live in Downloads; this is an incarnation binding,
/// not an updater image trust proof. UAC + verified Disconnect remain required.
pub fn parent_image() -> Result<Image> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    ensure!(snapshot != INVALID_HANDLE_VALUE, "process snapshot failed");
    let snapshot = Handle(snapshot);
    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = std::mem::size_of_val(&entry) as u32;
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while found != 0 {
        if entry.th32ProcessID == std::process::id() {
            let pid = entry.th32ParentProcessID;
            let identity =
                super::super::process::process_identity(pid)?.context("installer parent exited")?;
            let path = PathBuf::from(identity.executable);
            return Ok(Image {
                pid,
                started_at: identity.started_at,
                sha256: file_digest(&path)?,
                path,
            });
        }
        found = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    anyhow::bail!("installer parent unavailable")
}

/// Capture the authenticated initiating user's token *before* stopping the App.
/// The executor never launches a user GUI with its own SYSTEM identity.
pub struct UserLaunch {
    token: Handle,
}
impl UserLaunch {
    pub fn capture(peer: &Image) -> Result<Self> {
        use windows_sys::Win32::System::Threading::*;
        process_matches(peer)?;
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, peer.pid) };
        ensure!(!process.is_null(), "cannot capture initiating process");
        let process = Handle(process);
        let mut raw = std::ptr::null_mut();
        ensure!(
            unsafe { OpenProcessToken(process.0, TOKEN_DUPLICATE | TOKEN_QUERY, &mut raw) } != 0,
            "cannot capture user token"
        );
        let token = Handle(raw);
        let mut primary = std::ptr::null_mut();
        ensure!(
            unsafe {
                DuplicateTokenEx(
                    token.0,
                    TOKEN_ALL_ACCESS,
                    std::ptr::null(),
                    SecurityImpersonation,
                    TokenPrimary,
                    &mut primary,
                )
            } != 0,
            "cannot duplicate user token"
        );
        process_matches(peer)?;
        Ok(Self {
            token: Handle(primary),
        })
    }

    pub fn suspended(&self, path: &Path) -> Result<SuspendedApp> {
        use windows_sys::Win32::System::{Environment::*, Threading::*};
        let pins = pin_path(path, true)?;
        let path_wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut command = wide(&format!("\"{}\"", path.display()));
        let mut desktop = wide("winsta0\\default");
        let mut startup = STARTUPINFOW::default();
        startup.cb = std::mem::size_of_val(&startup) as u32;
        startup.lpDesktop = desktop.as_mut_ptr();
        let mut environment = std::ptr::null_mut();
        ensure!(
            unsafe { CreateEnvironmentBlock(&mut environment, self.token.0, 0) } != 0,
            "cannot create user environment"
        );
        let mut process = PROCESS_INFORMATION::default();
        let created = unsafe {
            CreateProcessAsUserW(
                self.token.0,
                path_wide.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                environment,
                std::ptr::null(),
                &startup,
                &mut process,
            )
        };
        unsafe { DestroyEnvironmentBlock(environment) };
        ensure!(
            created != 0,
            "successor launch failed: {}",
            std::io::Error::last_os_error()
        );
        let child = SuspendedApp {
            process: Handle(process.hProcess),
            thread: Handle(process.hThread),
            pid: process.dwProcessId,
            resumed: false,
            _pins: pins,
        };
        Ok(child)
    }
}

pub struct SuspendedApp {
    process: Handle,
    thread: Handle,
    pub pid: u32,
    resumed: bool,
    _pins: Vec<File>,
}
impl SuspendedApp {
    pub fn resume(mut self) -> Result<()> {
        use windows_sys::Win32::System::Threading::ResumeThread;
        ensure!(
            unsafe { ResumeThread(self.thread.0) } != u32::MAX,
            "successor resume failed"
        );
        self.resumed = true;
        Ok(())
    }
}
impl Drop for SuspendedApp {
    fn drop(&mut self) {
        if !self.resumed {
            unsafe { windows_sys::Win32::System::Threading::TerminateProcess(self.process.0, 1) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_sddl(sddl: &str) -> Result<()> {
        let mut descriptor = std::ptr::null_mut();
        ensure!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide(sddl).as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            } != 0,
            "SDDL parse failed: {}",
            std::io::Error::last_os_error()
        );
        struct Descriptor(PSECURITY_DESCRIPTOR);
        impl Drop for Descriptor {
            fn drop(&mut self) {
                unsafe { LocalFree(self.0) };
            }
        }
        let descriptor = Descriptor(descriptor);
        let (mut owner, mut dacl) = (std::ptr::null_mut(), std::ptr::null_mut());
        let (mut defaulted, mut present) = (0, 0);
        ensure!(
            unsafe { GetSecurityDescriptorOwner(descriptor.0, &mut owner, &mut defaulted) } != 0
                && unsafe {
                    GetSecurityDescriptorDacl(descriptor.0, &mut present, &mut dacl, &mut defaulted)
                } != 0,
            "descriptor unreadable"
        );
        verify_owner_and_dacl(owner, dacl)
    }

    /// What an elevated installer's `C:\Program Files\Tono` inherits from Windows' default
    /// Program Files ACL (icacls: TrustedInstaller:(I)(F), SYSTEM:(I)(F), Administrators:(I)(F),
    /// Users:(I)(RX), CREATOR OWNER inherit-only, app packages RX). Not yet read from a device.
    #[test]
    fn default_program_files_inherited_acl_is_trusted_and_user_write_is_not() {
        const TI: &str = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
        let inherited = format!(
            "O:BAD:AI(A;ID;FA;;;{TI})(A;CIIOID;GA;;;{TI})(A;ID;FA;;;SY)(A;OICIIOID;GA;;;SY)\
             (A;ID;FA;;;BA)(A;OICIIOID;GA;;;BA)(A;ID;0x1200a9;;;BU)(A;OICIIOID;GXGR;;;BU)\
             (A;OICIIOID;GA;;;CO)(A;ID;0x1200a9;;;S-1-15-2-1)(A;OICIIOID;GXGR;;;S-1-15-2-1)\
             (A;ID;0x1200a9;;;S-1-15-2-2)(A;OICIIOID;GXGR;;;S-1-15-2-2)"
        );
        verify_sddl(&inherited).expect("the default Program Files inheritance must be trusted");

        let user_modify = format!("{inherited}(A;;0x1301bf;;;BU)");
        assert!(
            verify_sddl(&user_modify).is_err(),
            "a Users write grant must still be refused"
        );
    }
}
