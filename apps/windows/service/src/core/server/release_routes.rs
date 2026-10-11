//! The release service's own pipe (PROPOSAL §10 v5): `POST /release` and
//! `GET /release/status`, authenticated exactly like the main Service's owner routes, and
//! nothing else. It shares no lock, runtime or state with the main Service.

use super::*;
use crate::core::auth::ipc_request_context_to_auth_context;
use crate::core::release::daemon;
use crate::release_wire::{RELEASE_IPC_PATH, RELEASE_ROUTE, RELEASE_STATUS_ROUTE, ReleaseRequest};

/// Serve the release pipe until `shutdown` resolves.
pub async fn run_release_server_until(shutdown: impl std::future::Future<Output = ()>) -> AnyResult<()> {
    let server = IpcHttpServer::with_config(
        RELEASE_IPC_PATH,
        ServerConfig {
            write_timeout: IPC_TRANSPORT_WRITE_TIMEOUT,
            ..ServerConfig::default()
        },
    )?
    .with_listener_security_descriptor(WINDOWS_CONTROL_PIPE_SDDL);
    let router = Router::new()
        .get(IpcCommand::Magic.as_ref(), |ctx| async move {
            ipc_request_context_to_auth_context(&ctx)?;
            Ok(HttpResponse::builder().text("Tunglies!").build())
        })
        .post(RELEASE_ROUTE, |ctx| async move {
            let (request, owner) =
                match authenticate_request::<AuthenticatedRequest<ReleaseRequest>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            info!(
                "Restore internet requested by owner {} (request {})",
                owner.key, request.payload.request_id
            );
            // The same owner rule as `ReleaseKillSwitch`; the worker checks it again under C.
            if let Some(reason) = crate::core::release::worker::owner_refusal(&owner.key).await {
                return service_error(ServiceError::new(
                    crate::core::structure::ServiceErrorCode::ProtectionHeldByAnotherUser,
                    format!("Restore internet refused: {reason}"),
                ));
            }
            ok_json(daemon::start_or_join(request.payload, owner.key.clone()).await)
        })
        .get(RELEASE_STATUS_ROUTE, |ctx| async move {
            let (_request, _owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            ok_json(daemon::status())
        });
    let mut server = server.router(router);
    tokio::select! {
        served = server.serve() => served?,
        () = shutdown => {}
    }
    server.shutdown();
    Ok(())
}
