//! DIRECT runtime reload leases and sing-box DIRECT transitions.

use super::*;

pub(super) fn canonical_direct_endpoints(
    armed: &Armed,
    endpoints: &[ProxyEndpoint],
) -> Result<Vec<ProxyEndpoint>> {
    let validation = KillSwitchConfig {
        tunnel_interface: armed.intent.tunnel_interface.clone(),
        proxy_endpoints: armed.intent.endpoints.clone(),
        bootstrap_api_hosts: Vec::new(),
        direct_endpoints: endpoints.to_vec(),
    };
    validate_direct_endpoints(&validation)?;
    crate::canonical_direct_endpoints(endpoints).map_err(anyhow::Error::msg)
}

fn reload_result(
    owner_generation: u64,
    reload_id: u64,
    endpoints: &[ProxyEndpoint],
) -> Result<crate::DirectRuntimeReloadResult> {
    Ok(crate::DirectRuntimeReloadResult {
        owner_generation,
        reload_id,
        endpoint_digest: crate::direct_endpoint_digest(endpoints).map_err(anyhow::Error::msg)?,
    })
}

fn next_direct_reload_id() -> u64 {
    loop {
        let id = NEXT_DIRECT_RELOAD_ID.fetch_add(1, Ordering::Relaxed);
        if id != 0 {
            return id;
        }
    }
}

fn direct_reload_matches(
    armed: &Armed,
    owner_generation: u64,
    reload_id: u64,
) -> Result<DirectReloadLease> {
    let lease = armed
        .direct_reload
        .clone()
        .context("no DIRECT runtime reload bracket is active")?;
    if lease.owner_generation != owner_generation || lease.reload_id != reload_id {
        bail!("DIRECT runtime reload bracket is stale");
    }
    Ok(lease)
}

#[derive(Debug, thiserror::Error)]
#[error("live WFP is Blocked but the DIRECT intent could not be persisted")]
pub(super) struct DirectBlockedIntentPersistenceFailure;

/// Reconcile to exact Blocked without publishing a state stricter than live WFP proved.
///
/// The Blocked intent is attempted first so a Service restart cannot revive volatile DIRECT
/// grants. The in-memory state is committed only after the WFP transaction succeeds. If BFE is
/// unavailable, the prior endpoint set remains published (because it may still be live), `live`
/// is false, and its invalid/expired lease makes the watchdog retry this exact narrowing on every
/// tick. This avoids the dangerous split-brain state "memory says empty while WFP still permits".
pub(super) async fn transition_direct_to_blocked_unlocked(
    armed: Armed,
    current_core: Option<CoreInstance>,
    next_lease: Option<DirectReloadLease>,
) -> Result<()> {
    let mut retry_state = armed.clone();
    let mut blocked = armed;
    // Protected Offline's recovery channel must include addresses learned
    // after StartClash. The HTTP client already pins them; without this
    // union WFP would still only permit the connect-time set.
    apply_learned_bootstrap_pins(&mut blocked.intent);
    blocked.direct_endpoints.clear();
    blocked.direct_reload = next_lease;
    blocked.tun_luid = None;
    blocked.core_instance = None;
    blocked.intent.mode = KillSwitchStatusMode::Blocked;
    blocked.intent.updated_at = now_unix();

    // DIRECT grants are volatile and never restored from the intent file, so narrowing live WFP
    // first is crash-safe: an older Locked intent also restores as exact Blocked. More
    // importantly, a damaged state directory must not delay the attempt to retract physical
    // permits. Serialization is captured separately for the same reason — both proofs are always
    // attempted.
    let encoded = serde_json::to_vec_pretty(&blocked.intent);
    let install = install_unlocked_for(&blocked, current_core).await;
    let persist = match encoded {
        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
        Err(error) => Err(error.into()),
    };
    if install.is_ok() {
        *armed_guard() = Some(blocked);
    } else {
        // Keep publishing the endpoint set that may still be live, but poison its lease so the
        // watchdog cannot treat the old committed deadline as authorization to retain it.
        if let Some(lease) = retry_state.direct_reload.as_mut() {
            lease.expires_at = Some(std::time::Instant::now());
        }
        *armed_guard() = Some(retry_state);
        note_verify(false);
    }
    match (install, persist) {
        (Ok(()), Ok(())) => {
            *last_error_guard() = None;
            Ok(())
        }
        (Err(error), Ok(())) => {
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error
                .context("DIRECT Blocked intent was persisted but live WFP narrowing failed; prior permits remain published until retry"))
        }
        (Ok(()), Err(error)) => {
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error.context(DirectBlockedIntentPersistenceFailure))
        }
        (Err(install), Err(persist)) => {
            let message = format!(
                "DIRECT transition could not prove live Blocked WFP ({install:#}) or persist Blocked intent ({persist:#})"
            );
            *last_error_guard() = Some(message.clone());
            bail!(message)
        }
    }
}

