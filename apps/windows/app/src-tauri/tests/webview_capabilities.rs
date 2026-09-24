//! The webview may only reach the core controller commands the frontend uses.
//! Controller address/secret, config reload/patch, upgrades, restarts and
//! provider updates stay on the Rust side.

use std::{fs, path::Path};

const PLUGIN: &str = "tono-plugin-core:";
const WEBVIEW_ALLOWED: &[&str] = &[
    "allow-ws-traffic",
    "allow-ws-connections",
    "allow-ws-disconnect",
    "allow-clear-all-ws-connections",
    "allow-delay-proxy-by-name",
    "allow-healthcheck-node-in-provider",
];

#[test]
fn webview_capabilities_grant_only_the_core_commands_the_frontend_uses() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut granted = Vec::new();
    for entry in fs::read_dir(&dir).expect("capabilities dir") {
        let path = entry.expect("capability entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).expect("capability file");
        let capability: serde_json::Value = serde_json::from_str(&text).expect("capability json");
        for permission in capability["permissions"].as_array().expect("permissions array") {
            let id = permission
                .as_str()
                .or_else(|| permission["identifier"].as_str())
                .expect("permission identifier");
            if let Some(command) = id.strip_prefix(PLUGIN) {
                granted.push((path.display().to_string(), command.to_owned()));
            }
        }
    }
    let outside: Vec<_> = granted
        .iter()
        .filter(|(_, command)| !WEBVIEW_ALLOWED.contains(&command.as_str()))
        .collect();
    assert!(
        outside.is_empty(),
        "webview granted core commands outside the allowlist: {outside:?}"
    );
}
