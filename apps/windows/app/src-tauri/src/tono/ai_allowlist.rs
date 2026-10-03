//! Allowlisted AI-service routing facts. Default off.
//!
//! A matching host becomes `claude` or `openai` and is then discarded. Nothing
//! here stores a hostname, path, or URL. Rows are uploaded only when
//! `ai_services_consent` is true, and the server deletes them after 60 days.

use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

static CONSENT: AtomicBool = AtomicBool::new(false);
static NOTES: Mutex<Vec<AiNote>> = Mutex::new(Vec::new());
const NOTE_CAP: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiNote {
    pub service: &'static str,
    pub exit_kind: &'static str,
    pub bucket_start_ms: i64,
}

pub fn set_consent(enabled: bool) {
    CONSENT.store(enabled, Ordering::Release);
    if !enabled {
        if let Ok(mut notes) = NOTES.lock() {
            notes.clear();
        }
    }
}

pub fn consent() -> bool {
    CONSENT.load(Ordering::Acquire)
}

/// `claude.ai`, `anthropic.com`, `api.anthropic.com`, `openai.com`, `chatgpt.com`
/// and their subdomains. Any other host is ignored.
pub fn classify_host(host: &str) -> Option<&'static str> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.contains('/') || host.contains('@') {
        return None;
    }
    if host == "claude.ai"
        || host.ends_with(".claude.ai")
        || host == "anthropic.com"
        || host.ends_with(".anthropic.com")
    {
        return Some("claude");
    }
    if host == "openai.com"
        || host.ends_with(".openai.com")
        || host == "chatgpt.com"
        || host.ends_with(".chatgpt.com")
    {
        return Some("openai");
    }
    None
}

pub fn exit_kind(route: &str) -> &'static str {
    match route {
        "RESIDENTIAL" => "residential",
        "DIRECT" => "direct",
        "PROXIED" => "datacenter",
        _ => "unknown",
    }
}

/// Record one allowlisted flow. The host is classified and not retained.
pub fn note(host: &str, route: &str, now_ms: i64) {
    if !consent() {
        return;
    }
    let Some(service) = classify_host(host) else {
        return;
    };
    let bucket = now_ms - now_ms.rem_euclid(300_000);
    let note = AiNote { service, exit_kind: exit_kind(route), bucket_start_ms: bucket };
    let Ok(mut notes) = NOTES.lock() else {
        return;
    };
    if notes.iter().any(|item| item == &note) {
        return;
    }
    notes.push(note);
    if notes.len() > NOTE_CAP {
        let overflow = notes.len() - NOTE_CAP;
        notes.drain(0..overflow);
    }
}

pub fn snapshot() -> Vec<AiNote> {
    NOTES.lock().map(|notes| notes.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_allowlist_is_classified_and_consent_off_stores_nothing() {
        set_consent(false);
        assert_eq!(classify_host("api.anthropic.com"), Some("claude"));
        assert_eq!(classify_host("chat.openai.com"), Some("openai"));
        assert_eq!(classify_host("example.com"), None);
        assert_eq!(classify_host("https://claude.ai/path"), None);
        note("claude.ai", "DIRECT", 1_000_000);
        assert!(snapshot().is_empty(), "consent off must not keep a routing fact");
        set_consent(true);
        note("claude.ai", "RESIDENTIAL", 1_000_000);
        let rows = snapshot();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].service, "claude");
        assert_eq!(rows[0].exit_kind, "residential");
        set_consent(false);
    }
}
