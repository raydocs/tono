//! Physical interface detection and the non-critical redacted runtime copy.

use std::sync::Arc;
use std::time::Duration;
use tono_logging::{Type, logging};
use crate::tono::state::TonoState;

/// One absolute budget covers service readiness, the cold Core start, controller/DNS
/// verification, fail-closed cloud-policy hot reload, locking, and the post-lock verification
/// group. Per-stage retries never reset this clock.
///
/// The redacted runtime copy is a diagnostics convenience, but it lands under `%APPDATA%`,
/// which enterprise policy can redirect to a UNC share or a sync-provider placeholder folder.
/// `OpenOptions::open`/`write_all` then have no timeout of their own, so an offline share can
/// park the write for minutes. Bound it well under the transaction budget: a diagnostics file
/// must never be the reason a connect spends its clock.
pub(super) const REDACTED_COPY_WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// The physical interface carrying the default route. Windows uses
/// `GetBestRoute2` (runtime-unverified here; covered by the xwin check and
/// on-device smoke); other dev machines parse `route get default`.
pub(super) async fn detect_physical_interface() -> Result<String, String> {
    #[cfg(windows)]
    {
        // GetBestRoute2/GetIfEntry2 are synchronous OS calls. Keep them off the Tauri async
        // workers so a slow IP helper stack cannot starve UI / status / release tasks.
        tokio::task::spawn_blocking(detect_physical_interface_windows)
            .await
            .map_err(|error| format!("physical interface discovery worker failed: {error}"))?
    }
    #[cfg(not(windows))]
    {
        detect_physical_interface_route_command().await
    }
}

/// macOS/Linux dev path: parse `interface: en0` out of `route get default`.
#[cfg(not(windows))]
pub(super) async fn detect_physical_interface_route_command() -> Result<String, String> {
    let output = tokio::process::Command::new("route")
        .args(["get", "default"])
        .output()
        .await
        .map_err(|err| format!("route get default failed: {err}"))?;
    if !output.status.success() {
        return Err("route get default returned an error".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(interface) = line.trim().strip_prefix("interface:") {
            let interface = interface.trim();
            if !interface.is_empty() {
                return Ok(interface.to_string());
            }
        }
    }
    Err("no default route interface found".to_string())
}

/// Windows path: `GetBestRoute2` for a public destination, then `GetIfEntry2` for the interface
/// alias (`"Ethernet 2"`, `"以太网"`, etc.). This runs before WinTUN starts, so the best route
/// cannot resolve back to Tono. The Service deliberately resolves aliases to LUIDs as well; using
/// `ConvertInterfaceLuidToNameW` here would produce the adapter's internal name and recreate the
/// alias/name mismatch behind Windows error 123. VMware/VirtualBox/Hyper-V host adapters are
/// deliberately not acceptable physical uplinks: they remain enabled for the customer's VMs,
/// but Tono's optional DIRECT outbounds must bind to a real hardware interface.
#[cfg(windows)]
pub(super) fn detect_physical_interface_windows() -> Result<String, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetBestRoute2, GetIfEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
        IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL, MIB_IF_ROW2, MIB_IF_TYPE_LOOPBACK,
        MIB_IPFORWARD_ROW2,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, IN_ADDR, SOCKADDR_INET};

    // 8.8.8.8 — byte-symmetric, so the S_addr value needs no byte swapping.
    let mut destination = SOCKADDR_INET::default();
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr = IN_ADDR {
        S_un: windows_sys::Win32::Networking::WinSock::IN_ADDR_0 { S_addr: 0x0808_0808 },
    };

    let mut best_route = MIB_IPFORWARD_ROW2::default();
    let mut best_source = SOCKADDR_INET::default();
    let status = unsafe {
        GetBestRoute2(
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            &destination,
            0,
            &mut best_route,
            &mut best_source,
        )
    };
    if status != 0 {
        return Err(format!("GetBestRoute2 failed: {status}"));
    }

    let best_luid = unsafe { best_route.InterfaceLuid.Value };
    let mut candidates = vec![best_luid];
    for luid in default_route_interface_luids()? {
        if !candidates.contains(&luid) {
            candidates.push(luid);
        }
    }

    let mut rejected = Vec::new();
    for luid in candidates {
        let mut interface = MIB_IF_ROW2 {
            InterfaceLuid: windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH {
                Value: luid,
            },
            ..Default::default()
        };
        // SAFETY: `interface` is initialized and the LUID came from IP Helper.
        let status = unsafe { GetIfEntry2(&mut interface) };
        if status != 0 {
            rejected.push(format!("LUID {luid}: GetIfEntry2 failed ({status})"));
            continue;
        }
        let description = utf16_field(&interface.Description);
        let alias = utf16_field(&interface.Alias);
        if alias.is_empty() {
            rejected.push(format!("LUID {luid}: empty interface alias"));
            continue;
        }
        let hardware = interface.InterfaceAndOperStatusFlags._bitfield & 0x01 != 0;
        let known_hardware_type = matches!(interface.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211);
        let virtual_description = is_virtual_uplink_description(&description);
        let forbidden_type = matches!(
            interface.Type,
            MIB_IF_TYPE_LOOPBACK | IF_TYPE_PROP_VIRTUAL | IF_TYPE_TUNNEL
        );
        if virtual_description || forbidden_type || (!hardware && !known_hardware_type) {
            rejected.push(format!(
                "{alias:?} ({description:?}, type {}, hardware={hardware})",
                interface.Type
            ));
            continue;
        }
        return Ok(alias);
    }

    Err(format!(
        "no usable hardware uplink found; rejected candidates: {}",
        if rejected.is_empty() {
            "none".to_string()
        } else {
            rejected.join("; ")
        }
    ))
}

