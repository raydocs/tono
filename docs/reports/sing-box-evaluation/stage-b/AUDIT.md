# Follow-up review of the two Stage A P2 repairs

Stage A findings remain in [the immutable A audit](../AUDIT.md). B did not edit
product code, repeat a broad audit, or test a copied product state machine.
The scope below is source review of the local main thread's repairs, separate
from the A-pinned network measurements.

## A2-02 pin refresh — source path addressed, native timing still required

Reviewed [PR #170](https://github.com/raydocs/tono/pull/170), head
[`b852c76afd4ce65d84024d9979e71d34c828ae57`](https://github.com/raydocs/tono/commit/b852c76afd4ce65d84024d9979e71d34c828ae57).
GitHub subsequently reported it merged at 2026-09-13 20:58:13 UTC; the eight
reported Windows checks were all SUCCESS when re-read. No local product test
was rerun in this Orb.

- `transport.rs::send` clones the reqwest client while holding the transport
  read guard, then releases the guard before awaiting HTTP. A slow in-flight
  response therefore no longer holds up the pin writer.
- Periodic refresh, service refresh and startup restore clone the API client
  under `TonoState`, then release state before awaiting pin refresh.
- The periodic owner rechecks generation and Connected after refresh; no stale
  success or connection state is published by that refresh.
- The real loopback HTTP test holds a response pending, requires pin publication
  to finish, then releases and verifies the original request. It tests actual
  transport locking rather than a reimplemented FSM, and does not cancel/replay
  an already delivered business request.

**ALREADY_FIXED at the reviewed source boundary.** This does not prove installed
Windows disconnect timing, UI responsiveness or all lifecycle interleavings.

## A2-01 endpoint convergence — reviewed source repair, native fault proof open

Reviewed [PR #174](https://github.com/raydocs/tono/pull/174), head
[`fb0c53900d25e45a75afb6936898931dd4c1b069`](https://github.com/raydocs/tono/commit/fb0c53900d25e45a75afb6936898931dd4c1b069).
At the review snapshot it was OPEN; Windows app-rust checks were still running,
while the returned completed Windows/macOS checks were SUCCESS. This is not a
claim of final CI status or merge approval.

- Windows now requires successful final exact endpoint replacement before the
  completion status emission. Failure enters the existing generation-checked
  `cold_switch_selected_node`: withdraw Connected, stop Core without disarming,
  then retry the retained requested selection.
- Windows rollback now requires selector, protected probe **and** old-only
  replacement success. Uncertain rollback uses protected recovery instead of
  claiming the old node is restored. Verified rollback also restores the saved
  selection used at next launch.
- macOS tracks an unproved protection transition; final convergence goes through
  `ConnectionCoordinator.finishNodeSwitch`, checking cancellation and generation
  before commit/recovery. Failure retains requested intent, synchronously calls
  `disconnect(releaseKillSwitch: false)`, then schedules protected reconnect.
- The existing Mac disconnect owner synchronously clears Connected, cancels the
  switch and queues teardown **after draining it**. The new recovery callback
  does not await that teardown from inside the task being drained.
- Added tests exercise production completion boundaries with an injected final
  failure. They do not actually install a union, operate the bundled helper or
  inspect the resulting PF/WFP rules. Their passing author-reported native/local
  suites are not Orb-generated evidence.

**Source repair addresses the originally demonstrated completion paths;
NEEDS_NATIVE_VALIDATION remains.** [Issue #171](https://github.com/raydocs/tono/issues/171)
is intentionally open for installed-device final-replace/rollback fault injection,
exact endpoint removal, protected DNS continuity and switch/disconnect collisions.

No additional product P2 patch was authored here. Experimental CA loading,
DNS-address translation and controller API differences are documented as
configuration/migration gaps in [PARITY.md](PARITY.md), not repackaged as current
Tono production bugs. This limited review does not certify “zero bugs,” G1/G2/G3,
or release readiness.
