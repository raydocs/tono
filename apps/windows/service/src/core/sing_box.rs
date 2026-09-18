//! Windows sing-box control identity. A TCP connect is not process ownership.
//! The service checks the OS listener tables before publishing a spawned PID.

use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::net::{Ipv4Addr, SocketAddrV4};

pub(super) struct Control {
    pub(super) address: SocketAddrV4,
    pub(super) mixed_port: u16,
}

/// Read the service-owned JSON, never a controller-supplied `/configs` view.
/// sing-box's compatibility endpoint omits TUN configuration entirely.
pub(super) fn control(json: &str) -> Result<Control> {
    if json.len() > 8 * 1024 * 1024 {
        bail!("TONO_SINGBOX_INVALID_RUNTIME");
    }
    let value: Value =
        serde_json::from_str(json).map_err(|_| anyhow::anyhow!("TONO_SINGBOX_INVALID_RUNTIME"))?;
    let api = &value["experimental"]["clash_api"];
    let address: SocketAddrV4 = api["external_controller"]
        .as_str()
        .context("TONO_SINGBOX_MISSING_CONTROLLER")?
        .parse()
        .context("TONO_SINGBOX_INVALID_CONTROLLER")?;
    let secret = api["secret"].as_str().unwrap_or_default();
    if *address.ip() != Ipv4Addr::LOCALHOST
        || address.port() == 0
        || address.port() == 53
        || secret.len() < 32
        || !secret.bytes().all(|b| b.is_ascii_alphanumeric())
        || api.get("external_ui").is_some()
        || api.get("external_ui_download_url").is_some()
    {
        bail!("TONO_SINGBOX_INVALID_CONTROLLER");
    }
    let inbounds = value["inbounds"]
        .as_array()
        .context("TONO_SINGBOX_MISSING_INBOUNDS")?;
    let mut mixed_port = 0;
    for inbound in inbounds {
        if inbound["type"] == "mixed" {
            let port = inbound["listen_port"].as_u64().unwrap_or_default();
            if inbound["listen"] != "127.0.0.1"
                || port == 0
                || port > u16::MAX as u64
                || port == 53
                || port == u64::from(address.port())
                || mixed_port != 0
            {
                bail!("TONO_SINGBOX_INVALID_MIXED_LISTENER");
            }
            mixed_port = port as u16;
        }
    }
    Ok(Control {
        address,
        mixed_port,
    })
}

#[cfg(windows)]
pub(super) fn listener_owned(address: SocketAddrV4, pid: u32, udp: bool) -> Result<bool> {
    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCPROW_OWNER_PID, MIB_UDPROW_OWNER_PID,
        TCP_TABLE_OWNER_PID_LISTENER, UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;

    // The count header is followed by fixed-size rows; use unaligned reads rather
    // than casting Vec<u8> into an aligned Windows structure. Bound allocation and
    // handle table growth by retrying, never accepting an incomplete snapshot.
    let mut size = 0u32;
    for _ in 0..4 {
        let mut bytes = vec![0u8; size as usize];
        let ptr = if bytes.is_empty() {
            std::ptr::null_mut()
        } else {
            bytes.as_mut_ptr().cast()
        };
        let status = unsafe {
            if udp {
                GetExtendedUdpTable(ptr, &mut size, 0, AF_INET as u32, UDP_TABLE_OWNER_PID, 0)
            } else {
                GetExtendedTcpTable(
                    ptr,
                    &mut size,
                    0,
                    AF_INET as u32,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                )
            }
        };
        if status == ERROR_INSUFFICIENT_BUFFER && size <= 16 * 1024 * 1024 {
            continue;
        }
        if status != NO_ERROR || bytes.len() < 4 {
            bail!("TONO_SINGBOX_LISTENER_TABLE_UNAVAILABLE");
        }
        let count = u32::from_ne_bytes(bytes[..4].try_into()?) as usize;
        let row_size = if udp {
            std::mem::size_of::<MIB_UDPROW_OWNER_PID>()
        } else {
            std::mem::size_of::<MIB_TCPROW_OWNER_PID>()
        };
        if count > (bytes.len() - 4) / row_size {
            bail!("TONO_SINGBOX_LISTENER_TABLE_TRUNCATED");
        }
        let mut found = false;
        for row in bytes[4..4 + count * row_size].chunks_exact(row_size) {
            let (ip, port, owner) = unsafe {
                if udp {
                    let row = std::ptr::read_unaligned(row.as_ptr().cast::<MIB_UDPROW_OWNER_PID>());
                    (row.dwLocalAddr, row.dwLocalPort, row.dwOwningPid)
                } else {
                    let row = std::ptr::read_unaligned(row.as_ptr().cast::<MIB_TCPROW_OWNER_PID>());
                    (row.dwLocalAddr, row.dwLocalPort, row.dwOwningPid)
                }
            };
            if u16::from_be(port as u16) == address.port()
                && (Ipv4Addr::from(ip.to_ne_bytes()) == *address.ip() || ip == 0)
            {
                if owner != pid || ip == 0 {
                    return Ok(false);
                }
                found = true;
            }
        }
        return Ok(found);
    }
    bail!("TONO_SINGBOX_LISTENER_TABLE_UNSTABLE")
}

#[cfg(windows)]
pub(super) async fn verify_listeners(config_path: &str, expected_pid: Option<u32>) -> Result<()> {
    let pid = expected_pid.context("TONO_SINGBOX_MISSING_PID")?;
    let json = tokio::fs::read_to_string(config_path).await?;
    let control = control(&json)?;
    let dns = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 53);
    for _ in 0..60 {
        if crate::core::process::process_identity(pid)?.is_none() {
            bail!("TONO_SINGBOX_EXITED_BEFORE_READY");
        }
        if listener_owned(control.address, pid, false)?
            && listener_owned(dns, pid, false)?
            && listener_owned(dns, pid, true)?
            && (control.mixed_port == 0
                || listener_owned(
                    SocketAddrV4::new(Ipv4Addr::LOCALHOST, control.mixed_port),
                    pid,
                    false,
                )?)
        {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    bail!("TONO_SINGBOX_LISTENER_IDENTITY_UNPROVEN")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controller_admission_rejects_exposed_or_ambiguous_listeners() {
        let mut value = serde_json::json!({
            "experimental": {"clash_api": {
                "external_controller": "127.0.0.1:19381",
                "secret": "0123456789abcdef0123456789abcdef"
            }},
            "inbounds": [{"type": "mixed", "listen": "127.0.0.1", "listen_port": 19382}]
        });
        let admitted = control(&value.to_string()).unwrap();
        assert_eq!(admitted.address.port(), 19381);
        assert_eq!(admitted.mixed_port, 19382);
        value["experimental"]["clash_api"]["external_controller"] = "0.0.0.0:19381".into();
        assert!(control(&value.to_string()).is_err());
        value["experimental"]["clash_api"]["external_controller"] = "127.0.0.1:19381".into();
        value["inbounds"][0]["listen_port"] = 19381.into();
        assert!(control(&value.to_string()).is_err());
        assert!(control("mode: rule").is_err());
    }
}
