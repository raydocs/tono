//! #1258 for the sing-box processes the Service starts on its own (WIN-SINGBOX-FAKEIP-SERVICE-RESTART).
//!
//! sing-box alpha.9 keeps its fake-IP table in memory and hands addresses out from the start of
//! its range, so a process started on the range its predecessor used maps an address an app still
//! has cached to whichever name it answers first. The App moves every document it composes to the
//! next of eight slots (`tono-core` `sing_box/runtime.rs`, `fake_ipv4_range`). The Service also
//! starts documents it kept: the watchdog's restart, the desired-state replay, the restart after
//! an unrecorded stop, and the previous or requested document after a failed replacement. Each of
//! those first moves the document's fake-IP range one slot back, past any slot in `leave`. Back,
//! because the App counts forward: its next document takes the slot after the one it last
//! composed, which a forward step here would already be on.
//!
//! Only the range's text changes, and the result must parse to the kept document with that one
//! value replaced. A document whose fake-IP server is not on a slot is started as kept.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde_json::Value;
use tracing::warn;

use crate::core::structure::{ClashConfig, is_sing_box_core_path};

/// The App's pool: eight /20 slots from 198.18.128.0, slot `n` at `198.18.(128 + 16n).0/20`.
const SLOTS: usize = 8;

fn slot_range(slot: usize) -> String {
    format!("198.18.{}.0/20", 128 + 16 * slot)
}

/// The index of the document's one fake-IP server and the slot its range is.
fn fake_ip_server(document: &Value) -> Option<(usize, usize)> {
    let servers = document.get("dns")?.get("servers")?.as_array()?;
    let mut fake = servers
        .iter()
        .enumerate()
        .filter(|(_, server)| server.get("type").and_then(Value::as_str) == Some("fakeip"));
    let (index, server) = fake.next()?;
    if fake.next().is_some() {
        return None;
    }
    let range = server.get("inet4_range")?.as_str()?;
    let slot = (0..SLOTS).find(|slot| slot_range(*slot) == range)?;
    Some((index, slot))
}

fn slot_of(document: &[u8]) -> Option<usize> {
    let value: Value = serde_json::from_slice(document).ok()?;
    fake_ip_server(&value).map(|(_, slot)| slot)
}

/// `document` with its fake-IP range one slot back, skipping the slots the `leave` documents
/// ran on. `None` when the document has no fake-IP server on a slot, or when the range's text is
/// not exactly one place in the bytes.
fn move_fake_ip_slot(document: &[u8], leave: &[&[u8]]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(document).ok()?;
    let mut value: Value = serde_json::from_str(text).ok()?;
    let (index, current) = fake_ip_server(&value)?;
    let taken: Vec<usize> = leave.iter().filter_map(|other| slot_of(other)).collect();
    let slot = (1..SLOTS)
        .map(|step| (current + SLOTS - step) % SLOTS)
        .find(|slot| !taken.contains(slot))?;
    let from = format!("\"{}\"", slot_range(current));
    let to = format!("\"{}\"", slot_range(slot));
    if text.matches(from.as_str()).count() != 1 {
        return None;
    }
    let moved = text.replacen(from.as_str(), &to, 1);
    value["dns"]["servers"][index]["inet4_range"] = Value::String(slot_range(slot));
    if serde_json::from_str::<Value>(&moved).ok()? != value {
        return None;
    }
    Some(moved.into_bytes())
}

/// The bytes to start in place of a kept `document`.
pub(crate) fn retained_document(document: &[u8], leave: &[&[u8]]) -> Vec<u8> {
    move_fake_ip_slot(document, leave).unwrap_or_else(|| {
        warn!("Kept sing-box document has no fake-IP range on a slot; starting it unchanged");
        document.to_vec()
    })
}

/// The watchdog's own copy, next to `config.json`. Nothing else in the Service writes it: the IPC
/// handlers and the replay write `config.json`, and a watchdog that rewrote that file could put
/// the exited document back over one a replacement had just written there.
const RESPAWN_CONFIG_FILE_NAME: &str = "config.respawn.json";

/// Files the Service writes into a sing-box runtime generation besides `config.json`: the
/// watchdog's copy and the temporaries `sing_box_direct::write_document` stages both through.
/// A runtime asset may not claim them (`runtime_generation::assets::destination_key_for`), or a
/// staged bundle could put an unadmitted document where the watchdog starts it.
pub(crate) const SERVICE_WRITTEN_FILE_NAMES: &[&str] = &[
    RESPAWN_CONFIG_FILE_NAME,
    "config.json.sing-next",
    "config.respawn.json.sing-next",
];