pub(super) fn direct_state_may_be_live(armed: &Armed) -> bool {
    !armed.direct_endpoints.is_empty() || armed.direct_reload.is_some()
}

/// The connected sing-box session is a locked tunnel with no physical DIRECT set.
pub(crate) fn sing_box_full_tunnel_is_locked() -> Result<()> {
    ensure_supported()?;
    let armed = armed_guard().clone().context("kill switch is not armed")?;
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("sing-box replacement requires a locked tunnel");
    }
    if let Some(lease) = &armed.direct_reload
        && lease.phase != DirectReloadPhase::Committed
    {
        bail!("sing-box replacement will not interrupt an in-progress DIRECT bracket");
    }
    Ok(())
}

/// Install reviewed-app permits without opening the mihomo bracket.
///
/// The lease starts Committed so the watchdog treats it as a heartbeat, not as
/// a bracket that expires into Blocked. A failed install puts the previous
/// full-tunnel set back. If that cannot be proved, the caller stops Core and
/// releases general traffic while the AI hold stays. This function does not
/// call [`transition_direct_to_blocked_unlocked`].
pub(crate) async fn commit_sing_box_direct_while_locked(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let failed = {
        let _operation = WFP_OPERATION.lock().await;
        match commit_sing_box_direct_unlocked(endpoints, reviewed_ports, owner_generation).await {
            Ok(result) => return Ok(result),
            Err(error) => error,
        }
    };
    if format!("{failed:#}").contains("general traffic was released") {
        // TUN auto_route would keep capturing packets after WFP is gone.
        let _ = crate::core::manager::CORE_MANAGER.lock().await.stop_core().await;
    }
    Err(failed)
}

async fn commit_sing_box_direct_unlocked(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    if previous.intent.mode != KillSwitchStatusMode::Locked
        || !previous.direct_endpoints.is_empty()
        || previous.direct_reload.is_some()
    {
        bail!("sing-box DIRECT permits require a locked full tunnel");
    }
    let core = current_core_instance_authoritative()
        .await
        .context("sing-box DIRECT permits have no running core")?;
    if tunnel_permit_luid(&previous, Some(core)).is_none() {
        bail!("sing-box DIRECT permits require the current core's tunnel grant");
    }
    prove_current_tunnel_luid(&previous).await.context(
        "sing-box DIRECT permits lost the locked tunnel; the full tunnel was left in place",
    )?;
    let canonical = canonical_direct_endpoints(&previous, endpoints)?;
    let endpoint_digest = crate::direct_endpoint_digest(&canonical).map_err(anyhow::Error::msg)?;
    let reload_id = next_direct_reload_id();
    let tunnel_luid = previous
        .tun_luid
        .context("locked sing-box tunnel has no LUID")?;
    let mut candidate = previous.clone();
    candidate.direct_endpoints = canonical.clone();
    candidate.reviewed_direct_ports = reviewed_ports
        .iter()
        .copied()
        .filter(|port| crate::REVIEWED_DIRECT_PORTS.contains(port))
        .collect();
    candidate.reviewed_direct_ports.sort_unstable();
    candidate.reviewed_direct_ports.dedup();
    candidate.intent.mode = KillSwitchStatusMode::Locked;
    candidate.direct_reload = Some(DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Committed,
        endpoint_digest,
        core_instance: Some(core),
        tunnel_luid: Some(tunnel_luid),
        expires_at: Some(std::time::Instant::now() + DIRECT_COMMITTED_LEASE),
    });
    if let Err(error) = install_unlocked_for(&candidate, Some(core)).await {
        return restore_sing_box_full_tunnel(previous, core, error).await;
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        return restore_sing_box_full_tunnel(
            previous,
            core,
            anyhow::anyhow!("core changed during sing-box DIRECT permit install"),
        )
        .await;
    }
    if let Err(error) = prove_current_tunnel_luid(&candidate).await {
        return restore_sing_box_full_tunnel(previous, core, error).await;
    }
    *armed_guard() = Some(candidate);
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &canonical)
}

