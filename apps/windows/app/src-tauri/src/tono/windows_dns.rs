//! Bounded access to the Windows DNS Client resolver.
//!
//! Tokio's `lookup_host` delegates to `getaddrinfo`, whose blocking work keeps
//! running after an async timeout. That is especially harmful immediately after
//! changing adapter DNS: one stale query can occupy a worker while subsequent
//! verification attempts pile up behind it. `DnsQueryEx` gives us the same
//! system resolver with cache bypass, an A-only query, and a real cancellation
//! handle.

use std::{
    ffi::c_void,
    net::Ipv4Addr,
    ptr,
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

use windows_sys::Win32::{
    Foundation::{DNS_REQUEST_PENDING, ERROR_CANCELLED, ERROR_SUCCESS},
    NetworkManagement::Dns::{
        DNS_QUERY_BYPASS_CACHE, DNS_QUERY_CANCEL, DNS_QUERY_NO_HOSTS_FILE, DNS_QUERY_REQUEST,
        DNS_QUERY_REQUEST_VERSION1, DNS_QUERY_RESULT, DNS_QUERY_RESULTS_VERSION1, DNS_QUERY_TREAT_AS_FQDN, DNS_RECORDA,
        DNS_TYPE_A, DnsCancelQuery, DnsFree, DnsFreeRecordList, DnsQueryEx,
    },
};

#[derive(Debug)]
enum QueryOutcome {
    Answer(Vec<Ipv4Addr>),
    Error(i32),
}

/// The lease remains on the blocking worker until DNSAPI actually completes. A wedged
/// cancellation must not accumulate native workers across retries/reconnects.
static QUERY_BATCH: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
// ROG: ordinary queries launched 35/81 ms after DNS readback stalled; 132/205/312 ms
// succeeded. This schedules a fresh query, never declares DNS ready or shortens the first.
const FRESH_QUERY_DELAY: Duration = Duration::from_millis(150);
const CANCEL_SETTLE_MARGIN: Duration = Duration::from_secs(2);

type NativeResult = Result<Vec<Ipv4Addr>, QueryError>;

#[derive(Debug, PartialEq, Eq)]
enum QueryError {
    InvalidHost,
    Empty,
    Status(i32),
    TimedOut(Duration),
    Cancelled,
    Unsettled,
    Worker,
    NonFake,
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidHost => f.write_str("Windows system DNS query received an invalid host name"),
            Self::Empty => f.write_str("Windows system DNS A query returned no A records"),
            Self::Status(status) => write!(f, "Windows system DNS A query failed with status {status}"),
            Self::TimedOut(timeout) => write!(f, "Windows system DNS A query exceeded {timeout:?}"),
            Self::Cancelled => f.write_str("Windows system DNS A query was cancelled"),
            Self::Unsettled => f.write_str("Windows system DNS cancellation did not settle"),
            Self::Worker => f.write_str("Windows DNS worker failed"),
            Self::NonFake => f.write_str("Windows system DNS A query returned a non-fake address"),
        }
    }
}

#[derive(Default)]
struct CompletionState {
    outcome: Option<QueryOutcome>,
    cancel_requested: bool,
}

#[derive(Default)]
struct Completion {
    state: Mutex<CompletionState>,
    ready: Condvar,
}

impl Completion {
    fn cancel(&self) {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.cancel_requested = true;
        self.ready.notify_all();
    }
}

struct QueryTask {
    worker: tokio::task::JoinHandle<NativeResult>,
    completion: Arc<Completion>,
    deadline: tokio::time::Instant,
}

impl QueryTask {
    fn start(host: String, timeout: Duration, lease: Arc<tokio::sync::SemaphorePermit<'static>>) -> Self {
        let completion = Arc::new(Completion::default());
        let control = completion.clone();
        let worker = tokio::task::spawn_blocking(move || {
            let _lease = lease;
            query_a_blocking(&host, timeout, &control)
        });
        Self {
            worker,
            completion,
            deadline: tokio::time::Instant::now() + timeout + CANCEL_SETTLE_MARGIN,
        }
    }

