# Restricted B result: working TUN candidates, no basis for a product upgrade yet

**738/738 measured requests passed, 0 failures, 0 timeouts**, in one 57.82-second
run after the functional parity gate passed. Downloaded and byte-verified payload:
531,357,696 bytes (about 506.74 MiB). No production credentials or third-party
targets; no netem, kernel/profile modification, concurrent build, or native app.

The result supports a narrow follow-up on Go-stack CPU use. It does **not** show
uncapped throughput superiority, reliable connection-time superiority, absence
of contention, a cure for UI stalls, or safe replacement of Mihomo.

## Evidence and fixed execution

- [Build identity](BASELINE.md); [functional checks and migration gaps](PARITY.md).
- [JSON samples](raw/measurement.json), [CSV samples](raw/samples.csv),
  [per-round summaries/resources](raw/summary.json), [parity checks](raw/parity.json),
  [failed setup summaries](raw/setup-failures.json), [external artifact hashes](raw/artifacts.json).
- External complete record: `/tmp/tono-stage-b-20260913/measure-01/results.json`,
  SHA-256 `5431262162b61aff6fecbd22b4fd13d71a46622444d80c586b1163a922acf3e3`.
- Gate: `parity-05/results.json`, SHA-256
  `eca503affd20b59406beb92991ef2f2bf8aa80c98fd7289c694eb0d20fdc4e6e`.
