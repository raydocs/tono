## 2026-09-30 · macOS selective AI recovery routes carry required gateways

- Ownership: SHIP_PLAN §2 item 10; macOS privileged helper crash/failure recovery.
- Source: baseline `957a4c5d`, rebased onto `56a11440`; branch `hunt/sol-r4mh-selective-route-gateway`, this PR; not yet merged.
- Defect fix: both Anthropic blackhole route additions lacked Darwin's mandatory gateway and were rejected; use same-family loopback gateways so the narrow IP hold can be installed after ordinary network release. Finding R4MH-SELECTIVE-ROUTE-GATEWAY.
- Added/optimized: none; existing suffixes, prefixes, general traffic release, strict protection and removal operations retained.
- Engineering/test: one native routing-message regression uses `/sbin/route -d -v` to inspect the actual parser/encoder without writing routes; existing root lifecycle CI invokes it. Helper version is latest main + 0.0.1 and the full source contract is regenerated.
- Verification: Linux source trace against pinned Apple route/XNU, `git diff --check`, records parser and exact contract hash check. Swift compilation/self-tests and native route installation not runnable here; macOS CI and needs-hardware acceptance required. No local native failing/passing result is claimed.
- Candidate/publish: source only; no new package, deployment or publication.
- Remaining limits: the existing installer is best-effort. The dry-run proves message shape, not installed routing behavior; real-device testing must confirm both prefix drops and ordinary connectivity after automatic release.
