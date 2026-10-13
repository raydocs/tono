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

/// What the DNS Client resolves through for one adapter, as far as it could be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum EffectiveDns {
    /// The adapter is not active, so there is no running resolver to prove.
    NotActive,
    /// The adapter's effective servers, both families.
    Servers(Vec<std::net::IpAddr>),
    /// The adapter is active but its servers could not be read. Unknown is never "empty": it can
    /// neither prove the adapter off Tono nor leave it out of the verification.
    Unknown,
}

/// The address families of one adapter to put back on automatic (DHCP).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct FamilyReset {
    pub(super) v4: bool,
    pub(super) v6: bool,
}

impl FamilyReset {
    pub(super) fn any(self) -> bool {
        self.v4 || self.v6
    }
}

/// What the emergency reset has to do about one adapter, and whether it can be proven.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Assessment {
    /// The families still on a Tono resolver that nothing will answer.
    pub(super) reset: FamilyReset,
    /// The adapter is recorded in the snapshot or reads as Tono in the registry, and its
    /// effective servers are unknown: nothing proves it off Tono.
    pub(super) unproven: bool,
}

/// Whether, per address family, an adapter is still pointed at a Tono resolver that nothing will
/// answer, so the emergency reset has to put that family on automatic (DHCP).
///
/// `adapter` is the registry as it reads now, `recorded` the adapter's entry in the saved
/// snapshot (the user's originals), `effective` the DNS Client's own resolver list. The registry
/// alone is not enough: the exact restore writes the user's registry values back even when its
/// live apply failed, so a family can read as restored in the registry while it still resolves
/// through Tono.
///
/// * The Tono-only endpoint (`198.18.0.2`) in either view is Tono's by itself: no user owns that
///   address, whatever the saved original was.
/// * A plain loopback (`127.0.0.1` / `::1`, what an older build wrote) is Tono's only for an
///   adapter the snapshot recorded, and a family stays exempt only while the user's own saved
///   loopback is what both its registry and its effective list still hold. On an adapter the
///   snapshot never recorded it is the user's own local resolver (Pi-hole, Acrylic).
/// * An unreadable effective list leaves a family that reads as the user's own where it is, but
///   marks the adapter `unproven`: unknown is never evidence of a clean machine.
/// * An IPv6 family with no static server follows an IPv4 family that is reset, as the uninstall
///   ladder resets both, so a protected-empty IPv6 does not stay behind.
pub(super) fn assess_adapter(
    adapter: &AdapterDnsSnapshot,
    recorded: Option<&AdapterDnsSnapshot>,
    effective: &EffectiveDns,
) -> Assessment {
    let servers = match effective {
        EffectiveDns::Servers(servers) => Some(servers.as_slice()),
        EffectiveDns::NotActive | EffectiveDns::Unknown => None,
    };
    let mut reset = FamilyReset::default();
    for ipv6 in [false, true] {
        let (name, profile) = if ipv6 {
            (&adapter.ipv6_name_server, &adapter.ipv6_profile_name_server)
        } else {
            (&adapter.ipv4_name_server, &adapter.ipv4_profile_name_server)
        };
        let live: Vec<std::net::IpAddr> = servers
            .map(|servers| servers.iter().copied().filter(|ip| ip.is_ipv6() == ipv6).collect())
            .unwrap_or_default();
        let found = classify_effective_servers(&live);
        let registry_endpoint = contains_current_protected_v4(name.as_deref())
            || contains_current_protected_v4(profile.as_deref());
        let on_tono = if registry_endpoint || found.endpoint {
            true
        } else if is_tono_dns_value(name.as_deref())
            || is_tono_dns_value(profile.as_deref())
            || found.tono_owned_family
        {
            // A plain loopback: Tono's only where the snapshot says the user did not have it.
            recorded.is_some_and(|saved| !family_is_users_own_loopback(saved, name, profile, &live, effective, ipv6))
        } else {
            false
        };
        if on_tono {
            if ipv6 {
                reset.v6 = true;
            } else {
                reset.v4 = true;
            }
        }
    }
    let no_static_v6 = parse_name_server_list(adapter.ipv6_name_server.as_deref().unwrap_or_default()).is_empty()
        && parse_name_server_list(adapter.ipv6_profile_name_server.as_deref().unwrap_or_default()).is_empty();
    if reset.v4 && no_static_v6 {
        reset.v6 = true;
    }
    Assessment {
        reset,
        unproven: matches!(effective, EffectiveDns::Unknown)
            && (recorded.is_some() || adapter_reads_as_tono_dns(adapter)),
    }
}

