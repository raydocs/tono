use super::*;

// --- Engine boundary (registry + CIM on Windows; stubs elsewhere) ---

/// Budget for one *reading* DNS engine call (registry sweep + `GetAdaptersAddresses`). A
/// healthy enumeration is milliseconds; 25 s is the same clock `WFP_CALL_TIMEOUT` uses, so the
/// two modules give up on a wedged kernel/service at the same point, and it leaves the
/// surrounding `IPC_HANDLER_TIMEOUT` = 60 s more than half its budget to answer the client.
#[cfg(all(windows, not(feature = "test")))]
pub(super) const DNS_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
/// Budget for a *mutating* call (protected-DNS apply / snapshot restore). Longer than the reading
/// budget on purpose: this path already contains two internally bounded PowerShell batches
/// (2 × `engine::POWERSHELL_TIMEOUT` = 20 s) plus the registry sweep, and an outer bound below
/// its own inner bound would report a merely slow machine as wedged and refuse a restore that
/// was still making progress. It stays below `windows_kill_switch::DNS_RESTORE_TIMEOUT` = 40 s
/// so that a wedged DNS engine is named by *this* module's marker instead of being swallowed by
/// the cross-module bound, and because the first expiry latches the in-flight claim, one handler
/// can stall for at most one budget no matter how many engine calls its path makes (`enable`
/// makes up to six).
#[cfg(all(windows, not(feature = "test")))]
pub(super) const DNS_APPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Budget for the best-effort cache flush: `LoadLibraryW("dnsapi.dll")` + a `DnsFlushResolver
/// Cache` RPC to the Dnscache service (no timeout parameter of its own) and, failing that, a
/// 5 s `ipconfig /flushdns`. Short, because a flush that never returns must not eat the
/// mutating budget — its failure is only logged, but the claim it leaves behind is what keeps
/// the next operation from piling a second thread onto a wedged Dnscache.
#[cfg(all(windows, not(feature = "test")))]
pub(super) const DNS_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// Anything slower than this is already pathological. Set above a PowerShell cold start
/// (~1 s), which the mutating path legitimately pays, so the warning means "degrading", not
/// "busy".
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) const DNS_SLOW_CALL: std::time::Duration = std::time::Duration::from_secs(5);

/// A DNS engine call that was handed to a blocking thread and has not come back yet.
///
/// Registered *before* the thread is spawned and released *only* by that thread — never by the
/// caller. Same asymmetry as `windows_kill_switch::EngineCallInFlight`: a caller that hits its
/// deadline gives up on the *answer*, not on the *ownership*.
#[cfg(any(all(windows, not(feature = "test")), test))]
#[derive(Debug, Clone, Copy)]
pub(super) struct DnsCallInFlight {
    operation: &'static str,
    started_at: std::time::Instant,
    /// Epoch of this call. The releasing guard only clears its own epoch, so a call that
    /// returns very late can never erase the claim of a call that started after it.
    epoch: u64,
    /// Its caller already timed out and reported failure; the result is discarded on arrival.
    abandoned: bool,
}

#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) static DNS_CALL_IN_FLIGHT: Lazy<Mutex<Option<DnsCallInFlight>>> = Lazy::new(|| Mutex::new(None));
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) static DNS_CALL_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) fn dns_call_slot() -> std::sync::MutexGuard<'static, Option<DnsCallInFlight>> {
    DNS_CALL_IN_FLIGHT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
pub(super) fn dns_call_in_flight() -> Option<DnsCallInFlight> {
    *dns_call_slot()
}

/// Refusal for a caller that wants to start an engine call while an earlier one is still
/// inside the loader/registry/Dnscache. Fail-closed: nothing is applied, nothing is restored,
/// nothing is deleted, and the machine keeps whatever the last completed call left behind —
/// which for the restore path means the snapshot survives and the kill switch stays armed.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) fn wedged_dns_error(operation: &str, wedged: DnsCallInFlight) -> anyhow::Error {
    anyhow::anyhow!(
        "{DNS_ENGINE_WEDGED_PREFIX}: the DNS engine has been inside {} for {:?} without \
         returning, so {operation} is refused rather than started as a second concurrent \
         writer. The DNS Client service (Dnscache), a registry filter driver or third-party \
         security software is likely wedged; protected DNS stays in its last known state — \
         including its snapshot — until that call returns or the machine is restarted.",
        wedged.operation,
        wedged.started_at.elapsed(),
    )
}