async fn restore_sing_box_full_tunnel(
    full_tunnel: Armed,
    core: CoreInstance,
    error: anyhow::Error,
) -> Result<crate::DirectRuntimeReloadResult> {
    match install_unlocked_for(&full_tunnel, Some(core)).await {
        Ok(()) => {
            *armed_guard() = Some(full_tunnel);
            *last_error_guard() = Some(format!(
                "sing-box DIRECT permits were not installed; the full tunnel remains: {error:#}"
            ));
            Err(error.context(
                "sing-box DIRECT permits were not installed; the full tunnel remains",
            ))
        }
        Err(restore) => {
            // The WFP lock is already held. Disarm here; the caller stops Core
            // after this function returns the lock. Do not publish Blocked.
            if let Err(release) = disarm_unlocked(true).await {
                *last_error_guard() = Some(format!(
                    "sing-box DIRECT permit install failed ({error:#}); full tunnel restore failed ({restore:#}); release failed ({release:#})"
                ));
                return Err(release.context(
                    "sing-box DIRECT permits failed and the full tunnel could not be restored or released",
                ));
            }
            let ai = release_ai_hold_note().map_or_else(
                || " and AI destinations stay blocked".to_owned(),
                |note| format!("; {note}"),
            );
            *last_error_guard() = Some(format!(
                "sing-box DIRECT permit install failed ({error:#}); full tunnel restore failed ({restore:#}); general traffic was released{ai}"
            ));
            Err(error.context(format!(
                "sing-box full tunnel could not be restored; general traffic was released{ai}"
            )))
        }
    }
}

/// Retract every tunnel/DIRECT grant before a TUN-affecting core reload. Every invocation creates
/// a fresh volatile id, so an ambiguous replay invalidates delayed endpoint requests from the
/// previous invocation rather than accidentally authorizing them in the new bracket.
pub(crate) async fn begin_direct_runtime_reload(
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    if !matches!(
        previous.intent.mode,
        KillSwitchStatusMode::Locked | KillSwitchStatusMode::Blocked
    ) {
        bail!("DIRECT runtime reload requires a locked kill switch");
    }
    let current_core = current_core_instance_authoritative().await;
    let reload_id = next_direct_reload_id();
    let empty_digest = crate::direct_endpoint_digest(&[]).map_err(anyhow::Error::msg)?;
    let lease = DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Bracket,
        endpoint_digest: empty_digest,
        core_instance: current_core,
        tunnel_luid: None,
        expires_at: Some(std::time::Instant::now() + DIRECT_BRACKET_LEASE),
    };
    transition_direct_to_blocked_unlocked(previous, current_core, Some(lease)).await?;
    reload_result(owner_generation, reload_id, &[])
}