fn respawn_path(config_path: &str) -> PathBuf {
    Path::new(config_path).with_file_name(RESPAWN_CONFIG_FILE_NAME)
}

/// What the watchdog's last restart ran, or nothing.
pub(crate) async fn respawned_document(config_path: &str) -> Vec<u8> {
    tokio::fs::read(respawn_path(config_path))
        .await
        .unwrap_or_default()
}

/// The document a just-started sing-box process runs, read while the starter still holds the
/// manager, so a replacement that writes `config.json` later cannot pass for it. Nothing for
/// mihomo.
pub(crate) async fn started_document(config: &ClashConfig) -> Option<Vec<u8>> {
    if !is_sing_box_core_path(&config.core_config.core_path) {
        return None;
    }
    tokio::fs::read(&config.core_config.config_path).await.ok()
}

/// The watchdog's restart of the process that ran `exited` (its file, when the start could not
/// be read): that document a slot back, admitted again, in the watchdog's own file. `exited`
/// then holds what the restart runs. A mihomo config is returned as it is.
pub(crate) async fn respawn_config(
    config: &ClashConfig,
    exited: &mut Option<Vec<u8>>,
) -> Result<ClashConfig> {
    let mut respawn = config.clone();
    if !is_sing_box_core_path(&config.core_config.core_path) {
        return Ok(respawn);
    }
    let document = match exited.as_ref() {
        Some(document) => document.clone(),
        None => tokio::fs::read(&config.core_config.config_path)
            .await
            .context("failed to read the exited sing-box config")?,
    };
    let moved = retained_document(&document, &[]);
    let text = std::str::from_utf8(&moved).context("the sing-box config is not UTF-8")?;
    crate::core::sing_box_runtime::admit_owned_runtime(text)
        .map_err(|error| anyhow::anyhow!("the restarted sing-box config is refused: {error}"))?;
    let path = respawn_path(&config.core_config.config_path);
    crate::core::sing_box_direct::write_document(&path, &moved).await?;
    respawn.core_config.config_path = path.to_string_lossy().into_owned();
    *exited = Some(moved);
    Ok(respawn)
}

/// Before a kept `config` is started again from its own file: the replay after a Service restart
/// and the restart after an unrecorded stop. The last process may have been the watchdog's, so
/// its slot is left too. A file that cannot be read is left for the start to report.
pub(crate) async fn move_kept_document(config: &ClashConfig) -> Result<()> {
    if !is_sing_box_core_path(&config.core_config.core_path) {
        return Ok(());
    }
    let path = PathBuf::from(&config.core_config.config_path);
    let Ok(document) = tokio::fs::read(&path).await else {
        return Ok(());
    };
    let respawned = respawned_document(&config.core_config.config_path).await;
    let moved = retained_document(&document, &[respawned.as_slice()]);
    if moved != document {
        crate::core::sing_box_direct::write_document(&path, &moved)
            .await
            .context("the kept sing-box config could not leave its fake-IP slot")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{retained_document, slot_of, slot_range};

    /// #1258: the watchdog restarts the document the exited process ran, and a failed
    /// replacement restores the one before it. Either new process must allocate from a slot no
    /// process it follows used, with every other byte of the kept document unchanged.
    #[test]
    fn a_service_restart_of_a_kept_document_leaves_the_exited_process_slot() {
        let kept = include_str!("../../../../../tooling/scripts/sing-box/runtime-template.json")
            .as_bytes();
        let slot = |document: &[u8]| slot_of(document).expect("a fake-IP range on a slot");

        let restarted = retained_document(kept, &[]);
        assert_ne!(slot(restarted.as_slice()), slot(kept));
        let from = format!("\"{}\"", slot_range(slot(kept)));
        let to = format!("\"{}\"", slot_range(slot(restarted.as_slice())));
        let at = kept
            .windows(from.len())
            .position(|window| window == from.as_bytes())
            .expect("the kept range");
        let end = at + from.len();
        assert_eq!(restarted.len(), kept.len());
        assert_eq!(restarted[..at], kept[..at]);
        assert_eq!(&restarted[at..end], to.as_bytes());
        assert_eq!(restarted[end..], kept[end..]);

        // The replacement that failed ran on the restarted slot; the restored document leaves it.
        let restored = retained_document(kept, &[restarted.as_slice()]);
        assert!(![slot(kept), slot(restarted.as_slice())].contains(&slot(restored.as_slice())));
    }
}