/// Dropped on the blocking thread the instant the engine call returns — on time, or hours
/// late. This is the *only* place an in-flight claim is released, and it releases only its own
/// epoch.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) struct DnsCallClaim(u64);

#[cfg(any(all(windows, not(feature = "test")), test))]
impl Drop for DnsCallClaim {
    fn drop(&mut self) {
        let mut slot = dns_call_slot();
        let Some(current) = *slot else { return };
        if current.epoch != self.0 {
            return;
        }
        *slot = None;
        if current.abandoned {
            // The caller reported failure long ago; this is the log line that says the engine
            // is alive again. The call's own result was dropped with its `JoinHandle`, so it
            // cannot contradict what was already reported.
            tracing::error!(
                "dns: {} finally returned after {:?}; its caller had already given up, the \
                 result is discarded, and DNS operations are accepted again",
                current.operation,
                current.started_at.elapsed(),
            );
        }
    }
}

/// The status watchdog reads every `DNS_WATCHDOG_INTERVAL`: only the rare, mutating operations
/// may announce themselves at info, or the service log would carry two lines every two seconds
/// forever.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) fn dns_call_is_periodic(operation: &str) -> bool {
    operation == "collect" || operation == "verify protected DNS"
}

/// Run one DNS engine operation on a blocking thread under a hard deadline, holding the
/// single-writer claim described on [`DnsCallInFlight`].
///
/// These calls are synchronous registry/IP-helper/CIM/Dnscache work, so they run off the IPC
/// runtime. They are also bounded, because on a real machine `DnsFlushResolverCache` (an RPC
/// to a wedged Dnscache), `LoadLibraryW` behind an AV image-load callback, or a registry sweep
/// behind a filter driver can block forever — and `spawn_blocking` cannot be cancelled: the
/// thread keeps running whatever the caller does.
///
/// Single-writer argument for the timeout path:
/// * the claim is registered *before* the thread is spawned and released only by that thread,
///   in `DnsCallClaim::drop`, when the blocking call actually returns;
/// * a caller that hits its deadline returns an error and leaves the claim standing, so every
///   later DNS engine call — this operation's, the next handler's, the watchdog's — fails fast
///   here instead of stacking a second writer on the same registry keys and adapters;
/// * the abandoned task can publish nothing: it only touches `engine::*`, its return value dies
///   with the `JoinHandle` the deadline dropped, and its claim release is keyed to its own
///   epoch, so it cannot clear a claim taken by a later call.
///
/// The facade's `DNS_OPERATION` lock alone cannot provide this: it is released as soon as the
/// timing-out caller returns, which is exactly when the abandoned thread is still working.
///
/// The machinery is compiled off Windows too, so those ownership rules stay unit-testable;
/// only the closures handed to it are Windows-only.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) async fn bounded_dns_call<T: Send + 'static>(
    budget: std::time::Duration,
    operation: &'static str,
    call: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let epoch = {
        let mut slot = dns_call_slot();
        if let Some(wedged) = *slot {
            return Err(wedged_dns_error(operation, wedged));
        }
        let epoch = DNS_CALL_EPOCH.fetch_add(1, Ordering::AcqRel);
        *slot = Some(DnsCallInFlight {
            operation,
            started_at: std::time::Instant::now(),
            epoch,
            abandoned: false,
        });
        epoch
    };
    let announce = !dns_call_is_periodic(operation);
    if announce {
        tracing::info!("dns: {operation} starting");
    } else {
        tracing::debug!("dns: {operation} starting");
    }
    let started_at = std::time::Instant::now();
    let task = tokio::task::spawn_blocking(move || {
        // Local, so it drops (releasing the claim) after `call` returns and before the result
        // reaches the awaiting caller.
        let _claim = DnsCallClaim(epoch);
        call()
    });
    match tokio::time::timeout(budget, task).await {
        Ok(joined) => {
            let elapsed = started_at.elapsed();
            if elapsed >= DNS_SLOW_CALL {
                tracing::warn!(
                    "dns: {operation} finished in {}ms — the engine is answering, but far slower \
                     than a healthy call",
                    elapsed.as_millis()
                );
            } else if announce {
                tracing::info!("dns: {operation} finished in {}ms", elapsed.as_millis());
            } else {
                tracing::debug!("dns: {operation} finished in {}ms", elapsed.as_millis());
            }
            joined.context("DNS engine task failed")?
        }
        Err(_) => {
            // Claim the abandonment by epoch instead of writing the slot: the call may have
            // returned in the instant between the deadline and this line, in which case its
            // guard already cleared the slot and nothing is wedged.
            let still_running = {
                let mut slot = dns_call_slot();
                match slot.as_mut() {
                    Some(current) if current.epoch == epoch => {
                        current.abandoned = true;
                        true
                    }
                    _ => false,
                }
            };
            if still_running {
                tracing::error!(
                    "dns: {operation} did not return within {budget:?} and is still running; \
                     every further DNS operation fails fast until it returns"
                );
            } else {
                tracing::error!(
                    "dns: {operation} returned just after its {budget:?} deadline; its result was \
                     discarded and the caller was told it failed"
                );
            }
            bail!(
                "{DNS_ENGINE_WEDGED_PREFIX}: the DNS engine did not answer within {budget:?} \
                 during {operation}; the DNS Client service (Dnscache), a registry filter driver \
                 or third-party security software may be wedged. Protected DNS was left in its \
                 last known state, its snapshot was kept, and no further DNS operation starts \
                 until the pending call returns."
            )
        }
    }
}

