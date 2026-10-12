//! Bounded, redacted Mihomo controller error detail.

use super::*;

/// Controller failures are useful only when they remain bounded and safe to persist in the
/// connect progress/audit trail. Mihomo's local API normally returns a tiny JSON error; cap the
/// extracted message in case that shape changes.
pub(super) const CONTROLLER_ERROR_DETAIL_LIMIT: usize = 384;

/// Extract the human-readable part of a Mihomo controller error without carrying credentials,
/// query strings, arbitrary control characters, or an unbounded response into logs/UI state.
pub fn controller_error_detail(body: &str) -> Option<String> {
    const MAX_JSON_INPUT: usize = 4 * 1024;
    let json_detail = (body.len() <= MAX_JSON_INPUT)
        .then(|| serde_json::from_str::<serde_json::Value>(body).ok())
        .flatten()
        .and_then(|value| {
            ["message", "error", "detail"]
                .into_iter()
                .find_map(|key| value.get(key).and_then(serde_json::Value::as_str).map(str::to_owned))
        });
    let source = json_detail.as_deref().unwrap_or(body);

    let mut normalized = String::with_capacity(CONTROLLER_ERROR_DETAIL_LIMIT.min(source.len()));
    let mut pending_space = false;
    let mut truncated = false;
    for character in source.chars() {
        if character.is_whitespace() || character.is_control() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            if normalized.chars().count() >= CONTROLLER_ERROR_DETAIL_LIMIT {
                truncated = true;
                break;
            }
            normalized.push(' ');
            pending_space = false;
        }
        if normalized.chars().count() >= CONTROLLER_ERROR_DETAIL_LIMIT {
            truncated = true;
            break;
        }
        normalized.push(character);
    }
    let mut normalized = audit::redact(normalized.trim());
    if normalized.is_empty() {
        return None;
    }
    if truncated {
        normalized.push('…');
    }
    Some(normalized)
}
