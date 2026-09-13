# G1: pin refresh must not wait for in-flight HTTP under product state

Baseline: `44c8efc359db12544484a9481cca79856bcd8e9c`.
Source finding: [Orb Stage A A2-02](https://github.com/raydocs/tono/blob/7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1/docs/reports/sing-box-evaluation/AUDIT.md).

A pinned HTTP attempt held the transport read guard until the response finished.
Periodic refresh, service-pin hydration and startup restore held `TonoState` while
waiting for the transport writer. Slow HTTP could therefore delay Disconnect's
first generation invalidation. This is lock convoying, not demonstrated deadlock
or fail-open.

- Each HTTP attempt now clones the reqwest client under the read guard and drops
  the guard before I/O. The old attempt keeps its own pool/pin snapshot; refresh
  neither cancels nor replays it. New requests take the new snapshot.
- All three refresh callers clone the API handle under state and await outside
  the state guard. The periodic owner checks generation/connected state again
  after refresh. Pin refresh does not publish connection success.
- TLS, proxy bypass, redirect, request replay policy, timeouts and PF/WFP contracts
  are unchanged. No global lock was added.

One narrow async regression uses an actual loopback HTTP request, holds its
response at the server, and requires refresh to finish before replying. The
unmodified implementation fails the 2-second publication deadline. With the fix,
refresh succeeds while the request remains pending, then that same request reads
its original successful response. This tests real transport locking, not a copy
of the connection FSM and not native UI timing.

Local Mac-hosted App checks (`cargo +1.98.1 test --offline --locked -p tono-windows
--features clippy --lib`): the transport subset is 13/13; the full App suite is
477/477. Native Windows CI is required before merge; installed-device collision
and Disconnect timing remain G1 acceptance work. A2-01 endpoint convergence and
issue #26 are not fixed or closed by this PR. No kernel or customer-channel change.
