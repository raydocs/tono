# Follow-up to WIN-DIRECT-RESTORE-WRITER-DELAY / merged #898

P1, real-unfixed decision item. apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1384 aborts reconnect but does not retire the connection generation before automatic ordinary health release. The cancellation added by #898 therefore receives no signal.

One stalled optional DIRECT PUT /configs retracts TUN permit and leaves exact Blocked WFP while holding a lifecycle reader across two60-second attempts. App owner marker ends at60seconds; two2-second health observations request release around62-64seconds. Its writer cannot enter until about120seconds and the55-second caller budget can expire first. Service Bracket lease is420seconds, Bracket deliberately ignores Core/TUN checks, exactBlocked verifies healthy and startup's30-second wanted-Core timer is not active for an established session.

Exact trace: connection/stages.rs:397,425 -> connection/direct.rs:1153-1314,793-835 and148-155 -> connection/monitor.rs:1381-1391 -> connection/disconnect.rs:134. Service guards: core/windows_kill_switch.rs:232,2203,3420,3523,3094.

No patch: cancelling this wait while retaining current release_explicit opens all AI destinations sooner. Existing release_explicit_applying_narrow invokes a best-effort three-second post-release layer, which removes its predecessor first and cannot cover cached/DoH/literal-IP AI traffic. These AI-fallback gaps are SFO-1/#738 and ZC-F1/#706. The owner's top rule requires normal internet plus AI blocking, so the automatic cancellation follow-up awaits that guaranteed fallback. Strict and policy-rebuild protected behavior must remain intact.

A feasible regression once the fallback is safe: exercise the current direct.rs:1763 stalled HTTP-handler test with an automatic-health retirement seam, retaining the uncancellable exact-session reconciliation boundary before writer admission. No Windows hardware was exercised.
