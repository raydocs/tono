//! Arming: bootstrap, verification barrier, endpoint replacement, tunnel lock, restrict.

use super::*;

/// The bootstrap API channel's destinations, admitted from what the client supplied.
///
/// **Literal IPs only — the service never resolves a name here.** Resolving one would mean the
/// answer picks the permit: the app looks the API host up through the system resolver *before*
/// the barrier arms, so a hostile DHCP resolver, a captive portal or an on-path spoofer would
/// choose up to [`wfp_model::MAX_API_HOST_IPS`] of the destinations this service then punches
/// through its own block — and "public and unreserved" is the only thing that check could ever
/// prove about the answer, because nothing here binds it to an expected host or a pin. The
/// client already pins literals for exactly this reason (its own recovery path must survive a
/// poisoned resolver), so nothing is lost: a non-literal entry is dropped, never looked up.
///
/// Order is the caller's, so the sanitizer's first-wins dedup and cap keep favouring earlier
/// hosts; everything is funnelled through the model's public-only, bounded sanitizer.
/// Union persisted learned control-plane addresses into a restored intent.
///
/// The last StartClash may predate this session's protected learn. On reboot the
/// WFP recovery channel should still include those ProgramData pins, or a
/// rotated anycast edge is unreachable until the App connects again.
pub(super) fn apply_learned_bootstrap_pins(intent: &mut IntentRecord) {
    let learned = crate::core::bootstrap_pins::load();
    if learned.addresses.is_empty() {
        return;
    }
    intent.api_host_ips = union_api_hosts(&intent.api_host_ips, &learned.addresses);
}

pub(super) fn union_api_hosts(existing: &[String], learned: &[String]) -> Vec<String> {
    let mut hosts = existing.to_vec();
    hosts.extend(learned.iter().cloned());
    admit_api_host_ips(&hosts)
        .into_iter()
        .map(|ip| ip.to_string())
        .collect()
}

pub(super) fn admit_api_host_ips(hosts: &[String]) -> Vec<IpAddr> {
    let mut literals = Vec::new();
    for host in hosts.iter().take(16) {
        let host = host.trim();
        if host.is_empty() {
            continue;
        }
        match host.parse::<IpAddr>() {
            Ok(ip) => literals.push(ip),
            Err(_) => tracing::warn!(
                "kill-switch API host {host:?} is not a literal IP and is dropped; the service \
                 does not resolve names into WFP permits"
            ),
        }
    }
    wfp_model::sanitize_api_host_ips(literals)
}

/// First phase of the two-phase arm: floor + session rules up, API channel open, tunnel not
/// yet permitted. Called from `StartClash` before the core is started. `owner_key` is the
/// authenticated owner's key (SHA256(SID)), recorded so only that owner can later release or
/// restrict the machine-wide policy.
pub(crate) async fn arm_bootstrap(
    config: &KillSwitchConfig,
    app_path: &str,
    owner_key: &str,
) -> Result<()> {
    ensure_supported()?;
    validate_config(config)?;
    if app_path.trim().is_empty() {
        bail!("enabled kill switch requires the staged core path");
    }
    if owner_key.is_empty() {
        bail!("enabled kill switch requires the authenticated owner key");
    }
    if !config.direct_endpoints.is_empty() {
        bail!(
            "initial arm cannot grant DIRECT endpoints; use the authenticated runtime-reload transaction"
        );
    }
    let api_host_ips = admit_api_host_ips(&config.bootstrap_api_hosts);
    let _operation = WFP_OPERATION.lock().await;
    // Re-checked under the WFP lock: this is the write that records the new owner.
    authorize_takeover_for(owner_key).map_err(anyhow::Error::new)?;
    let inherited_verified = armed_guard().as_ref().is_some_and(|armed| {
        armed.intent.owner_key.as_deref() == Some(owner_key) && armed.intent.is_verified()
    });
    let armed = Armed {
        intent: IntentRecord {
            wanted: true,
            mode: KillSwitchStatusMode::Bootstrap,
            verified: Some(inherited_verified),
            tunnel_interface: config.tunnel_interface.trim().to_owned(),
            app_path: app_path.to_owned(),
            endpoints: config.proxy_endpoints.clone(),
            api_host_ips: api_host_ips.iter().map(ToString::to_string).collect(),
            updated_at: now_unix(),
            owner_key: Some(owner_key.to_owned()),
            strict_kill_switch: false,
            reconnect_after_release: false,
            reconnect_owner_key: None,
            apply_narrow_after_release: None,
        },
        tun_luid: None,
        core_instance: None,
        // In memory only — populated exclusively by the lease-backed reload transaction.
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };
    // Persist fail-closed intent before touching WFP: a daemon restart installs at least the
    // floor if this process dies during the following transaction.
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
    publish_reconnect(false, None);
    *armed_guard() = Some(armed.clone());
    note_fresh_arm_core_window(&armed.intent);
    record_outcome(install_unlocked(&armed).await)
}

