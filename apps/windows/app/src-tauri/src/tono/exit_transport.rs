//! Explicit first-hop selection, not a second connection/retry owner.
//! TCP stays the default. Changing the carrier requires a fully released session.

use super::{
    commands,
    state::{TonoInner, TonoState},
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tono_core::node::ExitTransport;

const FILE: &str = "exit-transport.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preference {
    transport: ExitTransport,
}

pub(super) fn load(dir: &Path) -> ExitTransport {
    let path = dir.join(FILE);
    if std::fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 256) {
        return ExitTransport::default();
    }
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Preference>(&bytes).ok())
        .map(|preference| preference.transport)
        .unwrap_or_default()
}

fn save(dir: &Path, transport: ExitTransport) -> Result<(), String> {
    let body = serde_json::to_vec(&Preference { transport })
        .map_err(|_| "could not serialize transport preference".to_string())?;
    // Do not forward filesystem paths into frontend error strings.
    super::state::write_private_file(&dir.join(FILE), &body)
        .map_err(|_| "could not save transport preference".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportSetting {
    selected: ExitTransport,
    udp_available: bool,
    change_allowed: bool,
}

fn setting_of(inner: &TonoInner) -> TransportSetting {
    let status = inner.fsm.status();
    TransportSetting {
        selected: inner.exit_transport,
        udp_available: inner
            .nodes
            .iter()
            .any(|node| Some(&node.name) == inner.selected_node.as_ref() && node.hysteria2.is_some()),
        change_allowed: change_allowed(
            status.is_connected,
            status.is_connecting,
            status.is_disconnecting,
            inner.fsm.kill_switch_armed(),
        ),
    }
}

fn change_allowed(connected: bool, connecting: bool, disconnecting: bool, armed: bool) -> bool {
    !connected && !connecting && !disconnecting && !armed
}

pub(super) fn applied_matches(inner: &TonoInner) -> bool {
    snapshot_matches(
        inner.applied_exit_transport,
        inner.exit_transport,
        inner.last_admitted_node.as_deref(),
        &inner.applied_nodes,
        &inner.nodes,
    )
}

fn snapshot_matches(
    applied_transport: Option<ExitTransport>,
    requested: ExitTransport,
    admitted: Option<&str>,
    applied_nodes: &[tono_core::ValidatedNode],
    current_nodes: &[tono_core::ValidatedNode],
) -> bool {
    if applied_transport != Some(requested) {
        return false;
    }
    // During a hot switch selected_node is the pending target; last_admitted_node
    // remains the actual selector owner until the endpoint transaction commits.
    let Some(name) = admitted else {
        return false;
    };
    match (
        applied_nodes.iter().find(|node| node.name == name),
        current_nodes.iter().find(|node| node.name == name),
    ) {
        (Some(applied), Some(current)) => applied.same_transport_endpoint(current, requested),
        _ => false,
    }
}

#[tauri::command]
pub async fn tono_exit_transport(state: tauri::State<'_, Arc<TonoState>>) -> Result<TransportSetting, String> {
    Ok(setting_of(&*state.lock().await))
}

#[tauri::command]
pub async fn tono_set_exit_transport(
    state: tauri::State<'_, Arc<TonoState>>,
    app: tauri::AppHandle,
    transport: ExitTransport,
) -> Result<TransportSetting, String> {
    if state.release_in_progress().await {
        return Err("wait for network protection release before changing transport".to_string());
    }
    let mut inner = state.lock().await;
    let setting = setting_of(&inner);
    if transport == setting.selected {
        return Ok(setting);
    }
    if !setting.change_allowed {
        return Err("disconnect and release protection before changing transport".to_string());
    }
    if transport == ExitTransport::Hysteria2Udp && !setting.udp_available {
        return Err(tono_core::NodeRejection::TransportUnavailable.to_string());
    }
    save(&inner.catalog_dir, transport)?;
    // Retire even a guard snapshot that has not yet latched Connecting. No live
    // session is mutated; the ordinary connect transaction owns the next start.
    inner.invalidate_connection(false);
    inner.cancel_server_tests();
    inner.exit_transport = transport;
    inner.applied_exit_transport = None;
    inner.applied_nodes.clear();
    inner.last_admitted_node = None;
    commands::emit_status(&app, &commands::status_of(&inner));
    Ok(setting_of(&inner))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_transport_change_can_overlap_a_protected_session_or_transition() {
        for mask in 0_u8..16 {
            assert_eq!(
                change_allowed(mask & 1 != 0, mask & 2 != 0, mask & 4 != 0, mask & 8 != 0),
                mask == 0
            );
        }
    }

    #[test]
    fn preference_defaults_to_tcp_and_roundtrips_without_catalog_or_credentials() {
        let dir = std::env::temp_dir().join(format!(
            "tono-transport-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(load(&dir), ExitTransport::RealityTcp);
        save(&dir, ExitTransport::Hysteria2Udp).unwrap();
        assert_eq!(load(&dir), ExitTransport::Hysteria2Udp);
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join(FILE)).unwrap()).unwrap();
        assert_eq!(value, serde_json::json!({"transport": "hysteria2Udp"}));
        std::fs::write(dir.join(FILE), b"{\"transport\":\"auto\"}").unwrap();
        assert_eq!(load(&dir), ExitTransport::RealityTcp);
        std::fs::write(dir.join(FILE), vec![b' '; 257]).unwrap();
        assert_eq!(load(&dir), ExitTransport::RealityTcp);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn downloaded_or_stale_carrier_is_never_accepted_as_the_applied_graph() {
        let value = serde_yaml_ng::from_str(
            r#"
name: Synthetic
type: vless
server: 8.8.8.8
port: 443
uuid: 00000000-0000-4000-8000-000000000001
tls: true
servername: www.example.com
reality-opts:
  public-key: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  short-id: ab
tono-hysteria2:
  port: 8443
  password: synthetic-auth
  sni: udp.example.com
"#,
        )
        .unwrap();
        let nodes = vec![tono_core::node::admit_node(&value).unwrap()];
        let udp = ExitTransport::Hysteria2Udp;
        assert!(snapshot_matches(Some(udp), udp, Some("Synthetic"), &nodes, &nodes));
        assert!(!snapshot_matches(None, udp, Some("Synthetic"), &nodes, &nodes));
        assert!(!snapshot_matches(
            Some(ExitTransport::RealityTcp),
            udp,
            Some("Synthetic"),
            &nodes,
            &nodes
        ));
        assert!(!snapshot_matches(Some(udp), udp, None, &nodes, &nodes));
        assert!(!snapshot_matches(Some(udp), udp, Some("Synthetic"), &[], &nodes));
        let mut updated = nodes.clone();
        updated[0].hysteria2 = None;
        assert!(!snapshot_matches(Some(udp), udp, Some("Synthetic"), &nodes, &updated));
        let tcp = ExitTransport::RealityTcp;
        assert!(snapshot_matches(Some(tcp), tcp, Some("Synthetic"), &nodes, &updated));
    }
}
