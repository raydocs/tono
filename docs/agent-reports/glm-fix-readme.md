# GLM-5.3 fix / hunt harness for raydocs/tono

[credential/configuration details redacted]

## What it is
- **Harness:** Claude Code CLI (`@anthropic-ai/claude-code`, installed globally at `~/.local/bin/claude`, v2.1.286), run headless (`-p`) against Zhipu's Anthropic-compatible endpoint.
- **Wrapper:** `bin/glm-claude.sh <worktree> <prompt-file> <run-name> [fix|hunt]`
[credential/configuration details redacted]
  - Every model slot (`ANTHROPIC_MODEL`, opus/sonnet/haiku defaults, subagent, small-fast) is set to `glm-5.3`, with `--model glm-5.3 --effort max`.
  - `MAX_THINKING_TOKENS=48000`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`. Claude Code caps an unrecognised model at 32k output per turn, which is fine because agent turns are short.
  - `API_TIMEOUT_MS=1800000` (30 min).
[credential/configuration details redacted]
  - **Permissions** (`--permission-prompts none`, so anything not allow-listed is auto-denied):
    - `fix`: `acceptEdits` inside the worktree. Allowed: read/grep/glob; edit/write; `git diff/log/show/status/grep/blame`; `rg`, `ls`, `cat`, `sed -n`, `find`; `node`, `npm test/run`, `npx tsc/vitest`, `pnpm`, `python3`, `cargo check/test`.
    - `hunt`: read-only tools only (no Edit/Write).
    - Always denied: `git push/commit/reset/checkout/rebase`, `gh`, `curl`, `wget`, `rm`, `sudo`, WebFetch, WebSearch.
    - An appended system prompt tells it to ignore AGENTS.md merge/deploy instructions.
  - **Output** goes to `runs/<name>/`: `stream.jsonl` (full event stream), `stderr.log`, `usage.json` (tokens plus USD estimate), `diff.patch`, `diffstat.txt`. One line per run is appended to `runs/ledger.log`.
- **Spend:** `python3 bin/usage.py runs/<name>/stream.jsonl` prices the run at Zhipu list price for glm-5.3 (CNY 8 / 28 / 2 per M input / output / cached input, about USD 1.13 / 3.96 / 0.28). Ignore Claude Code's own `total_cost_usd`; it uses Anthropic prices.
  - Session total: `awk -F'usd_est": ' '{split($2,a,","); s+=a[1]} END{print s}' runs/ledger.log`
- **Verify it is really GLM on the user's key:** `bin/glm-claude.sh repo prompts/smoke.txt smoke hunt`. The smoke-run usage metadata should show `"models": ["glm-5.3"]`, and the stream's `message.model` should be `glm-5.3`, with msg ids from bigmodel.
- **Helper contract:** `bin/helper-contract.sh <repo> [new-version]` sets `HelperProtocolVersion.current` and rewrites `tooling/scripts/core-helper/CONTRACT.sha256` exactly as `build-core-helper.sh` checks it. Run it with no version to print the current hash.

## Launch a FIX run
```sh
cd /workspace/glm-fix
git -C repo fetch -q origin
git -C repo worktree add -b glm/<slug> ../wt-<slug> origin/main
# prompt = prompts/_fix_common.md + a task section (see prompts/*.md for examples: verified bug, file:line, fix direction, finding IDs, changelog slug)
cat prompts/_fix_common.md my-task.md > prompts/<slug>.md
nohup bin/glm-claude.sh wt-<slug> prompts/<slug>.md <slug> fix > runs/<slug>.out 2>&1 &
```
- A fix run takes about 5–25 min.
- Then **review `runs/<slug>/diff.patch` yourself**. Reject sloppy or risky diffs and re-run with a follow-up prompt, e.g. `claude -p --resume <session_id>` using the same env as the wrapper, or a fresh run with the review notes appended.
- For macOS helper changes, run `bin/helper-contract.sh wt-<slug> <main+0.0.1>`.
- Then commit, push, and `gh pr create` (see "PR rules").

## Launch a HUNT run
```sh
git -C repo worktree add --detach ../wt-hunt-<n> origin/main
nohup bin/glm-claude.sh wt-hunt-<n> prompts/hunt-<area>.md hunt-<area> hunt > runs/hunt-<area>.out 2>&1 &
```
- Hunt prompts (`prompts/hunt-*.md`) scope one area and ask for concrete, file:line findings on network-loss, crash and freeze paths.
- **Verify every finding yourself.** GLM's historical FP rate is about 50–60%, and it inflates severities.

## Concurrency and cost notes
- Zhipu allows about 3–4 concurrent glm-5.3 streams on this key. More than that returns 429s, which Claude Code retries.
- A typical agentic fix run costs $0.3–2. Most input is cache reads at $0.28/M.
- A scheduled job should cap the number of runs and check the ledger total before each launch.

## PR rules (for tono)
- Branch `glm/...`. Before each PR run `git fetch`, `gh pr list`, and rebase on `origin/main`.
- Add `docs/changelog.d/` and `docs/findings.d/` entries. Never edit `docs/DECISIONS.md`.
- A macOS helper change bumps `HelperProtocolVersion` to main + 0.0.1 and updates CONTRACT.sha256.
- The PR body has repro, root cause, fix and test, and says "Fixed by GLM-5.3 (user API key) via Claude Code CLI".
- Network/TUN/PF/WFP/kill-switch runtime changes get "Needs real-hardware test (静杰 batch) before merge" and **no auto-merge**.
- Other PRs may run `gh pr merge --auto --merge` once `ci-gate` is green. Never merge or deploy by hand.

## Helper version collisions after another helper PR merges
When main's `HelperProtocolVersion.current` moves, open helper PRs go DIRTY. Do not rebase or force-push. Merge main in instead:
```bash
cd /workspace/glm-fix/wt-<branch> && git pull --no-rebase origin <branch> && git merge origin/main
python3 /workspace/glm-fix/bin/resolve-helper-bump.py .   # keeps main's history, re-adds this branch's entry as main→main+0.0.1, recomputes CONTRACT
# fix the version mentioned in the branch's changelog.d entry and the PR body, then:
git add -A && git commit -m "Merge origin/main; helper <new>" && git push
```
Branches that are BEHIND but have no conflict: `gh api -X PUT repos/raydocs/tono/pulls/<N>/update-branch`.

## Policy (updated 2026-09-30 16:09)
Network-behavior PRs get the `needs-hardware` label (it feeds the final hardware checklist) and ALSO `gh pr merge --auto --merge` once CI is green. Add labels and edit bodies through the REST API (`gh api`), because `gh pr edit` currently fails on the Projects-classic GraphQL deprecation.