pub(super) async fn engine_collect() -> Result<Vec<AdapterDnsSnapshot>> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        bounded_dns_call(DNS_CALL_TIMEOUT, "collect", engine::collect_adapters).await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(test_hooks::collected_adapters())
    }
}

/// Collect only adapters whose Windows resolver configuration Tono owns. The tunnel exclusion
/// inside [`without_current_tunnel`] uses the WFP-validated runtime LUID while a core is alive
/// and the WinTUN connection name once it is not, so a stale tunnel adapter left by an orphaned
/// core can never re-enter a snapshot or a restore proof.
pub(super) async fn collect_dns_adapters() -> Result<Vec<AdapterDnsSnapshot>> {
    let adapters = engine_collect().await?;
    let current_tunnel_luid = crate::core::windows_kill_switch::protected_tunnel_luid().await;
    Ok(without_current_tunnel(adapters, current_tunnel_luid))
}

pub(super) async fn engine_collect_interface_keys() -> Result<Vec<AdapterDnsSnapshot>> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        bounded_dns_call(
            DNS_CALL_TIMEOUT,
            "collect registry interfaces",
            engine::collect_interface_key_adapters,
        )
        .await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(test_hooks::collected_adapters())
    }
}

/// Every interface the registry knows about, active or not: the `Parameters\Interfaces` key
/// spaces outlive the active set (disabled, unplugged and removed adapters keep their last
/// written DNS values), and a TUN endpoint parked on an inactive adapter is invisible to
/// [`collect_dns_adapters`]. Excludes the tunnel adapter exactly like it, by connection name
/// when the core is gone — the registry view carries no LUID — and additionally drops
/// [`is_inactive_tunnel_interface_key`] keys, which the name cannot cover once the WinTUN
/// device (and with it, possibly, its `Connection` key) is gone.
pub(super) async fn collect_registry_interface_adapters() -> Result<Vec<AdapterDnsSnapshot>> {
    let adapters = engine_collect_interface_keys().await?;
    let current_tunnel_luid = crate::core::windows_kill_switch::protected_tunnel_luid().await;
    let active = collect_dns_adapters().await?;
    Ok(without_current_tunnel(adapters, current_tunnel_luid)
        .into_iter()
        .filter(|adapter| !is_inactive_tunnel_interface_key(adapter, &active))
        .collect())
}

/// A name-independent tunnel exclusion for the registry view. The WinTUN interface key gets its
/// `NameServer` from the TUN inbound's `dns_address` (sing-box sets it through the interface DNS
/// API, which writes `NameServer` only), and that key can outlive the device it belonged to.
/// Tono's own protected apply (`engine::apply_protected`) always writes IPv4 `NameServer`
/// *and* `ProfileNameServer` — `ProfileNameServer` first, so even an apply stopped between the
/// two writes cannot leave this shape behind. A key that is not active, holds exactly the TUN
/// DNS address in IPv4 `NameServer` and nothing in any other value is the tunnel's shape, not
/// a real adapter Tono redirected. Anything else — a profile value, a mixed list (#293), a legacy
/// loopback, an IPv6 server, or an active adapter — stays in the evidence. A real adapter
/// misread here is not recorded as an original either: if it comes back, enable meets it as
/// unrecorded and [`ensure_unrecorded_adapters_are_safe`] heals or refuses it.
pub(super) fn is_inactive_tunnel_interface_key(
    adapter: &AdapterDnsSnapshot,
    active: &[AdapterDnsSnapshot],
) -> bool {
    let empty =
        |value: Option<&str>| value.is_none_or(|value| parse_name_server_list(value).is_empty());
    let is_active = active
        .iter()
        .any(|live| live.interface_guid.eq_ignore_ascii_case(&adapter.interface_guid));
    let tun_dns_only = adapter
        .ipv4_name_server
        .as_deref()
        .is_some_and(|value| parse_name_server_list(value) == [PROTECTED_DNS_V4]);
    !is_active
        && tun_dns_only
        && empty(adapter.ipv4_profile_name_server.as_deref())
        && empty(adapter.ipv6_name_server.as_deref())
        && empty(adapter.ipv6_profile_name_server.as_deref())
}

