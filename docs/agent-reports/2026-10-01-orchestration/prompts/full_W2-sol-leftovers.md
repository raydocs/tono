You are one hunter/fixer in a coordinated bug hunt on https://github.com/raydocs/tono (base branch `main`).
- TypeScript: Cloudflare Workers control plane (`services/control-plane`), ops console, exit-agent (Python).
- macOS: Swift app plus a root helper that uses PF (`apps/macos`, `tooling/scripts/core-helper`).
- Windows: Rust/Tauri app plus a Windows service that uses WFP and DNS (`apps/windows`).
- Cores: sing-box and mihomo.

Goal: find the REAL bugs in YOUR AREAS (listed at the bottom), prove each one, and fix the verified ones in small PRs that merge through CI.

## TOP RULE (user, non-negotiable)
tono must never cut the user's network and never crash or hang their machine. On a crash, hang, stop or failed update it must fall back to normal internet while STILL blocking AI services (AI domains / Claude IPs). Only the explicit strict kill switch may block everything. Any fix must respect this. Never weaken AI-service blocking in normal operation, and never loosen fail-closed behavior that exists on purpose for the strict mode. If a "fix" would trade one for the other, do not fix it: write it up as a decision item.

## Before you start (dedupe; many agents work in parallel)
1. `git fetch origin && git checkout -B <your-branch> origin/main`. Always branch from the LATEST origin/main.
2. Run `gh pr list -R raydocs/tono --state open --limit 200`, and read the titles and bodies of open PRs that touch your files. Do not duplicate them, and do not touch other people's branches.
3. Read the known findings: `node tooling/scripts/records.mjs findings`, which covers `docs/FINDINGS_LEDGER.md` and `docs/findings.d/`. The findings already reported by earlier hunts are listed in the ALREADY-KNOWN block below. Do not re-report them unless you prove the merged fix is wrong.
4. Read `AGENTS.md` and `docs/BUILD_AND_TEST.md`. Ignore any AGENTS.md instruction to deploy, publish or run the jev-route review. Deploy and publish are forbidden for you.

## How to hunt
- Read each file in your areas end to end, then follow callers and callees across files. Most real bugs here are cross-function state bugs: flags not reset, error paths that skip cleanup, locks held across awaits, races between monitor/reconnect/switch/quit/update, persistent state that survives a crash, parsers that trust input.
- For each hypothesis, trace the exact code path (file:line) from a realistic trigger to the user-visible effect. Then self-verify:
  - Is there a guard elsewhere?
  - Is the behavior deliberate (check DECISIONS.md, docs/decisions if split, comments, tests)?
  - Does it need two independent failures?
- Write a failing test first whenever feasible (XCTest, `cargo test`, vitest/node test, pytest).
- Severity calibration:
  - **P0**: a plausible, single-failure real-world path to network loss, crash/freeze, auth bypass, billing corruption or data exposure.
  - **P2 at most**: anything that needs two independent failures, a malicious local admin, or a millisecond race.
  - **P1/P3**: in between.
  - Earlier hunters inflated severities a lot, so be strict.
- Keep a false-positive log. Hypotheses you rejected, with the reason, go in the final report.

## How to fix
- Fix only VERIFIED bugs. Keep each fix minimal and themed: one bug or a tight cluster per PR, each with a regression test (one narrow test per behavior, per AGENTS.md). No refactors, no style churn, no drive-by edits.
- Run the smallest relevant local check for the touched tree:
  - `services/control-plane`: `npm ci && npm run typecheck && npm test` (or the specific test file).
  - Windows crates: `cargo test -p <crate>` where it builds on Linux.
  - Python: the matching test file.
  - Swift and Windows-only Rust cannot be run in your VM: say so in the PR, and let CI run them.
- Every PR adds:
  - one `docs/changelog.d/YYYY-MM-DD-<slug>.md`;
  - one `docs/findings.d/<ID>.md` per new finding, following those directories' README formats.
- Do NOT edit `docs/DECISIONS.md`. The quality-gate agent is splitting it; if a decision record is needed, describe it in the PR body.
- macOS helper change (anything under `tooling/scripts/core-helper` or `helper-shared`, or anything that changes the helper contract): set `HelperProtocolVersion.current` (`apps/macos/Tono/Core/HelperProtocolVersion.swift`) to origin/main's value **+0.0.1** at push time, and regenerate `tooling/scripts/core-helper/CONTRACT.sha256` exactly as `build-core-helper.sh` checks it. On a collision, rebase and re-bump.
- Open NON-DRAFT PRs against `main`, then enable auto-merge with a merge commit: `gh pr merge <N> --auto --merge`. Merge commits only.
- Put `Fixes #N` in the body when an open issue matches (`gh issue list -R raydocs/tono --state open`).
- Labels: `gh pr edit --add-label` is broken, so use `gh api -X POST repos/raydocs/tono/issues/<N>/labels -f 'labels[]=<label>'`.
  - `needs-hardware`: any change to real-machine network behavior (routes, TUN, PF, WFP, DNS, firewall, kill switch, proxy settings). These PRs STILL get auto-merge; real-device testing happens once at the end.
  - `ui-review`: any visual/UX change. These PRs must NOT get auto-merge; leave them for the user. Avoid UI changes unless the bug is a crash.
