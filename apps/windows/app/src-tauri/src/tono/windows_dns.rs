//! Bounded access to the Windows DNS Client resolver.
//!
//! Tokio's `lookup_host` delegates to `getaddrinfo`, whose blocking work keeps
//! running after an async timeout. That is especially harmful immediately after
//! changing adapter DNS: one stale query can occupy a worker while subsequent
//! verification attempts pile up behind it. `DnsQueryEx` gives us the same
//! system resolver with cache bypass, explicit record types (`A` / `AAAA`), and
//! a real cancellation handle.

use std::{
    ffi::c_void,
    net::{Ipv4Addr, Ipv6Addr},
    ptr,
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

use windows_sys::Win32::{
    Foundation::{DNS_REQUEST_PENDING, ERROR_SUCCESS},
    NetworkManagement::Dns::{
        DNS_QUERY_BYPASS_CACHE, DNS_QUERY_CANCEL, DNS_QUERY_NO_HOSTS_FILE, DNS_QUERY_REQUEST,
        DNS_QUERY_REQUEST_VERSION1, DNS_QUERY_RESULT, DNS_QUERY_RESULTS_VERSION1,
        DNS_QUERY_TREAT_AS_FQDN, DNS_RECORDA, DNS_TYPE_A, DnsCancelQuery, DnsFree,
        DnsFreeRecordList, DnsQueryEx,
    },
};

/// RFC 3596 `AAAA` record type (`0x001c`).
const DNS_TYPE_AAAA_WIRE: u16 = 28;

/// Win32 `DNS_INFO_NO_RECORDS` (`9501`): `NOERROR` response with zero records of
/// the requested type (the exact `NODATA` answer `sing-box` returns for `AAAA`).
const DNS_INFO_NO_RECORDS_STATUS: i32 = 9501;

#[derive(Debug)]
enum QueryOutcome<T> {
    Answer(Vec<T>),
    Error(i32),
}

struct Completion<T> {
    outcome: Mutex<Option<QueryOutcome<T>>>,
    ready: Condvar,
}

impl<T> Default for Completion<T> {
    fn default() -> Self {
        Self {
            outcome: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
}

impl<T> Completion<T> {
    fn callback_context(self: &Arc<Self>) -> *const c_void {
        Arc::into_raw(Arc::clone(self)).cast()
    }

    /// Publish only after consuming the records; keep callback storage alive through notification.
    ///
    /// SAFETY: `context` owns one `Arc` reference from `callback_context`, consumed exactly once.
    unsafe fn publish_from_callback(
        context: *const c_void,
        outcome: QueryOutcome<T>,
        notify: impl FnOnce(&Condvar),
    ) {
        let completion = unsafe { Arc::from_raw(context.cast::<Self>()) };
        let mut slot = completion
            .outcome
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *slot = Some(outcome);
        drop(slot);
        notify(&completion.ready);
    }
}

/// Run one A-only query through the Windows DNS Client, bypassing both cache and
/// `hosts` file. The returned future is bounded even though the native API is
/// callback based; on timeout the worker asks DNSAPI to cancel and waits for
/// the mandatory completion callback only on Tokio's blocking pool.
pub async fn query_a(host: &str, timeout: Duration) -> Result<Vec<Ipv4Addr>, String> {
    let options = u64::from(
        DNS_QUERY_BYPASS_CACHE | DNS_QUERY_NO_HOSTS_FILE | DNS_QUERY_TREAT_AS_FQDN,
    );
    run_query_worker(host, timeout, "A", move |name| {
        query_a_blocking(name, timeout, options)
    })
    .await
}

/// Run one A-only query through the Windows DNS Client while consulting the
/// local `hosts` file (`DNS_QUERY_BYPASS_CACHE | DNS_QUERY_TREAT_AS_FQDN`),
/// matching what applications observe via `getaddrinfo`.
pub async fn query_a_effective(host: &str, timeout: Duration) -> Result<Vec<Ipv4Addr>, String> {
    let options = u64::from(DNS_QUERY_BYPASS_CACHE | DNS_QUERY_TREAT_AS_FQDN);
    run_query_worker(host, timeout, "A", move |name| {
        query_a_blocking(name, timeout, options)
    })
    .await
}

/// Run one AAAA-only query through the Windows DNS Client while consulting the
/// local `hosts` file (`DNS_QUERY_BYPASS_CACHE | DNS_QUERY_TREAT_AS_FQDN`).
/// Returns `Ok(Vec::new())` when the resolver proves `NODATA` (`NOERROR` with
/// zero `AAAA` records), and returns `Ok(addrs)` if any IPv6 `AAAA` record
/// would be exposed to applications.
pub async fn query_aaaa_effective(host: &str, timeout: Duration) -> Result<Vec<Ipv6Addr>, String> {
    let options = u64::from(DNS_QUERY_BYPASS_CACHE | DNS_QUERY_TREAT_AS_FQDN);
    run_query_worker(host, timeout, "AAAA", move |name| {
        query_aaaa_blocking(name, timeout, options)
    })
    .await
}

async fn run_query_worker<T, F>(
    host: &str,
    timeout: Duration,
    label: &'static str,
    f: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(String) -> Result<T, String> + Send + 'static,
{
    let host = host.to_owned();
    let worker = tokio::task::spawn_blocking(move || f(host));

    // `DnsCancelQuery` is non-blocking. Leave a small cleanup margin for the
    // callback after the worker's own deadline, without ever stranding the
    // connection transaction if a third-party DNS provider wedges DNSAPI.
    match tokio::time::timeout(timeout + Duration::from_secs(2), worker).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(format!("Windows DNS worker failed: {error}")),
        Err(_) => Err(format!(
            "Windows system DNS {label} query exceeded {timeout:?} and cancellation did not settle"
        )),
    }
}

fn query_a_blocking(host: String, timeout: Duration, options: u64) -> Result<Vec<Ipv4Addr>, String> {
    let outcome = execute_dns_query(
        &host,
        DNS_TYPE_A,
        options,
        timeout,
        "A",
        query_a_complete,
        collect_a_records,
    )?;
    format_a_outcome(outcome)
}

fn query_aaaa_blocking(
    host: String,
    timeout: Duration,
    options: u64,
) -> Result<Vec<Ipv6Addr>, String> {
    let outcome = execute_dns_query(
        &host,
        DNS_TYPE_AAAA_WIRE,
        options,
        timeout,
        "AAAA",
        query_aaaa_complete,
        collect_aaaa_records,
    )?;
    format_aaaa_outcome(outcome)
}

fn execute_dns_query<T>(
    host: &str,
    query_type: u16,
    query_options: u64,
    timeout: Duration,
    label: &'static str,
    callback: unsafe extern "system" fn(*const c_void, *mut DNS_QUERY_RESULT),
    collector: fn(*mut DNS_RECORDA) -> Vec<T>,
) -> Result<QueryOutcome<T>, String> {
    if host.is_empty() || host.encode_utf16().any(|unit| unit == 0) {
        return Err("Windows system DNS query received an invalid host name".to_string());
    }

    let wide_name: Vec<u16> = host.encode_utf16().chain(std::iter::once(0)).collect();
    let completion = Arc::new(Completion::<T>::default());
    let mut result = DNS_QUERY_RESULT {
        Version: DNS_QUERY_RESULTS_VERSION1,
        ..Default::default()
    };
    let mut cancel = DNS_QUERY_CANCEL::default();
    let request = DNS_QUERY_REQUEST {
        Version: DNS_QUERY_REQUEST_VERSION1,
        QueryName: wide_name.as_ptr(),
        QueryType: query_type,
        QueryOptions: query_options,
        pDnsServerList: ptr::null_mut(),
        InterfaceIndex: 0,
        pQueryCompletionCallback: Some(callback),
        pQueryContext: completion.callback_context().cast_mut(),
    };

    // SAFETY: `request`, `wide_name`, `result`, and `cancel` remain alive until
    // a synchronous result is consumed or the callback publishes its outcome
    // after consuming the records. The callback has its own completion reference
    // so a deadline wake cannot free storage while notification is still running.
    let status = unsafe { DnsQueryEx(&request, &mut result, &mut cancel) };
    if status != DNS_REQUEST_PENDING {
        // SAFETY: synchronous success/error never invokes the callback, so this
        // path must retire its unused reference. Pending queries retire it there.
        unsafe { drop(Arc::from_raw(request.pQueryContext.cast::<Completion<T>>())) };
        return Ok(finish_sync_query(status, &mut result, collector));
    }

    let mut outcome = completion
        .outcome
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (guard, wait_result) = completion
        .ready
        .wait_timeout_while(outcome, timeout, |value| value.is_none())
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    outcome = guard;
    if wait_result.timed_out() && outcome.is_none() {
        drop(outcome);
        // SAFETY: DNSAPI populated `cancel` for this still-pending query and it
        // stays alive until the completion callback below releases the wait.
        let _ = unsafe { DnsCancelQuery(&cancel) };
        outcome = completion
            .outcome
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while outcome.is_none() {
            outcome = completion
                .ready
                .wait(outcome)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        return Err(format!("Windows system DNS {label} query exceeded {timeout:?}"));
    }

    outcome
        .take()
        .ok_or_else(|| "Windows DNS completion callback returned without a result".to_string())
}

fn finish_sync_query<T>(
    status: i32,
    result: &mut DNS_QUERY_RESULT,
    collector: fn(*mut DNS_RECORDA) -> Vec<T>,
) -> QueryOutcome<T> {
    if status == ERROR_SUCCESS as i32 {
        // A synchronous DnsQueryEx reports its final status in the result too.
        query_outcome(result, collector)
    } else {
        free_records(result);
        QueryOutcome::Error(status)
    }
}

unsafe extern "system" fn query_a_complete(context: *const c_void, result: *mut DNS_QUERY_RESULT) {
    if context.is_null() || result.is_null() {
        return;
    }

    // SAFETY: the caller keeps `DNS_QUERY_RESULT` alive until this callback has
    // consumed its records. The supplied context owns a separate completion
    // reference, retired only after publication and notification finish.
    let outcome = unsafe { query_outcome(&mut *result, collect_a_records) };
    unsafe { Completion::publish_from_callback(context, outcome, Condvar::notify_all) };
}

unsafe extern "system" fn query_aaaa_complete(
    context: *const c_void,
    result: *mut DNS_QUERY_RESULT,
) {
    if context.is_null() || result.is_null() {
        return;
    }

    // SAFETY: same lifetime invariant as `query_a_complete`.
    let outcome = unsafe { query_outcome(&mut *result, collect_aaaa_records) };
    unsafe { Completion::publish_from_callback(context, outcome, Condvar::notify_all) };
}

fn query_outcome<T>(
    result: &mut DNS_QUERY_RESULT,
    collector: fn(*mut DNS_RECORDA) -> Vec<T>,
) -> QueryOutcome<T> {
    if result.QueryStatus != ERROR_SUCCESS as i32 {
        let status = result.QueryStatus;
        free_records(result);
        return QueryOutcome::Error(status);
    }

    let addresses = collector(result.pQueryRecords);
    free_records(result);
    QueryOutcome::Answer(addresses)
}

fn collect_a_records(mut record: *mut DNS_RECORDA) -> Vec<Ipv4Addr> {
    let mut addresses = Vec::new();
    // DNSAPI owns this acyclic list. Keep a defensive cap so corrupt third-party
    // resolver output can never turn verification into an unbounded walk.
    for _ in 0..128 {
        if record.is_null() {
            break;
        }
        // SAFETY: `record` comes from the live DNSAPI result list and is only
        // read before the list is freed. The union's A arm is valid for A RRs.
        let item = unsafe { &*record };
        if item.wType == DNS_TYPE_A && usize::from(item.wDataLength) >= size_of::<u32>() {
            let raw = unsafe { item.Data.A.IpAddress };
            addresses.push(ipv4_from_dns_word(raw));
        }
        record = item.pNext;
    }
    addresses
}

fn collect_aaaa_records(mut record: *mut DNS_RECORDA) -> Vec<Ipv6Addr> {
    let mut addresses = Vec::new();
    for _ in 0..128 {
        if record.is_null() {
            break;
        }
        // SAFETY: `record` comes from the live DNSAPI result list and is only
        // read before the list is freed. `DNS_AAAA_DATA` stores 16 network-order
        // octets at offset 0 of `DNS_RECORDA::Data` when `wType == DNS_TYPE_AAAA`.
        let item = unsafe { &*record };
        if item.wType == DNS_TYPE_AAAA_WIRE
            && usize::from(item.wDataLength) >= size_of::<[u8; 16]>()
            && size_of_val(&item.Data) >= size_of::<[u8; 16]>()
        {
            let octets =
                unsafe { ptr::from_ref(&item.Data).cast::<[u8; 16]>().read_unaligned() };
            addresses.push(ipv6_from_dns_octets(octets));
        }
        record = item.pNext;
    }
    addresses
}

fn free_records(result: &mut DNS_QUERY_RESULT) {
    if !result.pQueryRecords.is_null() {
        // SAFETY: the pointer was allocated by DNSAPI for this result and this
        // function clears it immediately, preventing a second free.
        unsafe { DnsFree(result.pQueryRecords.cast(), DnsFreeRecordList) };
        result.pQueryRecords = ptr::null_mut();
    }
}

fn ipv4_from_dns_word(raw: u32) -> Ipv4Addr {
    // DNS_A_DATA stores the four network-order octets in memory. `to_ne_bytes`
    // preserves that memory order on both little- and big-endian targets.
    Ipv4Addr::from(raw.to_ne_bytes())
}

fn ipv6_from_dns_octets(octets: [u8; 16]) -> Ipv6Addr {
    Ipv6Addr::from(octets)
}

fn format_a_outcome(outcome: QueryOutcome<Ipv4Addr>) -> Result<Vec<Ipv4Addr>, String> {
    match outcome {
        QueryOutcome::Answer(addresses) if addresses.is_empty() => {
            Err("Windows system DNS A query returned no A records".to_string())
        }
        QueryOutcome::Answer(addresses) => Ok(addresses),
        QueryOutcome::Error(status) => Err(format!(
            "Windows system DNS A query failed with status {status}: {}",
            std::io::Error::from_raw_os_error(status)
        )),
    }
}

fn format_aaaa_outcome(outcome: QueryOutcome<Ipv6Addr>) -> Result<Vec<Ipv6Addr>, String> {
    match outcome {
        QueryOutcome::Answer(addresses) => Ok(addresses),
        QueryOutcome::Error(DNS_INFO_NO_RECORDS_STATUS) => Ok(Vec::new()),
        QueryOutcome::Error(status) => Err(format!(
            "Windows system DNS AAAA query failed with status {status}: {}",
            std::io::Error::from_raw_os_error(status)
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Completion, DNS_INFO_NO_RECORDS_STATUS, QueryOutcome, format_a_outcome,
        format_aaaa_outcome, ipv4_from_dns_word, ipv6_from_dns_octets,
    };
    use std::{
        net::{Ipv4Addr, Ipv6Addr},
        sync::Arc,
    };

    #[test]
    fn dns_a_word_keeps_wire_octet_order() {
        let raw = u32::from_ne_bytes([198, 18, 7, 9]);
        assert_eq!(ipv4_from_dns_word(raw), Ipv4Addr::new(198, 18, 7, 9));
    }

    #[test]
    fn dns_aaaa_octets_keep_wire_order() {
        let octets = [
            0x26, 0x06, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x68, 0x12,
            0x01, 0x02,
        ];
        assert_eq!(
            ipv6_from_dns_octets(octets),
            "2606:4700::6812:102".parse::<Ipv6Addr>().unwrap()
        );
    }

    #[test]
    fn an_empty_success_is_not_a_dns_proof_for_a_records() {
        assert!(format_a_outcome(QueryOutcome::Answer(Vec::new())).is_err());
    }

    #[test]
    fn nodata_status_and_empty_answer_prove_aaaa_suppression() {
        assert_eq!(
            format_aaaa_outcome(QueryOutcome::Error(DNS_INFO_NO_RECORDS_STATUS)).unwrap(),
            Vec::<Ipv6Addr>::new()
        );
        assert_eq!(
            format_aaaa_outcome(QueryOutcome::Answer(Vec::new())).unwrap(),
            Vec::<Ipv6Addr>::new()
        );
        assert!(format_aaaa_outcome(QueryOutcome::Error(9002)).is_err());
    }

    #[test]
    fn callback_storage_survives_the_waiter_consuming_its_result() {
        let caller = Arc::new(Completion::<Ipv4Addr>::default());
        let weak = Arc::downgrade(&caller);
        let context = caller.callback_context();

        // SAFETY: this is the query's sole callback, consuming its exact context once.
        unsafe {
            Completion::publish_from_callback(context, QueryOutcome::Error(123), |_| {
                assert!(matches!(
                    caller.outcome.lock().unwrap().take(),
                    Some(QueryOutcome::Error(123))
                ));
                // A deadline wake may consume the outcome before notification finishes.
                assert_eq!(weak.strong_count(), 2);
                drop(caller);
                assert!(weak.upgrade().is_some(), "the callback still owns its storage");
            });
        }
        assert!(weak.upgrade().is_none(), "callback ownership is retired on return");
    }
}