/// Install the complete volatile DIRECT set as a short Service-owned pending lease. The caller
/// must finalize after its post-install proofs; App death, Core change, or lease expiry retracts
/// the permits and moves the machine to exact Blocked.
pub(crate) async fn replace_direct_endpoints(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance_authoritative().await;
    let lease = match direct_reload_matches(&previous, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            transition_direct_to_blocked_unlocked(previous, current_core, None)
                .await
                .context("stale DIRECT replacement could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT replacement was rejected; traffic is Blocked"));
        }
    };
    let canonical = match canonical_direct_endpoints(&previous, endpoints) {
        Ok(canonical) => canonical,
        Err(error) => {
            transition_direct_to_blocked_unlocked(previous, current_core, None)
                .await
                .context("invalid DIRECT endpoint set could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT endpoint validation failed; traffic is Blocked"));
        }
    };
    let endpoint_digest = crate::direct_endpoint_digest(&canonical).map_err(anyhow::Error::msg)?;
    if previous.intent.mode != KillSwitchStatusMode::Locked
        || tunnel_permit_luid(&previous, current_core).is_none()
    {
        transition_direct_to_blocked_unlocked(previous, current_core, None)
            .await
            .context("invalid DIRECT replacement state could not be reconciled to Blocked")?;
        bail!(
            "replacing DIRECT endpoints requires a locked tunnel grant owned by the current core"
        );
    }
    let core = current_core.context("DIRECT endpoint replacement has no running Core")?;
    if lease.core_instance != Some(core) {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("stale DIRECT Core bracket could not be reconciled to Blocked")?;
        bail!("Core identity changed after the DIRECT reload bracket opened");
    }

    if lease
        .expires_at
        .is_some_and(|deadline| std::time::Instant::now() >= deadline)
    {
        let reconcile = transition_direct_to_blocked_unlocked(previous, Some(core), None).await;
        reconcile.context("expired DIRECT bracket could not be reconciled to Blocked")?;
        bail!("DIRECT runtime reload bracket expired");
    }
    if let Err(error) = prove_current_tunnel_luid(&previous).await {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("stale DIRECT tunnel LUID could not be reconciled to Blocked")?;
        return Err(error.context("DIRECT endpoint replacement lost its locked tunnel identity"));
    }
    if lease.phase != DirectReloadPhase::Bracket {
        let actual_digest = crate::direct_endpoint_digest(&previous.direct_endpoints)
            .map_err(anyhow::Error::msg)?;
        if lease.endpoint_digest != endpoint_digest || actual_digest != endpoint_digest {
            let reconcile = transition_direct_to_blocked_unlocked(previous, Some(core), None).await;
            reconcile.context("conflicting DIRECT replay could not be reconciled to Blocked")?;
            bail!("DIRECT endpoint replay did not match the pending/committed set");
        }
        // Lost-response replay after either pending install or finalization. Re-run exact install
        // and identity proof, but never extend the pending lease.
        if let Err(error) = install_unlocked_for(&previous, Some(core)).await {
            transition_direct_to_blocked_unlocked(previous, Some(core), None)
                .await
                .context("DIRECT replay failed and exact-permit retraction also failed")?;
            return Err(error.context("DIRECT replay failed; traffic is Blocked"));
        }
        let core_after = current_core_instance_authoritative().await;
        if core_after != Some(core) {
            transition_direct_to_blocked_unlocked(previous, core_after, None)
                .await
                .context("Core changed during DIRECT replay and Blocked reconciliation failed")?;
            bail!("Core changed during DIRECT endpoint replay");
        }
        if let Err(error) = prove_current_tunnel_luid(&previous).await {
            transition_direct_to_blocked_unlocked(previous, Some(core), None)
                .await
                .context("tunnel changed during DIRECT replay and Blocked reconciliation failed")?;
            return Err(error.context("tunnel identity changed during DIRECT endpoint replay"));
        }
        return reload_result(owner_generation, reload_id, &previous.direct_endpoints);
    }
    if !previous.direct_endpoints.is_empty()
        || lease.endpoint_digest
            != crate::direct_endpoint_digest(&[]).map_err(anyhow::Error::msg)?
    {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("non-empty DIRECT bracket could not be reconciled to Blocked")?;
        bail!("DIRECT bracket was not empty before endpoint installation");
    }

    let mut candidate = previous.clone();
    candidate.direct_endpoints = canonical.clone();
    // The App proposes; this keeps only what the Service itself sanctions, so a client asking
    // for port 22 gets nothing rather than an argument.
    candidate.reviewed_direct_ports = reviewed_ports
        .iter()
        .copied()
        .filter(|port| crate::REVIEWED_DIRECT_PORTS.contains(port))
        .collect();
    candidate.reviewed_direct_ports.sort_unstable();
    candidate.reviewed_direct_ports.dedup();
    let tunnel_luid = previous
        .tun_luid
        .context("locked DIRECT replacement lost its tunnel LUID")?;
    candidate.direct_reload = Some(DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Pending,
        endpoint_digest: endpoint_digest.clone(),
        core_instance: Some(core),
        tunnel_luid: Some(tunnel_luid),
        expires_at: Some(std::time::Instant::now() + DIRECT_PENDING_LEASE),
    });
    if let Err(error) = install_unlocked_for(&candidate, Some(core)).await {
        // `install` may have committed before its exact verification failed, and a timed-out WFP
        // worker continues running after this caller receives an error. The candidate is therefore
        // the conservative possibly-live set, not the empty Bracket snapshot. If Blocked cannot be
        // proved immediately, publishing candidate with its poisoned Pending lease makes the
        // watchdog retry without ever claiming the physical permits are absent.
        transition_direct_to_blocked_unlocked(candidate, Some(core), None)
            .await
            .context("DIRECT install failed and exact-permit retraction also failed")?;
        return Err(error.context("DIRECT endpoint set was not installed; traffic is Blocked"));
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        transition_direct_to_blocked_unlocked(candidate, core_after, None)
            .await
            .context("Core changed during DIRECT install and exact-permit retraction failed")?;
        bail!("Core changed during DIRECT endpoint installation; traffic is Blocked");
    }
    if let Err(error) = prove_current_tunnel_luid(&candidate).await {
        transition_direct_to_blocked_unlocked(candidate, Some(core), None)
            .await
            .context("tunnel changed during DIRECT install and exact-permit retraction failed")?;
        return Err(error.context("tunnel identity changed during DIRECT endpoint installation"));
    }
    *armed_guard() = Some(candidate);
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &canonical)
}

