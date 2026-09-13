# B2 owned AI POST/SSE workload

Independent experiment, not a native Tono controller/regression. Never call a real
AI provider. Reports: [B2 results](../../../../docs/reports/sing-box-evaluation/stage-b2/RESULTS.md).

Prerequisites: the exact A/B binaries (hashes enforced), Go 1.27.1, 8 available CPUs,
sudo CAP_NET_ADMIN, `/dev/net/tun`, iproute2 and PID/mount/network namespaces.
If isolation is unavailable, stop. Do not disable host protection or alter host routes.

The fixture and cores run only in owned nested namespaces, with no external NIC
or default route. CPU affinity and GOMAXPROCS are fixed. Root timeout kills the
owned PID tree even if the parent command is interrupted; normal cleanup also
asserts no TUN/listeners/owned PIDs remain. Output directories must be new and
outside every repository worktree. They contain generated private test identities;
never commit/copy the whole directory to GitHub.

## Reproduce once, in order

Use a fresh external root for each independent run; **do not automatically repeat**.
These paths are the original run's fixed inputs. Rebuilding those cores requires
the existing A/B experimental build entries, never product installation scripts.

```sh
export PYTHONDONTWRITEBYTECODE=1
TOOL=tooling/experiments/sing-box-bench/stage_b2
OUT=/tmp/tono-ai-b2-unique-run
GO=/tmp/tono-stage-a-20260913/go/bin/go
MIHOMO=/tmp/tono-stage-a-20260913/build-02/mihomo-tono-linux-amd64
SING=/tmp/tono-stage-b-20260913/build-01/sing-box-linux-amd64
python3 -m unittest discover -s "$TOOL" -p 'test_*.py' -v
python3 "$TOOL/batch.py" build --go "$GO" --output "$OUT/build-01"
# build also executes the four Go HTTPS/SSE tests inside a sealed namespace.
python3 "$TOOL/batch.py" smoke --mihomo "$MIHOMO" --sing-box "$SING" \
  --workload "$OUT/build-01/https-workload" --build-manifest "$OUT/build-01/manifest.json" \
  --output "$OUT/smoke-01"
python3 "$TOOL/batch.py" measure --mihomo "$MIHOMO" --sing-box "$SING" \
  --workload "$OUT/build-01/https-workload" --build-manifest "$OUT/build-01/manifest.json" \
  --gate "$OUT/smoke-01/results.json" --output "$OUT/measure-01"
python3 "$TOOL/export.py" --root "$OUT" --output "$OUT/public-export"
```

Normal run: 193.15 MiB conservative application payload budget plus small smoke/
selftest allowance, below 256 MiB; no sustained file transfer. One measured run,
three serial candidate orders ABC/CAB/BCA. Request deadline 3s, invocation 45s,
root watchdog 600s + 2s grace. A worker failure cannot become PASS; missing samples
remain in the report denominator. No application retries or POST replay.

Metrics use monotonic clocks. `application_tcp_ms` is the application's connect to
the TUN-intercepted destination, **not** the proxy's real TCP dial. `origin_tls_ms`
is the application's observed TLS operation through that path, which may overlap
proxy setup; it cannot isolate Reality/QUIC authentication. TTFB is the first actual
HTTP response byte. First SSE event requires its complete blank-line delimiter.

SSE is deliberately generated after 40ms with 16 events at 20ms intervals, not a
real tokenizer/provider. Requests do not use TLS session resumption or HTTP/2.
Keep-alive batches retain their initial cold requests. Per-case `/proc` CPU time
includes core background activity, has 10ms tick precision, and can exceed 100%
when expressed relative to one CPU. RSS is sampled, not a guaranteed peak.

The exporter reads only results/build/provenance, never raw identities/config/logs.
It preserves failure/timeout/missing counts and emits JSON + CSV. Review exported
files before publishing. B2 does not overwrite A/B evidence; no netem, production
fallback, policy translation or native fail-closed certification is included.
