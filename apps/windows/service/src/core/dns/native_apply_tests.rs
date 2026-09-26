//! Production orchestration with injected native calls, IP Helper buffers and legacy work.
//! No test changes host DNS. These counts are synthetic, not connection latency evidence.

use super::*;
use std::cell::{Cell, RefCell};
use windows_sys::Win32::Networking::WinSock::SOCKET_ADDRESS;

fn entry(n: u32) -> LiveApplyEntry {
    LiveApplyEntry {
        guid: format!("{{{:08x}-9abc-4def-8123-456789abcdef}}", 0x12345670 + n),
        luid: u64::from(100 + n),
        ipv4_index: 10 + n,
        ipv6_index: 20 + n,
        ipv4_servers: Some(vec!["198.18.0.2".to_owned()]),
        ipv6_servers: Some(Vec::new()),
    }
}

fn effective(entry: &LiveApplyEntry, v4: [u8; 4], with_v6: bool) -> ActiveAdapter {
    let mut address4 = SOCKADDR_IN {
        sin_family: AF_INET,
        ..Default::default()
    };
    address4.sin_addr.S_un.S_addr = u32::from_ne_bytes(v4);
    let mut address6 = SOCKADDR_IN6 {
        sin6_family: AF_INET6,
        ..Default::default()
    };
    address6.sin6_addr.u.Byte = [
        0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x53,
    ];
    let mut record6 = IP_ADAPTER_DNS_SERVER_ADDRESS_XP {
        Address: SOCKET_ADDRESS {
            lpSockaddr: std::ptr::from_mut(&mut address6).cast(),
            iSockaddrLength: std::mem::size_of::<SOCKADDR_IN6>() as i32,
        },
        ..Default::default()
    };
    let mut record4 = IP_ADAPTER_DNS_SERVER_ADDRESS_XP {
        Address: SOCKET_ADDRESS {
            lpSockaddr: std::ptr::from_mut(&mut address4).cast(),
            iSockaddrLength: std::mem::size_of::<SOCKADDR_IN>() as i32,
        },
        Next: if with_v6 {
            &mut record6
        } else {
            std::ptr::null_mut()
        },
        ..Default::default()
    };
    // SAFETY: both records and socket allocations stay live throughout the copy. This
    // exercises the production parser, including network byte order and IPv6 membership.
    let dns_servers = unsafe { read_dns_servers(&mut record4) }.unwrap();
    ActiveAdapter {
        guid: entry.guid.to_ascii_uppercase(),
        luid: entry.luid,
        ipv4_index: entry.ipv4_index,
        ipv6_index: entry.ipv6_index,
        dns_servers: Some(dns_servers),
    }
}

