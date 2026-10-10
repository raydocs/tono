/// Stable, App-mappable marker for "the DNS engine stopped answering". Same contract as
/// `windows_kill_switch::WFP_ENGINE_WEDGED_PREFIX`: the App matches by substring and every
/// handler wraps this message in its own context, so the marker must survive anywhere inside
/// the string. Separate from the WFP markers because the cause and the user action differ —
/// a wedged Dnscache/registry filter, not the Base Filtering Engine.
#[cfg_attr(not(any(all(windows, not(feature = "test")), test)), allow(dead_code))]
pub(crate) const DNS_ENGINE_WEDGED_PREFIX: &str = "TONO_DNS_ENGINE_WEDGED";

/// Stable, App-mappable marker for "`protected-dns.json` cannot be read *and* the machine is
/// still resolving through the loopback core". Same substring contract as the wedge markers.
/// Separate from them because the user action differs: this one is resolved by putting the
/// affected adapters back on automatic (DHCP) DNS, or by the elevated emergency disarm.
pub(crate) const DNS_SNAPSHOT_UNREADABLE_PREFIX: &str = "TONO_DNS_SNAPSHOT_UNREADABLE";
/// Stable marker for a deleted recovery snapshot while an adapter still carries the current
/// Tono-only DNS endpoint. The disarm gate must stay closed until Windows DNS is repaired.
pub(crate) const DNS_SNAPSHOT_MISSING_PREFIX: &str = "TONO_DNS_SNAPSHOT_MISSING";
/// Stable marker for an adapter that Tono has never recorded meeting the current Tono-only DNS
/// endpoint — the merge-time face of the same orphaned state [`DNS_SNAPSHOT_MISSING_PREFIX`]
/// guards when there is no snapshot at all. The enable that hits it keeps the durable snapshot
/// and its saved originals untouched.
pub(crate) const DNS_ORPHANED_ADAPTER_PREFIX: &str = "TONO_DNS_ORPHANED_ADAPTER";

/// Stable, App-mappable marker for "the restore was accepted on registry evidence alone after a
/// sustained live-apply failure" (see [`accepts_degraded_restore`]). It rides in `last_error` on
/// an otherwise *successful* restore, so the App must treat it as a warning to surface, not as a
/// failed operation.
pub(crate) const DNS_RESTORE_DEGRADED_PREFIX: &str = "TONO_DNS_RESTORE_DEGRADED";

/// Stable, App-mappable marker for "a resolver-policy capture file (`protected-secure-dns.json`
/// / `protected-interface-doh.json`) was unreadable, was quarantined for diagnosis, and the
/// in-place values stood as the restore result because the saved originals were unrecoverable".
/// Like [`DNS_RESTORE_DEGRADED_PREFIX`] it rides in `last_error` on an otherwise *successful*
/// restore — a warning to surface, never a failed operation, and never positive evidence that
/// encrypted DNS was restored to the user's chosen setting.
pub(crate) const DNS_CAPTURE_QUARANTINED_PREFIX: &str = "TONO_DNS_CAPTURE_QUARANTINED";

/// Stable, App-mappable marker for "protected DNS was applied, but the apply or its read-back
/// could not be verified on every adapter". Like [`DNS_RESTORE_DEGRADED_PREFIX`] it rides in
/// `last_error` on an otherwise **successful** operation, so the App must treat it as a warning
/// to surface (and to put in the diagnostics report), never as a failed enable. It is the
/// explanation the user gets when the connect subsequently fails in the fake-ip probe.
pub(crate) const DNS_PROTECTION_UNVERIFIED_PREFIX: &str = "TONO_DNS_UNVERIFIED";