/// Commit a pending DIRECT lease only after the App proves the reloaded controller, WFP snapshot,
/// DNS, and ordinary tunnel data plane. Idempotent for a lost response from the same bracket.
pub(crate) async fn finalize_direct_runtime_reload(
    expected_digest: &str,
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    let lease = match direct_reload_matches(&armed, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            let current_core = current_core_instance_authoritative().await;
            transition_direct_to_blocked_unlocked(armed, current_core, None)
                .await
                .context("stale DIRECT finalize could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT finalize was rejected; traffic is Blocked"));
        }
    };
    if lease.endpoint_digest != expected_digest {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("DIRECT finalize digest mismatch could not be reconciled to Blocked")?;
        bail!("DIRECT finalize digest did not match the Service pending set");
    }
    if lease.phase == DirectReloadPhase::Bracket {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("premature DIRECT finalize could not be reconciled to Blocked")?;
        bail!("DIRECT endpoints have not been installed for this bracket");
    }
    if lease
        .expires_at
        .is_none_or(|deadline| std::time::Instant::now() >= deadline)
    {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("expired pending DIRECT set could not be reconciled to Blocked")?;
        bail!("pending DIRECT endpoint lease expired");
    }

    let current_core = current_core_instance_authoritative().await;
    let Some(core) = current_core else {
        transition_direct_to_blocked_unlocked(armed, None, None)
            .await
            .context("missing finalize Core could not be reconciled to Blocked")?;
        bail!("DIRECT finalize has no running Core");
    };
    if armed.intent.mode != KillSwitchStatusMode::Locked
        || tunnel_permit_luid(&armed, Some(core)).is_none()
        || lease.core_instance != Some(core)
        || lease.tunnel_luid != armed.tun_luid
    {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("invalid DIRECT finalize state could not be reconciled to Blocked")?;
        bail!("DIRECT finalize lost its locked Core/TUN identity");
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("stale finalize tunnel LUID could not be reconciled to Blocked")?;
        return Err(error.context("DIRECT finalize lost its current tunnel identity"));
    }
    let actual_digest =
        crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?;
    if actual_digest != expected_digest {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("DIRECT finalize set mismatch could not be reconciled to Blocked")?;
        bail!("DIRECT finalize endpoint set did not match its receipt");
    }

    if let Err(error) = install_unlocked_for(&armed, Some(core)).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("DIRECT finalize proof failed and exact-permit retraction also failed")?;
        return Err(error.context("DIRECT finalize WFP proof failed; traffic is Blocked"));
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        transition_direct_to_blocked_unlocked(armed, core_after, None)
            .await
            .context("Core changed during DIRECT finalize and exact-permit retraction failed")?;
        bail!("Core changed during DIRECT finalize; traffic is Blocked");
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("tunnel changed during DIRECT finalize and exact-permit retraction failed")?;
        return Err(error.context("tunnel identity changed during DIRECT finalize"));
    }
    if lease
        .expires_at
        .is_none_or(|deadline| std::time::Instant::now() >= deadline)
    {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context(
                "DIRECT lease expired during finalize and could not be reconciled to Blocked",
            )?;
        bail!("DIRECT endpoint lease expired during finalize; traffic is Blocked");
    }
    if lease.phase == DirectReloadPhase::Pending {
        armed.direct_reload = Some(DirectReloadLease {
            phase: DirectReloadPhase::Committed,
            expires_at: Some(std::time::Instant::now() + DIRECT_COMMITTED_LEASE),
            ..lease
        });
        *armed_guard() = Some(armed.clone());
    }
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &armed.direct_endpoints)
}