#[test]
fn native_apply_verifies_both_families_without_legacy() {
    let entries = [entry(1)];
    let calls = RefCell::new(Vec::new());
    let result = apply_with(
        &entries,
        Some(|entry: &LiveApplyEntry| {
            apply_native(entry, |guid, settings| {
                assert_eq!(
                    (guid.data1, guid.data2, guid.data3),
                    (0x12345671, 0x9abc, 0x4def)
                );
                assert_eq!(guid.data4, [0x81, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
                assert_eq!(settings.Version, 1);
                let ipv6 = settings.Flags == 3;
                assert!(
                    settings.Flags == 2 || ipv6,
                    "only NAMESERVER and per-family IPV6 flags"
                );
                assert!(
                    settings.Domain.is_null()
                        && settings.SearchList.is_null()
                        && settings.ProfileNameServer.is_null()
                );
                assert_eq!(
                    (
                        settings.RegistrationEnabled,
                        settings.RegisterAdapterName,
                        settings.EnableLLMNR,
                        settings.QueryAdapterName
                    ),
                    (0, 0, 0, 0)
                );
                let expected = if ipv6 { "" } else { "198.18.0.2" };
                assert!(!settings.NameServer.is_null());
                // SAFETY: inspected synchronously while apply_native owns this terminated buffer.
                let len = (0..256)
                    .position(|i| unsafe { *settings.NameServer.add(i) } == 0)
                    .expect("terminated DNS list");
                let value = unsafe { std::slice::from_raw_parts(settings.NameServer, len) };
                assert_eq!(String::from_utf16(value).unwrap(), expected);
                calls.borrow_mut().push(if ipv6 { "v6" } else { "v4" });
                0
            })
        }),
        || {
            calls.borrow_mut().push("readback");
            Ok(vec![effective(&entries[0], [198, 18, 0, 2], false)])
        },
        |_| panic!("healthy native apply must launch zero legacy work"),
    );
    assert_eq!(result, vec![(entries[0].guid.clone(), true)]);
    assert_eq!(*calls.borrow(), ["v4", "v6", "readback"]);

    // Restoring DHCP must never reach even the first native setter.
    let mut dhcp = entry(2);
    dhcp.ipv4_servers = None;
    assert!(apply_native(&dhcp, |_, _| panic!("DHCP is legacy-only")).is_err());
}

#[test]
#[serial_test::serial]
fn native_apply_partial_and_readback_failures_preserve_originals() {
    use crate::core::dns::{AdapterDnsSnapshot, DnsSnapshot, note_live_results, parse_snapshot};
    let entries = [entry(1), entry(2), entry(3)];
    let originals = DnsSnapshot {
        version: 1,
        taken_at: 123,
        adapters: entries
            .iter()
            .map(|entry| AdapterDnsSnapshot {
                interface_guid: entry.guid.clone(),
                ipv4_name_server: Some("9.9.9.9, 149.112.112.112".to_owned()),
                ipv4_profile_name_server: None,
                ipv6_name_server: Some("2001:db8::7".to_owned()),
                ipv6_profile_name_server: Some(String::new()),
                ..Default::default()
            })
            .collect(),
    };
    let saved_bytes = serde_json::to_vec_pretty(&originals).unwrap();
    let mut snapshot = parse_snapshot(&saved_bytes).unwrap();
    let applied_v4 = RefCell::new(Vec::new());
    let reads = Cell::new(0);
    let legacy_calls = Cell::new(0);
    let result = apply_with(
        &entries,
        Some(|entry: &LiveApplyEntry| {
            apply_native(entry, |_, settings| {
                if settings.Flags == 2 {
                    applied_v4.borrow_mut().push(entry.guid.clone());
                }
                if entry.guid == entries[1].guid && settings.Flags == 3 {
                    5
                } else {
                    0
                }
            })
        }),
        || {
            reads.set(reads.get() + 1);
            let mut third = effective(&entries[2], [198, 18, 0, 2], false);
            if reads.get() == 2 {
                // Even a native-success adapter must have a fresh identity/read-back
                // after the compatibility batch changes other adapters.
                third.luid += 1;
            }
            Ok(vec![
                // A completed setter is contradicted initially, then fixed by compatibility.
                effective(
                    &entries[0],
                    if reads.get() == 1 {
                        [8, 8, 4, 4]
                    } else {
                        [198, 18, 0, 2]
                    },
                    false,
                ),
                // IPv4 landed before the IPv6 error; compatibility claims success but IPv6
                // still has a resolver. Omitting v6 or trusting the setter must fail this test.
                effective(&entries[1], [198, 18, 0, 2], true),
                third,
            ])
        },
        |pending| {
            legacy_calls.set(legacy_calls.get() + 1);
            assert_eq!(
                applied_v4.borrow().len(),
                3,
                "fallback follows completed native calls"
            );
            assert_eq!(
                pending.iter().map(|e| e.guid.as_str()).collect::<Vec<_>>(),
                [&entries[0].guid, &entries[1].guid]
            );
            pending
                .iter()
                .map(|entry| (entry.guid.clone(), true))
                .collect()
        },
    );
    assert_eq!(legacy_calls.get(), 1);
    assert_eq!(reads.get(), 2);
    assert_eq!(
        result,
        vec![
            (entries[0].guid.clone(), true),
            (entries[1].guid.clone(), false),
            (entries[2].guid.clone(), false)
        ]
    );

    // Feed actual outcomes into the facade's production evidence writer/serialization.
    // The existing facade tests cover on-disk snapshot-before-write and restore refusal.
    note_live_results(&mut snapshot, &result);
    let roundtrip = parse_snapshot(&serde_json::to_vec_pretty(&snapshot).unwrap()).unwrap();
    let mut expected = originals;
    expected.adapters[1].live_apply_failed = true;
    expected.adapters[2].live_apply_failed = true;
    assert_eq!(
        roundtrip, expected,
        "all four exact originals survive a partial apply"
    );
    assert!(
        crate::core::dns::LIVE_APPLY_FAILURES
            .lock()
            .unwrap()
            .remove(&entries[1].guid)
    );
    assert!(
        crate::core::dns::LIVE_APPLY_FAILURES
            .lock()
            .unwrap()
            .remove(&entries[2].guid)
    );
    assert_eq!(
        parse_snapshot(&saved_bytes).unwrap().adapters[1].ipv4_profile_name_server,
        None
    );
}

#[test]
fn native_apply_missing_export_uses_one_verified_compatibility_batch() {
    let entries = [entry(1)];
    let calls = RefCell::new(Vec::new());
    let result = apply_with(
        &entries,
        None::<fn(&LiveApplyEntry) -> Result<()>>,
        || {
            calls.borrow_mut().push("readback");
            Ok(vec![effective(&entries[0], [198, 18, 0, 2], false)])
        },
        |pending| {
            calls.borrow_mut().push("bounded legacy");
            pending
                .iter()
                .map(|entry| (entry.guid.clone(), true))
                .collect()
        },
    );
    assert_eq!(result, vec![(entries[0].guid.clone(), true)]);
    assert_eq!(*calls.borrow(), ["bounded legacy", "readback"]);
}

#[test]
fn native_apply_unavailable_readback_never_confirms_setter_success() {
    let entries = [entry(1)];
    let reads = Cell::new(0);
    let legacy_calls = Cell::new(0);
    let result = apply_with(
        &entries,
        Some(|entry: &LiveApplyEntry| apply_native(entry, |_, _| 0)),
        || {
            reads.set(reads.get() + 1);
            bail!("IP Helper unavailable");
        },
        |pending| {
            legacy_calls.set(legacy_calls.get() + 1);
            pending
                .iter()
                .map(|entry| (entry.guid.clone(), true))
                .collect()
        },
    );
    assert_eq!(reads.get(), 2);
    assert_eq!(legacy_calls.get(), 1);
    assert_eq!(
        result,
        vec![(entries[0].guid.clone(), false)],
        "missing readback cannot prove this apply even after compatibility claims success"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn native_apply_absence_retains_pending_until_active_repair() -> Result<()> {
    use super::super::test_io::{self, Fixture};
    use crate::core::dns as facade;
    let a = effective(&entry(1), [9, 9, 9, 9], true);
    let b = effective(&entry(2), [149, 112, 112, 112], false);
    let guid = a.guid.clone();
    let fixture = Fixture::new(vec![a, b])?;
    test_io::with(|io| {
        io.fail_live.insert(guid.clone());
    });
    assert!(facade::status_is_unverified(&facade::enable().await?));
    assert!(fixture.snapshot()?.adapters[0].live_apply_failed);

    // A is collected by the facade, then vanishes before apply_protected_set enumerates it.
    // B still has to pass real native orchestration/readback: this is not an empty-set proof.
    test_io::with(|io| io.vanish_after_collect = Some(guid.clone()));
    let absent = facade::enable().await?;
    let saved = fixture.snapshot()?;
    fixture.assert_originals(&saved);
    assert!(
        saved.adapters[0].live_apply_failed,
        "absence must not retire A's pending effective-apply evidence"
    );
    assert!(absent.enabled && !facade::status_is_unverified(&absent));

    let (idle, active_pending) = facade::observe_status_unlocked().await?;
    assert!(!facade::needs_reconcile(
        true,
        true,
        idle.enabled,
        active_pending || facade::status_is_unverified(&idle)
    ));
    let idle_counts = test_io::with(|io| (io.writes, io.native_calls)).unwrap();
    facade::enable().await?;
    assert_eq!(
        test_io::with(|io| (io.writes, io.native_calls)).unwrap(),
        idle_counts,
        "historical absent A must not cause perpetual writes to healthy B"
    );

    test_io::with(|io| {
        io.absent.remove(&guid);
        io.fail_live.clear();
        io.adapters[0].luid += 1;
        io.adapters[0].ipv4_index += 1;
    });
    // Restart-shaped observation: there is no process-local failure set or error string.
    test_io::reset_memory();
    let returned = facade::status_unlocked().await?;
    assert!(
        facade::needs_reconcile(
            true,
            true,
            returned.enabled,
            facade::status_is_unverified(&returned)
        ),
        "returning A still owes effective proof even though the registry looks protected"
    );
    let before = test_io::with(|io| (io.native_calls, io.effective_reads)).unwrap();
    let repaired = facade::enable().await?;
    let after = test_io::with(|io| (io.native_calls, io.effective_reads)).unwrap();
    assert!(
        after.0 > before.0 && after.1 > before.1,
        "reappearance must really apply and read back"
    );
    assert!(repaired.enabled && !facade::status_is_unverified(&repaired));
    let saved = fixture.snapshot()?;
    assert!(saved.adapters.iter().all(|a| !a.live_apply_failed));
    fixture.assert_originals(&saved);
    Ok(())
}

#[tokio::test]
#[serial_test::serial]
async fn native_apply_registry_error_retains_pending_repair() -> Result<()> {
    use super::super::{
        NAME_SERVER, PROFILE_NAME_SERVER,
        test_io::{self, Fixture},
        v4_key, v6_key,
    };
    use crate::core::dns as facade;
    let a = effective(&entry(1), [9, 9, 9, 9], true);
    let guid = a.guid.clone();
    let fixture = Fixture::new(vec![a])?;
    assert!(facade::enable().await?.enabled);
    fixture.assert_originals(&fixture.snapshot()?);
    let before = test_io::with(|io| {
        // External drift triggers the same repair the watchdog requests. Restore/DHCP is
        // deliberately not involved, and the next failure occurs after both v4 writes.
        io.keys
            .get_mut(&v4_key(&guid))
            .unwrap()
            .insert(NAME_SERVER.into(), "8.8.4.4".into());
        io.adapters[0].dns_servers = Some(vec![
            "8.8.4.4".parse().unwrap(),
            "2001:db8::53".parse().unwrap(),
        ]);
        io.fail_write = Some((v6_key(&guid), NAME_SERVER.into()));
        io.before_write.clear();
        (io.writes, io.native_calls, io.effective_reads)
    })
    .unwrap();
    let _operation = facade::DNS_OPERATION.lock().await;
    let error = facade::enable_unlocked(facade::EnableTrigger::Reconcile)
        .await
        .unwrap_err();
    assert!(format!("{error:#}").contains("injected IPv6 registry write failure"));
    test_io::with(|io| {
        assert_eq!(
            io.writes,
            before.0 + 2,
            "both v4 values changed before the error"
        );
        assert_eq!(
            (io.native_calls, io.effective_reads),
            (before.1, before.2),
            "no live apply ran"
        );
        assert_eq!(
            io.read(&v4_key(&guid), PROFILE_NAME_SERVER).as_deref(),
            Some("198.18.0.2")
        );
    });
    // Use the same private observation and gate as the watchdog, without turning a hard
    // registry error into an advisory warning for the App's unchanged health predicate.
    let (status, active_pending) = facade::observe_status_unlocked().await?;
    assert!(active_pending);
    assert!(status.enabled && !facade::status_is_unverified(&status));
    assert!(
        facade::needs_reconcile(
            true,
            true,
            status.enabled,
            active_pending || facade::status_is_unverified(&status)
        ),
        "partial registry error must remain repairable despite protected-looking v4 registry"
    );
    assert!(
        status
            .last_error
            .as_deref()
            .unwrap()
            .contains("injected IPv6 registry write failure")
    );
    let saved = fixture.snapshot()?;
    assert!(
        saved.adapters[0].live_apply_failed,
        "unfinished apply must survive process restart"
    );
    fixture.assert_originals(&saved);
    test_io::with(|io| {
        assert!(!io.before_write.is_empty());
        for snapshot in &io.before_write {
            assert!(
                snapshot.adapters[0].live_apply_failed,
                "persist pending BEFORE the first mutation"
            );
            fixture.assert_originals(snapshot);
        }
        io.fail_write = None;
    });
    test_io::reset_memory();
    let restarted = facade::status_unlocked().await?;
    assert!(facade::needs_reconcile(
        true,
        true,
        restarted.enabled,
        facade::status_is_unverified(&restarted)
    ));
    let repaired = facade::enable_unlocked(facade::EnableTrigger::Reconcile).await?;
    assert!(repaired.enabled && !facade::status_is_unverified(&repaired));
    assert_eq!(repaired.last_error, None);
    assert!(
        test_io::with(|io| io.native_calls > before.1 && io.effective_reads > before.2).unwrap()
    );
    let saved = fixture.snapshot()?;
    assert!(!saved.adapters[0].live_apply_failed);
    fixture.assert_originals(&saved);
    Ok(())
}

#[tokio::test]
#[serial_test::serial]
async fn mixed_protected_dns_cannot_prove_corrupt_snapshot_recovery() -> Result<()> {
    use super::super::{
        PROFILE_NAME_SERVER,
        test_io::{self, Fixture},
        v4_key,
    };
    use crate::core::dns as facade;
    let a = effective(&entry(1), [198, 18, 0, 2], false);
    let b = effective(&entry(2), [149, 112, 112, 112], false);
    let guid = a.guid.clone();
    let _fixture = Fixture::new(vec![a, b])?;
    let path = test_io::with(|io| {
        // The ordinary value and B are public; only A's active-profile list still
        // contains the TUN resolver, behind a public server. Any occurrence matters.
        io.keys
            .get_mut(&v4_key(&guid))
            .unwrap()
            .insert(PROFILE_NAME_SERVER.into(), "1.1.1.1, 198.18.0.2".into());
        io.snapshot_path.clone()
    })
    .unwrap();
    let corrupt = b"{invalid DNS recovery snapshot";
    tokio::fs::write(&path, corrupt).await?;

    // Real restore -> parse failure -> engine registry read -> recovery gate. Only
    // OS effects are injected; neither the proof nor the facade outcome is stubbed.
    let error = facade::restore_protected()
        .await
        .expect_err("a public fallback cannot prove the Tono redirect was removed");
    let message = format!("{error:#}");
    assert!(message.contains(facade::DNS_SNAPSHOT_UNREADABLE_PREFIX));
    assert!(message.contains("tono_dns=true"), "{message}");
    assert_eq!(tokio::fs::read(&path).await?, corrupt);
    assert_eq!(
        test_io::with(|io| (io.writes, io.native_calls, io.policy_restores)).unwrap(),
        (0, 0, 0),
        "refused recovery must keep its evidence and leave resolver policies alone"
    );
    assert_eq!(
        facade::uninstall_reset_targets().await?,
        vec![guid.clone()],
        "uninstall selection must not omit a partial current redirect either"
    );

    // Independent positive control: once the TUN address is removed, recovery
    // must still complete, restore policy and retain the corrupt file for diagnosis.
    test_io::with(|io| {
        io.keys
            .get_mut(&v4_key(&guid))
            .unwrap()
            .insert(PROFILE_NAME_SERVER.into(), "1.1.1.1, 9.9.9.9".into());
        io.adapters[0].dns_servers =
            Some(vec!["1.1.1.1".parse().unwrap(), "9.9.9.9".parse().unwrap()]);
    });
    let restored = facade::restore_protected().await?;
    assert!(!restored.enabled && !restored.snapshot_present);
    assert_eq!(restored.last_error, None);
    assert!(!path.exists());
    assert_eq!(test_io::with(|io| io.policy_restores).unwrap(), 1);
    let retained = std::fs::read_dir(path.parent().unwrap())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    assert_eq!(retained.len(), 1);
    assert!(
        retained[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("protected-dns.corrupt-")
    );
    assert_eq!(tokio::fs::read(&retained[0]).await?, corrupt);
    Ok(())
}

/// R3-F1, recovery half: the corrupt-snapshot recovery must take its evidence from the
/// registry's own interface list, not only the active adapters. A leftover TUN endpoint on an
/// adapter that was inactive when the file went unreadable used to be invisible to the
/// recovery: it survived the quarantine and rode the adapter's return into the next merge as
/// a poisoned "original". Here {B} never joins the active set — only its interface key exists.
/// {C} is the removed WinTUN interface's key: the TUN DNS address in `NameServer` alone, the
/// shape Tono's own apply never writes. It is not a leftover, so once {B} is cleaned up it
/// must not keep refusing the recovery.
#[tokio::test]
#[serial_test::serial]
async fn corrupt_snapshot_recovery_refuses_over_an_inactive_leftover_tun_dns() -> Result<()> {
    use super::super::{NAME_SERVER, PROFILE_NAME_SERVER, test_io::{self, Fixture}, v4_key};
    use crate::core::dns as facade;

    let a = effective(&entry(1), [9, 9, 9, 9], false);
    let b = entry(2).guid;
    let c = entry(3).guid;
    let fixture = Fixture::new(vec![a])?;
    let path = test_io::with(|io| {
        // {B} exists only in the registry: unplugged or disabled while the snapshot was lost,
        // its interface key still carries the protected endpoint exactly as Tono's apply wrote it.
        io.keys.insert(
            v4_key(&b),
            [
                (NAME_SERVER.to_owned(), facade::PROTECTED_DNS_V4.to_owned()),
                (PROFILE_NAME_SERVER.to_owned(), facade::PROTECTED_DNS_V4.to_owned()),
            ]
            .into(),
        );
        io.keys.insert(
            v4_key(&c),
            [(NAME_SERVER.to_owned(), facade::PROTECTED_DNS_V4.to_owned())].into(),
        );
        io.snapshot_path.clone()
    })
    .unwrap();
    let corrupt = b"{invalid DNS recovery snapshot";
    tokio::fs::write(&path, corrupt).await?;

    let error = facade::enable()
        .await
        .expect_err("an inactive leftover must refuse the recovery, not ride it out");
    let message = format!("{error:#}");
    assert!(
        message.contains(facade::DNS_SNAPSHOT_UNREADABLE_PREFIX),
        "{message}"
    );
    assert!(message.contains("tono_dns=true"), "{message}");
    assert_eq!(
        tokio::fs::read(&path).await?,
        corrupt,
        "a refused recovery keeps its evidence"
    );
    assert_eq!(
        test_io::with(|io| (io.writes, io.native_calls, io.policy_restores)).unwrap(),
        (0, 0, 0),
        "a refused recovery must not rewrite adapter DNS or resolver policy"
    );

    // Once the leftover is cleaned up in Windows, the same recovery completes — the removed
    // tunnel's key {C} does not hold it back: the corrupt file is quarantined and enable
    // proceeds from a clean snapshot of the active adapters.
    test_io::with(|io| {
        let key = io.keys.get_mut(&v4_key(&b)).unwrap();
        key.insert(NAME_SERVER.into(), "1.1.1.1".into());
        key.remove(PROFILE_NAME_SERVER);
    });
    let status = facade::enable().await?;
    assert!(status.enabled && status.snapshot_present, "{status:?}");
    let saved = fixture.snapshot()?;
    assert_eq!(saved.adapters.len(), 1, "{saved:?}");
    fixture.assert_originals(&saved);
    let retained = std::fs::read_dir(path.parent().unwrap())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    let quarantined = retained
        .iter()
        .find(|path| {
            path.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .starts_with("protected-dns.corrupt-")
            })
        })
        .expect("the unreadable file must be quarantined, not kept in place");
    assert_eq!(tokio::fs::read(quarantined).await?, corrupt);
    Ok(())
}

/// R3-F2: a corrupt resolver-policy capture must not turn Disconnect into a permanent
/// refusal. The sidecar writes used to be neither atomic nor ever rewritten, so a crash or
/// power loss could leave `protected-interface-doh.json` zero-length; every later restore
/// then failed the parse — on every retry, with no in-product way out, and the file survives
/// even an uninstall/reinstall. Here a normal session exists (a real snapshot on disk), the
/// adapter vanishes mid-session — the documented "vanished counts as proven" restore — and
/// the capture lands zero-length: restore must succeed through the proven path, quarantine
/// the capture under the snapshot quarantine's naming, and report the loss through the
/// marker rather than as a clean restore. (The suppress early-death aggravation — the same
/// unreadable file failing the capture read before any policy was written — is fixed by the
/// same parse-tolerant engine path, but suppress stays fixture-short-circuited, so this test
/// asserts the restore face only.)
#[tokio::test]
#[serial_test::serial]
async fn corrupt_interface_doh_capture_is_quarantined_not_a_permanent_refusal() -> Result<()> {
    use super::super::{NAME_SERVER, test_io::{self, Fixture}, v4_key};
    use crate::core::dns as facade;

    let a = effective(&entry(1), [9, 9, 9, 9], false);
    let guid = a.guid.clone();
    let _fixture = Fixture::new(vec![a])?;
    assert!(facade::enable().await?.enabled);
    let capture_path = test_io::with(|io| {
        // The adapter left while protection was on: its registry key keeps the protected
        // values and the snapshot keeps the originals, which `apply_snapshot` restores.
        io.absent.insert(guid.clone());
        io.capture_dir.join("protected-interface-doh.json")
    })
    .unwrap();
    // The crash face: the sidecar exists, but its bytes never made it to disk.
    std::fs::write(&capture_path, b"")?;

    let restored = facade::restore_protected().await?;
    assert!(
        !restored.enabled && !restored.snapshot_present,
        "{restored:?}"
    );
    assert!(
        restored
            .last_error
            .as_deref()
            .is_some_and(|note| note.contains(facade::DNS_CAPTURE_QUARANTINED_PREFIX)),
        "the lost capture must be surfaced, not reported as a clean restore: {:?}",
        restored.last_error
    );
    // The vanished adapter's registry was still restored from the intact snapshot, and the
    // snapshot was retired; only the unreadable capture was set aside, empty bytes retained.
    assert!(!capture_path.exists());
    test_io::with(|io| {
        assert_eq!(
            io.read(&v4_key(&guid), NAME_SERVER).as_deref(),
            Some("9.9.9.9, 149.112.112.112"),
            "the snapshot's originals must be back in the vanished adapter's key"
        );
    });
    let retained = std::fs::read_dir(capture_path.parent().unwrap())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    assert_eq!(
        retained.len(),
        1,
        "the retired snapshot must be gone: {retained:?}"
    );
    let quarantined = &retained[0];
    assert!(
        quarantined
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("protected-interface-doh.corrupt-"),
        "the unreadable capture must be quarantined, not kept in place: {quarantined:?}"
    );
    assert_eq!(std::fs::read(quarantined)?, b"");
    assert_eq!(
        test_io::with(|io| io.policy_restores).unwrap(),
        1,
        "the policy restore must have run for real through the fixture"
    );
    Ok(())
}

/// R3-F2, the standard timeline: the capture goes zero-length, and the *next Connect* reaches
/// it before any restore does. Its suppress quarantines the file, but the live templates are
/// already zeroed by the earlier session, so there is nothing left to re-capture. The loss
/// used to live only in that suppress's log line: the following restore found no capture at
/// all and reported a clean result, leaving the user's DoH preference silently off. The
/// restore must report the loss instead.
#[test]
#[serial_test::serial]
fn a_capture_quarantined_by_suppress_is_still_reported_by_restore() -> Result<()> {
    use super::super::{
        restore_interface_doh, retire_lost_captures, suppress_interface_doh,
        test_io::{self, Fixture},
    };

    let _fixture = Fixture::new(vec![effective(&entry(1), [9, 9, 9, 9], false)])?;
    let capture_path =
        test_io::with(|io| io.capture_dir.join("protected-interface-doh.json")).unwrap();
    std::fs::write(&capture_path, b"")?;

    // Connect: no enabled template is left in the fixture registry — they are ours, zeroed.
    suppress_interface_doh()?;
    // Disconnect.
    assert!(
        restore_interface_doh()?,
        "a capture lost during suppress must reach the restore result, not read as clean"
    );
    // Restore only reads the evidence; the facade retires it once a restore has committed and
    // surfaced the loss (#305 review: a failed attempt must not have consumed it).
    assert!(
        restore_interface_doh()?,
        "the record stays until a committed restore retires it"
    );
    retire_lost_captures()?;
    assert!(
        !restore_interface_doh()?,
        "a retired loss is not reported again by the engine"
    );
    Ok(())
}

/// #305 review (opus:F2 / codex:F2): the loss evidence must survive a restore that fails on a
/// later leg. The unreadable `EnableAutoDoh` capture used to be renamed away (and a lost record
/// deleted) before the per-adapter leg ran; when that leg then failed, the error dropped the
/// loss, and the retry — finding no capture at all — reported a clean restore.
#[test]
#[serial_test::serial]
fn a_failed_policy_restore_keeps_the_capture_loss_for_the_retry() -> Result<()> {
    use super::super::{DOH_FLAGS, interface_doh_key, restore_encrypted_dns, test_io::{self, Fixture}};
    use crate::core::dns as facade;

    let _fixture = Fixture::new(vec![effective(&entry(1), [9, 9, 9, 9], false)])?;
    let doh_key = interface_doh_key("{A}", "Doh", "1.1.1.1");
    let (snapshot, global, interface) = test_io::with(|io| {
        io.keys.insert(doh_key.clone(), Default::default());
        io.fail_write = Some((doh_key.clone(), DOH_FLAGS.into()));
        (
            io.snapshot_path.clone(),
            io.capture_dir.join("protected-secure-dns.json"),
            io.capture_dir.join("protected-interface-doh.json"),
        )
    })
    .unwrap();
    // The fixture inspects the durable snapshot at every registry write.
    std::fs::write(
        &snapshot,
        serde_json::to_vec(&facade::DnsSnapshot {
            version: 1,
            taken_at: 0,
            adapters: Vec::new(),
        })?,
    )?;
    // The global capture went zero-length; the per-adapter one is intact.
    std::fs::write(&global, b"")?;
    let body = facade::format_interface_doh_capture(&[facade::InterfaceDohEntry {
        guid: "{A}".into(),
        family: "Doh".into(),
        server: "1.1.1.1".into(),
        flags: 1,
    }])
    .map_err(anyhow::Error::msg)?;
    std::fs::write(&interface, body)?;

    restore_encrypted_dns().expect_err("the per-adapter leg fails this attempt");
    test_io::with(|io| io.fail_write = None);
    assert!(
        restore_encrypted_dns()?,
        "the retry must still report the unrecoverable EnableAutoDoh original"
    );
    Ok(())
}

/// #305 review (codex:F1): a normal Disconnect runs two restores — the release handler's, then
/// the disarm gate's snapshot-less one. The second used to find the evidence already consumed,
/// clear `last_error` and publish a clean result over the loss the first one had reported.
#[tokio::test]
#[serial_test::serial]
async fn the_second_restore_of_a_disconnect_keeps_the_capture_loss_note() -> Result<()> {
    use super::super::test_io::{self, Fixture};
    use crate::core::dns as facade;

    let a = effective(&entry(1), [9, 9, 9, 9], false);
    let guid = a.guid.clone();
    let _fixture = Fixture::new(vec![a])?;
    assert!(facade::enable().await?.enabled);
    let capture_path = test_io::with(|io| {
        // Vanished mid-session, as in the R3-F2 restore test: the proven path needs no live apply.
        io.absent.insert(guid.clone());
        io.capture_dir.join("protected-interface-doh.json")
    })
    .unwrap();
    std::fs::write(&capture_path, b"")?;
    let reports_loss = |status: &crate::core::structure::DnsProtectionStatus| {
        status
            .last_error
            .as_deref()
            .is_some_and(|note| note.contains(facade::DNS_CAPTURE_QUARANTINED_PREFIX))
    };

    let first = facade::restore_protected().await?;
    assert!(reports_loss(&first), "{first:?}");
    let second = facade::restore_protected().await?;
    assert!(
        reports_loss(&second),
        "the disarm gate's restore must not publish a clean result: {second:?}"
    );
    Ok(())
}

/// #305 review (opus:F1): a capture found unreadable by the corrupt-snapshot recovery inside
/// Connect must still reach the next restore. The recovery used to move it aside while
/// `enable` dropped its note, so the following Disconnect reported a clean restore.
#[tokio::test]
#[serial_test::serial]
async fn a_capture_loss_met_by_the_enable_recovery_reaches_the_next_restore() -> Result<()> {
    use super::super::test_io::{self, Fixture};
    use crate::core::dns as facade;

    let a = effective(&entry(1), [9, 9, 9, 9], false);
    let guid = a.guid.clone();
    let _fixture = Fixture::new(vec![a])?;
    let (snapshot, capture) = test_io::with(|io| {
        (
            io.snapshot_path.clone(),
            io.capture_dir.join("protected-interface-doh.json"),
        )
    })
    .unwrap();
    std::fs::write(&snapshot, b"{invalid DNS recovery snapshot")?;
    std::fs::write(&capture, b"")?;
    assert!(
        facade::enable().await?.enabled,
        "the recovery completes on a clean registry"
    );

    test_io::with(|io| io.absent.insert(guid.clone()));
    let restored = facade::restore_protected().await?;
    assert!(
        restored
            .last_error
            .as_deref()
            .is_some_and(|note| note.contains(facade::DNS_CAPTURE_QUARANTINED_PREFIX)),
        "the loss met during Connect must reach the Disconnect: {restored:?}"
    );
    Ok(())
}

/// #305 review (opus:F4): suppress must not move an unreadable capture aside before the
/// lost-originals record is durable. When the record cannot be written, the unreadable file is
/// the only evidence of the loss, so it has to stay where the next restore reads it.
#[test]
#[serial_test::serial]
fn an_unwritable_lost_record_keeps_the_unreadable_capture_in_place() -> Result<()> {
    use super::super::{suppress_interface_doh, test_io::{self, Fixture}};

    let _fixture = Fixture::new(vec![effective(&entry(1), [9, 9, 9, 9], false)])?;
    let capture =
        test_io::with(|io| io.capture_dir.join("protected-interface-doh.json")).unwrap();
    std::fs::write(&capture, b"")?;
    // A directory where the record belongs: the atomic replace onto it fails.
    std::fs::create_dir(capture.with_extension("lost.json"))?;
    suppress_interface_doh().expect_err("the lost record cannot be committed");
    assert_eq!(
        std::fs::read(&capture)?,
        b"",
        "the unreadable capture must stay in place as the evidence"
    );
    Ok(())
}

/// R3-F1 review (#300): the recovery's WinTUN exclusion reads "the TUN address in IPv4
/// `NameServer` and nothing else" as the removed tunnel's own key. Tono's protected apply must
/// never leave a real adapter in that shape when it is stopped between its two IPv4 writes,
/// or a corrupt snapshot would let the half-redirected adapter drop out of the evidence. The
/// stop is injected at the IPv4 `ProfileNameServer` write, the second one in the old order.
#[tokio::test]
#[serial_test::serial]
async fn an_interrupted_protected_apply_never_leaves_the_tunnel_key_shape() -> Result<()> {
    use super::super::{
        PROFILE_NAME_SERVER, read_adapter,
        test_io::{self, Fixture},
        v4_key, v6_key,
    };
    use crate::core::dns as facade;

    let a = effective(&entry(1), [9, 9, 9, 9], false);
    let guid = a.guid.clone();
    let _fixture = Fixture::new(vec![a])?;
    test_io::with(|io| {
        // DHCP on the IPv6 side: nothing there tells the key apart from the tunnel's.
        io.keys.get_mut(&v6_key(&guid)).unwrap().clear();
        io.fail_write = Some((v4_key(&guid), PROFILE_NAME_SERVER.into()));
    })
    .unwrap();
    facade::enable()
        .await
        .expect_err("the injected registry failure stops the protected apply");
    let left = read_adapter(&guid, None)?;
    assert!(
        !facade::is_inactive_tunnel_interface_key(&left, &[]),
        "a stopped protected apply left the WinTUN key shape on a real adapter: {left:?}"
    );
    test_io::with(|io| io.fail_write = None);
    Ok(())
}

#[tokio::test]
#[serial_test::serial]
async fn effective_resolver_policy_drift_cannot_read_as_healthy() -> Result<()> {
    use super::super::test_io::{self, Fixture};
    use crate::core::dns as facade;
    use crate::core::structure::DnsProtectionStatus;
    let a = effective(&entry(1), [9, 9, 9, 9], true);
    let _fixture = Fixture::new(vec![a])?;
    let connected = facade::enable().await?;
    assert!(connected.enabled && connected.last_error.is_none());
    assert!(connected.resolver_policy_warning.is_none());
    let conflict = |status: &DnsProtectionStatus| {
        status
            .resolver_policy_warning
            .as_deref()
            .is_some_and(|warning| warning.contains(facade::DNS_RESOLVER_POLICY_CONFLICT_PREFIX))
    };
    // The update Prepare gate (`protection()`), the startup takeover candidate and the App's
    // lost-response read-back all require exactly this: an enabled status with no error.
    let no_error = |status: &DnsProtectionStatus| status.enabled && status.last_error.is_none();

    // Tono's catch-all is still the rule in force, but a cache-bypassing lookup was answered from
    // outside the tunnel: a conflict, reported beside the error rather than as one.
    test_io::with(|io| io.system_lookup = Ok(vec![std::net::Ipv4Addr::new(142, 250, 72, 4)])).unwrap();
    facade::refresh_resolver_policy_observation().await;
    let status = facade::observe_for_update().await?;
    assert!(conflict(&status) && no_error(&status), "{status:?}");

    // A protected reconnect restarts Core and both observations fail for a few seconds. That
    // decides nothing, so it is neither a conflict nor an error.
    test_io::with(|io| {
        io.effective_nrpt = Err("NRPT read exceeded 5s".to_owned());
        io.system_lookup = Err("DnsQuery_W returned 1460".to_owned());
    })
    .unwrap();
    facade::refresh_resolver_policy_observation().await;
    let status = facade::observe_for_update().await?;
    assert!(!conflict(&status) && no_error(&status), "{status:?}");

    // A policy-store catch-all to a resolver outside the tunnel takes effect while every adapter
    // still reads 198.18.0.2; the failing lookup beside it does not hide the rule.
    test_io::with(|io| {
        io.effective_nrpt = Ok(vec![facade::EffectiveNrptRule {
            namespaces: vec![".".to_owned()],
            generic_dns_servers: vec!["10.20.30.40".to_owned()],
            tono_owned: false,
        }]);
    })
    .unwrap();
    facade::refresh_resolver_policy_observation().await;
    let status = facade::observe_for_update().await?;
    assert!(conflict(&status) && no_error(&status), "{status:?}");
    assert!(
        facade::PROTECTION_WANTED.load(std::sync::atomic::Ordering::Acquire),
        "reporting the conflict must not release protection"
    );
    Ok(())
}
