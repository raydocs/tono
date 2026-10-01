# Codex R4 handoff: slots for Codex account 1

Written 2026-10-01 ~02:55 MT by the executor that ran Codex account 2 (GPT-6.1 Sol, `ultra`, `multi_agent_v2`).

At 01:54 MT the user's 20%-reserve rule stopped all new account-2 launches. Account-2 weekly usage ended at **75%**; it resets 10-07 22:53 MT. Every slot that was running has finished and landed its PRs.

## Ownership (from 02:02 MT)
The local Claude Code session owns two areas:
- the Windows sing-box path: #1140, #1159, `sing_box/*`, core selection/fallback;
- the release/update chain: macOS sign/notarize/appcast, Windows packaging/updater integrity, `*-release.yml`, tooling release scripts.

Codex account 1 must not scan or change those areas. Each handoff prompt below starts with that note.

## Slots that never launched (resume on account 1)
Full prompts are next to this file as `codex-r4-prompt-<slot>.md`. They are the box copies of `/workspace/w1-codex/prompt-overrides/full_R4-<slot>.md` with the ownership note added. Append your runner's operator addendum: GIT_DIR, `prs.tsv`/`findings.tsv`, gh workarounds, claim rule, the rule to open issues for real bugs left unfixed.

| Slot | Branch prefix | Scope | Overlap with Claude-owned areas |
|---|---|---|---|
| R4-RegLate | `hunt/sol-r4late-` | Regression review of every PR merged after 22:45 MT on Sep 30 (04:45Z Oct 1), all platforms. One REG-<PR#> row per PR. Fix verified regressions. | Narrow it: skip PRs in the release/update chain and the Windows sing-box path. |
| R4-RegLate2 | `hunt/sol-r4late2-` | Same review for PRs merged after 01:30 MT (07:30Z). Run it after RegLate, or merge the two into one run. | Narrow the same way. |
| R4-FixMisc | `hunt/sol-r4fmx-` | Issue batch: #1134 (Win StartClash timeout drops AI hold), #1125 (Win replacement sign-in keeps the old connect failure), #1131 (mac PF interface scope vs LAN DNS widening), #1132 (mac pending-update release drops a joining Restore). Re-verify each one first; later merges may already have fixed it. | None |
| R4-ExitAgent | `hunt/sol-r4xa-` | Deep re-scan of `services/exit-agent/**`, `services/home-agent/**` and the control-plane endpoints they call: counters, config validation/apply, revocation inventory, retries, atomic state writes. | None |
| R4-FixNew | `hunt/sol-r4fnew-` | Fix unclaimed open issues created after 00:00 MT Oct 1 that have no open PR. Skip decision items. Its exclusion list names issues the R4 Fix slots already handled. Newer issues to consider: #1117 #1151 #1164 #1165 #1169 #1174 #1181 #1200 #1139 (decision) #1145 (decision). | Skip #1152 (helper build metadata, release-adjacent) unless Claude passes on it. |
| R4-WinSvcIPC | `hunt/sol-r4ipc-` | Re-scan Windows service request handling and lifecycle: `core/server/{mod,handlers}.rs`, desired/manager/structure/runstate, `bin/service.rs` SCM paths, app service client. #1139 is a known decision item. | None |

## Slot stopped early because of the ownership change
- **R4-ReleaseMig** (release tooling + D1 migrations). I stopped it at 02:02 MT. It had opened three PRs:
  - #1173 (Windows release staging) and #1179 (local macOS signer). Both are release chain, so I **turned auto-merge off** and left them open for Claude's review.
  - #1184 (D1 preview restore rehearsal). Not release chain; auto-merge stays on.
  - Its unfixed P3 `R4REL-UPLOAD-GLOB` (`tooling/scripts/upload-release-asset.mjs:96`, installer glob option matches by substring) goes to Claude.
  - Not covered at all: D1 migration order/idempotency (COVERAGE C8). Account 1 can take that as a narrow migrations-only slot.

## Decision items for the user (not bugs a slot can just fix)
- #1051: Windows automatic release waits ~2 min behind a stalled DIRECT reload. A fix needs a pre-armed AI-hold backend; the blocker design is in the issue comments. #1087 (in-place hold refresh) has since merged.
- #1052: should macOS Quit keep the AI hold?
- #1139: Windows full state disk + policy rebuild leaves a non-strict block with no Core.
- #1145: domain NRPT policy suppresses the selective AI DNS hold.
- #1120: replacement sign-in fully releases the AI hold.
- #1071: helper upgrade AI hold vs legacy helpers.
- #1056 / #1057: decision rows.