    async fn finish(&mut self) -> NativeResult {
        match tokio::time::timeout_at(self.deadline, &mut self.worker).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(QueryError::Worker),
            Err(_) => {
                self.completion.cancel();
                Err(QueryError::Unsettled)
            }
        }
    }
}

impl Drop for QueryTask {
    fn drop(&mut self) {
        // Transaction cancellation / superseding a connection also cancels native work.
        // The worker, not this async future, owns every DNSAPI buffer and the batch lease.
        self.completion.cancel();
    }
}

async fn batch_lease(timeout: Duration) -> Result<Arc<tokio::sync::SemaphorePermit<'static>>, QueryError> {
    tokio::time::timeout(timeout, QUERY_BATCH.acquire())
        .await
        .map_err(|_| QueryError::Unsettled)?
        .map(Arc::new)
        .map_err(|_| QueryError::Worker)
}

/// One ordinary Windows DNS Client query, with cache bypass, full timeout and cancellation.
pub async fn query_a(host: &str, timeout: Duration) -> Result<Vec<Ipv4Addr>, String> {
    let lease = batch_lease(timeout).await.map_err(|error| error.to_string())?;
    QueryTask::start(host.to_owned(), timeout, lease)
        .finish()
        .await
        .map_err(|error| error.to_string())
}

/// Admission only: if the first system query is still pending, issue at most ONE fresh query.
/// ROG reproduced early queries stuck for 2 s while new queries after ~130 ms succeeded.
/// This is not a readiness sleep or a shorter timeout: a fast first answer returns immediately,
/// both queries keep their full budget, and the losing query MUST settle before admission.
pub async fn query_fake_a_fresh(host: &str, timeout: Duration) -> Result<Vec<Ipv4Addr>, String> {
    let lease = batch_lease(timeout).await.map_err(|error| error.to_string())?;
    first_or_fresh(
        || {
            let mut task = QueryTask::start(host.to_owned(), timeout, lease.clone());
            let control = task.completion.clone();
            (async move { task.finish().await }, move || control.cancel())
        },
        FRESH_QUERY_DELAY,
    )
    .await
    .map_err(|error| error.to_string())
}

async fn first_or_fresh<F, Q, C>(mut start: F, delay: Duration) -> NativeResult
where
    F: FnMut() -> (Q, C),
    Q: std::future::Future<Output = NativeResult>,
    C: FnOnce(),
{
    let (first, cancel_first) = start();
    tokio::pin!(first);
    tokio::select! {
        biased;
        result = &mut first => return require_fake(result),
        _ = tokio::time::sleep(delay) => {}
    }
    let (fresh, cancel_fresh) = start();
    tokio::pin!(fresh);
    let (finished, remaining) = tokio::select! {
        biased;
        result = &mut first => {
            let result = require_fake(result);
            if should_cancel_peer(&result) { cancel_fresh(); }
            (result, require_fake(fresh.await))
        },
        result = &mut fresh => {
            let result = require_fake(result);
            if should_cancel_peer(&result) { cancel_first(); }
            (result, require_fake(first.await))
        }
    };
    combine_settled(finished, remaining)
}

fn require_fake(result: NativeResult) -> NativeResult {
    match result {
        Ok(addresses) if addresses.is_empty() => Err(QueryError::Empty),
        Ok(addresses) if addresses.iter().all(|ip| ip.octets()[..2] == [198, 18]) => Ok(addresses),
        Ok(_) => Err(QueryError::NonFake),
        error => error,
    }
}

fn harmless_loser(error: &QueryError) -> bool {
    matches!(
        error,
        QueryError::Cancelled | QueryError::TimedOut(_) | QueryError::Empty
    )
}

fn should_cancel_peer(result: &NativeResult) -> bool {
    // Settled empty/timeout leaves the peer its entire original query budget. A valid answer
    // or a fatal/contradictory result cancels it, but never skips the completion drain.
    result
        .as_ref()
        .map(|_| true)
        .unwrap_or_else(|error| !harmless_loser(error))
}