/// The corrupt-snapshot recovery's live question — does any interface the registry knows
/// about still read as pointed at a Tono resolver — answered from that registry view itself.
/// Test-feature builds additionally keep the contract [`engine_any_loopback`] established
/// while this evidence still flowed through it: there `set_live_dns_on_loopback` is the
/// stand-in for the whole machine state, and a recovery that ignored it would only ever see
/// the empty default of `test_hooks::collected_adapters` — the fail-closed half of the
/// corrupt-snapshot contract would be unreachable in every lifecycle test. The two answers
/// are OR-ed, never AND-ed, so a registry view a fixture does populate stays authoritative
/// and the combined answer can only lean further closed.
pub(super) fn registry_interfaces_read_as_tono_dns(adapters: &[AdapterDnsSnapshot]) -> bool {
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        if test_hooks::live_dns_is_on_loopback() {
            return true;
        }
    }
    adapters.iter().any(adapter_reads_as_tono_dns)
}

pub(super) async fn engine_apply_protected(adapters: &[AdapterDnsSnapshot]) -> Result<Vec<(String, bool)>> {
    // The only two writers of adapter DNS are this and `engine_apply_snapshot`; both mark the
    // window so `netmon` does not report our own writes as the machine's network changing.
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_APPLY_TIMEOUT, "apply protected DNS", move || {
            hold_self_write_across_the_write(|| engine::apply_protected_set(&guids))
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        // The stub models the two shapes the real engine fails in, because the difference is now
        // the difference between a hard failure and a recorded one:
        //   * the batch cannot be run at all — no adapter touched, no per-adapter outcome;
        //   * the batch runs and reports per-adapter live failures while the registry write
        //     underneath it landed (the real-machine case).
        if test_hooks::apply_batch_unavailable() {
            bail!("the DNS apply batch could not be run at all (test hook)");
        }
        let ok = !test_hooks::live_apply_fails();
        Ok(adapters
            .iter()
            .map(|adapter| (adapter.interface_guid.clone(), ok))
            .collect())
    }
}

pub(super) async fn engine_apply_snapshot(snapshot: &DnsSnapshot) -> Result<Vec<(String, bool)>> {
    // Restore writes the same per-adapter registry values and runs the legacy CIM/netsh
    // batch, so it raises the same notifications and gets the same self-write window.
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        let snapshot = snapshot.clone();
        return bounded_dns_call(DNS_APPLY_TIMEOUT, "restore snapshot", move || {
            hold_self_write_across_the_write(|| engine::apply_snapshot(&snapshot))
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        // The stub reports success unless a test asks for the machine condition that produced
        // the real-machine deadlock: a live apply that fails while the registry restore behind
        // it succeeds (`engine::apply_snapshot` writes the four registry values whatever the
        // PowerShell batch reported).
        let ok = !test_hooks::live_apply_fails();
        // A successful *automatic (DHCP)* reset takes the machine off the loopback resolver, so
        // the stubbed live read has to start answering that way — otherwise rung 2 of the
        // uninstall ladder is unreachable in every test build. The stub models "the reset lands
        // completely or not at all"; on a real machine the registry deletion is independent of
        // the PowerShell batch, which is precisely why rung 2 verifies on the reported machine
        // even though its live apply keeps failing.
        if ok && is_automatic_reset(snapshot) {
            #[cfg(test)]
            test_hooks::note_automatic_reset();
            test_hooks::set_live_dns_on_loopback(false);
        }
        Ok(snapshot
            .adapters
            .iter()
            .map(|adapter| (adapter.interface_guid.clone(), ok))
            .collect())
    }
}

/// Whether this snapshot is the uninstall ladder's automatic (DHCP) reset: a non-empty adapter
/// list in which every entry has all four values absent. "Absent" is what the engine turns into
/// a registry delete and a DHCP live apply, so this is a precise structural test rather than a
/// flag that could drift from what is actually applied.
#[cfg(any(test, not(all(windows, not(feature = "test")))))]
pub(super) fn is_automatic_reset(snapshot: &DnsSnapshot) -> bool {
    !snapshot.adapters.is_empty()
        && snapshot.adapters.iter().all(|adapter| {
            adapter.ipv4_name_server.is_none()
                && adapter.ipv4_profile_name_server.is_none()
                && adapter.ipv6_name_server.is_none()
                && adapter.ipv6_profile_name_server.is_none()
        })
}

pub(super) async fn engine_all_loopback(adapters: &[AdapterDnsSnapshot]) -> Result<bool> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_CALL_TIMEOUT, "verify protected DNS", move || {
            engine::all_loopback(&guids)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = adapters;
        Ok(false)
    }
}

