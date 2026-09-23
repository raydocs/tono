//! Windows-only, opt-in OS effects for the real apply/enable/status/recovery path. No facade decisions
//! are injected. Snapshot serialization, atomic replacement and file security stay real in a
//! unique temporary directory; registry/IP Helper/native/legacy effects never touch host DNS.

use super::*;
use crate::core::dns as facade;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use windows_sys::Win32::NetworkManagement::IpHelper::{DNS_INTERFACE_SETTINGS, DNS_SETTING_IPV6};
use windows_sys::core::GUID;

static IO: Mutex<Option<Machine>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(0);

pub(crate) fn with<T>(call: impl FnOnce(&mut Machine) -> T) -> Option<T> {
    IO.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_mut()
        .map(call)
}

pub(crate) fn active() -> bool {
    with(|_| ()).is_some()
}

pub(crate) struct Machine {
    pub snapshot_path: PathBuf,
    pub keys: BTreeMap<String, BTreeMap<String, String>>,
    pub adapters: Vec<ActiveAdapter>,
    pub absent: BTreeSet<String>,
    pub vanish_after_collect: Option<String>,
    pub fail_live: BTreeSet<String>,
    pub fail_write: Option<(String, String)>,
    pub writes: usize,
    pub native_calls: usize,
    pub effective_reads: usize,
    pub policy_restores: usize,
    pub before_write: Vec<DnsSnapshot>,
}

impl Machine {
    pub fn read(&self, key: &str, value: &str) -> Option<String> {
        self.keys
            .get(key)
            .and_then(|values| values.get(value))
            .cloned()
    }

    pub fn write(&mut self, key: &str, value: &str, data: &str) -> Result<()> {
        // Inspect the actual durable file at the mutation boundary, not a supplied expectation.
        self.before_write.push(
            facade::parse_snapshot(&std::fs::read(&self.snapshot_path)?)
                .map_err(anyhow::Error::msg)?,
        );
        if self
            .fail_write
            .as_ref()
            .is_some_and(|(k, v)| k == key && v == value)
        {
            bail!("injected IPv6 registry write failure");
        }
        self.keys
            .get_mut(key)
            .context("fixture registry key missing")?
            .insert(value.to_owned(), data.to_owned());
        self.writes += 1;
        Ok(())
    }

    pub fn adapters(&mut self, include_dns: bool) -> Vec<ActiveAdapter> {
        if include_dns {
            self.effective_reads += 1;
        }
        let adapters = self
            .adapters
            .iter()
            .filter(|a| !self.absent.contains(&a.guid))
            .cloned()
            .map(|mut a| {
                if !include_dns {
                    a.dns_servers = None;
                }
                a
            })
            .collect();
        if !include_dns {
            if let Some(guid) = self.vanish_after_collect.take() {
                self.absent.insert(guid);
            }
        }
        adapters
    }

    pub fn legacy(&mut self, entries: &[LiveApplyEntry], mode: ApplyMode) -> Vec<(String, bool)> {
        assert!(
            mode == ApplyMode::Protect,
            "this fixture must not exercise restore/DHCP"
        );
        entries
            .iter()
            .map(|entry| {
                // Only failed-native adapters enter this fixture's compatibility path.
                assert!(self.fail_live.contains(&entry.guid));
                (entry.guid.clone(), false)
            })
            .collect()
    }
}

/// Same ABI as the dynamically loaded setter. The production buffer builder and per-family
/// loop invoke this synchronously; effective state is independently read by the real verifier.
pub(crate) unsafe extern "system" fn set_dns(
    guid: GUID,
    settings: *const DNS_INTERFACE_SETTINGS,
) -> u32 {
    // SAFETY: NativeApi::apply owns the struct and borrowed UTF-16 list for this call.
    let settings = unsafe { &*settings };
    with(|io| {
        io.native_calls += 1;
        let Some(adapter) = io.adapters.iter_mut().find(|adapter| {
            native_apply::interface_guid(&adapter.guid).is_ok_and(|candidate| {
                candidate.data1 == guid.data1
                    && candidate.data2 == guid.data2
                    && candidate.data3 == guid.data3
                    && candidate.data4 == guid.data4
            })
        }) else {
            return 1168;
        };
        if io.fail_live.contains(&adapter.guid) {
            return 5;
        }
        let ipv6 = settings.Flags & u64::from(DNS_SETTING_IPV6) != 0;
        let Some(len) = (0..256).position(|i| unsafe { *settings.NameServer.add(i) } == 0) else {
            return 13;
        };
        let names = String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(settings.NameServer, len)
        });
        let servers = adapter.dns_servers.get_or_insert_with(Vec::new);
        servers.retain(|ip| ip.is_ipv6() != ipv6);
        for name in names.split(',').filter(|s| !s.is_empty()) {
            let Ok(ip) = name.parse() else {
                return 13;
            };
            servers.push(ip);
        }
        0
    })
    .unwrap_or(1168)
}

