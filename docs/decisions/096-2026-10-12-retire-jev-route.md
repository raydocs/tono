## 2026-10-12 · Retire jev-route from the review policy?
- Status: provisional (the owner asked for it on 2026-10-12; only the owner sets `owner`)
- Chosen: drop jev-route and `.jev-route.json`. High-risk diffs keep the independent Codex high
  review in [AGENTS.md](../../AGENTS.md) "Finish the work" item 1, judged by its risk list
  (PF/WFP fail-closed behavior, privileged paths, routing or release trust, ...), which covers the
  paths `.jev-route.json` named (Windows service, kill switch/WFP/PF/DNS/NRPT, the customer update
  feed, catalog generation). Rejected: keeping jev-route as an optional tool. The owner retired it
  on the maintainer machine, and older branches still told agents to run a script that is no longer
  installed.
- Why stricter: nothing widens. The Codex review requirement, its stop rule and the merge
  conditions are unchanged; only the optional tool and its path list go. This supersedes the
  `.jev-route.json` part of [008](008-2026-09-24-merge-without-asking.md).
- Applied in: the PR that adds this file.
