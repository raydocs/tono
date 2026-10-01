//! What to do with the network after connect recovery is exhausted.
//!
//! #706 owns this module. Windows `plan_failure` and #703's sticky heal both
//! call [`exhausted_protection_using`]. They must not grow a second match.
//!
//! An explicit strict kill switch (`permanent`) is checked first. Otherwise a
//! registered hook may release general traffic while AI-service destinations
//! stay blocked. The hook is the PF/WFP rule set from bc-3c5ccfd4. Until that
//! hook is registered and returns true, the decision is a full release to the
//! original network.
//!
//! Tests pass the hook as an argument. They must not call
//! [`register_selective_ai_block`]: that slot is process-wide and once-only.

use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExhaustedProtection {
    /// The user chose a strict kill switch. Leave that block in place.
    KeepStrictBlock,
    /// Put the machine back on the network it had before this attempt.
    ReleaseOriginalNetwork,
    /// General traffic is released. AI-service traffic stays blocked.
    /// The hook already rewrote the filters. Callers must not full-release.
    ReleaseGeneralKeepAi,
}

static SELECTIVE_AI_BLOCK: OnceLock<fn() -> bool> = OnceLock::new();

/// Register the selective AI-block hook once.
///
/// `engage` returns true only after it has installed rules that release
/// general traffic and keep Claude/OpenAI (and the same class of AI
/// services) from seeing the real address. Returns false if a hook is
/// already registered.
pub fn register_selective_ai_block(engage: fn() -> bool) -> bool {
    SELECTIVE_AI_BLOCK.set(engage).is_ok()
}

pub fn registered_selective_ai_block() -> Option<fn() -> bool> {
    SELECTIVE_AI_BLOCK.get().copied()
}

pub fn exhausted_protection(strict: bool) -> ExhaustedProtection {
    exhausted_protection_using(strict, registered_selective_ai_block())
}

/// `engage` is consulted only when `strict` is false. A hook that is absent
/// or returns false is today's full release.
pub fn exhausted_protection_using(
    strict: bool,
    engage: Option<fn() -> bool>,
) -> ExhaustedProtection {
    if strict {
        ExhaustedProtection::KeepStrictBlock
    } else if engage.is_some_and(|hook| hook()) {
        ExhaustedProtection::ReleaseGeneralKeepAi
    } else {
        ExhaustedProtection::ReleaseOriginalNetwork
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> bool {
        true
    }

    fn not_ready() -> bool {
        false
    }

    #[test]
    fn exhausted_protection_is_strict_then_selective_then_full_release() {
        assert_eq!(
            exhausted_protection_using(true, Some(ready)),
            ExhaustedProtection::KeepStrictBlock
        );
        assert_eq!(
            exhausted_protection_using(false, Some(ready)),
            ExhaustedProtection::ReleaseGeneralKeepAi
        );
        assert_eq!(
            exhausted_protection_using(false, Some(not_ready)),
            ExhaustedProtection::ReleaseOriginalNetwork
        );
        assert_eq!(
            exhausted_protection_using(false, None),
            ExhaustedProtection::ReleaseOriginalNetwork
        );
        assert!(registered_selective_ai_block().is_none());
    }
}