/// Commit the full app verification barrier for the active logical session.
pub(crate) async fn mark_verified(owner_key: &str) -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    if DIRECT_EXPIRY_RETIREMENT_PENDING.load(Ordering::Acquire) {
        bail!("expired DIRECT session is retiring Core; a fresh Connect is required");
    }
    if armed.intent.owner_key.as_deref() != Some(owner_key) {
        bail!("kill switch belongs to a different owner");
    }
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("kill switch must be locked before verification");
    }
    if armed.intent.is_verified() && armed.intent.verified == Some(true) {
        clear_wanted_core_window();
        return Ok(());
    }
    armed.intent.verified = Some(true);
    armed.intent.updated_at = now_unix();
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    *armed_guard() = Some(armed);
    clear_wanted_core_window();
    Ok(())
}

/// Replace the live Reality destination permits without stopping the core.
///
/// Used by a connected node switch: the App first sends old ∪ new, then after
/// the selector and data-plane proof succeed, sends new-only. Install failure
/// restores the previous permit set. Restore failure goes Blocked — never open.
pub(crate) async fn replace_proxy_endpoints(endpoints: &[ProxyEndpoint]) -> Result<()> {
    ensure_supported()?;
    if endpoints.is_empty() {
        bail!("enabled kill switch requires at least one proxy endpoint");
    }
    if endpoints.len() > MAX_PROXY_ENDPOINTS {
        bail!("proxy_endpoints exceeds the {MAX_PROXY_ENDPOINTS}-entry bound");
    }
    for endpoint in endpoints {
        if wfp_model::parse_endpoint(endpoint).is_none() {
            bail!("invalid proxy endpoint {}:{}", endpoint.ip, endpoint.port);
        }
    }
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("kill switch must be locked before replacing proxy endpoints");
    }
    let Some(core) = current_core_instance_authoritative().await else {
        bail!("proxy endpoint replace has no running Core");
    };
    if armed.core_instance.is_some() && armed.core_instance != Some(core) {
        bail!("core identity changed; a fresh lock is required");
    }
    let previous = armed.intent.endpoints.clone();
    armed.intent.endpoints = endpoints.to_vec();
    armed.intent.updated_at = now_unix();
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    *armed_guard() = Some(armed.clone());
    if let Err(error) = install_unlocked_for(&armed, Some(core)).await {
        armed.intent.endpoints = previous;
        armed.intent.updated_at = now_unix();
        let _ = atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await;
        *armed_guard() = Some(armed.clone());
        if let Err(restore) = install_unlocked_for(&armed, Some(core)).await {
            let current = current_core_instance_authoritative().await;
            let _ = transition_direct_to_blocked_unlocked(armed, current, None).await;
            return Err(restore.context(format!(
                "proxy endpoint install failed ({error:#}) and previous permit could not be restored"
            )));
        }
        return Err(error.context("proxy endpoint install failed; previous permit restored"));
    }
    Ok(())
}

pub(super) async fn resolve_luid(name: &str) -> Result<u64> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let name = name.to_owned();
        engine_call("tunnel LUID lookup", move || {
            crate::core::wfp::luid_for_interface(&name)
        })
        .await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = name;
        Ok(0)
    }
}

