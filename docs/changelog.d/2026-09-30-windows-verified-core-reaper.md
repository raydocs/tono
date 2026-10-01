## 2026-09-30 · Windows Core recovery retains process identity

- Ownership: SHIP_PLAN §2 item 10; W3 process recovery review.
- Source: baseline `e504f6f4`; branch `hunt/sol-r3proc-verified-reaper`; [PR #994](https://github.com/raydocs/tono/pull/994), not merged.
- Defect fix: the orphan sweep and startup reconciliation previously reopened an inspected PID without checking its creation time. They now retain the expected image and creation time; Windows checks both through the same owned handle used for termination. Gone/mismatched instances survive; inspection and termination errors retain their existing refusal behavior. Finding: WIN-CORE-REAPER-PID-REUSE, P2.
- New capabilities: none. No WFP, DNS, routing, strict-mode or AI-blocking policy change.
- Engineering/test changes: one real-child stale-creation regression. An independent read-only review checked Windows handle ownership and stale-record cleanup; socket reachability is sampled after a refused termination.
- Verification: Linux, Rust 1.98.1, `CARGO_BUILD_JOBS=2`. The baseline forwarding shim to existing termination failed the new regression (0 passed, 1 failed); fixed process tests passed (4 passed). Existing successful startup-reconciliation regression passed (1 passed). Final checks and native Windows CI are recorded in the delivering PR.
- Candidate/publication: source only; no new candidate, deployment or publication.
- Limits: no actual Windows PID-reuse reproduction or hardware acceptance. The Unix check/signal sequence remains subject to PID reuse. Watchdog timeout and SCM fallback candidates remain outside this change. Known uninstall failures BRICK-W3/BRICK-W4 remain separate.