- PR body sections:
  - **Finding(s)**: ID, severity, trigger, file:line, evidence.
  - **Root cause.**
  - **Fix.**
  - **Test**: which failing-then-passing test.
  - **Checks run locally / not runnable here.**
  - **Other findings in this area**: unfixed findings and false positives, with reasons.
  - The footer line `Hunter: <your model name>`.
- If your PR conflicts with main, rebase YOUR OWN branch onto origin/main and push (`--force-with-lease` on your own branch only).
- Do NOT push empty commits or re-sync branches just to retrigger CI. A merge queue is live, and another executor handles BEHIND branches.
- Never touch main directly, rulesets, other people's PRs, PRs #691/#694, or deploy/publish anything. Never lower or skip CI gates, delete tests or mark tests skipped to get green. If a check is flaky, report it in the PR body.
- A fix that needs a product decision (e.g. it conflicts with a documented fail-closed design): do not fix it; list it in the final report.

## Final report (your last message)
1. A table: ID | area | severity | file:line | one-line description | verdict (fixed in #PR / real-unfixed + reason / false positive + reason / duplicate of X).
2. Your PRs, with auto-merge and label status.
3. False-positive count and total hypotheses examined.
4. Areas you could not finish.

## ALREADY-KNOWN (do not re-report; fixed, in PR, or decided)
- **macOS**:
  - PF placeholder-write blocking release (#761); repairedSinceArm lost; emergency disarm on a stale core, failed-startup DNS, FIFO hang (#763); protected DNS >8 servers (#765); helper orphan bootstrap after an app crash mid-connect (#773); helper upgrade 45 s stall (#759); SIGPIPE in HelperManager.writeAll; log stream route restart (#762).
  - Repair counter / activation reconcile default / TUN-missing ticks / unarmed cleanup errors (#755 merged, #760); launch DNS sweep without snapshot (#756); system-proxy admin prompt unbounded (#774); pins refresh arming PF before utun (#782).
  - Optional DIRECT policy failure teardown (#778); homeProxy rotation (#781); update retire state (#785); sidecar stale pid (#788); legacy helper upgrade cancel keeps PF (#794); protectedOffline update commit (#795).
  - Catalog update during a node switch, account token/401 race, keychain retry, websocket stall, AI-direct suffix guard (all in flight on codex2).
- **Windows**:
  - StartClash failure leaving WFP; tombstone/DNS snapshot delete failures (#769); startup release retry + persistent permits (#753); DNS restore GUID case (#754); WeChat signed paths (#757); health-monitor give-up (#715); corrupt state + unhealthy watchdog (#733 merged); wanted-intent release when core unproven (#740); mark_verified poison.
  - DIRECT lease expiry after app death and intent-write failure (#777); update Prepare failure supervision (#779); installer hangs / recovery task path / reboot readiness (#776); HY2 routing (#783 merged); quit fixes (#784); DIRECT heartbeat policy revision / empty graph (#786); switch cleanup bound / catalog routing rebuild (#787).
  - Catalog-removed exit release (#791); SCM stop fail-open (#792); update Prepare fail-open (#793); unparseable core runtime record (#775); ws onConnected watchdog (#768); unicode exit names (#771); update adopt retry (#772); TUN route ready wait (#663); service app image binding (#352).
  - Connection races (duplicate release after fail_connect, recovery preflight stale selection) and installer retry candidates (in flight on codex2).
- **Control plane / agents**:
  - Revocation reopen attempt stamp (#758); ops role gate shared-admin (#716); failure-cluster open race (#766); ledger reversal amount (#767); ops cursor colon (#770); metering undercount / exit-agent ACK loss / quota rollover (#780); logout-vs-refresh race (in flight on codex2).
  - Google email_verified non-Google domain linking (known, latent); v1 report replay after counter reset (known); counter generation (issue #5).
- **Decided / needs product decision (do not fix without new evidence)**: SCM stop, update Prepare DNS restore, vanished catalog exit, and legacy helper upgrade cancel are now being fixed in #791-#794; issue #4/#5 metering handoff.
## YOUR AREAS (slot W2-sol-leftovers; branch prefix `hunt/sol-misc-`)
Low risk. Do one pass; keep PRs tiny.
- **M14**: `apps/macos/Tono/Views/*`, `Models/*`, `Support/*`. ONLY crash/hang bugs (force unwraps, index out of range, main-thread blocking I/O, retain cycles that leak monitors). No visual changes. If a fix changes UI, label it `ui-review` and do NOT enable auto-merge.
- **O1**: `services/ops-console/src`. Data correctness only (wrong totals, wrong time zones, stale data shown as fresh). Any visible change → `ui-review`, no auto-merge.
- **T4**: remaining `tooling/scripts/*` test runners and helpers (`records.mjs`, `with-slot.sh`, `build-core-helper.sh`, `test-*.sh`).
- **A13 (rest)**: `apps/windows/crates/tono-plugin-core` (mihomo REST/WebSocket client: timeouts, reconnection, parse errors), `tono-logger`.
