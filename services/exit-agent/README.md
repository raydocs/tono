# Tono exit agent

`reconcile_and_report.py` installs the control plane's current client roster in
Xray, acknowledges a completely reconciled roster, and reports monotonic usage
totals.

Copy `exit-agent.env.example` into the service's protected environment file and
replace every placeholder. For an existing node, read `sourceId` from its durable
agent state first and provision the control-plane exit node with that exact ID.
`TONO_SOURCE_ID`, the provisioned node ID, and the roster's authenticated
`nodeId` must all match. The agent refuses a rename before changing Xray or
billing state: a pending cumulative report may already have reached its old
ledger, so rewriting or dropping it cannot be made exactly-once. The token is
node-specific and must not be committed.

`TONO_API_BASE` must be a bare HTTPS origin on port 443: no credentials, path,
query, fragment, or custom port. Every authenticated request refuses redirects,
so a control-plane redirect can neither receive the node token at another
origin nor masquerade as a successful roster or usage operation.

Upgrade an existing node in this order:

1. Run the old reporter against the old control plane and confirm its
   `pendingReports` is empty, then stop its timer. Traffic may continue; Xray's
   counter preserves bytes used during the maintenance window.
2. Back up the mode-0600 state file and record its `sourceId`. Confirm that the
   value is unique across the fleet.
3. Deploy the dual-phase control plane, provision `exit_nodes.id` with that
   exact value, and save the one-time token response.
4. Configure the new agent with the same `TONO_SOURCE_ID` and its node token,
   then restart its timer. The roster preflight must return the same `nodeId`.

Do not delete the state file or rename a source to a friendlier node ID during
this upgrade. Either action loses the only durable counter baseline or creates a
second cumulative ledger.

The roster cycle is ordered deliberately:

1. Fetch and validate the roster.
2. If hy2 is installed, atomically replace its HTTP auth allowlist with exactly
   the verified roster, including an empty roster. Then fully reconcile Xray and
   read counters from one stable Xray process. Neither transport can be skipped
   while claiming a complete roster ACK. A hy2 failure (unsafe directory,
   missing allowlist, failed write) still lets the Xray reconcile and counter
   read run; the counters are kept in the state file and the round then exits
   non-zero with no ACK or usage report.
3. POST the roster's `observedAt` to `/api/v1/home/roster-ack` with the same
   bearer token.
4. Persist and deliver usage state.
5. Only after counters were valid, state was saved, and any usage was delivered,
   POST `{meteringProtocolVersion: 2, observedAt}` to
   `/api/v1/home/metering-ack`. Idle rounds send this separate readiness ACK;
   replaying an old pending queue alone does not prove readiness.

A failed reconciliation is never acknowledged. A failed acknowledgement exits
non-zero before this round changes the durable state, so the roster and any
queued usage are retried on the next run.

The state lock covers the entire roster/reconcile/counter/delivery cycle. If a
timer and an operator start overlap, the second run exits without observing or
persisting counters; the next timer safely resumes from cumulative state.

The roster ACK also requires a provable final inventory: either the live Xray client
list or the agent's durable prior inventory must be available. If both are
unknown, successful additions alone cannot prove that an old device generation
or `shared-legacy` client was removed, so the agent exits without claiming
rollout readiness.

Device clients are installed under
`u:<userId>:<deviceId>:<credentialDigest>`. The SHA-256 digest makes each UUID
generation a distinct Xray user and counter without exposing the UUID in metric
labels. On rotation the old generation is removed before the replacement is
added; both generations' retained counters still aggregate into the user's one
monotonic source total. Legacy dual-mode clients remain `u:<userId>`.

New reports carry `protocolVersion: 2`; their `observedAt` is derived from the
server roster and made strictly monotonic in the durable state. The control
plane lets any queued wall-clock v1 growth settle before the first v2 report,
then permanently rejects v1 from moving that source. This is what makes pruning
old report IDs safe after a counter reset.

`TONO_RETIRE_SHARED_LEGACY` is optional. When unset, the agent follows the
control plane's `retireSharedLegacy` signal. Set it to `false` to block automatic
retirement during rollback, or to `true` to force retirement. Case does not
matter (`1/true/yes/on`, `0/false/no/off`); any other value is logged and
leaves `shared-legacy` as it is (no retirement that round).

Retirement removes `shared-legacy` from the running Xray and from the static
config (`TONO_XRAY_CONFIG`, default `/opt/tono-xray/current/config.json`), so
a restart cannot bring it back. The file is replaced atomically with its owner
and mode after `xray run -test` accepts it; the agent must be able to write it.
Retirement is one-way per node: once persisted, a later `false` does not put
`shared-legacy` back. Restoring it takes the `config.json.pre-metering.*` backup or a
reprovision. A failed config write is reported and fails the round, but only
after the roster ACK and usage report, so metering and quota enforcement keep
running.

