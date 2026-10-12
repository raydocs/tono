//! Client for the release service's pipe (PROPOSAL §10 v5).

use super::*;
use crate::release_wire::{
    RELEASE_CLIENT_TIMEOUT_SECONDS, RELEASE_IPC_PATH, RELEASE_ROUTE, RELEASE_STATUS_ROUTE,
    ReleaseReport, ReleaseRequest, ReleaseStatus,
};
use crate::{AuthenticatedRequest, OwnerCredentials};

/// Whether this machine has a running release service to Restore internet through.
pub fn release_service_available() -> bool {
    #[cfg(all(windows, not(feature = "test")))]
    {
        windows_identity::release_service_running()
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        false
    }
}

/// Ask the release service to restore the network, or join the restore it is running. The
/// answer comes within the service's own deadline; a lost answer is read back with
/// [`release_status`], never by sending the request again.
pub async fn request_release(
    credentials: &OwnerCredentials,
    request: &ReleaseRequest,
) -> Result<Response<ReleaseReport>> {
    let timeout = Duration::from_secs(RELEASE_CLIENT_TIMEOUT_SECONDS);
    let body = AuthenticatedRequest {
        credentials: credentials.clone(),
        payload: request.clone(),
    }
    .to_json_value()?;
    run_ipc_request(call_guard(Some(timeout)), move || async move {
        let client = connect_release(MUTATING_REQUEST_ATTEMPTS).await?;
        Ok(protected(client.post(RELEASE_ROUTE))
            .timeout(timeout)
            .json_body(&body)
            .send()
            .await?
            .json::<Response<ReleaseReport>>()?)
    })
    .await
}

pub async fn release_status(credentials: &OwnerCredentials) -> Result<Response<ReleaseStatus>> {
    let body = AuthenticatedRequest {
        credentials: credentials.clone(),
        payload: (),
    }
    .to_json_value()?;
    run_ipc_request(call_guard(Some(STATUS_TIMEOUT)), move || async move {
        let client = connect_release(READ_REQUEST_ATTEMPTS).await?;
        Ok(protected(client.get(RELEASE_STATUS_ROUTE))
            .timeout(STATUS_TIMEOUT)
            .json_body(&body)
            .send()
            .await?
            .json::<Response<ReleaseStatus>>()?)
    })
    .await
}

/// [`connect_with_max_retries`] for the release pipe, verified against `TonoRelease`.
async fn connect_release(max_retries: usize) -> Result<IpcHttpClient> {
    let mut config = { CLIENT_CONFIG.read().await.clone() }.unwrap_or_default();
    config.max_retries = max_retries;
    let client = kode_bridge::IpcHttpClient::with_config(
        RELEASE_IPC_PATH,
        ClientConfig {
            default_timeout: config.default_timeout,
            max_retries: config.max_retries,
            retry_delay: config.retry_delay,
            enable_pooling: false,
            require_windows_server_system: false,
            #[cfg(all(windows, not(feature = "test")))]
            windows_server_pid_verifier: Some(windows_identity::verify_registered_release_process_id),
            #[cfg(all(windows, feature = "test"))]
            windows_server_pid_verifier: None,
            ..Default::default()
        },
    )?;
    client
        .get(IpcCommand::Magic.as_ref())
        .header(IPC_AUTH_HEADER_KEY, IPC_AUTH_EXPECT)
        .timeout(CONNECT_PHASE_BUDGET)
        .send()
        .await
        .map_err(|error| anyhow::anyhow!("Failed to connect to the release service: {error}"))?;
    Ok(client)
}