/// The route chosen by Windows can point at a host-only/NAT adapter even while a real
/// Ethernet/Wi-Fi default route is available. Return all IPv4 default-route interfaces in
/// metric order so the caller can reject virtual adapters without disabling them.
#[cfg(windows)]
pub(super) fn default_route_interface_luids() -> Result<Vec<u64>, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_TABLE2,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;

    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: IP Helper allocates the table and writes its address to `table`.
    let status = unsafe { GetIpForwardTable2(AF_INET, &mut table) };
    if status != 0 {
        return Err(format!("GetIpForwardTable2 failed: {status}"));
    }
    if table.is_null() {
        return Err("GetIpForwardTable2 returned a null table".to_string());
    }

    // SAFETY: a successful table contains `NumEntries` rows in the trailing `Table` array;
    // the allocation remains alive until FreeMibTable below.
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let mut routes: Vec<(u32, u64)> = rows
        .iter()
        .filter(|row| row.DestinationPrefix.PrefixLength == 0 && !row.Loopback)
        .map(|row| (row.Metric, unsafe { row.InterfaceLuid.Value }))
        .collect();
    // SAFETY: `table` was returned by GetIpForwardTable2 and is released exactly once.
    unsafe { FreeMibTable(table.cast()) };
    routes.sort_unstable_by_key(|(metric, _)| *metric);
    let mut luids = Vec::with_capacity(routes.len());
    for (_, luid) in routes {
        if !luids.contains(&luid) {
            luids.push(luid);
        }
    }
    Ok(luids)
}

#[cfg(windows)]
pub(super) fn utf16_field(field: &[u16]) -> String {
    let end = field.iter().position(|ch| *ch == 0).unwrap_or(field.len());
    String::from_utf16_lossy(&field[..end])
}

/// Adapter descriptions are diagnostic input, not a security identity. This filter is only
/// used to choose a physical interface for optional DIRECT outbounds; it never disables or
/// removes the matching adapter. Tono's Wintun adapter is included so it cannot become the
/// physical DIRECT interface during a race with route installation.
pub(super) fn is_virtual_uplink_description(description: &str) -> bool {
    const MARKERS: &[&str] = &[
        "vmware",
        "vmnet",
        "virtualbox",
        "vboxnet",
        "hyper-v",
        "hyperv",
        "vethernet",
        "wintun",
        "tono",
        "wsl",
        "docker",
        "loopback",
        "tap-windows",
    ];
    let lowered = description.to_lowercase();
    MARKERS.iter().any(|marker| lowered.contains(marker))
}

/// Open the redacted copy with the per-user DACL the rest of Tono's private files get.
///
/// It was the one file in the set written through plain `OpenOptions`, so it inherited whatever
/// the parent directory grants while `selection.json` and the owner token did not — and it is
/// the file that describes the selected node. A copy left by an earlier build fails the
/// private-file validation on its inherited ACL; replacing it once is how those converge.
#[cfg(windows)]
pub(super) fn open_private_redacted_copy(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let open = || crate::core::owner_identity::open_or_create_private_current_user_file(path);
    let file = match open() {
        Ok(file) => file,
        Err(error) => {
            if !path.exists() {
                // Nothing to converge — the create itself failed, so report that.
                return Err(std::io::Error::other(error));
            }
            std::fs::remove_file(path)?;
            open().map_err(std::io::Error::other)?
        }
    };
    // The helper opens without truncating; this file is always rewritten whole.
    file.set_len(0)?;
    Ok(file)
}

/// Persist the redacted runtime copy (§5: the secret never touches disk).
///
/// Never fails the connect. The copy is a diagnostics convenience — the runtime the core
/// actually receives travels over IPC and never through this file — so refusing an otherwise
/// healthy connect because a support artefact could not be written trades availability for
/// nothing. Skipping is also the safe direction for §5: not writing cannot leak. It is loud in
/// the log instead, and the timeout is reported separately from a write error so a stalled
/// redirected AppData is diagnosable rather than looking like a permissions problem.
pub(super) async fn write_redacted_copy(state: &Arc<TonoState>, redacted: &str) {
    let path = { state.lock().await.catalog_dir.join("owned-runtime.redacted.yaml") };
    let write = tokio::task::spawn_blocking({
        let redacted = redacted.to_string();
        move || -> std::io::Result<()> {
            #[cfg(windows)]
            let mut file = open_private_redacted_copy(&path)?;
            #[cfg(not(windows))]
            let mut file = {
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create(true).truncate(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt as _;
                    options.mode(0o600);
                }
                options.open(&path)?
            };
            use std::io::Write as _;
            file.write_all(redacted.as_bytes())
        }
    });
    // Abandoning the JoinHandle cannot stop the blocking thread — a thread parked inside a UNC
    // `open` stays parked until the redirector gives up. It commits nothing the connect depends
    // on, so leaving it behind is safe; what matters is that this future returns.
    match tokio::time::timeout(REDACTED_COPY_WRITE_TIMEOUT, write).await {
        Ok(Ok(Ok(()))) => {}
        // Previously dropped on the floor: only the JoinError was reported, so a failed write
        // was silent.
        Ok(Ok(Err(err))) => logging!(warn, Type::Service, "Tono: 写入 redacted 运行时副本失败: {err}"),
        Ok(Err(err)) => logging!(warn, Type::Service, "Tono: 写入 redacted 运行时副本失败: {err}"),
        Err(_elapsed) => logging!(
            warn,
            Type::Service,
            "Tono: 写入 redacted 运行时副本超时 ({REDACTED_COPY_WRITE_TIMEOUT:?})，跳过；连接继续"
        ),
    }
}