/// Whether one family still holds the user's own saved local resolver in both views: the saved
/// original is a loopback, the registry equals it, and the effective list (when it was read and
/// has servers in this family) is exactly it.
fn family_is_users_own_loopback(
    saved: &AdapterDnsSnapshot,
    name: &Option<String>,
    profile: &Option<String>,
    live: &[std::net::IpAddr],
    effective: &EffectiveDns,
    ipv6: bool,
) -> bool {
    let (saved_name, saved_profile) = if ipv6 {
        (&saved.ipv6_name_server, &saved.ipv6_profile_name_server)
    } else {
        (&saved.ipv4_name_server, &saved.ipv4_profile_name_server)
    };
    let saved_loopback =
        is_loopback_value(saved_name.as_deref()) || is_loopback_value(saved_profile.as_deref());
    if !saved_loopback || name != saved_name || profile != saved_profile {
        return false;
    }
    match effective {
        EffectiveDns::NotActive | EffectiveDns::Unknown => true,
        EffectiveDns::Servers(_) => {
            // The profile value overrides the name value when it is set.
            let saved_list = parse_name_server_list(
                saved_profile
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .or(saved_name.as_deref())
                    .unwrap_or_default(),
            );
            let saved_servers: std::collections::BTreeSet<std::net::IpAddr> =
                saved_list.iter().filter_map(|server| server.parse().ok()).collect();
            let live_servers: std::collections::BTreeSet<std::net::IpAddr> = live.iter().copied().collect();
            live_servers.is_empty() || live_servers == saved_servers
        }
    }
}

/// What the emergency reset reads and verifies: the candidate adapters as the registry reads
/// them, each with its effective state, and the snapshot adapters whose registry could not be
/// read at all.
struct DnsState {
    adapters: Vec<(AdapterDnsSnapshot, EffectiveDns)>,
    unreadable: Vec<String>,
}