/// Re-resolve the recorded tunnel alias and prove that Windows still maps it to the LUID locked
/// for this Core. Same-PID Mihomo hot reload can recreate WinTUN without changing Core identity;
/// a cached LUID must never keep either the tunnel grant or physical DIRECT grants alive then.
pub(super) async fn prove_current_tunnel_luid(armed: &Armed) -> Result<()> {
    let recorded = armed
        .tun_luid
        .context("DIRECT transaction has no recorded tunnel LUID")?;
    let current = resolve_luid(&armed.intent.tunnel_interface)
        .await
        .context("cannot re-resolve the DIRECT transaction tunnel interface")?;
    if current != recorded {
        bail!(
            "DIRECT transaction tunnel LUID changed from {recorded} to {current}; a fresh lock is required"
        );
    }
    Ok(())
}

/// Second phase: permit the tunnel interface (by LUID) and retract the bootstrap API
/// channel. Runs only once the WinTUN adapter exists — until then tunnel traffic is blocked
/// too (fail-closed).
///
/// The interface name is NOT negotiable: it must equal the one recorded at arm time. A
/// client-supplied name like "Ethernet" would otherwise install a weight-8 permit for a
/// physical adapter — a fail-open primitive for every process on the machine. Rejecting a
/// mismatch has zero side effects; it guards against client bugs and same-user process abuse.
///
/// The grant is recorded against the core instance running when it is made: a LUID names an
/// adapter that belongs to that core, and [`tunnel_permit_luid`] retracts the permit the moment
/// that core is replaced or gone. Locking again — the app's job — is what re-grants it.
pub(crate) async fn lock(tunnel_interface: Option<&str>) -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let result = lock_unlocked(tunnel_interface).await;
    let Err(error) = result else {
        return Ok(());
    };

    // A failed lock must never leave a previously committed physical escape set behind. `ARMED`
    // always tracks the last WFP set that may be live: `lock_unlocked` publishes its candidate
    // immediately after a successful transaction, while a failed transaction leaves the prior
    // state untouched. This therefore retracts the right endpoint set for validation, Core/TUN
    // races, install, persistence, and publication failures alike.
    let Some(possibly_live) = armed_guard().clone() else {
        return Err(error);
    };
    if !direct_state_may_be_live(&possibly_live) {
        return Err(error);
    }
    let current_core = current_core_instance_for_direct_security();
    match transition_direct_to_blocked_unlocked(possibly_live, current_core, None).await {
        Ok(()) => {
            let error = error.context(
                "tunnel lock failed; exact DIRECT permits were retracted and traffic is Blocked",
            );
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error)
        }
        Err(retraction) => {
            let endpoints_may_remain_live =
                armed_guard().as_ref().is_some_and(direct_state_may_be_live);
            let message = if endpoints_may_remain_live {
                format!(
                    "tunnel lock failed ({error:#}); exact DIRECT Blocked reconciliation also \
                     failed ({retraction:#}); the possibly-live endpoint set remains published \
                     with an expired lease for watchdog retry"
                )
            } else {
                format!(
                    "tunnel lock failed ({error:#}); live WFP was narrowed and Blocked was \
                     published, but durable Blocked persistence failed ({retraction:#})"
                )
            };
            *last_error_guard() = Some(message.clone());
            bail!(message)
        }
    }
}

