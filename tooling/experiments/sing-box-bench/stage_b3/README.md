# B3 — long synthetic AI SSE and CPU attribution

This is an isolated kernel experiment, **not the Tono native controller**. It does
not change Tono, launch a migration, replay application POSTs, contact an AI
provider, or implement fallback. Read the [frozen baseline and budget](../../../../docs/reports/sing-box-evaluation/stage-b3/BASELINE.md).

## Reproduce serially, without compiling during measurement

Use the A/B fixed binaries described in the baseline; do not substitute stock or
latest kernels. Requires eight usable CPU IDs, root-created private network/PID/
mount namespaces, veth and TUN. No host route/DNS/firewall change is permitted.
Every output directory must be new; an existing directory is rejected. Raw files,
synthetic private credentials and profiles stay outside Git.

```sh
P=/tmp/tono-stage-b3-20260913
GO=/tmp/tono-stage-a-20260913/go/bin/go
SCRIPT=tooling/experiments/sing-box-bench/stage_b3/run_b3.py
export PYTHONDONTWRITEBYTECODE=1
python3 "$SCRIPT" budget
python3 -m unittest discover -s tooling/experiments/sing-box-bench/stage_b3 -p 'test_*.py' -v
python3 "$SCRIPT" build --go "$GO" --output "$P/build-01"
COMMON=(--mihomo /tmp/tono-stage-a-20260913/build-02/mihomo-tono-linux-amd64
  --sing-box /tmp/tono-stage-b-20260913/build-01/sing-box-linux-amd64
  --workload "$P/build-01/workload"
  --burst-workload /tmp/tono-stage-b2-20260913/build-01/https-workload
  --build-manifest "$P/build-01/manifest.json")
python3 "$SCRIPT" smoke "${COMMON[@]}" --output "$P/smoke-01"
python3 "$SCRIPT" measure "${COMMON[@]}" --gate "$P/smoke-01/results.json" --batch 1 --output "$P/measure-01"
python3 "$SCRIPT" measure "${COMMON[@]}" --gate "$P/smoke-01/results.json" --batch 2 --output "$P/measure-02"
python3 "$SCRIPT" profile "${COMMON[@]}" --gate "$P/smoke-01/results.json" --output "$P/profile-01"
python3 tooling/experiments/sing-box-bench/stage_b3/export.py --output "$P/export-01" \
  "$P/smoke-01" "$P/measure-01" "$P/measure-02" "$P/profile-01"
"$GO" tool pprof -top -nodecount=40 "$P/profile-01/go-fresh-h1-c1.pprof"
"$GO" tool pprof -top -cum -nodecount=40 "$P/profile-01/go-fresh-h1-c1.pprof"
```

Commands use Bash arrays. Stop on failure (`set -e` in a script); inspect retained
results instead of automatically retrying. Each request has a 45s timeout, each
SSE worker 95s, and each privileged batch a 1200s watchdog with 2s kill grace.
The inner process owns a separate PID namespace and its descendants; normal and
exception paths clean up, and the outer wrapper checks both namespace disposal
and unchanged host network state. No process-name or global firewall cleanup.

## What constitutes evidence

- Each 30s stream has 600 ordered, content-checked 128-byte payload events,
  generated every 50ms, and exactly one `[DONE]`. This is synthetic, not a model
  provider's timing or token size. The first event includes the 50ms generator
  wait. `server_emit_ms` and `client_arrival_ms` have **different relative origins**;
  do not subtract them to claim precise one-way network latency.
- Real `resp.Proto` and TLS ALPN must agree. Streams must reuse observed warmup
  connection IDs. H1/c8 requires eight connections. H2/c8 requires one connection
  ID and at least eight simultaneously active server handlers, not merely `h2`
  in a configuration. Each case starts a new core and completes an HTTPS proof.
- Fresh SSE has only small startup/warmup requests beforehand. Post-burst uses
  the same five fixed B2 JSON cases; idle uses a separate fresh warmed process.
  Batch 2 reverses candidate and case order. Freshness refers to **core lifetime**,
  while application SSE deliberately reuses its warm HTTP connection.
- Cancellation must be observed by both client and owned server before DONE.
  Wrong SNI, truncated/malformed data, timeout and unexpected negotiation must
  fail. Hy2 tests correctness/cancellation only, never large-download mixing.
- CPU is process `utime+stime`, read over approximately 30s at 100 ticks/s on
  this Orb, not wall latency. RSS is sampled every 250ms, so it is a sampled max,
  not an exact lifetime peak. Server and fixture resources are retained too.
- `cases.csv` preserves raw CPU ms, plus separately named idle-adjusted values
  using that candidate's same-batch idle CPU rate and the measured window.
  Negative adjusted values remain negative. CPU/stream-second uses the sum of
  observed stream durations; CPU/event and CPU/payload-MiB use received verified
  events. Failed/missing streams stay in counts; a failure can have partial bytes.
- `streams.csv` contains one row per stream, including failures. Gap p50/p95 is
  descriptive **within that stream** (nearest-rank p95); its events are correlated,
  not independent connection samples. With only two c1 runs, report ranges rather
  than a connection-tail percentile. Small samples do not establish stability
  over hours or across carriers.
- Profiles run afterward using identical binaries. Mihomo requires debug logs
  to expose its pprof route; sing-box adds an isolated loopback debug listener.
  This configuration difference can perturb diagnostics. CPU capture lasts 32s;
  the workload begins 400ms later. Burst finishes early, leaving an idle tail.
  Profile totals must not replace normal-run CPU. A profile with zero samples
  cannot identify an idle hotspot. Mutex/block sampling is not enabled here.

Compact exports retain raw CPU endpoints, protocol/connection proof, errors,
configuration hashes and provenance. Large event/resource timelines and pprof
binaries remain in the external run directories, whose hashes are published.
Normal JSON status, subprocess exit, cleanup and protocol proofs must all agree;
an HTTP 204 or a listening controller alone is not successful application traffic.
