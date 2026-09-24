# Decisions

One entry per decision that used to wait for the owner. Newest first. An agent that
meets such a question chooses the stricter, non-leaking option (see
[AGENTS.md](../AGENTS.md)), adds an entry with status `provisional`, and continues.
Only the owner changes an entry to `owner` or `reversed`.

Status values: `owner` (the owner decided), `provisional` (an agent chose; the owner
may reverse), `reversed` (keep the line; say what replaced it).

```text
## YYYY-MM-DD · question in one line
- Status: provisional | owner | reversed
- Chosen: the option taken, and the option rejected
- Why stricter: what it does not widen (exposure, data, availability)
- Applied in: PR / commit / command
```

## 2026-09-24 · When may an agent merge a PR without asking?

- Status: owner
- Chosen: merge automatically when CI is green on the exact head for every touched
  tree; the jev-route review depth for the diff passed (cross-vendor for protected
  paths); no review threads are unresolved; the recorded merge order is respected
  (stacked PRs base-first); and a combined regression review runs on `main` after
  each merged batch. Rejected: a per-PR owner approval.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 1;
  [.jev-route.json](../.jev-route.json) protected paths.

## 2026-09-24 · May an agent deploy and publish?

- Status: owner
- Chosen: yes, automatically: Worker deploy via the deploy script, secrets, remote D1
  (migrations only through the script; ad-hoc writes only when the task names them,
  after an export), and customer channel publish. Customer publish only after the
  owner has written `[x]` for G1, G2 and G3 in [SHIP_PLAN.md](SHIP_PLAN.md) §6 with
  evidence links; agents never edit those lines. Rejected: owner runs every deploy
  and publish.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2.

## 2026-09-24 · Who makes product decisions that used to wait for the owner?

- Status: owner
- Chosen: the agent chooses the stricter, non-leaking option, records it here as
  `provisional`, and continues. Rejected: stopping the work to ask.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 3.
