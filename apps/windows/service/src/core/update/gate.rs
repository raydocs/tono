//! Why a manual installer gate refused (WIN-GATE-OPAQUE). Every refusal names one stable cause:
//! its own process exit status, which NSIS turns into a dialog with the next step for that
//! cause, and a code in the install-gate log. Nothing here decides whether to refuse; it only
//! names why, so a customer and support can see what is wrong on that machine.
use anyhow::{Context as _, Error, Result, ensure};
use std::io::Write as _;
use std::os::windows::{fs::OpenOptionsExt as _, io::AsRawHandle as _};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, GetFileInformationByHandle,
};

/// One cause per refusal. The exit codes are a contract with `installer.nsi`
/// (`TonoGateExplain`); 77, 78 and 79 keep their own types (`ProtectionActive`,
/// `OrphanedProtection`, the helper's `BfeUnavailable`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateReason {
    /// A protected update attempt has not committed.
    UpdatePending,
    /// Another live installer or uninstaller holds the manual lease.
    InstallerLeaseHeld,
    /// The repair lock or the update store lock is held by another Tono process.
    LifecycleWriterActive,
    /// WFP could not be read for a reason other than BFE.
    WfpUnreadable,
    /// The active owner record or its desired state could not be read.
    OwnerStateUnreadable,
    /// Protected DNS could not be shown restored.
    DnsRestoreUnproven,
    /// The recorded Tono Core is running, or could not be shown stopped.
    CoreRunning,
    /// A network interface named `Tono` is still present.
    TonoAdapterPresent,
    /// `ProgramData\Tono` (or a directory under it) is not a private, ordinary directory.
    StateDirUnusable,
    /// The protected update record is corrupt, orphaned or from a newer Tono.
    UpdateEvidenceUnreadable,
    /// The installer that started the gate could not be identified or read.
    InstallerUnverifiable,
    /// Anything no other reason names.
    Unexpected,
}

impl GateReason {
    pub const fn code(self) -> &'static str {
        match self {
            Self::UpdatePending => "TONO_INSTALL_UPDATE_PENDING",
            Self::InstallerLeaseHeld => "TONO_INSTALL_INSTALLER_LEASE_HELD",
            Self::LifecycleWriterActive => "TONO_INSTALL_LIFECYCLE_WRITER_ACTIVE",
            Self::WfpUnreadable => "TONO_INSTALL_WFP_UNREADABLE",
            Self::OwnerStateUnreadable => "TONO_INSTALL_OWNER_STATE_UNREADABLE",
            Self::DnsRestoreUnproven => "TONO_INSTALL_DNS_RESTORE_UNPROVEN",
            Self::CoreRunning => "TONO_INSTALL_CORE_RUNNING",
            Self::TonoAdapterPresent => "TONO_INSTALL_TONO_ADAPTER_PRESENT",
            Self::StateDirUnusable => "TONO_INSTALL_STATE_DIR_UNUSABLE",
            Self::UpdateEvidenceUnreadable => "TONO_INSTALL_UPDATE_EVIDENCE_UNREADABLE",
            Self::InstallerUnverifiable => "TONO_INSTALL_INSTALLER_UNVERIFIABLE",
            Self::Unexpected => "TONO_INSTALL_UNEXPECTED",
        }
    }

    pub const fn exit_code(self) -> i32 {
        match self {
            Self::UpdatePending => 80,
            Self::InstallerLeaseHeld => 81,
            Self::LifecycleWriterActive => 82,
            Self::WfpUnreadable => 83,
            Self::OwnerStateUnreadable => 84,
            Self::DnsRestoreUnproven => 85,
            Self::CoreRunning => 86,
            Self::TonoAdapterPresent => 87,
            Self::StateDirUnusable => 88,
            Self::UpdateEvidenceUnreadable => 89,
            Self::InstallerUnverifiable => 90,
            Self::Unexpected => 91,
        }
    }
}

/// Context marker naming why a gate refused: `result.context(GateRefusal(reason))`. It reads as
/// the code in the error chain, so the log line starts with it.
#[derive(Debug, Clone, Copy)]
pub struct GateRefusal(pub GateReason);

impl std::fmt::Display for GateRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0.code())
    }
}

impl std::error::Error for GateRefusal {}

/// A refusal with its cause and a plain description.
pub fn refusal(reason: GateReason, message: impl std::fmt::Display) -> Error {
    anyhow::anyhow!("{message}").context(GateRefusal(reason))
}

