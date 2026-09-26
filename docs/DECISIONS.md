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

## 2026-09-26 · Windows: which vault session does the next launch trust after a sign-in that did not finish saving?

- Status: provisional
- Chosen: a sign-in always marks the local session marker pending (also over a
  committed marker) before it retires anything, and commits it only after the new
  session is durable in the vault. A sign-in that ends before its session reaches
  the vault (release refused, superseded, `client.adopt` failed) puts back the
  marker as it was before any sign-in was in flight, because the vault still holds
  what that marker described; a pending marker it puts back belongs to an adopted
  sign-in whose commit task is still running. Once `client.adopt` has queued the
  new session, a crash or a commit that never lands (the commit task retries until
  the process exits) leaves the marker pending, and the next launch treats the vault
  session as not owned: the user signs in again, through main's existing
  unowned-session path, which releases stored protection when the Service reports
  it armed. Rejected:
  restoring the previous account's committed marker after the new session was
  queued, which would let the next launch silently restore the previous account or
  trust a session that never reached the vault.
- Why stricter: once a switch has handed its session to the vault, no account is
  resumed unless this installation proved that session durable. The cost is a
  re-login. No new sign-out or release path is added; the existing unowned-session
  path handles the case.
- Applied in: [#642](https://github.com/raydocs/tono/pull/642) for
  [#409](https://github.com/raydocs/tono/issues/409).

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
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2. Agent-added limits on
  secrets and candidate identity are the `provisional` entries below.

## 2026-09-24 · Who makes product decisions that used to wait for the owner?

- Status: owner
- Chosen: the agent chooses the stricter, non-leaking option, records it here as
  `provisional`, and continues. Rejected: stopping the work to ask.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 3.

## 2026-09-24 · hy2 blocks in the customer catalog before client admission is proven

- Status: provisional
- Chosen: keep ` · hy2` stripped from customer catalogs and do not PUT hy2 blocks
  until client admission is on `main` and the owner has supplied the
  `HY2_CATALOG_EMAILS` value (never committed); bump the catalog revision after
  changing it. Rejected: publishing hy2 blocks to internal accounts first.
- Why stricter: no customer sees a transport the shipped clients cannot admit.
- Applied in: [SHIP_PLAN.md](SHIP_PLAN.md) §3 item 5.

## 2026-09-24 · Where may a secret value come from?

- Status: provisional
- Chosen: `wrangler secret put` with an owner-supplied value, or a CSPRNG value
  for a Tono-controlled secret the task names for creation or rotation, after
  coordinating its consumers (a JWT key change signs users out; an admin token
  change affects the hub and scripts). Third-party credentials (for example the
  Telegram bot token) are never fabricated. No secret is printed or committed.
  Rejected: every secret value supplied by the owner.
- Why stricter: an agent never invents an external credential, and a rotation
  never happens unless a task names it.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2.

## 2026-09-24 · Does the G1–G3 acceptance cover a different candidate?

- Status: provisional
- Chosen: no. The owner's G1–G3 evidence names the candidate (source SHA,
  version/build, package hashes); customer publish uses only that candidate. Any
  other SHA or version needs new owner evidence, except rebuilding an
  already-published good source as a higher build for rollback. Rejected: any
  0.0.73 build inherits the ticks.
- Why stricter: customers only receive bytes the owner accepted on a device.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2;
  [RELEASE_LINES.md](RELEASE_LINES.md#customer-publish-g4).
