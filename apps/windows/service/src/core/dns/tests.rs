    use super::*;
    use serial_test::serial;

    fn adapter(guid: &str, v4: Option<&str>) -> AdapterDnsSnapshot {
        AdapterDnsSnapshot {
            interface_guid: guid.to_owned(),
            ipv4_name_server: v4.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn name_server_lists_tolerate_messy_registry_values() {
        assert_eq!(
            parse_name_server_list(" 1.1.1.1 , ,8.8.8.8, "),
            vec!["1.1.1.1".to_owned(), "8.8.8.8".to_owned()]
        );
        assert!(parse_name_server_list("").is_empty());
        assert_eq!(
            format_name_server_list(&["1.1.1.1".to_owned(), "8.8.8.8".to_owned()]),
            "1.1.1.1,8.8.8.8"
        );
    }

    #[test]
    fn loopback_detection_is_exact() {
        assert!(is_loopback_value(Some("127.0.0.1")));
        assert!(
            is_loopback_value(Some(LOOPBACK_V6)),
            "the protect path no longer writes ::1, but an adapter left there by an older build \
             is still pointed at a resolver that never answers and must not read as restored"
        );
        assert!(is_loopback_value(Some("127.0.0.1, ::1")));
        assert!(!is_loopback_value(Some("127.0.0.1, 1.1.1.1")));
        assert!(!is_loopback_value(Some("1.1.1.1")));
        assert!(!is_loopback_value(Some("")));
        assert!(!is_loopback_value(None));
    }

    #[test]
    fn protected_tun_dns_detection_is_exact_and_restore_safe() {
        assert!(is_protected_v4_value(Some(PROTECTED_DNS_V4)));
        assert!(is_tono_dns_value(Some(PROTECTED_DNS_V4)));
        assert!(
            is_tono_dns_value(Some(LOOPBACK_V4)),
            "restore must recognize the redirect written by older builds"
        );
        assert!(!is_protected_v4_value(Some(LOOPBACK_V4)));
        assert!(!is_protected_v4_value(Some("198.18.0.2, 1.1.1.1")));
        assert!(!is_tono_dns_value(Some("198.18.0.2, 1.1.1.1")));
        assert!(!is_protected_v4_value(None));
    }

    #[test]
    fn a_missing_snapshot_recognises_exact_and_partial_current_redirects() {
        assert!(contains_current_protected_v4(Some(PROTECTED_DNS_V4)));
        assert!(
            contains_current_protected_v4(Some("198.18.0.2, 1.1.1.1")),
            "a partial restore is still unsafe to capture as the user's original"
        );
        assert!(!contains_current_protected_v4(Some(LOOPBACK_V4)));
        assert!(!contains_current_protected_v4(Some("1.1.1.1, 8.8.8.8")));
        assert!(!contains_current_protected_v4(None));

        let mut profile_only = adapter("{A}", None);
        profile_only.ipv4_profile_name_server = Some(PROTECTED_DNS_V4.to_owned());
        assert!(adapter_contains_current_protected_dns(&profile_only));
        assert!(ensure_snapshotless_adapters_are_safe(&[profile_only]).is_err());
        assert!(
            ensure_snapshotless_adapters_are_safe(&[adapter("{LOCAL}", Some(LOOPBACK_V4))]).is_ok(),
            "a user's pre-existing local resolver must remain a valid snapshot-less state"
        );

        let mut tunnel = adapter("{TONO-TUN}", Some(PROTECTED_DNS_V4));
        tunnel.interface_luid = Some(42);
        assert!(
            ensure_snapshotless_adapters_are_safe(std::slice::from_ref(&tunnel)).is_err(),
            "the raw safety check never guesses that an endpoint belongs to Tono"
        );
        let only_tunnel = without_current_tunnel(vec![tunnel.clone()], Some(42));
        assert!(
            only_tunnel.is_empty(),
            "the WFP-validated current WinTUN adapter is excluded before snapshot or proof"
        );

        let mut physical = adapter("{ETHERNET}", Some(PROTECTED_DNS_V4));
        physical.interface_luid = Some(43);
        let physical_only = without_current_tunnel(vec![tunnel, physical], Some(42));
        assert_eq!(physical_only.len(), 1);
        assert!(
            ensure_snapshotless_adapters_are_safe(&physical_only).is_err(),
            "excluding the tunnel must not hide the same orphaned endpoint on a physical adapter"
        );
    }

    /// Disconnect stops the core before the restore proof runs, so the WFP-validated LUID is
    /// gone (`None`) exactly when the proof needs the tunnel excluded. The exclusion must then
    /// still work by connection name — and must never extend to a physical adapter.
    #[test]
    fn the_tunnel_exclusion_survives_a_stopped_core() {
        let mut stale_tunnel = adapter("{TONO-TUN}", Some(PROTECTED_DNS_V4));
        stale_tunnel.connection_name = Some(TUN_ADAPTER_NAME.to_owned());
        assert!(
            without_current_tunnel(vec![stale_tunnel.clone()], None).is_empty(),
            "a stale Tono WinTUN adapter is excluded by name once the core is gone"
        );

        let mut physical = adapter("{ETHERNET}", Some(PROTECTED_DNS_V4));
        physical.connection_name = Some("Ethernet".to_owned());
        let kept = without_current_tunnel(vec![stale_tunnel, physical], None);
        assert_eq!(
            kept.len(),
            1,
            "a physical adapter on the protected endpoint must never ride the tunnel exclusion"
        );
        assert_eq!(kept[0].interface_guid, "{ETHERNET}");
        assert!(
            ensure_snapshotless_adapters_are_safe(&kept).is_err(),
            "the surviving physical adapter still fails the orphaned-endpoint safety check"
        );
    }

    /// The IPv6 half of the `securingDNS` regression. Nothing listens on `[::1]:53`
    /// (`tono_core::config::DNS_LISTEN` is `127.0.0.1:53`), so the protected IPv6 state is an
    /// empty static server list — and "protected" therefore has to mean something different per
    /// family, or the watchdog reads the state it just wrote as drift and rewrites it for ever.
    #[test]
    fn an_empty_ipv6_server_list_is_the_protected_state() {
        assert!(
            is_protected_v6_value(Some(NO_NAME_SERVERS)),
            "an empty static list is what the protect path writes"
        );
        assert!(is_protected_v6_value(Some("  ,  ")));
        assert!(
            is_protected_v6_value(Some(LOOPBACK_V6)),
            "an upgrade over a build that wrote ::1 must not read as drift"
        );
        assert!(
            !is_protected_v6_value(None),
            "an absent value is DHCP — the ISP's resolvers — not protection"
        );
        assert!(!is_protected_v6_value(Some("2606:4700:4700::1111")));
        assert!(
            !is_loopback_value(Some(NO_NAME_SERVERS)),
            "an empty list resolves through nothing at all, so it is not evidence that the \
             machine is still pointed at the loopback core"
        );
    }

    #[test]
    fn only_up_non_loopback_adapters_with_a_bound_ip_stack_are_protected() {
        assert!(is_active_dns_adapter(1, 6, true), "up ethernet");
        assert!(is_active_dns_adapter(1, 71, true), "up wi-fi");
        assert!(is_active_dns_adapter(1, 131, true), "up tunnel");
        assert!(!is_active_dns_adapter(2, 6, true), "down ethernet");
        assert!(!is_active_dns_adapter(1, 24, true), "software loopback");
        assert!(
            !is_active_dns_adapter(1, 6, false),
            "up with no bound IP stack (Hyper-V/WSL switch, TAP, WinTUN mid-init) has no \
             resolver to protect and must not become a permanent failure"
        );
    }

    #[test]
    fn enable_preserves_originals_and_appends_new_adapters() {
        let original = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![adapter("{A}", Some("1.1.1.1"))],
        };
        let fresh = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 2,
            adapters: vec![
                adapter("{A}", Some(PROTECTED_DNS_V4)),
                adapter("{NEW}", Some("9.9.9.9")),
            ],
        };
        let merged = merge_snapshot(Some(original.clone()), fresh.clone());
        assert_eq!(merged.taken_at, original.taken_at);
        assert_eq!(
            merged.adapters[0], original.adapters[0],
            "saved DNS is never overwritten"
        );
        assert_eq!(
            merged.adapters[1], fresh.adapters[1],
            "a fresh adapter keeps its original DNS"
        );
        assert_eq!(merge_snapshot(None, fresh.clone()), fresh);
    }

    #[test]
    fn restore_proof_requires_exact_saved_values() {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![
                adapter("{A}", Some("1.1.1.1")),
                adapter("{B}", None), // DHCP: restore deletes the value
            ],
        };
        let restored = vec![adapter("{A}", Some("1.1.1.1")), adapter("{B}", None)];
        assert!(restore_is_proven(&snapshot, &restored, Some(false)));

        let still_protected = vec![adapter("{A}", Some(PROTECTED_DNS_V4)), adapter("{B}", None)];
        assert!(!restore_is_proven(&snapshot, &still_protected, Some(true)));

        let wrong_server = vec![adapter("{A}", Some("8.8.8.8")), adapter("{B}", None)];
        assert!(!restore_is_proven(&snapshot, &wrong_server, Some(false)));

        let missing_adapter = vec![adapter("{A}", Some("1.1.1.1"))];
        assert!(
            restore_is_proven(&snapshot, &missing_adapter, Some(false)),
            "an adapter whose registry key vanished has no live resolver left to restore"
        );
    }

    /// The live half of the proof, which is what replaced the `live_apply_failed` veto. Only
    /// "nothing is on loopback" can prove a restore; "something still is" refuses it, and
    /// "we could not look" is unproven — never proven.
    #[test]
    fn restore_proof_needs_positive_live_evidence() {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![adapter("{A}", Some("1.1.1.1"))],
        };
        let restored = vec![adapter("{A}", Some("1.1.1.1"))];
        assert!(restore_is_proven(&snapshot, &restored, Some(false)));
        assert!(
            !restore_is_proven(&snapshot, &restored, Some(true)),
            "an exact registry match cannot outvote an adapter that is provably still on \
             loopback — that ordering is the whole point of the disarm gate"
        );
        assert!(
            !restore_is_proven(&snapshot, &restored, None),
            "evidence that could not be gathered (a wedged engine, a timed-out call) is \
             unproven; the degraded exit is the only way past it"
        );
    }

    /// The snapshot-less uninstall path selects adapters with one predicate and proves the reset
    /// with another. They must agree, and for one release they did not: the proof was updated
    /// when the redirect target moved from `127.0.0.1` to the TUN endpoint `198.18.0.2`, and the
    /// selection kept asking `saved_dns_was_loopback`, which excludes `198.18.0.2` on purpose.
    /// Every machine a current build had protected therefore selected zero adapters, and an
    /// empty selection proved itself: the uninstaller reported "verified off Tono's protected
    /// DNS" having reset nothing, leaving the machine pointed at a resolver that was about to
    /// stop existing.
    #[test]
    fn selection_and_proof_agree_about_what_tono_owns() {
        let on_current = adapter("{REDIRECTED}", Some(PROTECTED_DNS_V4));
        let on_legacy = adapter("{OLD-BUILD}", Some(LOOPBACK_V4));
        let untouched = adapter("{NORMAL}", Some("1.1.1.1"));

        // The proof side has always recognised both Tono targets.
        assert!(adapter_reads_as_tono_dns(&on_current));
        assert!(adapter_reads_as_tono_dns(&on_legacy));
        assert!(!adapter_reads_as_tono_dns(&untouched));

        // The predicate the selection used to call answers a different question — "were this
        // adapter's *originals* already a local resolver, so DHCP would be the wrong answer" —
        // and is blind to the current target by design. Keeping the assertion pins why the two
        // must not be swapped for each other again.
        assert!(!saved_dns_was_loopback(&on_current));
        assert!(saved_dns_was_loopback(&on_legacy));
        assert!(!saved_dns_was_loopback(&untouched));
    }

    /// An empty selection must not be able to prove itself. `engine::any_loopback` over an empty
    /// list answers `false` without reading anything, so the rung decision has to get its
    /// evidence elsewhere when nothing was selected — from the one address that cannot belong to
    /// anyone else.
    #[test]
    fn an_empty_selection_is_not_evidence_of_a_reset() {
        // Vacuous: no adapters, so "is any of them still on Tono DNS" is false for free.
        assert_eq!(uninstall_restore_rung(false, true, Some(false)), UninstallRung::Automatic);
        // Which is why the caller substitutes a real question when the selection is empty. The
        // unambiguous target is the one it may ask about across every live adapter.
        let still_redirected = adapter("{REDIRECTED}", Some(PROTECTED_DNS_V4));
        let users_own_resolver = adapter("{PI-HOLE}", Some(LOOPBACK_V4));
        assert!(adapter_contains_current_protected_dns(&still_redirected));
        // A machine running its own local resolver must not be mistaken for ours, or uninstall
        // would refuse for ever on it.
        assert!(!adapter_contains_current_protected_dns(&users_own_resolver));
    }

    /// A machine that ran its own local resolver before Tono started had `127.0.0.1` all along.
    /// Restoring it puts `127.0.0.1` back — correctly — so the blunt "is anything on loopback?"
    /// question must not be asked about that adapter, or every disconnect is refused for ever.
    #[test]
    fn the_live_loopback_read_skips_adapters_whose_originals_were_loopback() {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![
                adapter("{LOCAL-RESOLVER}", Some(LOOPBACK_V4)),
                adapter("{NORMAL}", Some("1.1.1.1")),
            ],
        };
        let current = vec![
            adapter("{LOCAL-RESOLVER}", Some(LOOPBACK_V4)),
            adapter("{NORMAL}", Some("1.1.1.1")),
        ];
        let owing = adapters_owing_live_proof(&snapshot, &current);
        assert_eq!(owing.len(), 1);
        assert_eq!(owing[0].interface_guid, "{NORMAL}");

        // An adapter that appeared after the snapshot owes the proof: nothing says it was on
        // loopback of its own accord.
        let with_new = vec![adapter("{NEW}", Some(PROTECTED_DNS_V4))];
        assert_eq!(adapters_owing_live_proof(&snapshot, &with_new).len(), 1);
    }

    #[test]
    fn live_restore_uses_profile_overrides_and_keeps_the_families_apart() {
        let saved = AdapterDnsSnapshot {
            interface_guid: "{DUAL}".to_owned(),
            interface_luid: None,
            connection_name: None,
            ipv4_name_server: Some("1.1.1.1".to_owned()),
            ipv4_profile_name_server: Some("8.8.8.8, 8.8.4.4".to_owned()),
            ipv6_name_server: Some("2606:4700:4700::1111".to_owned()),
            ipv6_profile_name_server: None,
            live_apply_failed: false,
        };
        // No IPv6 address may reach the IPv4-only CIM method, and no IPv4 address may reach
        // the IPv6 mechanism: a merged list is either rejected wholesale or silently truncated.
        assert_eq!(
            restored_live_servers_v4(&saved),
            Some(vec!["8.8.8.8".to_owned(), "8.8.4.4".to_owned()])
        );
        assert_eq!(
            restored_live_servers_v6(&saved),
            Some(vec!["2606:4700:4700::1111".to_owned()])
        );

        let dhcp = AdapterDnsSnapshot {
            interface_guid: "{DHCP}".to_owned(),
            ..Default::default()
        };
        assert_eq!(restored_live_servers_v4(&dhcp), None);
        assert_eq!(restored_live_servers_v6(&dhcp), None);

        // A v4-only adapter must not be handed an empty v6 list that would reset a family it
        // never had, and vice versa.
        let v4_only = AdapterDnsSnapshot {
            interface_guid: "{V4}".to_owned(),
            ipv4_name_server: Some("1.1.1.1".to_owned()),
            ..Default::default()
        };
        assert_eq!(
            restored_live_servers_v4(&v4_only),
            Some(vec!["1.1.1.1".to_owned()])
        );
        assert_eq!(restored_live_servers_v6(&v4_only), None);
    }

    #[test]
    fn restore_proof_covers_v6_only_adapters() {
        let v6_only = AdapterDnsSnapshot {
            interface_guid: "{V6}".to_owned(),
            ipv6_name_server: Some("2606:4700:4700::1111".to_owned()),
            ..Default::default()
        };
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![v6_only.clone()],
        };
        assert!(restore_is_proven(
            &snapshot,
            std::slice::from_ref(&v6_only),
            Some(false)
        ));

        let wrong_v6 = AdapterDnsSnapshot {
            ipv6_name_server: Some("2001:db8::53".to_owned()),
            ..v6_only.clone()
        };
        assert!(!restore_is_proven(&snapshot, &[wrong_v6], Some(false)));

        // The protect path leaves IPv6 with no servers now, so this is what a *failed* v6
        // restore looks like: the registry no longer holds the user's resolver.
        let still_protected = AdapterDnsSnapshot {
            ipv6_name_server: Some(NO_NAME_SERVERS.to_owned()),
            ..v6_only.clone()
        };
        assert!(
            !restore_is_proven(&snapshot, &[still_protected], Some(false)),
            "an IPv6 family still holding the empty protected list is not restored, even though \
             an empty list is not itself a loopback value"
        );

        let left_on_loopback_by_an_older_build = AdapterDnsSnapshot {
            ipv6_name_server: Some(LOOPBACK_V6.to_owned()),
            ..v6_only
        };
        assert!(
            !restore_is_proven(&snapshot, &[left_on_loopback_by_an_older_build], Some(true)),
            "still on loopback is not a proven restore"
        );
    }

    #[test]
    fn restore_proof_ignores_adapters_added_after_the_snapshot() {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![adapter("{A}", Some("1.1.1.1"))],
        };
        let current = vec![
            adapter("{A}", Some("1.1.1.1")),
            adapter("{NEW}", Some("8.8.8.8")), // appeared later; not ours to prove
        ];
        assert!(restore_is_proven(&snapshot, &current, Some(false)));
    }

    /// The exact real-machine failure, in pure form. The registry held the user's own
    /// resolvers again (`registry_match=true`) and nothing was on loopback, yet the release was
    /// refused because one adapter carried a live-apply-failure flag — and the degraded exit
    /// that exists to prevent that deadlock needs a streak of three, which one click on
    /// Disconnect never reaches. The flag now makes us *demand* live evidence, not overrule it.
    #[test]
    fn a_live_apply_failure_no_longer_vetoes_a_restore_the_live_state_confirms() {
        let mut flagged = adapter("{A}", Some("1.1.1.1"));
        flagged.live_apply_failed = true;
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![flagged],
        };
        let current = vec![adapter("{A}", Some("1.1.1.1"))];
        assert!(
            restore_is_proven(&snapshot, &current, Some(false)),
            "registry restored + nothing on loopback is a proven restore, whatever an earlier \
             round recorded"
        );
        assert!(
            !restore_is_proven(&snapshot, &current, Some(true)),
            "the flag is not what refuses a restore — being provably still on loopback is"
        );
        assert!(
            !restore_is_proven(&snapshot, &current, None),
            "a flagged adapter with no obtainable live evidence stays unproven"
        );

        // Memory failures still merge into the snapshot; they simply no longer decide.
        let clean = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![adapter("{A}", Some("1.1.1.1"))],
        };
        let merged = with_live_failures(&clean, &["{A}".to_owned()].into_iter().collect());
        assert!(merged.adapters[0].live_apply_failed);
        assert!(restore_is_proven(&merged, &current, Some(false)));
        assert!(!restore_is_proven(&merged, &current, Some(true)));
    }

    #[test]
    fn enable_replays_loopback_only_when_protection_drifted() {
        assert!(
            needs_loopback_replay(false, false, false),
            "the first enable must snapshot adapters and apply loopback"
        );
        assert!(!needs_loopback_replay(true, true, false));
        assert!(
            needs_loopback_replay(true, false, false),
            "snapshot present but adapters off loopback: replay the write"
        );
        assert!(
            needs_loopback_replay(true, true, true),
            "a recorded live-apply failure must replay even when the registry is loopback"
        );
        assert!(needs_loopback_replay(false, false, true));
    }

    #[test]
    fn registry_match_ignores_the_live_apply_flag() {
        let mut saved = adapter("{A}", Some("1.1.1.1"));
        saved.live_apply_failed = true;
        let current = adapter("{A}", Some("1.1.1.1"));
        assert!(registry_values_match(&saved, &current));
        let drifted = adapter("{A}", Some("8.8.8.8"));
        assert!(!registry_values_match(&saved, &drifted));
    }

    #[test]
    fn snapshot_round_trips_through_json() {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 42,
            adapters: vec![AdapterDnsSnapshot {
                interface_guid: "{GUID}".to_owned(),
                interface_luid: None,
                connection_name: None,
                ipv4_name_server: Some("1.1.1.1,8.8.8.8".to_owned()),
                ipv4_profile_name_server: None,
                ipv6_name_server: Some("2606:4700:4700::1111".to_owned()),
                ipv6_profile_name_server: None,
                live_apply_failed: false,
            }],
        };
        let bytes = serde_json::to_vec_pretty(&snapshot).expect("snapshot should serialize");
        assert_eq!(
            serde_json::from_slice::<DnsSnapshot>(&bytes).expect("snapshot should deserialize"),
            snapshot
        );

        // Snapshots written before live-apply tracking must still load (flag defaults off).
        let legacy = serde_json::json!({
            "version": 1,
            "taken_at": 1,
            "adapters": [{
                "interface_guid": "{A}",
                "ipv4_name_server": "1.1.1.1",
                "ipv4_profile_name_server": null,
                "ipv6_name_server": null,
                "ipv6_profile_name_server": null
            }]
        });
        let decoded: DnsSnapshot =
            serde_json::from_value(legacy).expect("legacy snapshot should deserialize");
        assert!(!decoded.adapters[0].live_apply_failed);
    }

    #[test]
    fn an_unreadable_snapshot_is_named_rather_than_thrown() {
        let good = serde_json::to_vec(&DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 1,
            adapters: vec![adapter("{A}", Some("1.1.1.1"))],
        })
        .expect("snapshot should serialize");
        assert!(parse_snapshot(&good).is_ok());

        let corrupt = parse_snapshot(b"{not json").expect_err("a corrupt file is unreadable");
        assert!(corrupt.contains("corrupt"), "{corrupt}");

        // A file from a newer build must not be reinterpreted: its `None`/`Some` values decide
        // between deleting and rewriting a registry value.
        let newer = serde_json::json!({
            "version": SNAPSHOT_VERSION + 1,
            "taken_at": 1,
            "adapters": [],
        });
        let reason = parse_snapshot(&serde_json::to_vec(&newer).expect("json"))
            .expect_err("a newer schema is unreadable");
        assert!(reason.contains("newer build"), "{reason}");
    }

    #[test]
    fn the_degraded_restore_exit_needs_a_streak_and_an_exact_registry_match() {
        assert!(
            !accepts_degraded_restore(0, true),
            "a first failure is never degraded-accepted"
        );
        for streak in 1..DEGRADED_RESTORE_STREAK {
            assert!(
                !accepts_degraded_restore(streak, true),
                "streak {streak} is below the documented threshold"
            );
        }
        assert!(
            accepts_degraded_restore(DEGRADED_RESTORE_STREAK, true),
            "a sustained live-apply failure with an exact registry match must not deadlock the \
             user in Protected Offline"
        );
        assert!(
            !accepts_degraded_restore(DEGRADED_RESTORE_STREAK + 10, false),
            "no streak makes a registry mismatch acceptable"
        );
    }

    // --- The uninstall-only escalation ladder ---

    /// Rung 1 wins whenever the exact restore was proven, whatever the fallback evidence says.
    #[test]
    fn a_proven_exact_restore_is_always_rung_one() {
        for automatic_ok in [true, false] {
            for live in [Some(true), Some(false), None] {
                assert_eq!(
                    uninstall_restore_rung(true, automatic_ok, live),
                    UninstallRung::Exact,
                    "automatic_ok={automatic_ok} live={live:?}"
                );
            }
        }
    }

    /// Rung 2 — the whole point of the ladder. Either the DHCP write landed (the registry is
    /// what the DNS Client reads for the next lookup) or the live read says nothing is on the
    /// loopback resolver any more. Both are reasons to let the uninstall finish.
    #[test]
    fn an_unprovable_exact_restore_falls_back_to_automatic_dns() {
        assert_eq!(
            uninstall_restore_rung(false, true, Some(false)),
            UninstallRung::Automatic,
            "the DHCP reset applied and the machine is verifiably off the loopback resolver"
        );
        assert_eq!(
            uninstall_restore_rung(false, true, None),
            UninstallRung::Automatic,
            "a DHCP reset that landed is accepted even when the live read cannot be taken: \
             failing closed here costs the user an application they cannot remove, while the \
             WFP barrier — the thing that would actually strand them — is already gone"
        );
        assert_eq!(
            uninstall_restore_rung(false, false, Some(false)),
            UninstallRung::Automatic,
            "a failed DHCP write over a machine that is provably not on loopback leaves nothing \
             to refuse for"
        );
    }

    /// Rung 3 stays a refusal, and stays narrow: a machine we can *see* is still pointed at a
    /// resolver that has stopped answering, or one that produced no evidence at all.
    #[test]
    fn the_last_rung_refuses_only_on_loopback_or_on_no_evidence_at_all() {
        for automatic_ok in [true, false] {
            assert_eq!(
                uninstall_restore_rung(false, automatic_ok, Some(true)),
                UninstallRung::StillOnLoopback,
                "no fallback result may release a machine that provably still resolves through \
                 Tono's loopback core (automatic_ok={automatic_ok})"
            );
        }
        assert_eq!(
            uninstall_restore_rung(false, false, None),
            UninstallRung::StillOnLoopback,
            "the DHCP write failed and nothing could be read back: no evidence is not evidence"
        );
    }

    /// The stub engine has to recognise the DHCP-reset shape, because that is what lets a test
    /// build reach rung 2 at all. All four values absent on every adapter, and never an empty
    /// adapter list — an empty reset proves nothing about anything.
    #[test]
    fn the_automatic_reset_shape_is_all_four_values_absent() {
        let reset = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 0,
            adapters: vec![
                AdapterDnsSnapshot {
                    interface_guid: "{A}".to_owned(),
                    ..Default::default()
                },
                AdapterDnsSnapshot {
                    interface_guid: "{B}".to_owned(),
                    ..Default::default()
                },
            ],
        };
        assert!(is_automatic_reset(&reset));

        let mut partial = reset.clone();
        partial.adapters[1].ipv6_profile_name_server = Some("2606:4700:4700::1111".to_owned());
        assert!(
            !is_automatic_reset(&partial),
            "one family left on a saved value is a restore, not a DHCP reset"
        );

        let empty = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: 0,
            adapters: Vec::new(),
        };
        assert!(!is_automatic_reset(&empty));
    }

    /// Markers the uninstaller keys off. `uninstall_service.rs` duplicates the literals (it
    /// cannot see `pub(crate)` constants), so a rename on either side silently turns a
    /// continue-with-warning path back into result 3.
    #[test]
    fn the_ladder_markers_are_stable_across_the_binary_boundary() {
        assert_eq!(DNS_RESTORED_AUTOMATIC_PREFIX, "TONO_DNS_RESTORED_AUTOMATIC");
        assert_eq!(
            DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX,
            "TONO_DNS_STILL_ON_LOOPBACK"
        );
        assert_eq!(WFP_REMOVED_CONTINUE_PREFIX, "TONO_WFP_REMOVED");
        assert_ne!(DNS_RESTORED_AUTOMATIC_PREFIX, DNS_RESTORE_DEGRADED_PREFIX);
    }

    /// Only adapters Tono redirected may be reset to DHCP. Everything else on the machine is
    /// the user's own configuration, and an uninstall has no licence to flatten it — least of
    /// all an adapter whose *original* resolver was a local one (Acrylic, dnscrypt-proxy, a
    /// Pi-hole), for which loopback is the correct end state and DHCP would be the damage.
    #[tokio::test]
    #[serial]
    async fn the_dhcp_reset_targets_only_adapters_tono_redirected() -> Result<()> {
        let snapshot = DnsSnapshot {
            version: SNAPSHOT_VERSION,
            taken_at: now_unix(),
            adapters: vec![
                adapter("{REDIRECTED}", Some("1.1.1.1")),
                adapter("{OWN-LOCAL-RESOLVER}", Some(LOOPBACK_V4)),
            ],
        };
        atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;

        let targets = uninstall_reset_targets().await?;

        assert_eq!(targets, vec!["{REDIRECTED}".to_owned()]);
        tokio::fs::remove_file(snapshot_path()).await?;
        Ok(())
    }

    /// With no readable snapshot the only adapters we may touch are the ones that provably read
    /// as our own redirect right now. Off Windows the stub enumerates nothing, so the honest
    /// answer is an empty target list — never "reset everything".
    #[tokio::test]
    #[serial]
    async fn an_unreadable_snapshot_narrows_the_reset_to_provable_redirects() -> Result<()> {
        atomic_write(&snapshot_path(), b"{ corrupt").await?;
        assert!(uninstall_reset_targets().await?.is_empty());
        tokio::fs::remove_file(snapshot_path()).await?;
        Ok(())
    }

    /// The watchdog may only ever re-apply an existing snapshot. `Reconcile` on a machine with
    /// no snapshot would be an initial enable: it would capture the just-restored resolvers as
    /// "the originals" and point every adapter at a loopback core that is not running.
    #[tokio::test]
    #[serial]
    async fn reconciliation_never_starts_protection_from_nothing() -> Result<()> {
        let snapshot = snapshot_path();
        let _ = tokio::fs::remove_file(&snapshot).await;
        let before = tokio::fs::metadata(&snapshot).await.is_ok();
        assert!(!before, "the test needs a machine with no snapshot");

        let status = enable_unlocked(EnableTrigger::Reconcile).await?;
        assert!(
            !status.snapshot_present,
            "a repair with nothing to repair must not create a snapshot"
        );
        assert!(!status.enabled);
        assert!(
            tokio::fs::metadata(&snapshot).await.is_err(),
            "no snapshot file may be written by the reconciler"
        );
        Ok(())
    }

    /// The snapshot and registry are separate writes. If antivirus/manual cleanup removes the
    /// former while the latter still carries 198.18.0.2, neither Connect nor Disconnect may
    /// reinterpret that Tono-only address as the user's original resolver or open the WFP gate.
    #[tokio::test]
    #[serial]
    async fn an_orphaned_current_dns_target_cannot_be_snapshotted_or_disarmed() -> Result<()> {
        reset_dns_state().await;
        test_hooks::set_collected_adapters(vec![adapter("{A}", Some(PROTECTED_DNS_V4))]);

        let enable_error = enable()
            .await
            .expect_err("an orphaned Tono endpoint is not a clean initial state");
        let enable_message = format!("{enable_error:#}");
        assert!(
            enable_message.contains(DNS_SNAPSHOT_MISSING_PREFIX),
            "{enable_message}"
        );
        assert!(
            tokio::fs::metadata(snapshot_path()).await.is_err(),
            "the TUN endpoint must never be persisted as the original DNS"
        );

        let disarm_error = ensure_restored()
            .await
            .expect_err("missing recovery evidence must keep the disarm gate closed");
        let disarm_message = format!("{disarm_error:#}");
        assert!(
            disarm_message.contains(DNS_SNAPSHOT_MISSING_PREFIX),
            "{disarm_message}"
        );
        assert!(
            disarm_message.contains("Automatic (DHCP)"),
            "{disarm_message}"
        );

        // Once Windows DNS is repaired, the snapshot-less disarm path is clean again.
        test_hooks::set_collected_adapters(vec![adapter("{A}", Some("192.168.31.1"))]);
        ensure_restored().await?;

        reset_dns_state().await;
        Ok(())
    }

    /// The pure half of the P0 fix: what the window says, given only the four observable
    /// values. In particular an open window that has aged past the cap stops suppressing —
    /// a leaked depth cannot mute the machine's network events for the life of the service.
    #[test]
    fn the_self_write_window_covers_the_apply_and_a_tail_and_then_expires() {
        let tail = SELF_WRITE_TAIL.as_millis() as u64;
        let cap = SELF_WRITE_MAX_WINDOW.as_millis() as u64;

        // Nothing open, no tail: every notification is the machine's.
        assert!(!self_write_window_is_open(10_000, 0, 0, 0));
        // Open, and young: ours.
        assert!(self_write_window_is_open(10_000, 1, 9_900, 0));
        // Closed a moment ago: still inside the tail, because the callback is asynchronous.
        assert!(self_write_window_is_open(10_000, 0, 9_900, 9_900 + tail));
        // Past the tail: back to publishing, with no action required from anyone.
        assert!(!self_write_window_is_open(
            9_900 + tail,
            0,
            9_900,
            9_900 + tail
        ));
        // The belt-and-braces half: a depth that was somehow leaked ages out on its own.
        assert!(!self_write_window_is_open(10_000 + cap, 1, 10_000, 0));
        assert!(self_write_window_is_open(10_000 + cap - 1, 1, 10_000, 0));
    }

    /// The guard is the only writer of the depth, so every exit path closes the window —
    /// including a panic, which is exactly the case a bare flag would leave latched.
    #[test]
    #[serial]
    fn the_window_cannot_be_left_open_by_a_failed_or_panicking_apply() {
        let depth_before = SELF_WRITE_DEPTH.load(Ordering::Acquire);
        {
            let _window = SelfWriteWindow::open();
            assert_eq!(SELF_WRITE_DEPTH.load(Ordering::Acquire), depth_before + 1);
            assert!(in_self_write_window());
            // Nesting is counted, not latched.
            {
                let _inner = SelfWriteWindow::open();
                assert_eq!(SELF_WRITE_DEPTH.load(Ordering::Acquire), depth_before + 2);
            }
            assert_eq!(SELF_WRITE_DEPTH.load(Ordering::Acquire), depth_before + 1);
            assert!(
                in_self_write_window(),
                "the outer window is still open after the inner one closed"
            );
        }
        assert_eq!(SELF_WRITE_DEPTH.load(Ordering::Acquire), depth_before);

        let panicked = std::panic::catch_unwind(|| {
            let _window = SelfWriteWindow::open();
            panic!("the apply blew up");
        });
        assert!(panicked.is_err());
        assert_eq!(
            SELF_WRITE_DEPTH.load(Ordering::Acquire),
            depth_before,
            "unwinding through the guard must close the window"
        );
    }

    /// The end-to-end shape of the P0: an `enable` applies loopback DNS inside a window, and
    /// the window is closed again by the time the call returns. A notification arriving during
    /// the apply is attributable to us; one arriving a second later is the machine's.
    #[tokio::test]
    #[serial]
    async fn the_apply_marks_a_window_and_gives_it_back() -> Result<()> {
        reset_dns_state().await;
        assert!(
            !in_self_write_window(),
            "no window may be open before the apply"
        );
        seed_snapshot(vec![adapter("{A}", Some("9.9.9.9"))]).await?;
        test_hooks::set_live_dns_on_loopback(false);

        enable().await?;

        assert_eq!(
            SELF_WRITE_DEPTH.load(Ordering::Acquire),
            0,
            "the apply gave the window back"
        );
        let suppressed_before = suppressed_self_writes();
        assert_eq!(
            note_suppressed_self_write(),
            suppressed_before + 1,
            "the diagnostic counter counts what was not published"
        );

        reset_dns_state().await;
        Ok(())
    }

    /// Put the DNS globals back where a fresh process would have them; these tests drive the
    /// real facade, and a leaked failure flag or streak would decide the next test's proof.
    async fn reset_dns_state() {
        let _ = tokio::fs::remove_file(snapshot_path()).await;
        LIVE_APPLY_FAILURES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        CONSECUTIVE_LIVE_FAILURES.store(0, Ordering::Relaxed);
        *DNS_LAST_ERROR
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        PROTECTION_WANTED.store(false, Ordering::Release);
        test_hooks::set_live_dns_on_loopback(false);
        test_hooks::set_live_apply_fails(false);
        test_hooks::set_apply_batch_unavailable(false);
        test_hooks::set_collected_adapters(Vec::new());
        // The tail of an earlier test's write window would otherwise still be running.
        SELF_WRITE_TAIL_UNTIL.store(0, Ordering::Relaxed);
    }

    /// Write a snapshot as if a previous enable had taken it, so `enable` takes the replay path
    /// (the stub engine enumerates nothing, so the adapters have to come from the file).
    async fn seed_snapshot(adapters: Vec<AdapterDnsSnapshot>) -> Result<()> {
        atomic_write(
            &snapshot_path(),
            &serde_json::to_vec_pretty(&DnsSnapshot {
                version: SNAPSHOT_VERSION,
                taken_at: 1,
                adapters,
            })?,
        )
        .await
    }

    async fn read_snapshot() -> Result<DnsSnapshot> {
        let bytes = tokio::fs::read(snapshot_path()).await?;
        parse_snapshot(&bytes).map_err(|reason| anyhow::anyhow!(reason))
    }

    /// The note is the whole point of the demotion: it has to name the adapters, the read-back,
    /// and why an unverifiable configuration is still not a leak — and it must stay silent when
    /// there is nothing to say.
    #[test]
    fn the_unverified_note_names_the_adapters_and_the_read_back() {
        assert_eq!(
            unverified_note(&[], 3, LoopbackReadBack::Verified),
            None,
            "a clean round must not put a warning in the status payload"
        );
        assert_eq!(
            unverified_note(&[], 0, LoopbackReadBack::NotAttempted),
            None,
            "a build with no engine has nothing to report either way"
        );

        let note = unverified_note(
            &["{A}".to_owned(), "{B}".to_owned()],
            5,
            LoopbackReadBack::Contradicted,
        )
        .expect("recorded failures must be reported");
        assert!(note.contains(DNS_PROTECTION_UNVERIFIED_PREFIX), "{note}");
        assert!(note.contains("2 of 5"), "{note}");
        assert!(note.contains("{A}") && note.contains("{B}"), "{note}");
        assert!(note.contains("read-back=not-protected"), "{note}");
        assert!(
            note.contains("WFP default-denies physical DNS") && note.contains("fake-ip"),
            "the note has to explain why this is not a leak and where the real proof is: {note}"
        );

        let unreadable = unverified_note(&[], 2, LoopbackReadBack::Unavailable)
            .expect("a read-back that could not be run is its own state, not a pass");
        assert!(unreadable.contains("read-back=unreadable"), "{unreadable}");

        let many = unverified_note(
            &(0..9)
                .map(|index| format!("{{G{index}}}"))
                .collect::<Vec<_>>(),
            9,
            LoopbackReadBack::Verified,
        )
        .expect("per-adapter failures count even when the read-back is happy");
        assert!(many.contains("(+5 more)"), "{many}");
    }

    /// The regression this change exists for: the live apply fails on an adapter, `enable` used
    /// to abort the whole connect at ~1.1 s with "loopback DNS could not be verified", and the
    /// fake-ip probe — the only direct proof that the machine's resolver is the tunnel's — never
    /// ran. Now the round is recorded and the connect proceeds to that proof.
    #[tokio::test]
    #[serial]
    async fn an_unverifiable_apply_is_recorded_rather_than_failing_the_connect() -> Result<()> {
        reset_dns_state().await;
        seed_snapshot(vec![
            adapter("{A}", Some("1.1.1.1")),
            adapter("{B}", Some("9.9.9.9")),
        ])
        .await?;
        test_hooks::set_live_apply_fails(true);

        let status = enable().await?;

        assert!(
            status.snapshot_present && status.adapters == 2,
            "protection is in force and restorable: {status:?}"
        );
        let note = status
            .last_error
            .clone()
            .expect("the status must tell the truth about the unverified adapters");
        assert!(note.contains(DNS_PROTECTION_UNVERIFIED_PREFIX), "{note}");
        assert!(note.contains("2 of 2"), "{note}");
        assert!(note.contains("{A}") && note.contains("{B}"), "{note}");
        assert!(
            status_is_unverified(&status),
            "the marker is what the reconciler and the App key off"
        );

        // Recorded where the restore proof and the next enable will find it.
        let persisted = read_snapshot().await?;
        assert!(
            persisted
                .adapters
                .iter()
                .all(|adapter| adapter.live_apply_failed),
            "every failed adapter must be flagged in the snapshot: {persisted:?}"
        );
        assert_eq!(
            LIVE_APPLY_FAILURES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .len(),
            2,
            "the in-memory record is what survives a snapshot rewrite"
        );
        assert_eq!(
            CONSECUTIVE_LIVE_FAILURES.load(Ordering::Relaxed),
            1,
            "the streak the degraded restore exit needs must still advance"
        );

        reset_dns_state().await;
        Ok(())
    }

    /// The line the demotion does **not** cross: a round that produced no per-adapter outcome at
    /// all — the apply batch could not be run, nothing was written to any adapter — is still a
    /// hard failure of `enable`. There is nothing to restore from that round, nothing for the
    /// reconciler to retry, and a status claiming "protected" would be a lie.
    #[tokio::test]
    #[serial]
    async fn enable_still_fails_hard_when_nothing_could_be_applied() -> Result<()> {
        reset_dns_state().await;
        seed_snapshot(vec![adapter("{A}", Some("1.1.1.1"))]).await?;
        test_hooks::set_apply_batch_unavailable(true);

        let error = enable()
            .await
            .expect_err("an apply that never ran must not report success");
        let message = format!("{error:#}");
        assert!(message.contains("could not be run at all"), "{message}");
        assert!(
            !message.contains(DNS_PROTECTION_UNVERIFIED_PREFIX),
            "this is a failure, not a recorded warning: {message}"
        );
        assert_eq!(
            DNS_LAST_ERROR
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_deref()
                .map(|error| error.contains("could not be run at all")),
            Some(true),
            "the hard failure still lands in the status payload"
        );
        assert!(
            tokio::fs::metadata(snapshot_path()).await.is_ok(),
            "the originals are written before the apply and are kept whatever it does"
        );

        reset_dns_state().await;
        Ok(())
    }

    /// Demoting the gate must not stop the retry. The recorded failures are what tell the
    /// watchdog there is work left — including on a machine whose registry read-back says
    /// `enabled` — and a repair that still cannot verify counts as a failed round, so the
    /// backoff and the suspension cap keep applying.
    #[test]
    fn the_reconciler_retries_recorded_failures_and_still_backs_off() {
        let unverified = DnsProtectionStatus {
            enabled: true,
            snapshot_present: true,
            adapters: 1,
            last_error: unverified_note(&["{A}".to_owned()], 1, LoopbackReadBack::Verified),
        };
        assert!(status_is_unverified(&unverified));
        assert!(
            needs_reconcile(true, true, true, true),
            "a recorded live-apply failure is work to do even when the registry looks protected"
        );
        assert!(
            needs_reconcile(true, true, false, false),
            "drift is still repaired"
        );
        assert!(
            !needs_reconcile(true, true, true, false),
            "a healthy, verified machine must be left alone"
        );
        assert!(
            !needs_reconcile(false, true, false, true),
            "intent still gates everything: a snapshot that outlived a disarm is not a reason to \
             re-apply loopback"
        );
        assert!(
            !needs_reconcile(true, false, false, true),
            "with no snapshot there is nothing to re-apply"
        );

        let clean = DnsProtectionStatus {
            last_error: None,
            ..unverified
        };
        assert!(!status_is_unverified(&clean));
        assert!(
            reconcile_backoff(DNS_RECONCILE_MAX_FAILURES).is_none(),
            "an unverifiable machine must still stop spawning PowerShell eventually"
        );
    }

    /// The retry loop end to end: a reconcile round that succeeds clears the note, the snapshot
    /// flags and the marker, so the watchdog stops repairing instead of looping for ever.
    #[tokio::test]
    #[serial]
    async fn a_successful_reconcile_round_retires_the_unverified_note() -> Result<()> {
        reset_dns_state().await;
        seed_snapshot(vec![adapter("{A}", Some("1.1.1.1"))]).await?;
        test_hooks::set_live_apply_fails(true);
        let failed = enable().await?;
        assert!(status_is_unverified(&failed));

        // The next round gets through (the transient PowerShell/CIM failure cleared).
        test_hooks::set_live_apply_fails(false);
        let repaired = enable_unlocked(EnableTrigger::Reconcile).await?;

        assert!(
            !status_is_unverified(&repaired),
            "a repaired round must retire the note: {repaired:?}"
        );
        assert_eq!(repaired.last_error, None);
        assert!(
            !read_snapshot()
                .await?
                .adapters
                .iter()
                .any(|adapter| adapter.live_apply_failed),
            "the recovered adapter's flag must be cleared on disk too"
        );
        assert!(
            LIVE_APPLY_FAILURES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_empty()
        );

        reset_dns_state().await;
        Ok(())
    }

    /// The demotion is one-directional. Whatever `enable` now tolerates, the restore keeps its
    /// proof — it is the gate that decides whether WFP may be disarmed — including the live-state
    /// check: a machine that is provably still on the loopback resolver is refused even though
    /// the enable that put it there reported success.
    #[tokio::test]
    #[serial]
    async fn a_demoted_enable_does_not_soften_the_restore_proof() -> Result<()> {
        reset_dns_state().await;
        seed_snapshot(vec![adapter("{A}", Some("1.1.1.1"))]).await?;
        test_hooks::set_live_apply_fails(true);
        let enabled = enable().await?;
        assert!(status_is_unverified(&enabled), "{enabled:?}");

        // The machine is still resolving through the loopback core when Disconnect is clicked.
        test_hooks::set_live_dns_on_loopback(true);
        let error = restore_protected()
            .await
            .expect_err("the restore proof must be exactly as strict as before");
        let message = format!("{error:#}");
        assert!(message.contains("still_on_loopback=yes"), "{message}");
        assert!(
            tokio::fs::metadata(snapshot_path()).await.is_ok(),
            "a refused restore keeps its snapshot, which keeps the kill switch armed"
        );

        reset_dns_state().await;
        Ok(())
    }

    /// The real-machine regression, end to end. `securingDNS` aside, this is the half that
    /// stranded the user: the registry restore had succeeded (`registry_match=true`), the live
    /// apply reported a failure for one adapter (`consecutive_live_apply_failures=1`), nothing
    /// was left on loopback — and the release was refused anyway, because a `live_apply_failed`
    /// flag vetoed the proof. The degraded exit that exists to prevent exactly that deadlock
    /// needs three consecutive failures, which one click on Disconnect can never reach.
    #[tokio::test]
    #[serial]
    async fn a_live_apply_failure_does_not_strand_a_machine_whose_dns_is_restored() -> Result<()> {
        reset_dns_state().await;
        // The live apply fails this round; `engine::apply_snapshot` writes the four registry
        // values regardless, which is why the machine's resolvers are the user's own again.
        test_hooks::set_live_apply_fails(true);
        let mut flagged = adapter("{A}", Some("1.1.1.1"));
        flagged.live_apply_failed = true; // and an earlier round had already recorded one
        atomic_write(
            &snapshot_path(),
            &serde_json::to_vec_pretty(&DnsSnapshot {
                version: SNAPSHOT_VERSION,
                taken_at: 1,
                adapters: vec![flagged],
            })?,
        )
        .await?;

        let status = restore_protected().await?;

        assert!(
            !status.snapshot_present,
            "a proven restore drops the snapshot, which is what opens the disarm gate"
        );
        assert!(
            tokio::fs::metadata(snapshot_path()).await.is_err(),
            "the snapshot file must be gone once the restore is proven"
        );
        assert_eq!(
            status.last_error, None,
            "the live state confirms the restore outright — this is not the degraded exit"
        );
        reset_dns_state().await;
        Ok(())
    }

    /// The other half of the same change: dropping the historical veto must not drop the
    /// ordering invariant. A machine that is provably still resolving through the loopback core
    /// is refused however good the registry looks and however long the failure streak is, and
    /// the refusal has to tell the user what to do about it.
    #[tokio::test]
    #[serial]
    async fn a_restore_is_still_refused_while_an_adapter_is_provably_on_loopback() -> Result<()> {
        reset_dns_state().await;
        test_hooks::set_live_dns_on_loopback(true);
        atomic_write(
            &snapshot_path(),
            &serde_json::to_vec_pretty(&DnsSnapshot {
                version: SNAPSHOT_VERSION,
                taken_at: 1,
                adapters: vec![adapter("{A}", Some("1.1.1.1"))],
            })?,
        )
        .await?;

        let error = restore_protected()
            .await
            .expect_err("a machine still on loopback may not release protection");
        let message = format!("{error:#}");
        assert!(message.contains("registry_match=true"), "{message}");
        assert!(message.contains("still_on_loopback=yes"), "{message}");
        assert!(
            message.contains("consecutive_live_apply_failures="),
            "the diagnosis that made the real failure readable must survive: {message}"
        );
        assert!(
            message.contains("--emergency-disarm") && message.contains("Restore Network"),
            "a refusal must name both documented ways out: {message}"
        );
        assert!(
            tokio::fs::metadata(snapshot_path()).await.is_ok(),
            "a refused restore keeps its snapshot for the retry"
        );
        reset_dns_state().await;
        Ok(())
    }

    #[test]
    fn restoration_without_a_snapshot_needs_positive_evidence() {
        assert!(
            restore_established_without_snapshot(false, false),
            "nothing points at loopback and no live-apply failed: the machine is demonstrably \
             not stranded on a dead resolver"
        );
        assert!(
            !restore_established_without_snapshot(true, false),
            "still on loopback: never disarm on an unreadable snapshot"
        );
        assert!(
            !restore_established_without_snapshot(false, true),
            "a recorded live-apply failure means the running resolver is unproven"
        );
        assert!(!restore_established_without_snapshot(true, true));
    }

    #[test]
    fn reconciliation_backs_off_and_then_suspends() {
        assert_eq!(reconcile_backoff(0), Some(std::time::Duration::ZERO));
        assert_eq!(reconcile_backoff(1), Some(DNS_WATCHDOG_INTERVAL));
        assert_eq!(reconcile_backoff(2), Some(DNS_WATCHDOG_INTERVAL * 2));
        assert!(
            reconcile_backoff(DNS_RECONCILE_MAX_FAILURES - 1) <= Some(DNS_RECONCILE_MAX_BACKOFF)
        );
        assert_eq!(
            reconcile_backoff(DNS_RECONCILE_MAX_FAILURES),
            None,
            "the repair loop must stop rather than spawn PowerShell forever"
        );
        assert_eq!(reconcile_backoff(DNS_RECONCILE_MAX_FAILURES + 100), None);
    }

    /// The S1 residual risk in miniature, and the mirror of the WFP module's test: a DNS engine
    /// call that never returns must produce a mappable error, and the abandoned blocking thread
    /// must keep the single-writer claim until the call really comes back. The engine itself is
    /// Windows-only, so the closure stands in for a wedged Dnscache/registry sweep — the
    /// ownership rules under test are the engine-independent part.
    #[tokio::test]
    #[serial]
    async fn a_wedged_dns_call_times_out_and_blocks_a_second_writer() -> Result<()> {
        let (release, blocked) = std::sync::mpsc::channel::<()>();
        let wedged = move || -> Result<()> {
            let _ = blocked.recv_timeout(std::time::Duration::from_secs(30));
            Ok(())
        };

        let timed_out = bounded_dns_call(std::time::Duration::from_millis(50), "flush", wedged)
            .await
            .expect_err("a call that never returns must not be awaited forever");
        let message = format!("{timed_out:#}");
        assert!(message.contains(DNS_ENGINE_WEDGED_PREFIX), "{message}");
        assert!(message.contains("flush"), "{message}");

        // The claim is still held by the running thread, so nothing may start a second DNS
        // writer — the refusal names the operation that is stuck.
        let refused = bounded_dns_call(std::time::Duration::from_secs(5), "collect", || Ok(()))
            .await
            .expect_err("a second writer must be refused while the first is still running");
        let message = format!("{refused:#}");
        assert!(message.contains(DNS_ENGINE_WEDGED_PREFIX), "{message}");
        assert!(message.contains("flush"), "{message}");

        // Only the abandoned call itself releases the claim, and it does so on its own thread.
        release.send(()).expect("the wedged call is still running");
        for _ in 0..300 {
            if dns_call_in_flight().is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(
            dns_call_in_flight().is_none(),
            "the blocking thread must release the claim when the call finally returns"
        );
        bounded_dns_call(std::time::Duration::from_secs(5), "collect", || Ok(())).await?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn a_healthy_dns_call_leaves_no_claim_behind() -> Result<()> {
        bounded_dns_call(std::time::Duration::from_secs(5), "collect", || Ok(())).await?;
        assert!(
            dns_call_in_flight().is_none(),
            "a completed call must not keep the next operation out"
        );
        let error = bounded_dns_call(
            std::time::Duration::from_secs(5),
            "flush",
            || -> Result<()> { bail!("engine said no") },
        )
        .await
        .expect_err("engine errors still propagate");
        assert!(format!("{error:#}").contains("engine said no"));
        assert!(dns_call_in_flight().is_none());
        Ok(())
    }