/// Marker the App matches. A non-strict renewal failure must not say the machine is Blocked:
/// WFP is left as it was so the caller can release general traffic and keep AI destinations blocked.
pub(crate) const DIRECT_RENEW_FAILED_PREFIX: &str = "TONO_DIRECT_RENEW_FAILED";
/// An explicit strict kill switch is the one renewal failure that stays Blocked.
pub(crate) const DIRECT_RENEW_STRICT_BLOCKED_PREFIX: &str = "TONO_DIRECT_RENEW_STRICT_BLOCKED";

/// A lost committed DIRECT lease is a renewal failure. Non-strict sessions release general
/// traffic. An in-flight reload bracket and an explicit strict kill switch still narrow to Blocked.
pub(super) fn committed_direct_lease_failure_releases(reason: &str, strict_kill_switch: bool) -> bool {
    !strict_kill_switch && reason.starts_with("committed DIRECT heartbeat lease expired")
}

/// Non-strict renewal failures do not install Blocked. The App's selective release is what
/// opens the original network and keeps the secondary AI hold. Strict mode still narrows.
async fn reject_direct_renewal_unlocked(
    armed: Armed,
    current_core: Option<CoreInstance>,
    detail: &str,
) -> anyhow::Error {
    if !armed.intent.strict_kill_switch {
        return anyhow::anyhow!(
            "{DIRECT_RENEW_FAILED_PREFIX}: {detail}; WFP was left unchanged so general traffic can be released while AI-service destinations stay blocked"
        );
    }
    match transition_direct_to_blocked_unlocked(armed, current_core, None).await {
        Ok(()) => anyhow::anyhow!(
            "{DIRECT_RENEW_STRICT_BLOCKED_PREFIX}: {detail}; strict kill switch kept traffic Blocked"
        ),
        Err(error) => error.context(format!(
            "{DIRECT_RENEW_STRICT_BLOCKED_PREFIX}: {detail}; strict Blocked reconciliation failed"
        )),
    }
}