- Measured tool source is frozen in commit
  [`d5e69746`](https://github.com/raydocs/tono/commit/d5e69746f89c566c69bcbdf63ee74a7cf77f1f71).
  The only subsequent runner change is privileged post-run namespace inspection;
  it does not alter samples. A fresh root inventory supplements the original
  cleanup evidence. The final CSV exporter uses LF line endings; JSON/CSV values
  reproduce from the unchanged original result. No existing run result has been
  overwritten.

Each candidate gets a **fresh core process and state directory per round**;
server/fixture remain the same owned services. Orders: A/B/C, C/A/B, B/C/A.
These are three independent client runs, not three batches in one client process
and not three different machines. No formal case was selectively rerun or dropped.

Per candidate per round: one first-use Reality request, one first-use Hy2 request,
12 warm Reality requests at concurrency 1; 32 short Reality requests at concurrency
16; three sequential Hy2 transfers of 8 MiB; then one 32 MiB Hy2 transfer alongside
32 Reality requests at concurrency 1 with 20ms spacing. Core readiness happens
before timing: “cold” means the first request for that transport in a fresh core,
**not** native Connect-button-to-Connected or process launch time. Hy2's first
request follows Reality's first request, so the entire process is not cold again.

## Per-round results (no p99)

Latency ranges span the **three round medians**, not confidence intervals.
Other rows show per-round payload rates, CPU totals or sampled RSS peaks.
Full individual observations remain in JSON/CSV.

| Metric | A Tono Mihomo | B sing-box gVisor | C sing-box Go |
|---|---:|---:|---:|
| First Reality application TTFB, n=3, ms | 4.39–6.86 | 4.18–4.61 | 4.06–4.94 |
| First Hy2 application TTFB, n=3, ms | 5.67–5.82 | 4.66–5.64 | 4.33–5.36 |
| Warm Reality median TTFB, n=36, ms | 3.92–4.03 | 3.43–4.20 | 3.31–4.15 |
| C16 Reality median TTFB, n=96, ms | 21.26–21.67 | 17.59–19.47 | 18.06–19.43 |
| Sequential Hy2 payload rate, 3×8 MiB/round, Mbps | 98.25–98.30 | 98.25–98.31 | 98.27–98.29 |
| Mixed Reality median TTFB, n=96, ms | 2.87–3.42 | 2.61–3.28 | 2.68–3.03 |
| Mixed Hy2 payload rate, one 32 MiB/round, Mbps | 98.11–98.24 | 98.02–98.28 | 98.24–98.26 |
| Client CPU for 24 MiB sequential Hy2, CPU-seconds/round | 1.67 / 1.75 / 1.76 | 1.56 / 1.71 / 1.58 | 1.36 / 1.49 / 1.31 |
| Sampled client peak RSS in that case, KiB | 52,540–52,916 | 48,580–49,428 | 48,184–48,964 |

- **Throughput cannot distinguish candidates:** the configured Hy2 rate is
  100 Mbps and all three reach about 98 Mbps of verified application payload.
  These sub-second 8 MiB transfers plus approximately 2.7-second mixed transfers
  do not characterize long steady-state WAN throughput.
- **B vs C:** Go uses fewer observed client CPU-seconds in this narrow download
  case; the server uses approximately 0.94–1.07 CPU-seconds. This is an interesting
  small-sample signal, not proof across speeds/MTUs/OSes. Latency ranges overlap;
  there is no consistent B/C connection-latency winner here.
- **A vs B/C:** the C16 medians differ in this run, but whole-core routing, TLS,
  buffers and implementations differ. Do not attribute the entire difference to
  the TUN stack or forecast native UI gains from it.
- **Mixed load genuinely overlaps:** all 32 small requests in every round finish
  within the large Hy2 request interval (288/288), and both outbound chains were
  separately proven active in the parity run. The observed mixed medians remain
  low. However, the standalone warm loop uses a different process/pacing pattern;
  this is **not a matched causal test of mixed-load degradation**. Do not claim
  that adding Hy2 improves small-request latency or proves “no regression.”
- TUN interface drops/errors were zero in all rounds. This is not a packet capture
  or a proof of no retransmissions. Go's TUN packet counts differ substantially
  from gVisor, consistent with a different packet/batching path; no mechanism was
  isolated by a profile.

## What the clocks do and do not measure

All durations use `monotonic_ns`. Application TTFB starts before the application's
socket connect and ends at its first nonempty received byte. `kernel_connect_ms`
is the kernel/TUN socket handshake observation; it is **not** Reality TCP dial,
TLS/Reality authentication or Hy2 QUIC-handshake duration. Those internal hooks,
allocation/GC and contention sampling were not collected. No internal phase is
inferred from totals.

First-byte observations over 1.2s: 0/18 first-use transport requests, 0/738 total
measured requests. Long downloads exceeding 1.2s are not slow handshakes. The
negative timeout controls are separate checks, not omitted failed performance
samples. There is no real backup-node evidence or slow public connection cohort;
threshold false-trigger rate and fallback benefit outside this fixture are
**undetermined**. No fallback or business-request replay was implemented.

## Runs that failed are preserved, not benchmark scores

| Run | Exit | Direct observation / disposition |
|---|---:|---|
| `parity-01` | 1 | Reality passed, Hy2 rejected the test CA. Adjusted process-local trust loading; did not disable TLS checks. |
| `parity-02` | 1 | Actual TUN/DNS checks passed; reload file was outside Mihomo's safe directory. Moved the test file into the owned core data directory; no safe-path bypass. |
| `parity-03` | 1 | sing-box fake-IP HTTP timed out due to collision with derived DNS address. |
| `parity-04` | 1 | After disabling implicit address interception, querying an unallocated address within the fake-IP pool failed metadata lookup; worker produced no JSON. Gate correctly remained failed. |
| `parity-05` | 0 | Explicit DNS endpoint outside the pool; 68/68 checks passed for all candidates. |
| `measure-01` | 0 | Nine client instances, 738/738 verified requests, fresh state and serial order. |

Full failed logs/configurations stay outside Git. All six run directories remain
distinct. Summary exports retain sample status/denominator, not only successful
latencies. `gate_passed` is a parity-mode field; it remains false in measure-mode
JSON because that invocation consumes the separately validated gate instead of
rerunning it. It does not mean measurement bypassed a failed gate.