/// Perform the tunnel lock while [`WFP_OPERATION`] is held. Once an install succeeds, publish its
/// candidate immediately so every later error can reconcile the set that may actually be live.
async fn lock_unlocked(tunnel_interface: Option<&str>) -> Result<()> {
    if DIRECT_EXPIRY_RETIREMENT_PENDING.load(Ordering::Acquire) {
        bail!("expired DIRECT session is retiring Core; a fresh Connect is required");
    }
    // Same poison contract as every other mutation: a prior panic while `ARMED` was held must
    // not make the next tunnel lock panic the IPC task. `mark_verified` is the sibling path.
    let mut armed = armed_guard()
        .clone()
        .context("kill switch is not armed")?;
    let recorded = armed.intent.tunnel_interface.clone();
    if recorded.is_empty() {
        bail!("armed kill switch has no tunnel interface");
    }
    if let Some(supplied) = tunnel_interface
        .map(str::trim)
        .filter(|supplied| !supplied.is_empty())
        && supplied != recorded
    {
        bail!(
            "lock interface {supplied:?} does not match the interface recorded at arm time {recorded:?}"
        );
    }
    // Read the authoritative core identity *before* resolving the LUID: a core replaced in between makes the
    // recorded instance stale rather than falsely current, so the next render retracts the
    // permit instead of handing it to an adapter the new core did not create.
    //
    // Read it exactly **once**. This value is both persisted into `armed.core_instance` and
    // handed to the render below; a second read for the render could disagree with it (the
    // snapshot behind `current_core_instance` falls back to a cache while the core manager is
    // busy), and a disagreement here is terminal — see `rule_config_rendering`.
    let core_instance = current_core_instance_authoritative()
        .await
        .context("cannot lock a tunnel without a running core")?;
    let luid = resolve_luid(&recorded).await?;
    armed.tun_luid = Some(luid);
    armed.core_instance = Some(core_instance);
    armed.intent.mode = KillSwitchStatusMode::Locked;
    armed.intent.updated_at = now_unix();

    // Retain a same-Core reload bracket or endpoint set only if its complete Service-owned proof
    // is still valid for the newly resolved adapter. A recycled PID, expired heartbeat, missing
    // lease, or same-PID WinTUN recreation becomes full-tunnel-only before any render.
    if direct_reload_invalidation_reason(
        &armed,
        Some(core_instance),
        Some(luid),
        std::time::Instant::now(),
    )
    .is_some()
    {
        armed.direct_endpoints.clear();
        armed.reviewed_direct_ports.clear();
        armed.direct_reload = None;
    }

    if current_core_instance_authoritative().await != Some(core_instance) {
        bail!("core changed before tunnel lock install; a fresh lock is required");
    }
    let encoded = serde_json::to_vec_pretty(&armed.intent)?;
    // Update live WFP first (the macOS helper's add_tunnel ordering): if this fails, the
    // previous bootstrap rules remain effective and the persisted intent restores them after
    // a crash. Rendered from the same `core_instance` that was just recorded, never a re-read.
    install_unlocked_for(&armed, Some(core_instance)).await?;
    // The transaction succeeded, so this is now the conservative description of what may be
    // live. Publishing before the post-install proofs closes the old memory/live divergence on
    // persistence and Core/TUN race failures.
    *armed_guard() = Some(armed.clone());

    let core_after = current_core_instance_authoritative().await;
    let luid_after = if core_after == Some(core_instance) {
        resolve_luid(&recorded).await
    } else {
        Err(anyhow::anyhow!("Core identity changed during tunnel lock"))
    };
    let post_install_failure = match luid_after {
        Ok(current_luid) if current_luid != luid => Some(format!(
            "tunnel LUID changed from {luid} to {current_luid} during tunnel lock"
        )),
        Err(error) => Some(format!(
            "cannot prove the tunnel LUID after tunnel lock install: {error:#}"
        )),
        Ok(current_luid) => direct_reload_invalidation_reason(
            &armed,
            core_after,
            Some(current_luid),
            std::time::Instant::now(),
        )
        .map(str::to_owned),
    };
    if let Some(reason) = post_install_failure {
        transition_direct_to_blocked_unlocked(armed, core_after, None)
            .await
            .with_context(|| {
                format!("{reason}; exact Blocked reconciliation after tunnel lock install failed")
            })?;
        bail!("{reason}; traffic remains blocked until a fresh lock");
    }
    atomic_write(&intent_path(), &encoded)
        .await
        .context("locked tunnel intent could not be persisted")?;
    *last_error_guard() = None;
    Ok(())
}

/// Disconnected-but-armed ("Protected Offline"): floor + endpoint/DNS rules stay, the API
/// recovery channel re-opens, the tunnel permit is gone.
pub(super) async fn restrict_bootstrap_unlocked() -> Result<()> {
    let armed = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance().await;
    transition_direct_to_blocked_unlocked(armed, current_core, None).await
}

pub(crate) async fn restrict_bootstrap() -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    restrict_bootstrap_unlocked().await
}
