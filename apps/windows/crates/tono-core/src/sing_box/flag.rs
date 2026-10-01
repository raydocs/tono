//! Per-device core preference.
//!
//! Missing, corrupt, foreign, or empty-device records stay on sing-box.
//! Mihomo is selected only by an explicit record for this exact device:
//! schema 2 `core: "mihomo"`, or schema 1 `sing_box_core: false`.

use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreferredCore {
    SingBox,
    Mihomo,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Schema1 {
    schema: u32,
    device_id: String,
    sing_box_core: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Schema2 {
    schema: u32,
    device_id: String,
    core: String,
}

/// sing-box unless this device explicitly asked for mihomo.
pub fn preferred_core(path: &Path, device_id: &str) -> PreferredCore {
    if device_id.is_empty() {
        return PreferredCore::SingBox;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return PreferredCore::SingBox;
    };
    if let Ok(record) = serde_json::from_str::<Schema2>(&text)
        && record.schema == 2
        && record.device_id == device_id
        && record.core == "mihomo"
    {
        return PreferredCore::Mihomo;
    }
    if let Ok(record) = serde_json::from_str::<Schema1>(&text)
        && record.schema == 1
        && record.device_id == device_id
        && !record.sing_box_core
    {
        return PreferredCore::Mihomo;
    }
    PreferredCore::SingBox
}

/// True when [`preferred_core`] is sing-box. The connect path reads this.
pub fn enabled_for(path: &Path, device_id: &str) -> bool {
    preferred_core(path, device_id) == PreferredCore::SingBox
}

/// sing-box `/delay` may run only after the data plane is already proven.
pub fn controller_delay_allowed(sing_box_selected: bool, data_plane_proven: bool) -> bool {
    !sing_box_selected || data_plane_proven
}

#[cfg(test)]
mod tests {
    use super::{PreferredCore, controller_delay_allowed, enabled_for, preferred_core};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tono-singbox-flag-{nanos}-{name}"));
        fs::create_dir_all(&dir).unwrap();
        dir.join("flag.json")
    }

    #[test]
    fn missing_file_selects_sing_box() {
        let file = path("missing");
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::SingBox);
        assert!(enabled_for(&file, "device-a"));
        assert_eq!(preferred_core(&file, ""), PreferredCore::SingBox);
    }

    #[test]
    fn explicit_mihomo_is_per_device_and_corrupt_stays_sing_box() {
        let file = path("record");
        fs::write(
            &file,
            r#"{"schema":2,"device_id":"device-a","core":"mihomo"}"#,
        )
        .unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::Mihomo);
        assert!(!enabled_for(&file, "device-a"));
        assert_eq!(preferred_core(&file, "device-b"), PreferredCore::SingBox);
        assert_eq!(preferred_core(&file, ""), PreferredCore::SingBox);
        fs::write(
            &file,
            r#"{"schema":1,"device_id":"device-a","sing_box_core":false}"#,
        )
        .unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::Mihomo);
        fs::write(
            &file,
            r#"{"schema":1,"device_id":"device-a","sing_box_core":true}"#,
        )
        .unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::SingBox);
        fs::write(
            &file,
            r#"{"schema":2,"device_id":"device-a","core":"sing-box"}"#,
        )
        .unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::SingBox);
        fs::write(&file, "{not-json").unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::SingBox);
        fs::write(
            &file,
            r#"{"schema":2,"device_id":"device-a","core":"mihomo","extra":1}"#,
        )
        .unwrap();
        assert_eq!(preferred_core(&file, "device-a"), PreferredCore::SingBox);
    }

    #[test]
    fn sing_box_delay_waits_for_the_data_plane() {
        assert!(controller_delay_allowed(false, false));
        assert!(!controller_delay_allowed(true, false));
        assert!(controller_delay_allowed(true, true));
    }
}
