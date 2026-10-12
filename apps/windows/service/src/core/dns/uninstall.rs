use super::*;

// --- Uninstall-only escalation ladder ---
//
// **The design error this ladder corrects.** Everywhere else in this module, "refuse unless the
// network is provably restored" is right: the product is staying installed, the user can retry,
// and the App still has a way to open the block. At *uninstall* time the same rule produced an
// **unremovable application** — the machine that reported this could not get past
// `RemoveVergeService` because the live CIM/netsh apply was failing on one adapter, so the exact
// restore could never be proven and the NSIS macro aborted the whole uninstall, every time.
// Unremovable consumer software is a worse outcome than an inexact DNS configuration, and it is
// not a trade the user ever agreed to.
//
// The danger the old refusal was aimed at is real, but the aim was wrong. What must never
// happen is *removing the app while leaving persistent WFP filters armed* — a blocked machine
// with no software left to unblock it. Refusing the uninstall is not the only way to prevent
// that, and it is the way that costs the most: it leaves the user blocked **and** stuck.
// `windows_kill_switch::emergency_disarm_windows_kill_switch` removes the WFP objects whether
// or not DNS could be restored, so the barrier is gone on every rung below; this ladder decides
// only what to do about the *resolver*.
//
// Rung 1 — exact restore, proven exactly as on the Disconnect path (`restore_protected`).
// Rung 2 — put the adapters Tono redirected back on **automatic (DHCP)**, both families, and
//          verify the machine is no longer resolving through the loopback core. DHCP is a
//          universally-correct resting state: the user gets working DNS from their network. It
//          is not their exact prior configuration, and at uninstall time — when the product is
//          being removed and connectivity matters more than fidelity — that is the right trade.
// Rung 3 — only when the machine is *provably* still on the loopback resolver, or when neither
//          the DHCP write nor the read-back produced any evidence at all. Then, and only then,
//          the refusal stands.
//
// None of this loosens the Disconnect / "Restore normal internet" path: `restore_protected`,
// `ensure_restored` and `disarm_unlocked` are untouched, and this ladder is reached only from
// the uninstaller's opt-in (`windows_kill_switch::uninstall_ladder_requested`).

/// Stable, App/installer-mappable marker for "the exact DNS restore could not be proven, so the
/// adapters were reset to automatic (DHCP) instead". Same substring contract as the wedge
/// markers. `uninstall_service.rs` matches this literal to pick its continue-with-warning exit
/// code, so the text is part of the exit-code contract and must not drift.
pub(crate) const DNS_RESTORED_AUTOMATIC_PREFIX: &str = "TONO_DNS_RESTORED_AUTOMATIC";

/// Stable marker for the last DNS rung: the machine could not be taken off Tono's protected DNS
/// target. Emitted only **after** WFP objects are already deleted. It must never by itself block
/// uninstall or reinstall — the user can fix DNS in Windows Settings, and cannot conjure back an
/// uninstaller that refuses to run. `uninstall_service.rs` treats this as continue-with-warning
/// (same exit family as [`DNS_RESTORED_AUTOMATIC_PREFIX`]).
pub(crate) const DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX: &str = "TONO_DNS_STILL_ON_LOOPBACK";

/// Stable marker that the WFP barrier is gone even though some DNS step is imperfect. The
/// emergency-disarm path attaches this to every post-removal DNS error so the uninstaller can
/// never re-classify "filters removed, DNS messy" as "machine still blocked" (result 3).
pub(crate) const WFP_REMOVED_CONTINUE_PREFIX: &str = "TONO_WFP_REMOVED";

/// Stable marker that Tono's NRPT catch-all could not be proven removed
/// ([`remove_tono_resolver_rule_within`]). Every lookup still goes to 198.18.0.2 while it stays.
/// It leads the message, and the DNS outcome follows it unchanged, so it can travel with
/// [`WFP_REMOVED_CONTINUE_PREFIX`] or another continue marker. The recovery CLI checks it first
/// and blocks. `uninstall_service.rs` classifies by the DNS outcome after it; what blocks the
/// uninstall is its `with_resolver_rule_proof` sweep, which exits 3 while the rule remains. Both
/// match this literal.
pub(crate) const DNS_RESOLVER_POLICY_REMAINS_PREFIX: &str = "TONO_DNS_POLICY_REMAINS";

