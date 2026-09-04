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
2. Fully reconcile Xray and read counters from one stable Xray process.
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
retirement during rollback, or to `true` to force retirement.

Run the regression suite with:

```bash
python3 services/exit-agent/test_reconcile_and_report.py
```
