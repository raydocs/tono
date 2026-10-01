//! Choose the core before StartClash arms WFP.
//!
//! sing-box is the default. Mihomo runs when this device asked for it, or when
//! the sing-box image is missing or unauthenticated and protection is not armed.
//! A Service that cannot run sing-box is a refusal, not a swap.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tono_core::{
    CatalogRouting,
    config::{self, RuntimePorts, build_owned_runtime_with_ports},
    node::ValidatedNode,
    sing_box::{
        CoreChoice, CoreSelection, RuntimeInput, build_runtime, preferred_core,
        prove_sing_box_binary, resolve, sing_box_pin_from_env_or_file,
    },
};
use tono_logging::{Type, logging};
use tono_service_protocol::ProtocolInfo;

use super::failure::StageFailure;
use crate::{tono::state::TonoState, utils::dirs};

pub(super) struct PreparedCore {
    pub document: String,
    pub core_path: PathBuf,
    pub sing_box: bool,
}

pub(super) async fn prepare_owned_core(
    state: &Arc<TonoState>,
    protection_armed: bool,
    nodes: &[ValidatedNode],
    selected: &str,
    routing: Option<&CatalogRouting>,
    secret: &str,
    ports: RuntimePorts,
    mihomo_path: &Path,
) -> Result<PreparedCore, StageFailure> {
    let installation_id = state.lock().await.installation_id.clone();
    let preferred = preferred_core(&preference_path(), &installation_id);
    let binary = sing_box_binary(mihomo_path);
    let pin = sing_box_pin_from_env_or_file(&binary.with_file_name("sing-box-sha256.txt"));
    let proof = prove_sing_box_binary(&binary, pin.as_deref());
    let service_probe = probe_service_sing_box().await;
    let service_can_run = matches!(service_probe, ServiceSingBoxProbe::Supported);
    let home_proxy = routing.and_then(|routing| routing.home_proxy.as_deref());
    let home_socks5 = routing.and_then(|routing| routing.home_socks5.as_ref());
    match resolve(preferred, proof, protection_armed, service_can_run) {
        CoreSelection::Run(CoreChoice::SingBox) => {
            compile_sing_box(nodes, selected, routing, secret, ports, None, binary)
        }
        CoreSelection::Run(CoreChoice::Mihomo { automatic_fallback }) => {
            if automatic_fallback {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: sing-box image is missing or unauthenticated before WFP; starting mihomo"
                );
            }
            compile_mihomo(
                nodes,
                selected,
                secret,
                ports,
                mihomo_path,
                home_proxy,
                home_socks5,
            )
        }
        CoreSelection::ArmedRefusesFallback => Err(StageFailure::error(
            "sing-box image is missing or unauthenticated and protection is already armed",
        )),
        CoreSelection::ServiceRefusesSingBox => {
            Err(StageFailure::error(service_refusal_message(&service_probe)))
        }
    }
}

pub(super) fn sing_box_runtime_document(
    nodes: &[ValidatedNode],
    selected: &str,
    routing: &CatalogRouting,
    secret: &str,
    ports: RuntimePorts,
    plan: Option<&tono_core::config::DirectPlan>,
) -> Result<String, String> {
    let home_names: Vec<String> = config::HOME_PROCESS_NAMES
        .iter()
        .copied()
        .map(str::to_string)
        .collect();
    let home_paths = config::home_process_path_regexes();
    let direct_names: Vec<String> = config::REVIEWED_DIRECT_PROCESS_NAMES
        .iter()
        .copied()
        .map(str::to_string)
        .collect();
    let input = RuntimeInput {
        nodes,
        selected,
        controller_secret: secret,
        direct_plan: plan,
        routing,
        platform: "windows-amd64-v2",
        ports,
        required_capabilities: &[],
        home_process_names: &home_names,
        home_process_path_regexes: &home_paths,
        direct_process_names: &direct_names,
    };
    build_runtime(input)
        .map(|runtime| runtime.runtime_json().to_string())
        .map_err(|error| error.to_string())
}

fn compile_sing_box(
    nodes: &[ValidatedNode],
    selected: &str,
    routing: Option<&CatalogRouting>,
    secret: &str,
    ports: RuntimePorts,
    plan: Option<&tono_core::config::DirectPlan>,
    binary: PathBuf,
) -> Result<PreparedCore, StageFailure> {
    let routing_owned = routing.cloned().unwrap_or_default();
    let document = sing_box_runtime_document(nodes, selected, &routing_owned, secret, ports, plan)
        .map_err(StageFailure::error)?;
    Ok(PreparedCore {
        document,
        core_path: binary,
        sing_box: true,
    })
}

fn compile_mihomo(
    nodes: &[ValidatedNode],
    selected: &str,
    secret: &str,
    ports: RuntimePorts,
    mihomo_path: &Path,
    home_proxy: Option<&str>,
    home_socks5: Option<&tono_core::CatalogHomeSocks5>,
) -> Result<PreparedCore, StageFailure> {
    let runtime = build_owned_runtime_with_ports(
        nodes,
        selected,
        secret,
        None,
        home_proxy,
        home_socks5,
        ports,
    )
    .map_err(|error| StageFailure::error(error.to_string()))?;
    Ok(PreparedCore {
        document: runtime.yaml().to_string(),
        core_path: mihomo_path.to_path_buf(),
        sing_box: false,
    })
}

fn preference_path() -> PathBuf {
    dirs::app_home_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("sing-box-core.json")
}

fn sing_box_binary(mihomo: &Path) -> PathBuf {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    mihomo.with_file_name(format!("sing-box{extension}"))
}

/// What the version probe proved about running sing-box. Only an answered,
/// parsed protocol below the sing-box revision is an old Service; a failed or
/// unparsed probe proves nothing and must not send the user to reinstall.
#[derive(Debug)]
enum ServiceSingBoxProbe {
    Supported,
    TooOld,
    Unconfirmed(String),
}

async fn probe_service_sing_box() -> ServiceSingBoxProbe {
    match tono_service_protocol::get_version().await {
        Ok(response) if response.code == 0 => match response.data.as_ref() {
            Some(info) if info.supports_sing_box_core() => ServiceSingBoxProbe::Supported,
            Some(_) => ServiceSingBoxProbe::TooOld,
            None => ServiceSingBoxProbe::Unconfirmed("version probe returned no protocol".into()),
        },
        Ok(response) => ServiceSingBoxProbe::Unconfirmed(format!(
            "version probe returned {}: {}",
            response.code, response.message
        )),
        Err(error) => ServiceSingBoxProbe::Unconfirmed(format!("{error:#}")),
    }
}

/// Both refusals fail before StartClash, so neither arms or swaps anything.
fn service_refusal_message(probe: &ServiceSingBoxProbe) -> String {
    match probe {
        ServiceSingBoxProbe::Unconfirmed(detail) => format!(
            "could not confirm that the Tono Service can run sing-box ({detail}); try connecting again"
        ),
        ServiceSingBoxProbe::Supported | ServiceSingBoxProbe::TooOld => {
            "this Tono Service cannot run sing-box; install the current service before connecting"
                .to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ServiceSingBoxProbe, service_refusal_message};

    #[test]
    fn a_failed_version_probe_is_retryable_not_an_old_service() {
        let transient =
            service_refusal_message(&ServiceSingBoxProbe::Unconfirmed("pipe busy".to_string()));
        assert!(transient.contains("try connecting again"));
        assert!(!transient.contains("install the current service"));
        assert!(
            service_refusal_message(&ServiceSingBoxProbe::TooOld)
                .contains("install the current service")
        );
    }
}
