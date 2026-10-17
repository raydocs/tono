//! Three-tier grants are derived from the admitted graph, never from App endpoint requests.
use super::*;
use sha2::{Digest, Sha256};

pub(crate) fn strict_runtime_digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub(crate) async fn admit_strict_start(
    runtime: &crate::RuntimeBundle,
    token: &str,
    protected: bool,
) -> Result<Option<StrictContract>> {
    let value: serde_json::Value = match serde_json::from_str(&runtime.yaml) {
        Ok(value) => value,
        Err(_) => return Ok(None), // ordinary YAML follows the stable admission path
    };
    if !crate::three_tier::is_three_tier_runtime(&value) {
        return Ok(None);
    }
    if !protected || !crate::core::structure::is_sing_box_core_path(&runtime.core_path) {
        bail!("three-tier requires sing-box and Windows protection");
    }
    crate::core::sing_box_runtime::admit_strict_runtime(&runtime.yaml)
        .map_err(anyhow::Error::msg)?;
    let interface = value["outbounds"].as_array().context("missing outbounds")?
        .iter().find(|outbound| outbound["type"] == "direct")
        .and_then(|outbound| outbound["bind_interface"].as_str())
        .context("three-tier physical interface missing")?.to_owned();
    prove_strict_interface(&interface).await?;
    let exit_endpoints = value["outbounds"].as_array().context("missing outbounds")?
        .iter().filter(|outbound| matches!(outbound["type"].as_str(), Some("vless" | "hysteria2")))
        .map(|outbound| {
            let ip = outbound["server"].as_str().context("strict exit needs literal IPv4")?;
            let address: Ipv4Addr = ip.parse().context("strict exit needs literal IPv4")?;
            let port = outbound["server_port"].as_u64().and_then(|port| u16::try_from(port).ok())
                .filter(|port| *port > 0).context("invalid strict exit port")?;
            if outbound["type"] != "vless" || !is_public_direct_ipv4(address) {
                bail!("initial three-tier exit must be public IPv4 VLESS/TCP");
            }
            Ok(ProxyEndpoint { ip: ip.to_owned(), port, protocol: crate::ProxyProtocol::Tcp })
        }).collect::<Result<Vec<_>>>()?;
    if exit_endpoints.is_empty() { bail!("strict graph has no cloud exit"); }
    Ok(Some(StrictContract {
        runtime_sha256: strict_runtime_digest(&runtime.yaml),
        config_path: None,
        session_token_hash: crate::core::auth::hash_session_token(token)?,
        generation: None,
        release_generation: 0, // Set from the Service's admitted authority, never the App hint.
        physical_interface: interface,
        exit_endpoints,
    }))
}

async fn prove_strict_interface(interface: &str) -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let interface = interface.to_owned();
        engine_call("strict physical interface admission", move || {
            crate::core::wfp::validate_physical_interface(&interface)
        }).await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        if interface.is_empty() || interface.eq_ignore_ascii_case("Tono") {
            bail!("strict interface is not physical");
        }
        Ok(())
    }
}

pub(crate) async fn bind_strict_session(active: &crate::core::desired::ActiveOwnerState) -> Result<()> {
    let _operation = WFP_OPERATION.lock().await;
    let Some(mut armed) = armed_guard().clone() else { return Ok(()); };
    let Some(contract) = armed.intent.strict_contract.as_mut() else { return Ok(()); };
    if armed.intent.owner_key.as_deref() != Some(active.owner_key.as_str())
        || contract.session_token_hash != active.session_token_hash
        || contract.generation.is_some()
    {
        bail!("three-tier owner/session contract changed during start");
    }
    contract.generation = Some(active.generation);
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    *armed_guard() = Some(armed);
    Ok(())
}

/// Called before granting a tunnel/DIRECT capability. Restored contracts have no generation:
/// a restart keeps the permanent floor but never restores old broad permits.
pub(super) async fn prove_strict_session(armed: &Armed) -> Result<()> {
    if !armed.intent.strict_kill_switch { return Ok(()); }
    let contract = armed.intent.strict_contract.as_ref().context("strict session has no contract")?;
    let active = crate::core::desired::load_active_owner().await?
        .context("strict session has no active owner")?;
    if contract.generation != Some(active.generation)
        || contract.session_token_hash != active.session_token_hash
        || armed.intent.owner_key.as_deref() != Some(active.owner_key.as_str())
    {
        bail!("strict session generation/token/owner mismatch");
    }
    crate::core::release::check_release_generation(Some(contract.release_generation)).await
        .map_err(|error| anyhow::anyhow!("strict release generation changed: {error:?}"))?;
    // Read the Service-derived path, not an App path or the mutable manager snapshot.
    // Never acquire CORE_MANAGER under WFP_OPERATION (stop owns the opposite lock order).
    let document = tokio::fs::read_to_string(contract.config_path.as_ref().context("strict runtime has no staged path")?).await?;
    if strict_runtime_digest(&document) != contract.runtime_sha256 {
        bail!("strict runtime digest changed; explicit disconnect is required");
    }
    crate::core::sing_box_runtime::admit_strict_runtime(&document).map_err(anyhow::Error::msg)?;
    prove_strict_interface(&contract.physical_interface).await
}

pub(crate) fn refuse_strict_mutation() -> Result<()> {
    if strict_kill_switch_enabled() {
        bail!("three-tier session is immutable; explicitly disconnect before changing runtime or mode");
    }
    Ok(())
}