/// The cause a gate error names; [`GateReason::Unexpected`] when none does.
pub fn reason_of(error: &Error) -> GateReason {
    error
        .downcast_ref::<GateRefusal>()
        .map_or(GateReason::Unexpected, |refusal| refusal.0)
}

const LOG_NAME: &str = "install-gate.log";
/// Past this size the log is rolled once to `install-gate.log.1`, so it stays bounded.
const LOG_MAX_BYTES: u64 = 256 * 1024;
/// The dialog shows one line of detail; the log keeps the whole chain.
const REASON_MAX_CHARS: usize = 480;

/// Where one gate run reports: the install-gate log and, when NSIS asked for one, the reason
/// file it reads back for its dialog (the error's first line and the log that holds the rest).
#[derive(Debug, Clone)]
pub struct GateReport {
    /// `%ProgramData%\Tono\logs\install-gate.log`, or `None` when the state root is unusable.
    pub log: Option<PathBuf>,
    /// This account's temp directory, used only when the primary log cannot be written.
    pub fallback_log: PathBuf,
    pub reason_file: Option<PathBuf>,
}

impl GateReport {
    pub fn for_machine(reason_file: Option<PathBuf>) -> Self {
        let root = crate::service_paths().persistent_state_dir().to_path_buf();
        // Like the Service's own log: `logs` is created only below a state root that carries
        // the private SYSTEM/Administrators DACL, so it inherits that DACL. An unusable root
        // (perhaps the very refusal being reported) sends the log to the fallback instead.
        let log = super::super::windows_security::ensure_private_installer_directory(&root)
            .ok()
            .map(|()| root.join("logs").join(LOG_NAME));
        Self {
            log,
            fallback_log: std::env::temp_dir().join(LOG_NAME),
            reason_file,
        }
    }

    /// Append one timestamped entry; returns the log that holds it. Never fails the caller: a
    /// diagnostic must not change the gate's answer.
    pub fn record(&self, mode: &str, exit: i32, code: &str, chain: &str) -> Option<PathBuf> {
        let entry = format!(
            "{} pid={} {mode} exit={exit} {code}{}{}\r\n",
            utc_timestamp(),
            std::process::id(),
            if chain.is_empty() { "" } else { " " },
            chain.replace(['\r', '\n'], " "),
        );
        for path in self.log.iter().chain(std::iter::once(&self.fallback_log)) {
            match append_entry(path, &entry) {
                Ok(()) => return Some(path.clone()),
                Err(error) => {
                    eprintln!("tono-install: install-gate log {path:?} not written ({error:#})")
                }
            }
        }
        None
    }

    /// Hand NSIS the first line of the refusal and where the log is. UTF-16LE, no BOM, one
    /// value per CRLF-terminated line (`FileReadUTF16LE`).
    pub fn write_reason(&self, detail: &str, log: Option<&Path>) {
        let Some(path) = &self.reason_file else {
            return;
        };
        let detail: String = detail
            .replace(['\r', '\n'], " ")
            .chars()
            .take(REASON_MAX_CHARS)
            .collect();
        let log = log.map_or_else(
            || "(the install-gate log could not be written)".to_owned(),
            |log| log.display().to_string(),
        );
        let text = format!("{detail}\r\n{log}\r\n");
        let bytes: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        // A fresh name in the installer's own plug-ins directory: never follow or reuse one.
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .and_then(|mut file| file.write_all(&bytes));
        if let Err(error) = written {
            eprintln!("tono-install: installer reason file {path:?} not written ({error})");
        }
    }
}

/// Append to a plain, single-link file: a privileged writer never follows a link or writes
/// through a hard link someone else planted.
fn append_entry(path: &Path, entry: &str) -> Result<()> {
    let parent = path.parent().context("log path has no parent")?;
    std::fs::create_dir_all(parent)?;
    if std::fs::symlink_metadata(path).is_ok_and(|meta| meta.len() > LOG_MAX_BYTES) {
        std::fs::rename(path, path.with_extension("log.1"))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `file` is an open handle and `information` a valid out-pointer.
    let read = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) };
    ensure!(read != 0, "log file information unavailable");
    ensure!(
        information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
            == 0
            && information.nNumberOfLinks == 1,
        "log path is not a plain single-link file"
    );
    file.write_all(entry.as_bytes())?;
    Ok(())
}

/// `YYYY-MM-DDTHH:MM:SSZ` from the system clock, without a date crate.
fn utc_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}
