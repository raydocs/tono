//! Per-device opt-in for a future sing-box core.
//!
//! Default is off. The connect path, the Service, and the installer do not
//! read this record. A missing, corrupt, or foreign record stays on mihomo,
//! which is the network the machine already has.

use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u32,
    device_id: String,
    sing_box_core: bool,
}

/// True only for schema 1, this exact device, and an explicit `true`.
pub fn enabled_for(path: &Path, device_id: &str) -> bool {
    if device_id.is_empty() {
        return false;
    }
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return false,
    };
    match serde_json::from_str::<Record>(&text) {
        Ok(record) => record.schema == 1 && record.sing_box_core && record.device_id == device_id,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::enabled_for;
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
    fn missing_file_stays_off() {
        let file = path("missing");
        assert!(!enabled_for(&file, "device-a"));
    }

    #[test]
    fn explicit_record_is_per_device_and_corrupt_stays_off() {
        let file = path("record");
        fs::write(
            &file,
            r#"{"schema":1,"device_id":"device-a","sing_box_core":true}"#,
        )
        .unwrap();
        assert!(enabled_for(&file, "device-a"));
        assert!(!enabled_for(&file, "device-b"));
        assert!(!enabled_for(&file, ""));
        fs::write(
            &file,
            r#"{"schema":1,"device_id":"device-a","sing_box_core":false}"#,
        )
        .unwrap();
        assert!(!enabled_for(&file, "device-a"));
        fs::write(
            &file,
            r#"{"schema":2,"device_id":"device-a","sing_box_core":true}"#,
        )
        .unwrap();
        assert!(!enabled_for(&file, "device-a"));
        fs::write(&file, "{not-json").unwrap();
        assert!(!enabled_for(&file, "device-a"));
        fs::write(
            &file,
            r#"{"schema":1,"device_id":"device-a","sing_box_core":true,"extra":1}"#,
        )
        .unwrap();
        assert!(!enabled_for(&file, "device-a"));
    }
}
