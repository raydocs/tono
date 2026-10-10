use super::*;

/// Stable marker for "protected DNS is applied, but the resolver policy Windows actually applies
/// disagrees with it" (X2-2): another NRPT rule sends names to a non-Tono resolver, Tono's
/// catch-all is not the rule in force, or a cache-bypassing system lookup did not come back from
/// Tono DNS. Adapter registry health cannot see any of these, so the status carries the verdict
/// in its advisory `resolver_policy_warning`, never in `last_error`: the adapters are still
/// protected, and every gate that reads `last_error` (update admission, startup takeover, the
/// App's lost-response read-back) must not close over a policy Tono cannot change.
/// It is deliberately not repair work for the watchdog: `enable` rewrites only Tono's own rule and
/// cannot change group policy or a VPN profile, so re-running it would only spin.
pub(crate) const DNS_RESOLVER_POLICY_CONFLICT_PREFIX: &str = "TONO_DNS_POLICY_CONFLICT";

/// One NRPT rule from the store the DNS Client applies (X2-2).
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct EffectiveNrptRule {
    /// `Name` namespaces; `"."` is the catch-all.
    pub(crate) namespaces: Vec<String>,
    /// `GenericDNSServers` of a rule whose options select them; empty otherwise.
    pub(crate) generic_dns_servers: Vec<String>,
    /// Tono's own catch-all key in the local store.
    pub(crate) tono_owned: bool,
}

/// The name of the cache-bypassing system lookup: the same name the App's connect-time fake-ip
/// proof uses, so a healthy answer is a Tono fake-ip.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) const RESOLVER_POLICY_PROBE_HOST: &str = "www.google.com";
/// How often the watchdog re-reads the effective policy and repeats the system lookup.
pub(super) const RESOLVER_POLICY_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
/// The last policy verdict, written by [`refresh_resolver_policy_observation`] and folded into
/// every status observation while protection is wanted.
pub(super) static RESOLVER_POLICY_CONFLICT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Pure X2-2 verdict over the effective NRPT and one cache-bypassing system lookup. Only an
/// observation that succeeded and contradicts protected DNS is a conflict. A read or lookup that
/// failed proves nothing either way: during a protected reconnect Core restarts and every lookup
/// fails for a few seconds, and a Core that stays down is not another owner's resolver policy.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn resolver_policy_conflict(
    rules: std::result::Result<&[EffectiveNrptRule], &str>,
    system_lookup: std::result::Result<&[std::net::Ipv4Addr], &str>,
) -> Option<String> {
    let mut reasons = Vec::new();
    // An NRPT read that failed is undecidable, not a conflict.
    if let Ok(rules) = rules {
        let catch_all_in_force = rules.iter().any(|rule| {
            rule.tono_owned
                && rule.namespaces.iter().any(|name| name == ".")
                && !rule.generic_dns_servers.is_empty()
                && rule.generic_dns_servers.iter().all(|server| server == PROTECTED_DNS_V4)
        });
        if !catch_all_in_force {
            reasons.push("Tono's NRPT catch-all is not the rule in force".to_owned());
        }
        let foreign = rules
            .iter()
            .filter(|rule| {
                !rule.tono_owned
                    && rule.generic_dns_servers.iter().any(|server| server != PROTECTED_DNS_V4)
            })
            .count();
        if foreign > 0 {
            reasons.push(format!(
                "{foreign} other NRPT rule(s) send matching names to a non-Tono resolver"
            ));
        }
    }
    // Likewise a failed lookup: only an answer that did not come from Tono DNS is a conflict.
    if system_lookup
        .is_ok_and(|addresses| !addresses.iter().any(|address| address.octets()[..2] == [198, 18]))
    {
        reasons.push("a cache-bypassing system lookup was not answered by Tono DNS".to_owned());
    }
    (!reasons.is_empty())
        .then(|| format!("{DNS_RESOLVER_POLICY_CONFLICT_PREFIX}: {}", reasons.join("; ")))
}

/// Re-read the effective resolver policy and repeat one cache-bypassing system lookup. Runs
/// outside `DNS_OPERATION`: a lookup that policy sends to a resolver WFP drops waits out the DNS
/// Client's own timeout, and no restore or repair may queue behind it.
pub(super) async fn refresh_resolver_policy_observation() {
    let verdict = if PROTECTION_WANTED.load(Ordering::Acquire) {
        observe_resolver_policy().await
    } else {
        None
    };
    *RESOLVER_POLICY_CONFLICT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = verdict;
}

