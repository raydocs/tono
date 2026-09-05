// Exercise the production classifier/filesystem tests without the native GUI.
// Windows runs this module in the app crate with its registry dependencies.
#[cfg(not(windows))]
#[path = "../../../app/src-tauri/src/tono/browser_dns.rs"]
mod browser_dns;