/// Whether any adapter still resolves through a current or legacy Tono protected DNS target —
/// "is any of it left?", the mirror of `engine_all_loopback`'s "is protection complete?".
///
/// Two callers: the snapshot-less recovery, and the restore proof itself, which needs positive
/// live evidence that the machine is not being left pointed at a core that is about to stop
/// answering (see [`restore_is_proven`]). The restore proof narrows the adapter list first
/// ([`adapters_owing_live_proof`]).
pub(super) async fn engine_any_loopback(adapters: &[AdapterDnsSnapshot]) -> Result<bool> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_CALL_TIMEOUT, "detect Tono DNS", move || {
            engine::any_loopback(&guids)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = adapters;
        // Without this hook the stub would always answer "not on loopback", which makes the
        // unproven-restore branch — the fail-closed half of the corrupt-snapshot contract —
        // unreachable in every test build. A test that cannot fail is worse than none.
        Ok(test_hooks::live_dns_is_on_loopback())
    }
}

pub(super) async fn engine_flush_cache() -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(DNS_FLUSH_TIMEOUT, "flush", engine::flush_resolver_cache).await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

pub(super) async fn engine_suppress_encrypted_dns() -> Result<()> {
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(
            DNS_APPLY_TIMEOUT,
            "suppress encrypted DNS",
            || hold_self_write_across_the_write(engine::suppress_encrypted_dns),
        )
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

pub(super) async fn engine_restore_encrypted_dns() -> Result<bool> {
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(
            DNS_APPLY_TIMEOUT,
            "restore encrypted DNS",
            || hold_self_write_across_the_write(engine::restore_encrypted_dns),
        )
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        #[cfg(test)]
        test_hooks::note_encrypted_restore();
        if test_hooks::encrypted_restore_fails() {
            bail!("injected Tono NRPT removal failure");
        }
        Ok(false)
    }
}

/// Retire capture-loss evidence after a committed restore surfaced it (see
/// [`settle_capture_loss`]). File moves only; no resolver policy is touched.
pub(super) async fn engine_retire_lost_captures() -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(
            DNS_CALL_TIMEOUT,
            "retire lost encrypted-DNS captures",
            engine::retire_lost_captures,
        )
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

/// Only an operational adapter with a **bound IP stack** has a live resolver that can leak DNS.
/// Registry interface keys outlive disabled and removed adapters, while the software loopback
/// has no configurable DNS instance; including either class makes one irrelevant apply failure
/// abort protection for every real adapter.
///
/// Link state alone is not that test: a Hyper-V internal vSwitch, `vEthernet (WSL)` before
/// configuration, a Bluetooth PAN, a TAP adapter with no bound IP stack, or our own WinTUN
/// adapter mid-initialisation are all `OperStatus == Up` with nothing to configure. They used
/// to land in the failure list on every round, which persisted a `live_apply_failed` flag,
/// pinned `needs_loopback_replay` on forever, and made both the watchdog's repair loop and the
/// restore proof permanently unsatisfiable. `has_bound_ip` is the IP-Helper equivalent of
/// `IPEnabled`: at least one unicast address *and* a non-zero interface index in at least one
/// family. Adapters that fail it are non-participants — they have no resolver to protect — not
/// failures.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) fn is_active_dns_adapter(oper_status: i32, if_type: u32, has_bound_ip: bool) -> bool {
    const IF_OPER_STATUS_UP: i32 = 1;
    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    oper_status == IF_OPER_STATUS_UP && if_type != IF_TYPE_SOFTWARE_LOOPBACK && has_bound_ip
}