pub(super) async fn observe_resolver_policy() -> Option<String> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let rules = engine::effective_nrpt_rules().await;
        let lookup = engine::system_lookup_a(RESOLVER_POLICY_PROBE_HOST).await;
        return resolver_policy_conflict(
            rules.as_deref().map_err(String::as_str),
            lookup.as_deref().map_err(String::as_str),
        );
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        None
    }
}

#[derive(Debug)]
pub(super) struct ResolverPolicyRestoreFailed;

impl std::fmt::Display for ResolverPolicyRestoreFailed {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("resolver policy restoration failed; adapter DHCP fallback cannot repair NRPT/DoH")
    }
}

// Typed context preserves the cause and phase without matching diagnostic strings. A policy
// failure must not reset already-restored static adapter DNS to DHCP during uninstall.
//
// `Some(note)` on success = a capture was unreadable (or recorded lost by an earlier suppress)
// and the in-place values stand as the restore result; the note rides in `last_error` exactly
// like the degraded-restore note. The evidence stays on disk until the caller has committed the
// whole restore and hands the note to `settle_capture_loss`.
pub(super) async fn restore_resolver_policy() -> Result<Option<String>> {
    let quarantined = engine_restore_encrypted_dns().await.context(ResolverPolicyRestoreFailed)?;
    Ok(quarantined.then(|| {
        format!(
            "{DNS_CAPTURE_QUARANTINED_PREFIX}: a resolver-policy capture file \
             (protected-secure-dns.json / protected-interface-doh.json) was unreadable and was \
             quarantined for diagnosis; the user's previous Encrypted DNS setting could not be \
             recovered from it, so the current in-place values are the restore result. The \
             restore succeeded and protection is released, but the Windows Encrypted DNS \
             setting may need to be re-enabled by hand in Settings."
        )
    }))
}

/// Delete Tono's NRPT catch-all and prove it gone, giving up after `budget` (BRICK-W4).
///
/// The rule sends every lookup to 198.18.0.2, which nothing answers once the Core is gone, and a
/// restart does not remove it. The ladder deletes it only on its proven rungs, so an uninstall
/// could finish with it still installed. This is the proof the uninstall helper and the elevated
/// recovery CLI take before they report a machine safe; the Service never calls it.
///
/// Synchronous on purpose, for callers that must return after the budget whatever the registry
/// does: the removal runs on its own named thread, and a call that has not answered by then is
/// abandoned. Neither `spawn_blocking` (a runtime drop waits for it) nor the engine's wedge latch
/// (a wedged ladder call would refuse this sweep too) is used. A DNS operation still in progress
/// is an error, not a wait.
pub fn remove_tono_resolver_rule_within(budget: std::time::Duration) -> Result<()> {
    let Ok(_operation) = DNS_OPERATION.try_lock() else {
        bail!("another DNS operation is still running, so Tono's NRPT rule was not touched");
    };
    let _self_write = SelfWriteWindow::open();
    run_on_detached_thread("tono-nrpt-sweep", budget, sweep_tono_resolver_rule)
}

/// Run `work` on a detached named thread and wait for its answer at most `budget`. On timeout the
/// thread keeps running and its answer is dropped.
pub(super) fn run_on_detached_thread<T: Send + 'static>(
    name: &str,
    budget: std::time::Duration,
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let (answer, answered) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || {
            let _ = answer.send(work());
        })
        .with_context(|| format!("{name} could not be started"))?;
    match answered.recv_timeout(budget) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            bail!("{name} did not answer within {budget:?}; the registry call was abandoned")
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            bail!("{name} ended without an answer")
        }
    }
}

/// The removal itself: Tono's key only, an absent key is success, and the result is read back.
#[cfg(all(windows, not(feature = "test")))]
pub(super) fn sweep_tono_resolver_rule() -> Result<()> {
    hold_self_write_across_the_write(engine::remove_nrpt_rule)
}

/// The stub stands in for a registry call that never returns, or one that fails.
#[cfg(not(all(windows, not(feature = "test"))))]
pub(super) fn sweep_tono_resolver_rule() -> Result<()> {
    while test_hooks::nrpt_sweep_hangs() {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if test_hooks::encrypted_restore_fails() {
        bail!("injected Tono NRPT removal failure");
    }
    Ok(())
}

#[cfg(all(windows, not(feature = "test")))]
pub(crate) fn install_selective_nrpt() -> Result<()> {
    engine::install_selective_nrpt()
}

#[cfg(all(windows, not(feature = "test")))]
pub(crate) fn remove_selective_nrpt() -> Result<()> {
    engine::remove_selective_nrpt()
}