/// Which rung of the uninstall ladder the evidence lands on. Pure, so the whole decision table
/// is unit-tested off Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum UninstallRung {
    /// Rung 1: the snapshot was restored and proven.
    Exact,
    /// Rung 2: not exact, but the machine is off the loopback resolver (or its configured
    /// resolvers are now DHCP, which is what the DNS Client reads for the next lookup).
    Automatic,
    /// Rung 3: provably still redirected, or no evidence either way.
    StillOnLoopback,
}

/// The ladder's decision table.
///
/// * `automatic_apply_ok` — the DHCP reset was written for every targeted adapter. The registry
///   half of that write is what the DNS Client reads for the next lookup, so it is positive
///   evidence in exactly the sense [`accepts_degraded_restore`] already relies on.
/// * `live_loopback` — `Some(true)` the machine provably still resolves through our loopback
///   core, `Some(false)` provably does not, `None` the engine could not be asked.
///
/// The one asymmetry against the rest of this module: `None` (unobtainable evidence) does *not*
/// force a refusal here as long as the DHCP write succeeded. Everywhere else unobtainable
/// evidence is unproven and fails closed, because failing closed costs the user a retry. Here
/// failing closed costs them an application they cannot remove, while the thing that would
/// actually strand them — the WFP barrier — is already gone. `Some(true)` is still an
/// unconditional refusal: a machine we can *see* is still pointed at a resolver that has
/// stopped answering is not a machine we quietly walk away from.
pub(super) fn uninstall_restore_rung(
    exact_proven: bool,
    automatic_apply_ok: bool,
    live_loopback: Option<bool>,
) -> UninstallRung {
    if exact_proven {
        return UninstallRung::Exact;
    }
    if live_loopback == Some(true) {
        return UninstallRung::StillOnLoopback;
    }
    if automatic_apply_ok || live_loopback == Some(false) {
        return UninstallRung::Automatic;
    }
    UninstallRung::StillOnLoopback
}

/// What the uninstall ladder achieved. `Ok` of either variant means the machine is not left
/// resolving through a loopback core that is about to stop answering; rung 3 is the `Err`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UninstallDnsRestore {
    /// Rung 1 — the snapshot was restored and proven, exactly as on every other path.
    Exact,
    /// Rung 2 — the adapters Tono redirected were reset to automatic (DHCP) for both families.
    /// Carries the adapters that were reset, so the uninstaller can name them.
    Automatic { adapters: Vec<String> },
}

/// The adapters rung 2 is allowed to reset to automatic (DHCP).
///
/// Only ever adapters Tono redirected. Resetting an adapter we never touched would destroy a
/// static DNS configuration the user chose, which is exactly the kind of collateral damage the
/// uninstall trade does *not* license.
///
/// * With a readable snapshot: its adapters, minus any whose *originals were themselves a
///   loopback resolver* (a machine that already ran Acrylic / dnscrypt-proxy / a local Pi-hole).
///   For those, loopback is the correct end state, so DHCP would be the wrong answer and their
///   loopback reading is not evidence of our redirect.
/// * Without a readable snapshot: the adapters that provably read as a loopback resolver right
///   now. We cannot say what they were, but we can say they are pointed at a core that is about
///   to stop existing.
pub(super) async fn uninstall_reset_targets() -> Result<Vec<String>> {
    let snapshot = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => parse_snapshot(&bytes).ok(),
        Err(_) => None,
    };
    if let Some(snapshot) = snapshot {
        return Ok(snapshot
            .adapters
            .iter()
            .filter(|saved| !saved_dns_was_loopback(saved))
            .map(|saved| saved.interface_guid.clone())
            .collect());
    }
    // The live read must use the predicate that recognises *Tono-owned* resolvers, not the
    // narrower "legacy loopback" one used for saved originals. `saved_dns_was_loopback` answers
    // "was this adapter's original configuration already a local resolver, so DHCP would be the
    // wrong answer for it" — a question about the past, deliberately blind to `198.18.0.2`.
    // Asked of a live read it selected nothing on every machine a current build had protected.
    Ok(collect_dns_adapters()
        .await?
        .iter()
        .filter(|adapter| adapter_reads_as_tono_dns(adapter))
        .map(|adapter| adapter.interface_guid.clone())
        .collect())
}

