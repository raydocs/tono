# EXIT-AGENT-TIMER-BOOT — deployment evidence required

## Status and scope

**Blocked on the installed unit definitions; no runtime fix in this change.**
The [finding](../../docs/findings.d/EXIT-AGENT-TIMER-BOOT.md) stays `open`.
This is an exit-data-plane follow-up to the
[ops plan §3.4](../../docs/ops/plan-2026-09-11.md) executor/identity-sync
work, not a desktop SHIP_PLAN gate. No node was contacted, changed or rebooted.

Repository baseline: `d1232520a742b3e747f7b9a228361d696f24a172` (main,
2026-10-22). At investigation time origin/main had that same SHA; the open PR
list contained no exit-agent/timer task. Historical PRs #1378 and #1479 retained
this gap rather than supplying deployed units.

## What the repository establishes

- The [2026-09-24 rollout](../../docs/reports/FLEET_EXIT_AGENT_ROLLOUT_2026-09-24.md)
  copied `reconcile_and_report.py` into `/opt/tono-exit-agent/` and reused
  Westwood's service/timer, described as every minute. It records four timers
  at `NEXT n/a` after stop/manual-run/start, recovered by a timer restart plus
  a manual service run. It does **not** reproduce either full unit or prove
  whether a boot trigger was present. This is not cold-boot evidence.
- The tracked [environment example](exit-agent.env.example) defines agent inputs,
  not the service user, `ExecStart`, timer directives or sandbox. The
  [agent README](README.md#hy2-roster-ownership-g2) explicitly requires inspecting
  actual units, effective UID and write restrictions before deployment.
- [enable-tono-exit-metering.sh](../../tooling/scripts/remote/enable-tono-exit-metering.sh)
  edits Xray's stats/API configuration and may restart **Xray**; it does not
  install or generate the exit-agent service/timer. Do not run it for diagnosis.
- Repository-wide tracked references to `tono-exit-agent`, `exit-agent/` and
  `reconcile_and_report.py` yield no full exit-agent unit or owning deployment
  generator. There are zero tracked `*tono-exit-agent.service*` or
  `*tono-exit-agent.timer*` paths. Node-agent and relay-probe units are different
  services, not authoritative templates for this agent.

Consequently neither "OnBootSec is missing" nor "a boot trigger already exists"
is established. Choosing a runtime user, new timeout, calendar cadence, write
allowlist, credentials path or dependency order now would invent a deployment
contract. A unit-file presence test failing here would not reproduce the timer
failure; no artificial RED test or speculative unit is included.

## Next evidence collection (not executed here)

These are **read-only commands for an authorized operator already on each
in-scope Linux node**, in a separately approved evidence task. No SSH/deploy/
restart command is part of this change. Reconcile the current node inventory
first; the 2026-09 fleet list is not proof of today's installation coverage.

Run in a private terminal with sufficient existing read permissions:

```sh
systemctl --version
cat /proc/sys/kernel/random/boot_id
cat /proc/uptime
systemctl cat tono-exit-agent.timer tono-exit-agent.service
systemctl show tono-exit-agent.timer \
  -p FragmentPath -p DropInPaths -p LoadState -p UnitFileState \
  -p ActiveState -p SubState -p Triggers -p After -p Requires -p Wants \
  -p TimersMonotonic -p TimersCalendar -p AccuracyUSec \
  -p RandomizedDelayUSec -p Persistent \
  -p NextElapseUSecMonotonic -p NextElapseUSecRealtime -p LastTriggerUSec
systemctl show tono-exit-agent.service \
  -p FragmentPath -p DropInPaths -p LoadState -p UnitFileState \
  -p ActiveState -p SubState -p Result -p User -p Group -p DynamicUser \
  -p After -p Requires -p Wants -p ConditionResult -p AssertResult \
  -p ExecMainStartTimestampMonotonic -p ExecMainExitTimestampMonotonic \
  -p ExecMainCode -p ExecMainStatus -p TimeoutStartUSec
systemctl list-timers --all --no-pager tono-exit-agent.timer
journalctl -b -u tono-exit-agent.timer -u tono-exit-agent.service \
  -o short-monotonic --no-pager
```

**Do not paste raw output into an issue, PR or chat.** `systemctl cat` can contain
inline `Environment=`, credentials in command arguments, or credential-bearing
drop-ins; journals can contain sensitive diagnostics. Privately inspect and
sanitize these before sharing. Preserve directive names/structure and paths,
but replace secret values with `<redacted>`; keep raw evidence only in approved
private storage. Do not read/copy the env file, state, saved roster, Xray config,
allowlist or client identities. Record the node's non-secret ID, capture time,
boot ID, systemd version, loaded fragment paths and **all** drop-ins. Include any
referenced wrapper/generator's sanitized implementation and its deployment owner;
a unit invoking an unknown wrapper is still an incomplete contract. Do not infer
fleet uniformity from Westwood alone. Report missing/unreadable units as blockers.

## Conditions for a later implementation

1. Recover complete sanitized service/timer definitions and their deployment
   source, including effective startup arguments, service type/user/group,
   environment/credential handling, dependencies/conditions, filesystem access,
   capabilities, sandbox, timeouts and timer install/enabling rules. Keep
   per-node differences explicit; do not silently replace them with a template.
2. Determine whether existing boot scheduling is absent, disabled, masked,
   overridden, condition-blocked or delayed by dependency/startup failure.
   Preserve the established cycle and security restrictions. Define the initial
   scheduling bound from the observed contract, accounting for timer accuracy,
   random delay and dependencies. A scheduled invocation is not a successful
   roster ACK; [round deadline limits](../../docs/findings.d/EXIT-AGENT-ROUND-DEADLINE.md)
   are a separate unresolved constraint.
3. Add one deterministic regression for the confirmed scheduling defect and run
   it against the recovered old contract to obtain an assertion failure (not a
   missing-file error). Only then make the smallest unit/deployer change and
   rerun that test. Validate the complete units with `systemd-analyze verify`
   on Linux and test scheduling in an isolated Linux systemd environment.
4. After independent lifecycle/privilege review, request a separate approved
   node rollout/cold-boot acceptance task. Record boot-relative first automatic
   invocation, successful complete reconciliation and next scheduled cycle on
   each affected configuration. Do not manually start the service to claim
   automatic boot success, reboot production for this investigation, or treat
   `NEXT` alone as proof of successful reconciliation.

Until then, cold-boot scheduling and cold-boot roster recovery remain unverified.
