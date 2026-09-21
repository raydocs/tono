//! Tauri-independent connection orchestration and status reporting.
//!
//! Provides core traits (`StatusSink`, `PlatformInterface`) and
//! state coordination logic decoupled from GUI presentation and window management.

use std::sync::atomic::{AtomicU64, Ordering};
use tono_core::connection::ConnectStage;

/// Sink for emitting connection progress, stage transitions, and audit events.
pub trait StatusSink: Send + Sync {
    fn advance_stage(&self, stage: ConnectStage, elapsed_ms: u64);
    fn log_audit(&self, event: &str, details: &[(&str, &str)]);
}

/// No-op implementation of `StatusSink` for headless/test environments.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopStatusSink;

impl StatusSink for NoopStatusSink {
    fn advance_stage(&self, _stage: ConnectStage, _elapsed_ms: u64) {}
    fn log_audit(&self, _event: &str, _details: &[(&str, &str)]) {}
}

/// Abstract platform interface for network and route inspection.
pub trait PlatformInterface: Send + Sync {
    fn detect_physical_interface(&self) -> impl std::future::Future<Output = Result<String, String>> + Send;
}

/// Headless/mock platform interface returning a fixed interface name.
#[derive(Debug, Clone)]
pub struct MockPlatformInterface {
    pub interface: String,
}

impl PlatformInterface for MockPlatformInterface {
    async fn detect_physical_interface(&self) -> Result<String, String> {
        Ok(self.interface.clone())
    }
}

/// Tracks connection generation, attempt IDs, and cancellation state.
#[derive(Debug, Default)]
pub struct ConnectionOrchestrator {
    generation: AtomicU64,
}

impl ConnectionOrchestrator {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn bump_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn is_generation_valid(&self, generation: u64) -> bool {
        self.current_generation() == generation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_generation_progression() {
        let orchestrator = ConnectionOrchestrator::new();
        assert_eq!(orchestrator.current_generation(), 0);
        assert!(orchestrator.is_generation_valid(0));

        let gen1 = orchestrator.bump_generation();
        assert_eq!(gen1, 1);
        assert_eq!(orchestrator.current_generation(), 1);
        assert!(!orchestrator.is_generation_valid(0));
        assert!(orchestrator.is_generation_valid(1));
    }

    #[tokio::test]
    async fn test_mock_platform_interface() {
        let platform = MockPlatformInterface {
            interface: "Ethernet0".into(),
        };
        let iface = platform.detect_physical_interface().await.unwrap();
        assert_eq!(iface, "Ethernet0");
    }
}