/// The uninstall-only escalation ladder (see the block comment above [`uninstall_restore_rung`]).
///
/// Rung 1 is [`restore_protected`], unchanged and unrelaxed. If it cannot prove itself, rung 2
/// writes automatic (DHCP) DNS for both families over the adapters Tono redirected and verifies
/// the machine is off the loopback core; rung 3 is the `Err` (still on protected DNS). Rung 3 is
/// reported to the detail log so the user can flip DNS in Windows Settings, but it no longer
/// blocks uninstall/reinstall: WFP is already gone by the time the uninstaller classifies it.
///
/// This function is never on the Disconnect / release / quit path. `restore_protected`,
/// `ensure_restored` and `windows_kill_switch::disarm_unlocked` keep the strict proof: while the
/// product stays installed, a refusal costs a retry, and the App can still open the block.
pub(crate) async fn restore_for_uninstall() -> Result<UninstallDnsRestore> {
    if !SUPPORTED {
        return Ok(UninstallDnsRestore::Exact);
    }

    // Rung 1. Also the path that clears `PROTECTION_WANTED`, deletes the snapshot on success and
    // handles the unreadable-snapshot recovery, so nothing below has to repeat any of it.
    let exact_error = match restore_protected().await {
        Ok(_) => return Ok(UninstallDnsRestore::Exact),
        Err(error) if error.downcast_ref::<ResolverPolicyRestoreFailed>().is_some() => return Err(error),
        Err(error) => error,
    };
    tracing::error!(
        "dns: the exact restore could not be proven while uninstalling ({exact_error:#}); \
         escalating to automatic (DHCP) DNS rather than leaving an application that cannot be \
         removed"
    );

    // Rung 2. `restore_protected` has released the operation lock by now; take it for the reset
    // so the watchdog and any concurrent caller stay serialized behind the same single writer.
    let _operation = DNS_OPERATION.lock().await;
    // An engine that cannot even enumerate must not produce a *vacuous* success below: an empty
    // target list would otherwise report "every targeted adapter was reset" while nothing was
    // looked at. "The snapshot says we redirected nothing" and "we could not find out" are
    // different answers, and only the first one is evidence.
    let (targets_listed, targets) = match uninstall_reset_targets().await {
        Ok(targets) => (true, targets),
        Err(error) => {
            tracing::error!("dns: the adapters to reset to DHCP could not be listed: {error:#}");
            (false, Vec::new())
        }
    };
    // An adapter record whose four values are all `None` *is* "automatic (DHCP)" — the engine
    // deletes the registry values and drives the live apply with CIM `$null` (IPv4) and
    // `netsh … source=dhcp` (IPv6). No new engine mechanism is introduced for the fallback: it
    // is the ordinary restore path applied to a deliberately empty original.
    let automatic = DnsSnapshot {
        version: SNAPSHOT_VERSION,
        taken_at: now_unix(),
        adapters: targets
            .iter()
            .map(|guid| AdapterDnsSnapshot {
                interface_guid: guid.clone(),
                ..Default::default()
            })
            .collect(),
    };
    let automatic_apply_ok = targets_listed
        && match engine_apply_snapshot(&automatic).await {
            Ok(results) => results.iter().all(|(_, ok)| *ok),
            Err(error) => {
                tracing::error!(
                    "dns: the automatic (DHCP) fallback could not be applied: {error:#}"
                );
                false
            }
        };
    // Ask only about the adapters we redirected. "Is *anything* on loopback?" would refuse for
    // ever on a machine running its own local resolver on an adapter we never touched.
    //
    // Except when we redirected nothing, where that scoping stops being a safeguard and becomes
    // the hole: `any_loopback` over an empty list answers `false` without reading a single
    // adapter, so a selection that wrongly came back empty proved itself. Fall back to the one
    // value that cannot belong to anybody else — the TUN endpoint — across every live adapter.
    // The broader predicate cannot be used here: a machine running its own Pi-hole reads as
    // `127.0.0.1` on an adapter Tono never touched, and would refuse uninstall for ever.
    let live_loopback = if automatic.adapters.is_empty() {
        match collect_dns_adapters().await {
            Ok(adapters) => Some(adapters.iter().any(adapter_contains_current_protected_dns)),
            Err(error) => {
                tracing::warn!(
                    "dns: nothing was selected for the automatic (DHCP) fallback and the live \
                     DNS state could not be read to confirm that is correct: {error:#}"
                );
                None
            }
        }
    } else {
        match engine_any_loopback(&automatic.adapters).await {
            Ok(any_loopback) => Some(any_loopback),
            Err(error) => {
                tracing::warn!(
                    "dns: the live DNS state could not be read after the automatic (DHCP) \
                     fallback: {error:#}"
                );
                None
            }
        }
    };

    match uninstall_restore_rung(false, automatic_apply_ok, live_loopback) {
        // Not reachable with `exact_proven = false`; treated as rung 1 rather than panicking,
        // because an uninstaller is the last place to turn a logic slip into a crash.
        UninstallRung::Exact => Ok(UninstallDnsRestore::Exact),
        UninstallRung::Automatic => {
            // DHCP does not restore NRPT/DoH. Retain recovery evidence and report the cause
            // instead of publishing success or quarantining the snapshot on policy failure.
            // A capture-quarantine note is folded into the rung note below rather than dropped:
            // this arm always reports a trade, so the note that is always written wins. Nothing
            // after the policy restore can fail this rung, so its loss is settled right away.
            let capture_note =
                settle_capture_loss(record_outcome(restore_resolver_policy().await)?).await;
            let mut note = format!(
                "{DNS_RESTORED_AUTOMATIC_PREFIX}: the saved DNS servers could not be proven \
                 restored ({exact_error:#}), so {} adapter(s) were set back to automatic (DHCP) \
                 for both IPv4 and IPv6 and verified off Tono's protected DNS target \
                 (dhcp_apply_ok={automatic_apply_ok}, still_on_loopback={}). The machine gets \
                 its DNS from the network again; this is not the exact previous configuration, \
                 which is the accepted trade at uninstall time.",
                automatic.adapters.len(),
                live_loopback_label(live_loopback),
            );
            if let Some(captured) = capture_note {
                note.push(' ');
                note.push_str(&captured);
            }
            tracing::error!("dns: {note}");
            *DNS_LAST_ERROR
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note);
            // The redirect is gone, so the snapshot no longer describes anything in force — but
            // it is the only record of the user's original servers, so it is retained under a
            // new name instead of deleted. Retaining it under the *live* name would make a
            // second uninstall run replay this whole ladder for nothing.
            if let Err(error) = quarantine_snapshot(
                "superseded",
                "the saved DNS servers could not be proven restored, so the adapters were reset \
                 to automatic (DHCP) during uninstall",
            )
            .await
            {
                tracing::warn!("dns: the superseded snapshot could not be set aside: {error:#}");
            }
            if let Err(error) = engine_flush_cache().await {
                tracing::warn!("DNS cache flush after the DHCP fallback failed: {error:#}");
            }
            Ok(UninstallDnsRestore::Automatic { adapters: targets })
        }
        UninstallRung::StillOnLoopback => {
            // The resolver policy (the NRPT catch-all and the Encrypted DNS pin) does not depend
            // on the adapters, so it is restored here too rather than left behind (BRICK-W4). Its
            // outcome joins the message and the rung still refuses. Capture-loss evidence stays
            // on disk: nothing here commits a restore.
            let policy = match record_outcome(restore_resolver_policy().await) {
                Ok(None) => {
                    " Tono's resolver policy was restored and its NRPT rule removed.".to_owned()
                }
                Ok(Some(note)) => format!(" Tono's resolver policy was restored. {note}"),
                Err(error) => format!(" Tono's resolver policy could not be restored: {error:#}"),
            };
            // The last rung, and the only one that still refuses. Everything the user needs to
            // get out of it is in the message: the barrier is already gone, so they are online,
            // and one change in Windows' own network settings makes the next run take rung 2.
            bail!(
                "{DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX}: this machine could not be taken off \
                 Tono's protected DNS target. The exact restore failed ({exact_error:#}) and \
                 the automatic (DHCP) fallback did not verify either \
                 (dhcp_apply_ok={automatic_apply_ok}, still_on_loopback={}). The network barrier \
                 has already been removed, so the machine is no longer blocked — only name \
                 resolution is still pointed at Tono. Fix it in Windows: Settings → Network & \
                 Internet → your adapter → DNS server assignment → Edit → Automatic (DHCP), for \
                 both IPv4 and IPv6; a reboot also clears a wedged DNS Client service. Then run \
                 the uninstaller again and it will complete.{policy}",
                live_loopback_label(live_loopback),
            )
        }
    }
}