/// The candidate adapters are the snapshot's adapters together with the currently active ones.
/// The active enumeration alone is not enough: an adapter that is offline (disabled, unplugged)
/// is absent from it while its registry still holds whatever the exact restore failed to
/// replace, and it resolves through that the moment it returns. A snapshot adapter that is not
/// active is read from the registry by GUID (registry only: it has no effective list), and one
/// whose registry cannot be read is `unreadable`, never "restored". An effective read that fails
/// as a whole makes every adapter's state unknown.
async fn read_dns_state(snapshot: Option<&DnsSnapshot>) -> Result<DnsState> {
    let mut adapters = collect_dns_adapters().await?;
    let mut unreadable = Vec::new();
    if let Some(snapshot) = snapshot {
        let absent: Vec<String> = snapshot
            .adapters
            .iter()
            .map(|saved| saved.interface_guid.clone())
            .filter(|guid| !adapters.iter().any(|active| same_adapter_guid(&active.interface_guid, guid)))
            .collect();
        if !absent.is_empty() {
            match engine_read_registry_adapters(&absent).await {
                Ok(read) => {
                    for (guid, adapter) in read {
                        match adapter {
                            Some(adapter) => adapters.push(adapter),
                            None => unreadable.push(guid),
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!("dns: the registry DNS values of the inactive snapshot adapters could not be read: {error:#}");
                    unreadable = absent;
                }
            }
        }
    }
    let effective = engine_effective_dns(&adapters).await;
    if let Err(error) = &effective {
        tracing::warn!("dns: the effective DNS of the adapters could not be read: {error:#}");
    }
    let adapters = adapters
        .into_iter()
        .map(|adapter| {
            let state = match &effective {
                Err(_) => EffectiveDns::Unknown,
                Ok(read) => match read
                    .iter()
                    .find(|(guid, _)| same_adapter_guid(guid, &adapter.interface_guid))
                {
                    None => EffectiveDns::NotActive,
                    Some((_, None)) => EffectiveDns::Unknown,
                    Some((_, Some(servers))) => EffectiveDns::Servers(servers.clone()),
                },
            };
            (adapter, state)
        })
        .collect();
    Ok(DnsState { adapters, unreadable })
}

/// The adapter reset that answers a failed exact DNS restore, shared by its two callers: the
/// non-uninstall emergency disarm (one attempt, after WFP is gone) and the freshly started main
/// Service (which retries it while the engine is busy). `--emergency-disarm` and the Start-Menu
/// entry run the uninstall ladder instead and never reach this.
///
/// Owner rule: a released machine resolves through the home broadband's DNS, never through a
/// dead Tono resolver. So, like rung 2 of the uninstall ladder, the address families that still
/// read as a Tono target are put back on automatic (DHCP), and then the machine-wide resolver
/// policy (the NRPT catch-all and the Encrypted DNS pin) is removed. Differences from the
/// ladder, on purpose:
///
/// * Only families that are on a Tono target *right now* are touched, by registry and by the
///   DNS Client's effective list together ([`assess_adapter`]). The snapshot may list adapters
///   an earlier partial restore already put back exactly; resetting those to DHCP would destroy
///   the static servers the user chose.
/// * The reset is verified like the ladder's rung 2, over *every* candidate and not just the
///   reset subset: every adapter recorded in the snapshot and every adapter on a Tono target by
///   registry or effective list is read again. Any that still reads as a Tono target, or whose
///   effective state is unknown, fails the fallback ("could not be proven"), whatever the apply
///   reported. An empty selection is only a success when every candidate was actually read.
/// * The snapshot file is kept under its own name, so a later exact restore can still replay the
///   user's saved servers.
///
/// It never waits for the engine. A restore that timed out leaves its engine call running on a
/// blocking thread with the single-writer claim, which can be held for an unbounded time, so
/// every engine call is then refused at once; this function returns that refusal immediately
/// (check it with [`is_engine_busy_refusal`]) and leaves it to the caller to try again later.
///
/// The adapter reset and the policy restore are independent: a failure of one does not skip the
/// other (unless the engine is busy, which refuses both), and the first error is returned. The
/// strict `restore_protected` / `ensure_restored` / `disarm_unlocked` gate is untouched.
pub(crate) async fn reset_redirected_adapters_to_automatic() -> Result<Vec<String>> {
    if !SUPPORTED {
        return Ok(Vec::new());
    }
    let _operation = DNS_OPERATION.lock().await;
    let reset = reset_adapters_still_on_tono_dns().await;
    if let Err(error) = &reset {
        if is_engine_busy_refusal(error) {
            return reset;
        }
    }
    let policy = restore_resolver_policy().await;
    if let Err(error) = &policy {
        tracing::error!("dns: the resolver policy could not be removed after a failed restore: {error:#}");
    }
    if let Ok(Some(note)) = &policy {
        tracing::warn!("dns: {note}");
    }
    let adapters = reset?;
    policy?;
    Ok(adapters)
}

/// The adapters of `state` that still need a reset or cannot be proven off Tono, as
/// `(guid, assessment)`. A snapshot adapter whose registry could not be read is unproven.
fn unresolved_adapters(state: &DnsState, snapshot: Option<&DnsSnapshot>) -> Vec<(String, Assessment)> {
    let mut unresolved: Vec<(String, Assessment)> = state
        .adapters
        .iter()
        .filter_map(|(adapter, effective)| {
            let recorded = snapshot.and_then(|snapshot| {
                snapshot
                    .adapters
                    .iter()
                    .find(|saved| same_adapter_guid(&saved.interface_guid, &adapter.interface_guid))
            });
            let assessment = assess_adapter(adapter, recorded, effective);
            (assessment.reset.any() || assessment.unproven)
                .then(|| (adapter.interface_guid.clone(), assessment))
        })
        .collect();
    unresolved.extend(
        state
            .unreadable
            .iter()
            .map(|guid| (guid.clone(), Assessment { unproven: true, ..Assessment::default() })),
    );
    unresolved
}

async fn reset_adapters_still_on_tono_dns() -> Result<Vec<String>> {
    let snapshot = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => parse_snapshot(&bytes).ok(),
        Err(_) => None,
    };
    let before = read_dns_state(snapshot.as_ref()).await?;
    let resets: Vec<(AdapterDnsSnapshot, FamilyReset)> = before
        .adapters
        .iter()
        .filter_map(|(adapter, effective)| {
            let recorded = snapshot.as_ref().and_then(|snapshot| {
                snapshot
                    .adapters
                    .iter()
                    .find(|saved| same_adapter_guid(&saved.interface_guid, &adapter.interface_guid))
            });
            let reset = assess_adapter(adapter, recorded, effective).reset;
            reset.any().then(|| (adapter.clone(), reset))
        })
        .collect();
    let applied: Vec<String> = resets.iter().map(|(adapter, _)| adapter.interface_guid.clone()).collect();
    let after = if resets.is_empty() {
        // Nothing to write, so what was just read is the state to verify.
        before
    } else {
        let results = engine_reset_families(&resets).await?;
        if let Some((guid, _)) = results.iter().find(|(_, ok)| !*ok) {
            tracing::warn!("dns: the automatic (DHCP) DNS reset reported a failure for adapter {guid}");
        }
        if let Err(error) = engine_flush_cache().await {
            tracing::warn!("DNS cache flush after the DHCP reset failed: {error:#}");
        }
        // The read-back, not the apply report, is the proof: the registry write and the live
        // apply are independent, and a reset the DNS Client has not adopted leaves the machine on
        // the dead resolver.
        read_dns_state(snapshot.as_ref()).await?
    };
    let unresolved = unresolved_adapters(&after, snapshot.as_ref());
    if unresolved.is_empty() {
        return Ok(applied);
    }
    let named = unresolved
        .iter()
        .map(|(guid, assessment)| {
            let reason = if assessment.reset.any() {
                "still on Tono's DNS"
            } else if after.unreadable.iter().any(|unreadable| same_adapter_guid(unreadable, guid)) {
                "registry unreadable"
            } else {
                "effective DNS unknown"
            };
            format!("{guid} ({reason})")
        })
        .collect::<Vec<_>>()
        .join(", ");
    tracing::error!("dns: the automatic (DHCP) fallback could not be proven: {named}");
    bail!("the automatic (DHCP) fallback could not be proven off Tono's DNS target: {named}")
}
