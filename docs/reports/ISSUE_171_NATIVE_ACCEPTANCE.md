# #171 closeout: fixed source, installed-device evidence still missing

Status: **2026-09-14 — OPEN; native acceptance 未验证 (not verified)**.
Owns SHIP_PLAN G1 / [#171](https://github.com/raydocs/tono/issues/171), not a
new implementation or release qualification. See the
[repair report](HOT_SWITCH_CONVERGENCE_2026-09-13.md) and
[execution policy](../BUILD_AND_TEST.md).

## Fixed revisions and evidence checked in the Orb

Repository: `raydocs/tono`. Pins are immutable; do not build from floating main.

| Purpose | SHA |
| --- | --- |
| #174 final source head with inspected CI | `5fcde956a87d48238d7b108807c95f57a038ec4d` |
| #174 merge into main | `d769e134464e6fed7ed02c8f0c8eef05d122aa82` |
| Main observed; proposed native acceptance baseline | `a605306a1d41b93035338bd44e58635b5659e7df` |

[PR #174](https://github.com/raydocs/tono/pull/174) is merged. Its ten checks
are successful. Run metadata and logs were independently read, not inferred
from the issue comments:

- [Windows CI 34784076983](https://github.com/raydocs/tono/actions/runs/34784076983),
  `pull_request`, head `5fcde956…`: app-rust **470 passed, 0 failed**. Both
  `failed_exact_endpoint_commit_recovers_instead_of_completing_the_switch` and
  `verified_rollback_restores_the_selection_used_on_next_launch` explicitly pass.
- [macOS CI 34784077027](https://github.com/raydocs/tono/actions/runs/34784077027),
  `pull_request`, same head: **288 executed, 1 skipped, 0 failures**.
  `testFinalEndpointFailureRecoversWithoutCommittingOrOverridingANewerOwner` and
  `testRetiredNodeSwitchCannotAdoptTheGenerationBumpedBeforeFinalization` pass.
- [macOS push CI 34784074505](https://github.com/raydocs/tono/actions/runs/34784074505)
  also reports success at that head. These are hosted automation, not installed
  Mac/Windows acceptance. The historical local 479-test Windows report is not
  substituted for the inspected Windows CI count.

Orb checks: merge is an ancestor of observed main; `git diff` from merge to
observed main is empty for `AppState+Proxy.swift`,
`Services/Connection/ConnectionCoordinator.swift`,
`TonoTests/ConnectionCoordinatorTests.swift`, and Windows
`connection/switch.rs`. This establishes those owners did not drift; it does
**not** transfer all historical CI or binary qualification to current main.

No new native compilation, device mutation, deployment, or CI dispatch was run.
No duplicate boundary test was added. Existing tests inject a closure/future:
macOS seeds the strings `union`, `selector`, `probe`; Windows initializes a
connected FSM. Neither actually installs the union or runs the selector/probe.
The Windows test injects recovery as `fsm.tunnel_died()`, not the real Service
stop/reconnect path. Requested-selection recovery and serialization therefore
still need installed-device evidence.

Recheck metadata without rerunning jobs:

```sh
gh run view 34784076983 --repo raydocs/tono --json headSha,event,conclusion
gh run view 34784077027 --repo raydocs/tono --json headSha,event,conclusion
gh run view 34784076983 --repo raydocs/tono --log
gh run view 34784077027 --repo raydocs/tono --log
```

## Injection contract — prepared by source inspection, not device-validated

**Blocker:** no installed-device switch-specific injector was found in these
owners. Windows `TEST_INSTALL_FAILURE` / `TEST_AMBIGUOUS_INSTALL_FAILURE` are
test-only seams; do not build the Service with `feature = "test"` and call that
WFP evidence. A reviewed, internal-only instrumented build or approved native
debugger procedure is needed before executing this plan. Do not invent an
environment variable, corrupt live PF configuration, stop BFE, or kill the
helper to simulate a precisely targeted final replacement.

Pin any instrumentation as a separate commit derived from the baseline above;
record its full SHA, diff, build run, compiler, and app/helper/Service/core hashes.
Never label an instrumented binary as the unmodified baseline. Build on approved
hosted infrastructure; installation and privileged execution require separate
device authorization. Do not weaken helper signing/peer authorization to inject.

The injector must match the operation's session/generation and exact endpoint
set, fire once, and log a timestamped hit. Do not target the second generic arm:
reassertions, retries and teardown also arm. Require positive observations of
old-only → old ∪ new, selector=new, and successful protected new-exit probe before
arming the final-failure trigger. Use distinct Tono-issued old/new endpoints
(IP, port, protocol); shared endpoints cannot prove removal. Record any legitimate
overlap with control/bootstrap/direct permits separately.

| Case | Native injection boundary | Required observation |
| --- | --- | --- |
| F1: final replacement fails before kernel change | Mac `tooling/scripts/core-helper/KillSwitchPF.swift`, `ensureAnchorLoaded(disposal:)`, before the matching child-anchor load; Windows `service/src/core/windows_kill_switch.rs`, `replace_proxy_endpoints`, fail its first `install_unlocked_for` before install, allowing restore | Union really existed. Failure withdraws Connected, retains requested new selection, and invokes protected recovery. Inspect the surviving kernel set rather than inferring it from the error. |
| F2: error after possible commit | Mac after successful PF load but before state disposal/verification in `ensureAnchorLoaded`; Windows real WFP install commit followed by failed exact verification, propagated through `install_unlocked_for` | Record rules AND existing flows; a new-only ruleset alone does not prove old states were removed. Recovery stays armed and ultimately removes obsolete permissions/states. |
| R1: rollback cannot be certified | First fail the new-exit probe after successful selector change; then fail rollback selector to old. Separately repeat with selector/probe rollback successful but old-only arm failing | No certified rollback/Connected over an uncertain endpoint set; requested new selection remains recovery intent. This is distinct from F1/F2. |
| R2: Service restore also fails | Windows F1/F2 plus failure of the restore `install_unlocked_for` inside `replace_proxy_endpoints` | Observe actual Blocked filters and UI; source attempts `transition_direct_to_blocked_unlocked`, which is not proof it succeeded on the device. |
| G1: retired completion | Hold the final failure response, then separately issue Disconnect, choose a third node, or trigger the existing power/recovery owner; release the held response | Capture generation/owner chronology. Old completion must not repaint, rearm over, or restart after the newer owner. Explicit Disconnect may release protection by design; distinguish that from unsolicited release during recovery. |

macOS owner is the Swift helper above, **not** the Rust Service's
`macos_kill_switch.rs`. `KillSwitchManager.arm` saves intent before loading PF,
sets `lastLoadedPassRules = nil` before the possibly partial commit, then records
the new baseline only on success. A post-load error cannot prove union remains.
Windows replacement restores its immediately previous endpoints: during final
convergence this is union, not old-only. Its second failure attempts Blocked.

## Native operator procedure (both platforms currently 未验证)

1. Use an authorized, recoverable installed Mac and Windows 11 device, not the
   maintainer MacBook as an implicit build worker or Windows Server CI as Win11
   acceptance. Record OS/build, architecture, adapters, device role, operator,
   UTC timestamps and out-of-band recovery. No active customer connection.
2. Install the pinned internal candidate using the normal trusted path. Record
   app, installed helper/Service and core hashes/versions, signature results,
   build provenance and injector SHA. A GUI version alone is insufficient.
3. Capture baseline DNS, routes, protection and network traffic; select old exit
   and establish a real protected connection. Run an uninjected old→new switch
   as a control, then restore old using the product UI before each fault case.
4. Start timestamped UI/status and privileged logs plus physical-interface packet
   capture. Exercise a long-lived old-exit flow and repeated fresh TCP/UDP probes
   to a controlled non-permitted destination. Include IPv4 and IPv6 when available;
   mark unavailable families unverified, not passed. Choose traffic outside any
   permitted direct policy and record the expected policy decision.
5. Execute F1, F2, R1, Windows R2 and each G1 variant separately. Capture at least:
   connected-old, observed union, selector/probe success, injection hit, recovery
   entry, protected stop/restrict, reconnect or explicit disconnect, settled state.
   A missed trigger or missing stage invalidates the run. Freeze no product owner
   indefinitely; define a bounded observation window and record actual duration.
6. During protected recovery, DNS may fail closed while core is stopped. Require
   no fallback to unauthorized physical-interface DNS, and restored system
   resolution through the allowed path after recovery. Use unique uncached names
   under a controlled domain via the system resolver, correlate with packet
   capture, and record both success and timeout intervals. Cached lookup success,
   browser DoH, a controller response or a direct `dig @server` is not system-DNS
   proof. Inspect whether old endpoint permits AND old flows disappear after
   recovery; unchanged legitimate shared permits are not obsolete endpoints.
7. Remove/disable the one-shot injection, reconnect using retained intent, then
   perform explicit product Disconnect. Capture post-state and restore the
   authorized baseline (DNS, proxies, routes, services, adapters, PF/WFP).
   Do not blindly flush PF/WFP. Cleanup success does not turn a failed case green.

Read-only snapshot commands (run at each named stage; capture files privately):

```sh
# macOS; PF inspection needs privilege. Use the actual physical interface for capture.
sw_vers
scutil --dns
scutil --proxy
netstat -rn
sudo pfctl -s info
sudo pfctl -sr
sudo pfctl -a tono.killswitch -sr -v
sudo pfctl -ss
# System-resolver example: substitute a fresh controlled name per observation.
dscacheutil -q host -a name '<unique-controlled-hostname>'
```

```powershell
# Windows; elevated shell for WFP inspection. Choose a distinct output per stage.
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Get-NetAdapter
Get-DnsClientServerAddress
Get-NetRoute
Get-Service TonoService
netsh wfp show state file="<stage-wfp.xml>"
[System.Net.Dns]::GetHostAddresses('<unique-controlled-hostname>')
```

Use the device's approved packet capture tooling on the actual physical adapter;
record tool/filter/interface and capture drop counts. Windows Firewall rule
listings alone do not enumerate Tono's WFP provider filters. Correlate the WFP
state export with Tono's provider/filter identities, endpoint tuple, core identity
and block filters. Static snapshots alone cannot rule out a transient leak;
combine them with time-aligned traffic and status evidence. Protect raw DNS names,
addresses, paths and account data; redact before any public GitHub attachment.

## Evidence record (copy once per device and scenario)

```text
Issue: #171; case: F1/F2/R1-selector/R1-arm/R2/G1-disconnect/G1-selection/G1-power
Result: NOT RUN / INVALID TRIGGER / PASS / FAIL / BLOCKED
Operator; UTC start/end; OS/build; architecture; adapters/IP families:
Baseline source full SHA:
Instrumentation full SHA/diff + trigger match and one-shot policy:
Build URL/head SHA; app/helper-or-Service/core hashes; signatures:
Device installation receipt; authorization and out-of-band recovery:
Old/new/third endpoint tuples (private); legitimate permit overlap:
Uninjected control evidence:
Timeline (UTC + generation/session + raw evidence filename):
  old-only / union / selector=new / probe success / fault hit
  Connected withdrawal / selected intent / protected recovery / settled owner
Kernel permits + existing flows at each stage; obsolete endpoint removal:
DNS settings + uncached system lookups + physical-adapter capture correlation:
Non-permitted TCP/UDP, IPv4/IPv6 probes; capture loss/limitations:
Race trigger/held completion/release chronology; no stale publication/restart:
Cleanup and post-baseline comparison:
Private evidence location; redacted attachment links + SHA-256 checksums:
Unverified dimensions; failures; reviewer/date:
```

Keep #171 open until reviewed fixed-SHA installed Mac and Windows evidence covers
these obligations. Missing devices/injector/provenance are blockers recorded in
#171, not grounds to create a duplicate issue or certify G1. Passing hosted CI,
this plan, or a future documentation PR does not authorize closing the issue,
merging, deploying, signing a release or advancing either update source.
