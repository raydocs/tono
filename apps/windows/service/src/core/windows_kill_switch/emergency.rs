//! Emergency disarm (`--emergency-disarm`, failed-update recovery).

use super::*;

/// `tono-service.exe --emergency-disarm`: restore snapshotted DNS, then delete every WFP
/// object whose provider key is Tono's (filters → legacy sublayers → sublayer → provider),
/// and remove the intent record. It touches no other provider, sublayer, or Windows Defender
/// Firewall setting.
///
/// **The invariant this function exists to hold, and the one the uninstall exit codes rest on:**
/// the WFP objects are removed before any DNS outcome is reported, and every `?` above the
/// removal fails *without* claiming the barrier is gone. Once WFP is deleted, every DNS outcome
/// is tagged with a continue marker (`DNS_RESTORED_AUTOMATIC_PREFIX`,
/// `DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX`, or `WFP_REMOVED_CONTINUE_PREFIX`) so the
/// uninstaller can never treat "filters gone, DNS messy" as result 3. An NRPT catch-all that
/// could not be removed puts `DNS_RESOLVER_POLICY_REMAINS_PREFIX` in front of that DNS outcome,
/// so both markers appear. Two end states must still block: WFP still armed, and the NRPT rule
/// still present, which the uninstall helper's own sweep (`with_resolver_rule_proof`) checks
/// again and blocks on with result 3.
pub async fn emergency_disarm_windows_kill_switch() -> Result<()> {
    emergency_disarm_with(false).await
}

/// Automatic failed-update recovery uses the same WFP/DNS proof and reporting,
/// but retains the secondary AI hold. The caller must first exclude strict mode
/// and stop the Service while holding the repair and singleton owner gates.
pub async fn emergency_disarm_windows_kill_switch_applying_narrow() -> Result<()> {
    emergency_disarm_with(true).await
}

