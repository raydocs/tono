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
