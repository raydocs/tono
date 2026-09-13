# G2 telemetry reliability — 2026-09-13

Scope: #160/#161, failure diagnostics and route attribution. No core upgrade,
PF/WFP change, consent-default change, deployment or customer-feed promotion.

## Event retention (#160, PR #162)

macOS used to drain the periodic event ring before HTTP success. A 503 lost the
events. The bounded ring now snapshots and acknowledges only the sent sequence;
new in-flight events remain. Consent/account purge retires outstanding receipts.
The real URLProtocol regression failed before the fix and passed after it.
PR #162 merged as `7b256b39`, with six successful CI checks.

## Route-byte coverage (#161)

Both clients retain cumulative route deltas across failed uploads, but labeled
them with the fixed 22-minute event lookback. The coverage is now explicit:

```json
{
  "bytesByRoute": { "cloud": 1500, "residential": 0, "direct": 42 },
  "routeBytesInterval": { "startMs": 1789290000000, "endMs": 1789318800000 }
}
```

- `windowStartMs` / `windowEndMs` retain their event-window meaning and the
  Worker's six-hour limit. Route coverage may be longer after failures.
- The interval requires `bytesByRoute`; integer timestamps must satisfy
  `0 <= startMs <= endMs <= windowEndMs`, within the existing timestamp bound.
- A successful receipt advertises `routeBytesIntervalVersion: 1`.
- New clients initially omit **both** fields until a successful owned receipt
  advertises support. Event-only receipts do not advance the byte baseline.
  This lets a new client keep sending heartbeats to an older strict Worker.
- After support is confirmed, even zero deltas have their actual interval.
  ACK advances only the captured totals and end time, not counters read after
  HTTP returns. Failure preserves both. Retired receipts cannot regress them.
- HTTP 400 on an interval-bearing request clears capability for that owner;
  the next normal cadence re-negotiates without consuming bytes. No retry storm.
- Consent/account boundaries discard prior-owner counters and capability.
  A backwards clock omits byte coverage until a valid interval can be sent.
- Old clients remain accepted. Missing interval means **unknown coverage**, not
  zero traffic and not an implied 22-minute rate. These sampled diagnostics are
  neither billing records nor an exactly-once accounting protocol.

## Verification and remaining gates

Local checks: Worker ingest 15 tests plus typecheck; macOS 10 selected XTests
(including actual legacy receipt, capability upgrade, 503 retry, in-flight bytes,
and Worker rollback); portable tono-core 241 unit + 10 integration tests;
Windows App route-ledger 8 + telemetry 10 tests on macOS using the existing test feature.
Native Windows CI remains required; Mac-hosted App tests do not qualify WFP.

These fixes do not prove collection-to-storage-to-ops visibility on a real user
device. G1/G3 installed-device connection/update tests and #26 installer ownership
remain open. Keep sing-tun benchmarking separate until the Tono logic baseline
and these gates have evidence. Never infer a bug-free release from green CI.