A disabled or retired node gets `403 EXIT_NODE_DISABLED` on the roster. Only
that answer makes the agent remove every `u:` client and `shared-legacy`,
empty the hy2 allowlist, take a best-effort final counter sample into the
state file (reported by the next round that may report) and exit non-zero;
stop `tono-xray` afterwards. Any
other HTTP error or network failure keeps the last roster and retries.

Xray drops every client added over its management API when it restarts. Each
verified roster is therefore saved beside the state file as `state.json.roster`
(mode 0600, service-owned, replaced atomically) before it is enforced. When the
control plane cannot be reached (a network error or a 5xx/408/425/429 answer),
the round reinstalls that saved roster if it is at most 24 hours old, keeps
folding Xray counters into the durable totals, and exits non-zero without any
acknowledgement. The next round that reaches the control plane reports the
growth. An older, missing or unreadable copy restores nothing, and the round
refuses with the reason. Any other control-plane answer, including a rejected
token, an invalid roster or another node's roster, deletes the copy first; the
403 `EXIT_NODE_DISABLED` answer for a disabled node deletes it before the
node's clients are withdrawn. The copy is saved before the roster is
enforced, so it is never older than the newest roster the node has fetched: it
cannot reinstate an account a fetched roster had already removed. A revocation
issued while the control plane is unreachable is not seen, so an Xray restart
within 24 hours of the last successful fetch reinstalls that account (a running
Xray keeps it in memory just the same). The restore takes effect on the next
timer run after the Xray restart. hy2's allowlist is a file and survives
restarts, so it is not touched during an outage.

The copy holds every client UUID in plain text; these are the VLESS
credentials (hy2's allowlist keeps only hashes). It is mode 0600 and owned by
the agent's user; keep it out of VPS snapshots and backups.

Run the regression suite with:

```bash
python3 services/exit-agent/test_reconcile_and_report.py
```

## hy2 roster ownership (G2)

An installed `/opt/tono-hy2/` opts the node into roster enforcement for hy2.
The agent replaces `auth-allow.sha256` (owner preserved, checker group preserved,
mode 0640) before Xray reconciliation and the roster ACK. Only current Tono-issued
`clientUUID` hashes are included; no static Xray clients or shared probe password
are unioned back in. Empty means deny every new authentication. A failed fetch
is **not** an empty roster; unavailable control plane keeps the last known list.
A missing/unwritable allowlist on an installed node is an error, not readiness.
VLESS-only nodes without that directory are unchanged.

The first line `# tono-exit-agent roster v1` marks the new writer. After handover,
`--hy2-sync-identities` refuses to overwrite it from static configuration. Use the
normal verified roster cycle instead. Existing shared-password probes may stop
working; use a dedicated entitled test account, never restore the stale password.

**Deployment is a separate, approved node operation.** Before handover:

1. Inspect the actual agent/checker units, runtime user, source ID, timer and
   filesystem restrictions. Back up their code/unit/env/state. Do not expose
   node tokens or client UUIDs. Pause the agent timer and wait for its current
   cycle to finish so bootstrap and the new writer cannot overlap.
2. Upgrade/restart the auth checker with the current helper **before** the new
   agent publishes its first marked list. Its `ReadOnlyPaths` must bind the
   `/opt/tono-hy2` directory, not the individual allowlist inode; an atomic rename
   must remain visible inside the checker's mount namespace.
3. Deploy the agent with write access to the allowlist directory (including
   temporary-file creation and rename); the installed directory/file owner must
   match its effective UID. Run one roster cycle with the existing node token,
   then resume its timer. Do not alter the Xray config/process or customer catalog.
4. On the target Linux host, verify new authentication, removal, empty roster,
   and write failure without a false ACK, using isolated test identities. The
   local HTTP regression is not a real systemd/Hysteria acceptance test.

This sync changes subsequent authentication decisions. It does not claim to kick
already-established QUIC sessions or provide hy2 usage accounting. Existing
sessions, real client handshakes and transport acceptance still require node
validation before publication. A rollback must not restore an obsolete allowlist;
keep the last verified list or disable the unpublished hy2 transport instead.


### Existing hy2 nodes without an exit-agent (G2 only)

Use `python3 reconcile_and_report.py --hy2-roster-only` when the node has a
working hy2 transport but has not joined the VLESS/metering agent rollout.
It requires an explicit `TONO_SOURCE_ID` and that same node's token, validates
the authenticated roster identity, and uses the same atomic hy2 writer and
single-flight lock. Empty roster still denies all new authentication.

This mode **does not call Xray, read/write the usage state, report usage, or
send roster/metering ACKs**. Adding hy2 auth enforcement must not silently
migrate VLESS accounting or claim the whole node is reconciled. The control
plane's node-wide readiness timestamp therefore does not become green from
this mode; inspect the timer's success and actual auth results instead.

Register the existing catalog node name/source ID, not a second ` · hy2`
node identity. Do not borrow or rotate another node's token. Give the timer
only write access to `/opt/tono-hy2` and its lock directory; keep its credential
file root-owned mode 0600. The existing checker-directory binding/restart
preflight above still applies. Registration and node deployment require the
operator's explicit approval; neither publishes a catalog or changes a feed.
