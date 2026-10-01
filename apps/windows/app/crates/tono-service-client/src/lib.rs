//! Typed IPC service client for the privileged Tono Service.
//!
//! Encapsulates owner session proof tracking, capability discovery, and typed
//! calls over the IPC channel.

use std::sync::Arc;
use anyhow::{Context as _, Result, bail};
use parking_lot::Mutex;
pub use tono_service_protocol::{
    DirectRuntimeReloadResult, DnsProtectionStatus, FinalizeDirectRuntimeReloadRequest,
    KillSwitchConfig, KillSwitchLockRequest, KillSwitchStatus, KillSwitchStatusMode,
    OwnerCredentials, OwnerSessionProof, ProtocolInfo, ProxyApplyOutcome,
    RenewDirectRuntimeReloadRequest, ReplaceDirectEndpointsRequest, ReplaceProxyEndpointsRequest,
    RuntimeBundle, ServiceStatusSnapshot, StageRuntimeOutcome, StartClashRequest,
    StopClashOptions,
};

/// Active session credentials and capabilities for the running Core instance.
#[derive(Debug, Clone)]
pub struct ActiveServiceSession {
    pub proof: OwnerSessionProof,
    pub supports_runtime_staging: bool,
    pub supports_macos_kill_switch: bool,
    pub supports_direct_runtime_reload: bool,
}

impl ActiveServiceSession {
    pub fn new(
        proof: OwnerSessionProof,
        supports_runtime_staging: bool,
        supports_macos_kill_switch: bool,
        supports_direct_runtime_reload: bool,
    ) -> Self {
        Self {
            proof,
            supports_runtime_staging,
            supports_macos_kill_switch,
            supports_direct_runtime_reload,
        }
    }
}

/// Thread-safe holder for the current active Service session.
#[derive(Debug, Default, Clone)]
pub struct ServiceSessionStore {
    inner: Arc<Mutex<Option<ActiveServiceSession>>>,
}

impl ServiceSessionStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set(&self, session: ActiveServiceSession) {
        *self.inner.lock() = Some(session);
    }

    pub fn clear(&self) {
        *self.inner.lock() = None;
    }

    pub fn get_proof(&self) -> Result<OwnerSessionProof> {
        self.inner
            .lock()
            .as_ref()
            .map(|s| s.proof.clone())
            .context("service owner session is not active")
    }

    pub fn get_direct_reload_proof(&self) -> Result<OwnerSessionProof> {
        let guard = self.inner.lock();
        let session = guard.as_ref().context("service owner session is not active")?;
        if !session.supports_direct_runtime_reload {
            bail!("active Tono Service session does not support fail-closed DIRECT runtime reload");
        }
        Ok(session.proof.clone())
    }

    pub fn supports_staging(&self) -> bool {
        self.inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.supports_runtime_staging)
    }

    pub fn supports_macos_kill_switch(&self) -> bool {
        self.inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.supports_macos_kill_switch)
    }
}

/// Typed client for calling Tono Service operations.
#[derive(Debug, Clone, Default)]
pub struct ServiceClient {
    sessions: ServiceSessionStore,
}

impl ServiceClient {
    pub fn new() -> Self {
        Self {
            sessions: ServiceSessionStore::new(),
        }
    }

    pub fn with_sessions(sessions: ServiceSessionStore) -> Self {
        Self { sessions }
    }

    pub fn sessions(&self) -> &ServiceSessionStore {
        &self.sessions
    }

    /// Queries the service version and protocol information.
    pub async fn get_version(&self) -> Result<Option<ProtocolInfo>> {
        let response = tono_service_protocol::get_version()
            .await
            .context("failed to query Tono Service version")?;
        if response.code == 0 {
            Ok(response.data)
        } else {
            bail!("service query returned code {}: {}", response.code, response.message);
        }
    }

    /// Queries the full service status snapshot.
    pub async fn get_status(&self, creds: &OwnerCredentials) -> Result<ServiceStatusSnapshot> {
        let response = tono_service_protocol::get_status(creds)
            .await
            .context("failed to query Tono Service status")?;
        if response.code == 0 {
            response.data.context("service returned empty status snapshot")
        } else {
            bail!("service status query returned code {}: {}", response.code, response.message);
        }
    }

    /// Starts Clash/Mihomo/sing-box with the requested bundle.
    pub async fn start_clash(
        &self,
        creds: &OwnerCredentials,
        request: &StartClashRequest,
    ) -> Result<ActiveServiceSession> {
        let response = tono_service_protocol::start_clash(creds, request)
            .await
            .context("failed to send StartClash request to Tono Service")?;
        if response.code != 0 {
            bail!("StartClash failed (code {}): {}", response.code, response.message);
        }
        let result = response.data.context("StartClash returned no session result")?;
        let proof = OwnerSessionProof {
            generation: result.session.generation,
            token: request.proposed_session_token.clone(),
        };
        let version_info = self.get_version().await.unwrap_or(None);
        let supports_staging = version_info.as_ref().is_some_and(ProtocolInfo::supports_runtime_staging);
        let supports_macos_ks = version_info.as_ref().is_some_and(ProtocolInfo::supports_macos_kill_switch_preflight);
        let supports_direct = version_info.as_ref().is_some_and(ProtocolInfo::supports_direct_runtime_reload);

        let session = ActiveServiceSession::new(proof, supports_staging, supports_macos_ks, supports_direct);
        self.sessions.set(session.clone());
        Ok(session)
    }

    /// Stops Clash/Mihomo/sing-box and optionally restores DNS or disarms PF.
    pub async fn stop_clash(
        &self,
        creds: &OwnerCredentials,
        proof: &OwnerSessionProof,
        options: Option<StopClashOptions>,
    ) -> Result<()> {
        let response = match options {
            Some(opts) => tono_service_protocol::stop_clash_with_options(creds, proof, opts).await,
            None => tono_service_protocol::stop_clash(creds, proof).await,
        }
        .context("failed to send StopClash request to Tono Service")?;
        self.sessions.clear();
        if response.code != 0 {
            bail!("StopClash failed (code {}): {}", response.code, response.message);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_session_store_lifecycle() {
        let store = ServiceSessionStore::new();
        assert_store_empty(&store);

        let proof = OwnerSessionProof {
            generation: 1,
            token: "test-token".into(),
        };
        let session = ActiveServiceSession::new(proof.clone(), true, false, true);
        store.set(session);

        assert_eq!(store.get_proof().unwrap().generation, 1);
        assert_eq!(store.get_proof().unwrap().token, "test-token");
        assert_eq!(store.get_direct_reload_proof().unwrap().generation, 1);
        assert!(store.supports_staging());
        assert!(!store.supports_macos_kill_switch());

        store.clear();
        assert!(store.get_proof().is_err());
    }

    fn assert_store_empty(store: &ServiceSessionStore) {
        assert!(store.get_proof().is_err());
        assert!(!store.supports_staging());
    }
}
