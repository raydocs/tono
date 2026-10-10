//! H21-O-F7: read the adapter table for [`tono_core::other_vpn`].
//!
//! Unprivileged and read-only: one `GetIfTable2` call in the App process. It
//! changes no route, WFP filter or Service state, and it is never part of the
//! connect decision. A failed, stalled or overlapping read yields an empty
//! list, which means "no attribution", never a guess.

use std::{sync::Arc, time::Duration};

use once_cell::sync::Lazy;
use tono_core::other_vpn::NetworkAdapter;

/// A timeout cannot stop a native call; the permit stays with the blocking
/// worker so a stalled read never queues a second one behind it.
const READ_BUDGET: Duration = Duration::from_secs(2);
static READ_GATE: Lazy<Arc<tokio::sync::Semaphore>> = Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(1)));

/// Every adapter the system lists, up or not. Empty when the read is unavailable.
pub(crate) async fn adapters() -> Vec<NetworkAdapter> {
    let Ok(permit) = Arc::clone(&READ_GATE).try_acquire_owned() else {
        return Vec::new();
    };
    let read = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read_adapter_table()
    });
    match tokio::time::timeout(READ_BUDGET, read).await {
        Ok(Ok(adapters)) => adapters,
        _ => Vec::new(),
    }
}

#[cfg(windows)]
fn read_adapter_table() -> Vec<NetworkAdapter> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;

    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    // SAFETY: IP Helper allocates the table and writes its address to `table`.
    let status = unsafe { GetIfTable2(&mut table) };
    if status != 0 || table.is_null() {
        return Vec::new();
    }
    // SAFETY: a successful table holds `NumEntries` rows in the trailing `Table` array and stays
    // allocated until FreeMibTable below.
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let adapters: Vec<NetworkAdapter> = rows
        .iter()
        .map(|row| NetworkAdapter {
            alias: utf16_field(&row.Alias),
            description: utf16_field(&row.Description),
            if_type: row.Type,
            up: row.OperStatus == IfOperStatusUp,
        })
        .collect();
    // SAFETY: `table` was returned by GetIfTable2 and is released exactly once.
    unsafe { FreeMibTable(table.cast()) };
    adapters
}

#[cfg(windows)]
fn utf16_field(field: &[u16]) -> String {
    let end = field.iter().position(|ch| *ch == 0).unwrap_or(field.len());
    String::from_utf16_lossy(&field[..end])
}

/// Off Windows there is no Wintun/TAP table to read; this build only runs tests and previews.
#[cfg(not(windows))]
#[allow(clippy::missing_const_for_fn, reason = "mirrors the Windows reader's signature")]
fn read_adapter_table() -> Vec<NetworkAdapter> {
    Vec::new()
}