/// Extend a committed DIRECT lease only for the authenticated owner session and the exact
/// Core/TUN/endpoint proof finalized by that session. This performs no widening WFP mutation: it
/// merely moves the Service-owned deadline after every identity check passes. A malformed,
/// stale, expired, or mismatched heartbeat does not cut the network: unless the armed record
/// has an explicit strict kill switch, WFP is left unchanged and the caller selective-releases.
pub(crate) async fn renew_direct_runtime_reload(
    expected_digest: &str,
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance_authoritative().await;
    let lease = match direct_reload_matches(&armed, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            return Err(reject_direct_renewal_unlocked(
                armed,
                current_core,
                &format!("{error:#}"),
            )
            .await);
        }
    };

    let now = std::time::Instant::now();
    let actual_digest =
        crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?;
    let identity_valid = lease.phase == DirectReloadPhase::Committed
        && lease.endpoint_digest == expected_digest
        && actual_digest == expected_digest
        && lease.expires_at.is_some_and(|deadline| now < deadline)
        && armed.intent.mode == KillSwitchStatusMode::Locked
        && tunnel_permit_luid(&armed, current_core).is_some()
        && lease.core_instance == current_core
        && lease.tunnel_luid.is_some()
        && lease.tunnel_luid == armed.tun_luid;
    if !identity_valid {
        return Err(reject_direct_renewal_unlocked(
            armed,
            current_core,
            "DIRECT renewal proof was stale, expired, or mismatched",
        )
        .await);
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        return Err(reject_direct_renewal_unlocked(
            armed,
            current_core,
            &format!("DIRECT renewal lost its tunnel identity: {error:#}"),
        )
        .await);
    }

    let core_after = current_core_instance_authoritative().await;
    let final_now = std::time::Instant::now();
    if core_after != current_core
        || lease
            .expires_at
            .is_none_or(|deadline| final_now >= deadline)
    {
        return Err(reject_direct_renewal_unlocked(
            armed,
            core_after,
            "DIRECT renewal expired or changed Core identity while being proven",
        )
        .await);
    }

    let mut renewed = lease;
    renewed.expires_at = Some(final_now + DIRECT_COMMITTED_LEASE);
    armed.direct_reload = Some(renewed);
    *armed_guard() = Some(armed.clone());
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &armed.direct_endpoints)
}

/// Synchronous security barrier for every Core stop or replacement. An ALE App-ID permit names a
/// binary path, not a PID/generation, so a newly spawned Mihomo at that same path could inherit an
/// old DIRECT tuple. Packed identity revocation happens *inside* the WFP writer lock: a widening
/// that entered first must finish before this exact Blocked transaction, while one queued behind
/// it observes `None` and cannot authorize anything. The manager calls this before terminating an
/// ordinary Core and, after a crash, before every respawn attempt. Failure must prevent launch.
pub(crate) async fn retract_direct_before_core_replacement() -> Result<()> {
    if !SUPPORTED {
        crate::core::manager::revoke_core_security_identity_under_wfp_barrier();
        return Ok(());
    }
    let _operation = WFP_OPERATION.lock().await;
    crate::core::manager::revoke_core_security_identity_under_wfp_barrier();
    let Some(armed) = armed_guard().clone() else {
        return Ok(());
    };
    // Even an empty volatile receipt is not proof that live WFP is empty: session filters survive
    // a Service-process restart while BFE remains running, and startup's first exact install may
    // have failed. Always overwrite the provider set before allowing the same App-ID path to run.
    match transition_direct_to_blocked_unlocked(armed, None, None).await {
        // Volatile DIRECT grants cannot be restored by an older intent. Once live WFP is
        // exact Blocked, a full disk or state-directory ACL must not prevent Disconnect.
        Err(error) if error.is::<DirectBlockedIntentPersistenceFailure>() => {
            tracing::warn!(
                "wfp: exact Blocked WFP was proved before replacing Core; continuing despite intent persistence failure: {error:#}"
            );
            Ok(())
        }
        result => result.context(
            "could not prove exact Blocked WFP before replacing Core; replacement is refused",
        ),
    }
}