pub(crate) struct Fixture {
    root: PathBuf,
    pub originals: DnsSnapshot,
}

impl Fixture {
    pub fn new(adapters: Vec<ActiveAdapter>) -> Result<Self> {
        let root = std::env::temp_dir().join(format!(
            "tono-dns-apply-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root)?;
        let originals = DnsSnapshot {
            version: 1,
            taken_at: 0,
            adapters: adapters
                .iter()
                .map(|a| AdapterDnsSnapshot {
                    interface_guid: a.guid.clone(),
                    ipv4_name_server: Some("9.9.9.9, 149.112.112.112".to_owned()),
                    ipv4_profile_name_server: None,
                    ipv6_name_server: Some("2001:db8::53".to_owned()),
                    ipv6_profile_name_server: Some(String::new()),
                    ..Default::default()
                })
                .collect(),
        };
        let mut keys = BTreeMap::new();
        for a in &originals.adapters {
            for (key, name, profile) in [
                (
                    v4_key(&a.interface_guid),
                    &a.ipv4_name_server,
                    &a.ipv4_profile_name_server,
                ),
                (
                    v6_key(&a.interface_guid),
                    &a.ipv6_name_server,
                    &a.ipv6_profile_name_server,
                ),
            ] {
                let values = [(NAME_SERVER, name), (PROFILE_NAME_SERVER, profile)]
                    .into_iter()
                    .filter_map(|(key, value)| value.as_ref().map(|v| (key.to_owned(), v.clone())))
                    .collect();
                keys.insert(key, values);
            }
        }
        reset_memory();
        let mut slot = IO.lock().unwrap();
        assert!(
            slot.is_none(),
            "native facade fixtures must use serial_test"
        );
        *slot = Some(Machine {
            snapshot_path: root.join("protected-dns.json"),
            keys,
            adapters,
            absent: BTreeSet::new(),
            vanish_after_collect: None,
            fail_live: BTreeSet::new(),
            fail_write: None,
            writes: 0,
            native_calls: 0,
            effective_reads: 0,
            policy_restores: 0,
            before_write: Vec::new(),
        });
        Ok(Self { root, originals })
    }

    pub fn snapshot(&self) -> Result<DnsSnapshot> {
        facade::parse_snapshot(&std::fs::read(self.root.join("protected-dns.json"))?)
            .map_err(anyhow::Error::msg)
    }

    pub fn assert_originals(&self, snapshot: &DnsSnapshot) {
        assert_eq!(snapshot.adapters.len(), self.originals.adapters.len());
        for original in &self.originals.adapters {
            let current = snapshot
                .adapters
                .iter()
                .find(|a| a.interface_guid == original.interface_guid)
                .unwrap();
            assert!(
                facade::registry_values_match(original, current),
                "original DNS changed: {current:?}"
            );
        }
    }
}

pub(crate) fn reset_memory() {
    facade::LIVE_APPLY_FAILURES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clear();
    *facade::DNS_LAST_ERROR
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    facade::CONSECUTIVE_LIVE_FAILURES.store(0, Ordering::Relaxed);
    facade::PROTECTION_WANTED.store(false, Ordering::Release);
    facade::SELF_WRITE_TAIL_UNTIL.store(0, Ordering::Relaxed);
}

impl Drop for Fixture {
    fn drop(&mut self) {
        *IO.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        reset_memory();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