async fn emergency_disarm_with(apply_narrow: bool) -> Result<()> {
    let _operation = WFP_OPERATION.lock().await;
    // This is still the fail-open escape hatch: WFP objects are removed even if protected DNS
    // cannot be restored. The DNS failure is nevertheless returned *after* WFP and intent
    // cleanup so an uninstaller cannot report success and delete the remaining recovery files.
    // `restore_protected` preserves its snapshot on failure, making a repair + retry possible.
    //
    // Bounded like every other cross-module await on this path, and here the bound cannot even
    // touch the ordering invariant: this path is the documented fail-open escape hatch that
    // removes WFP whether or not DNS could be restored, so a timeout only changes *how* the
    // uninstaller reports an unrestored resolver — never whether it proved one before opening.
    // An unbounded hang here would instead wedge the uninstaller while holding `WFP_OPERATION`.
    //
    // Two DNS strategies, chosen by the *calling process*, never by the machine's condition:
    //
    // * The uninstaller opts into `dns::restore_for_uninstall`, the escalation ladder. Its
    //   rung 2 resets the adapters Tono redirected to automatic (DHCP) rather than refusing —
    //   because the alternative, which is what this code used to do, was an application the
    //   user could not remove. See the block comment above `dns::uninstall_restore_rung`.
    // * Everyone else — `tono-service.exe --emergency-disarm`, the Start-Menu "Restore Network"
    //   entry — keeps `dns::restore_protected` verbatim. That path's promise is to put the
    //   user's *own* servers back on a machine that is staying installed, and a machine that is
    //   staying installed can retry. Nothing about it is made more permissive here.
    let dns_restore = if uninstall_ladder_requested() {
        bounded_dns_call_within(
            UNINSTALL_DNS_RESTORE_TIMEOUT,
            "uninstall disarm",
            crate::core::dns::restore_for_uninstall(),
        )
        .await
    } else {
        bounded_dns_call("emergency disarm", crate::core::dns::restore_protected())
            .await
            .map(|_| crate::core::dns::UninstallDnsRestore::Exact)
    };

    // Persist fail-open intent *before* removing WFP when we can. Service-start recovery sees
    // the tombstone and finishes cleanup instead of re-arming a stale wanted policy.
    //
    // **Uninstall ladder exception:** Chinese customer machines repeatedly hit
    // `ensure_private_service_directory` / ProgramData ACL failures on this write, which used to
    // return *before* WFP removal and brick install/uninstall as result 3 forever — with the
    // barrier still armed. When this process opted into the uninstall ladder, a tombstone
    // failure is logged and we still delete provider-scoped WFP objects: the alternative is an
    // application that cannot be removed. Non-uninstall callers keep the old refuse path.
    let mut tombstone = match tokio::fs::read(intent_path()).await {
        Ok(bytes) => serde_json::from_slice::<IntentRecord>(&bytes).ok(),
        Err(_) => None,
    }
    .unwrap_or(IntentRecord {
        wanted: false,
        mode: KillSwitchStatusMode::Blocked,
        verified: Some(false),
        tunnel_interface: String::new(),
        app_path: String::new(),
        endpoints: Vec::new(),
        api_host_ips: Vec::new(),
        updated_at: now_unix(),
        owner_key: None,
        strict_kill_switch: false,
        reconnect_after_release: false,
        reconnect_owner_key: None,
        apply_narrow_after_release: None,
    });
    tombstone.wanted = false;
    tombstone.reconnect_after_release = false;
    tombstone.reconnect_owner_key = None;
    tombstone.apply_narrow_after_release = Some(apply_narrow);
    tombstone.updated_at = now_unix();
    let tombstone_error =
        match atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await {
            Ok(()) => None,
            Err(error) if uninstall_ladder_requested() => {
                tracing::error!(
                    "uninstall disarm: kill-switch tombstone could not be written ({error:#}); \
                 still removing WFP so install/uninstall cannot dead-end as result 3"
                );
                Some(error)
            }
            Err(error) => return Err(error),
        };

    // Bounded like every other engine call: an uninstaller that hangs forever on a wedged BFE
    // is worse than one that reports why it could not finish. When the tombstone is on disk the
    // next service start completes cleanup either way; when it is not (uninstall ladder only)
    // the WFP delete itself is the safety proof the uninstaller needs.
    //
    // Ordering: prefer tombstone *before* the engine call (a crash mid-removal must still
    // complete cleanup at the next service start), but the in-memory disarmed state is
    // published *after* it. Publishing first would make `status()` report an unprotected
    // machine while the filters are demonstrably still installed — the exact inversion of what
    // the product promises. On engine failure the reported state therefore stays "armed".
    hold_ai_before_release(apply_narrow).await;
    #[cfg(all(windows, not(feature = "test")))]
    engine_call("emergency disarm", crate::core::wfp::emergency_disarm).await?;
    // WFP is gone. Explicit Restore removes the secondary hold; automatic
    // failure recovery applies it. Neither may undo or refuse this release.
    finish_release_follow_up(apply_narrow).await;
    *armed_guard() = None;
    *last_verify_guard() = None;
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    // Best-effort tombstone after a skipped pre-write so a later Service start still prefers
    // cleanup over emergency re-arm when ProgramData becomes writable again.
    if tombstone_error.is_some() {
        if let Err(error) =
            atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await
        {
            tracing::warn!("uninstall disarm: post-WFP tombstone write still failed: {error:#}");
        }
    }
    // Automatic recovery retains its narrow disposition for future Service starts.
    // Explicit intent deletion is best-effort once WFP is gone. The tombstone is already
    // on disk, so a leftover file cannot re-arm a block; refusing uninstall here recreated the
    // "result 3 forever" deadlock for Chinese test machines whose ProgramData ACLs deny the
    // final unlink under the elevated installer token.
    if !apply_narrow {
        match tokio::fs::remove_file(intent_path()).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(
                    "kill-switch intent could not be deleted after WFP removal (continuing): {error:#}"
                );
            }
        }
    }
    // BRICK-W4: Tono's NRPT catch-all sends every lookup to 198.18.0.2, which nothing answers
    // once the Core is gone, and a restart does not remove it. It must be proven gone before any
    // DNS outcome below is reported as continuable. A rule that remains puts its own blocking
    // marker in front of that outcome (see the end of this function). Only this entry point
    // (the uninstall helper and the elevated recovery CLI) runs the sweep; the Service never does.
    const NRPT_SWEEP_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);
    let resolver_rule = crate::core::dns::remove_tono_resolver_rule_within(NRPT_SWEEP_BUDGET);
    // Everything below runs only once the WFP objects are provably gone: the engine_call `?`
    // above returns before it. Every imperfect DNS outcome is therefore tagged so the
    // uninstaller continues — the barrier that could leave a brick is already down.
    let dns_outcome = match dns_restore {
        // Rung 1: the snapshot was restored and proven. Nothing to report.
        Ok(crate::core::dns::UninstallDnsRestore::Exact) => Ok(()),
        // Rung 2: reported through the error channel on purpose. This entry point's contract has
        // always been "return the DNS deviation *after* the WFP cleanup so a caller cannot
        // report unqualified success", and rung 2 is a deviation — the user's own servers were
        // not restored. The marker is what turns it into a *continue*-with-warning at the
        // uninstaller instead of a refusal; a caller that does not know the marker keeps the old,
        // conservative reading, which is the correct default for anything that is not an
        // uninstall. Reachable only when this process opted into the ladder.
        Ok(crate::core::dns::UninstallDnsRestore::Automatic { adapters }) => {
            let snapshot = crate::service_paths()
                .persistent_state_dir()
                .join("protected-dns.json");
            Err(anyhow::anyhow!(
                "{}: WFP was removed and {} adapter(s) were set back to automatic (DHCP) DNS \
                 because the saved servers could not be proven restored. The machine resolves \
                 through the network's own DNS again; this is not the exact previous \
                 configuration. The saved servers were kept next to {snapshot:?} under a \
                 `protected-dns.superseded-*.json` name if they are needed. Uninstall may \
                 continue: nothing of Tono's is left blocking or redirecting this machine.",
                crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX,
                adapters.len(),
            ))
        }
        // Rung 3 or any other post-removal DNS failure: WFP is already gone. Tag with the
        // continue marker so install/uninstall never dead-end as result 3. The inner error
        // still names STILL_ON_LOOPBACK / snapshot paths so the detail log can tell the user
        // how to fix DNS in Windows Settings.
        Err(error) => {
            let snapshot = crate::service_paths()
                .persistent_state_dir()
                .join("protected-dns.json");
            Err(anyhow::anyhow!(
                "{}: WFP was removed, but DNS restore could not be proven: {error:#}. \
                 Recovery snapshot: {snapshot:?}. The network barrier is gone so install and \
                 uninstall may continue. If name resolution is still wrong, open Settings → \
                 Network & Internet → your adapter → DNS server assignment → Automatic (DHCP) \
                 for both IPv4 and IPv6.",
                crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX,
            ))
        }
    };
    // The blocking marker leads, and the DNS outcome follows it unchanged. The recovery CLI
    // checks this marker first, so it still blocks there. The uninstall helper sweeps again and
    // blocks if the rule remains; when that sweep proves the rule gone, it reports what the DNS
    // restore really did (an exact restore is exit 0, not a DHCP reset).
    if let Err(error) = resolver_rule {
        let dns = match &dns_outcome {
            Ok(()) => String::new(),
            Err(dns_error) => format!(" The DNS restore reported: {dns_error:#}"),
        };
        return Err(anyhow::anyhow!(
            "{}: WFP was removed, but Tono's DNS rule (the NRPT catch-all that sends every lookup \
             to 198.18.0.2) could not be removed: {error:#}. Name lookups keep going to the \
             stopped Tono resolver until it is gone. Run the Start-Menu shortcut \
             \"Tono — 恢复网络 (Restore Network)\" as administrator again, or run the uninstaller \
             again.{dns}",
            crate::core::dns::DNS_RESOLVER_POLICY_REMAINS_PREFIX,
        ));
    }
    dns_outcome
}