fn combine_settled(first: NativeResult, second: NativeResult) -> NativeResult {
    // Do not hide a real-address response, unknown OS error, panic or unsettled cancellation
    // behind the faster fake-ip response. This check also covers a callback racing cancellation.
    match (first, second) {
        (Err(error), _) if !harmless_loser(&error) => Err(error),
        (_, Err(error)) if !harmless_loser(&error) => Err(error),
        (Ok(answer), _) | (_, Ok(answer)) => Ok(answer),
        (_, Err(error)) => Err(error),
    }
}

fn query_a_blocking(host: &str, timeout: Duration, completion: &Completion) -> NativeResult {
    if host.is_empty() || host.encode_utf16().any(|unit| unit == 0) {
        return Err(QueryError::InvalidHost);
    }
    if completion
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .cancel_requested
    {
        return Err(QueryError::Cancelled);
    }
    let wide_name: Vec<u16> = host.encode_utf16().chain(std::iter::once(0)).collect();
    let mut result = DNS_QUERY_RESULT {
        Version: DNS_QUERY_RESULTS_VERSION1,
        ..Default::default()
    };
    let mut cancel = DNS_QUERY_CANCEL::default();
    let request = DNS_QUERY_REQUEST {
        Version: DNS_QUERY_REQUEST_VERSION1,
        QueryName: wide_name.as_ptr(),
        QueryType: DNS_TYPE_A,
        QueryOptions: u64::from(DNS_QUERY_BYPASS_CACHE | DNS_QUERY_NO_HOSTS_FILE | DNS_QUERY_TREAT_AS_FQDN),
        pDnsServerList: ptr::null_mut(),
        InterfaceIndex: 0,
        pQueryCompletionCallback: Some(query_complete),
        pQueryContext: ptr::from_ref(completion).cast_mut().cast::<c_void>(),
    };
    // SAFETY: all buffers live on this worker until synchronous completion or the callback's
    // last shared-state access. Dropping the async caller cannot free any of these buffers.
    let status = unsafe { DnsQueryEx(&request, &mut result, &mut cancel) };
    if status != DNS_REQUEST_PENDING {
        let outcome = if status == ERROR_SUCCESS as i32 {
            query_outcome(&mut result)
        } else {
            free_records(&mut result);
            QueryOutcome::Error(status)
        };
        return format_outcome(outcome);
    }
    let state = completion
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (mut state, _) = completion
        .ready
        .wait_timeout_while(state, timeout, |state| {
            state.outcome.is_none() && !state.cancel_requested
        })
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(outcome) = state.outcome.take() {
        return format_outcome(outcome);
    }
    let externally_cancelled = state.cancel_requested;
    drop(state);
    // SAFETY: the cancellation handle stays on this worker through DnsCancelQuery AND callback
    // completion. Cancellation is only a request; it never authorizes freeing buffers early.
    let _ = unsafe { DnsCancelQuery(&cancel) };
    let mut state = completion
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    while state.outcome.is_none() {
        state = completion
            .ready
            .wait(state)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
    let outcome = state.outcome.take().expect("callback outcome checked under lock");
    match outcome {
        // Only our requested, completed cancellation is ignorable alongside a valid peer.
        QueryOutcome::Error(status) if status == ERROR_CANCELLED as i32 => Err(if externally_cancelled {
            QueryError::Cancelled
        } else {
            QueryError::TimedOut(timeout)
        }),
        // A success/other OS error racing cancellation remains evidence, not a fabricated cancel.
        outcome => format_outcome(outcome),
    }
}

unsafe extern "system" fn query_complete(context: *const c_void, result: *mut DNS_QUERY_RESULT) {
    if context.is_null() || result.is_null() {
        return;
    }
    // SAFETY: worker owns the callback context and result until publication under this mutex.
    let completion = unsafe { &*context.cast::<Completion>() };
    let outcome = unsafe { query_outcome(&mut *result) };
    let mut state = completion
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.outcome = Some(outcome);
    // Notify BEFORE unlocking: the worker may drop its buffers as soon as it observes outcome.
    // No callback access to Completion/result is allowed after releasing this guard.
    completion.ready.notify_all();
}

fn query_outcome(result: &mut DNS_QUERY_RESULT) -> QueryOutcome {
    if result.QueryStatus != ERROR_SUCCESS as i32 {
        let status = result.QueryStatus;
        free_records(result);
        return QueryOutcome::Error(status);
    }

    let addresses = collect_a_records(result.pQueryRecords);
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

fn format_outcome(outcome: QueryOutcome) -> NativeResult {
    match outcome {
        QueryOutcome::Answer(addresses) if addresses.is_empty() => Err(QueryError::Empty),
        QueryOutcome::Answer(addresses) => Ok(addresses),
        QueryOutcome::Error(status) => Err(QueryError::Status(status)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn fake() -> NativeResult {
        Ok(vec![Ipv4Addr::new(198, 18, 7, 9)])
    }

    #[test]
    fn dns_a_word_keeps_wire_octet_order() {
        assert_eq!(
            ipv4_from_dns_word(u32::from_ne_bytes([198, 18, 7, 9])),
            Ipv4Addr::new(198, 18, 7, 9)
        );
    }

    #[test]
    fn empty_and_mixed_answers_are_not_proof() {
        assert_eq!(format_outcome(QueryOutcome::Answer(Vec::new())), Err(QueryError::Empty));
        assert_eq!(require_fake(Ok(vec![])), Err(QueryError::Empty));
        assert_eq!(
            require_fake(Ok(vec![Ipv4Addr::new(198, 18, 7, 9), Ipv4Addr::new(1, 1, 1, 1)])),
            Err(QueryError::NonFake)
        );
        assert_eq!(
            require_fake(Ok(vec![Ipv4Addr::new(198, 19, 7, 9)])),
            Err(QueryError::NonFake)
        );
    }

    #[test]
    fn contradictory_unknown_or_unsettled_loser_cannot_be_hidden() {
        for error in [
            QueryError::NonFake,
            QueryError::Status(5),
            QueryError::Worker,
            QueryError::Unsettled,
        ] {
            assert!(combine_settled(fake(), Err(error)).is_err());
        }
        assert_eq!(
            combine_settled(Err(QueryError::NonFake), fake()),
            Err(QueryError::NonFake)
        );
        assert!(combine_settled(fake(), Err(QueryError::Cancelled)).is_ok());
        assert!(combine_settled(Err(QueryError::TimedOut(Duration::from_secs(2))), fake()).is_ok());
        assert!(combine_settled(Err(QueryError::Empty), Err(QueryError::Cancelled)).is_err());
    }

    #[tokio::test]
    async fn fast_first_has_no_extra_query_or_delay() {
        let started = AtomicUsize::new(0);
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            first_or_fresh(
                || {
                    started.fetch_add(1, Ordering::SeqCst);
                    (async { fake() }, || {
                        panic!("completed query must not need peer cancellation")
                    })
                },
                Duration::from_secs(30),
            ),
        )
        .await
        .unwrap();
        assert!(result.is_ok());
        assert_eq!(started.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn failed_fast_first_does_not_create_a_second_attempt() {
        let started = AtomicUsize::new(0);
        let result = first_or_fresh(
            || {
                started.fetch_add(1, Ordering::SeqCst);
                (async { Err(QueryError::Status(5)) }, || {})
            },
            FRESH_QUERY_DELAY,
        )
        .await;
        assert_eq!(result, Err(QueryError::Status(5)));
        assert_eq!(started.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn fresh_winner_must_cancel_and_drain_the_first() {
        let started = AtomicUsize::new(0);
        let drained = Arc::new(AtomicUsize::new(0));
        let result = first_or_fresh(
            || {
                let index = started.fetch_add(1, Ordering::SeqCst);
                let (tx, rx) = tokio::sync::oneshot::channel();
                let drained = drained.clone();
                (
                    async move {
                        if index == 0 {
                            rx.await.expect("pending first must be cancelled");
                            tokio::time::sleep(Duration::from_millis(30)).await;
                            drained.fetch_add(1, Ordering::SeqCst);
                            Err(QueryError::Cancelled)
                        } else {
                            fake()
                        }
                    },
                    move || {
                        let _ = tx.send(());
                    },
                )
            },
            Duration::from_millis(1),
        )
        .await;
        assert!(result.is_ok());
        assert_eq!(started.load(Ordering::SeqCst), 2);
        assert_eq!(drained.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn real_answer_racing_requested_cancellation_fails_closed() {
        let started = AtomicUsize::new(0);
        let result = first_or_fresh(
            || {
                let index = started.fetch_add(1, Ordering::SeqCst);
                let (tx, rx) = tokio::sync::oneshot::channel();
                (
                    async move {
                        if index == 0 {
                            rx.await.unwrap();
                            Ok(vec![Ipv4Addr::new(1, 1, 1, 1)])
                        } else {
                            fake()
                        }
                    },
                    move || {
                        let _ = tx.send(());
                    },
                )
            },
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(result, Err(QueryError::NonFake));
    }

    #[tokio::test]
    async fn unsettled_loser_never_admits_the_valid_fresh_answer() {
        let started = AtomicUsize::new(0);
        let result = first_or_fresh(
            || {
                let index = started.fetch_add(1, Ordering::SeqCst);
                let (tx, rx) = tokio::sync::oneshot::channel();
                (
                    async move {
                        if index == 0 {
                            rx.await.unwrap();
                            Err(QueryError::Unsettled)
                        } else {
                            fake()
                        }
                    },
                    move || {
                        let _ = tx.send(());
                    },
                )
            },
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(result, Err(QueryError::Unsettled));
    }

    #[tokio::test]
    async fn settled_failure_leaves_peer_its_full_budget() {
        let started = AtomicUsize::new(0);
        let fresh_started = Arc::new(tokio::sync::Notify::new());
        let first_failed = Arc::new(tokio::sync::Notify::new());
        let result = first_or_fresh(
            || {
                let index = started.fetch_add(1, Ordering::SeqCst);
                let fresh_started = fresh_started.clone();
                let first_failed = first_failed.clone();
                if index == 1 {
                    fresh_started.notify_one();
                }
                (
                    async move {
                        if index == 0 {
                            // Handshake, not a 15 ms wall-clock assumption: a loaded Windows
                            // test runner can wake both timers before the select is polled.
                            fresh_started.notified().await;
                            first_failed.notify_one();
                            Err(QueryError::TimedOut(Duration::from_secs(2)))
                        } else {
                            first_failed.notified().await;
                            fake()
                        }
                    },
                    || panic!("settled timeout must not cut the peer's budget"),
                )
            },
            Duration::from_millis(1),
        )
        .await;
        assert!(result.is_ok());
        assert_eq!(started.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn dropping_task_requests_cancel_but_retains_worker_lease_until_settled() {
        let local_limit = Arc::new(tokio::sync::Semaphore::new(1));
        let permit = local_limit.clone().acquire_owned().await.unwrap();
        let completion = Arc::new(Completion::default());
        let control = completion.clone();
        let (release, wait) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            let _permit = permit;
            let _ = wait.await;
            Err(QueryError::Cancelled)
        });
        let task = QueryTask {
            worker,
            completion,
            deadline: tokio::time::Instant::now() + Duration::from_secs(2),
        };
        drop(task);
        assert!(control.state.lock().unwrap().cancel_requested);
        assert_eq!(local_limit.available_permits(), 0);
        release.send(()).unwrap();
        let _returned = tokio::time::timeout(Duration::from_secs(1), local_limit.acquire())
            .await
            .unwrap()
            .unwrap();
    }
}
