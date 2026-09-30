# Decisions

One entry per decision that used to wait for the owner. An agent that meets such
a question chooses the stricter, non-leaking option (see [AGENTS.md](../AGENTS.md)),
adds a file under [decisions/](decisions/) with status `provisional`, and continues.
Only the owner changes an entry to `owner` or `reversed`.

Status values: `owner` (the owner decided), `provisional` (an agent chose; the owner
may reverse), `reversed` (keep the line; say what replaced it).

Read them together, highest number first:

```sh
node tooling/scripts/records.mjs decisions
```

## 2026-09-30 · How long may a fake-ip answer live, and may DoH try HTTP/3?

- Status: provisional
- Chosen: `fake-ip-ttl: 30`, `prefer-h3: false`, `cache-algorithm: lru`, both DoH servers kept. Rejected: plaintext DNS, a 600s fake-ip TTL, `prefer-h3: true`, `cache-algorithm: arc`, and collapsing to one DoH server.
- Why stricter: lookups stay on the exit. 30s is the recovery bound so a missed OS flush cannot leave apps on 198.18.0.0/16. HTTP/3 would race a UDP probe the VLESS exit cannot carry and drop the HTTP client. LRU keeps stale answers; one dead DoH server still falls through to the other. A pre-warm miss does not block the first request.
- Applied in: [#741](https://github.com/raydocs/tono/pull/741).

How to add one: [decisions/README.md](decisions/README.md). Do not edit another
decision's file, and do not add a heading here. The headings below are the ones
this file had when it was split. They stay so an existing `#anchor` still lands
here; the entry itself is the linked file.

## Index

## 2026-09-30 · macOS 已连接时，哪些网络变化可以拆掉隧道？

[038 macos-uplink-rebuild](decisions/038-2026-09-30-macos-uplink-rebuild.md)

## 2026-09-30 · Windows 网络事件的第一次数据面探测失败，要不要立刻拆隧道？

[037 windows-first-probe-keeps-tunnel](decisions/037-2026-09-30-windows-first-probe-keeps-tunnel.md)

## 2026-09-30 · On crash or hang without an explicit strict kill switch, what happens to general traffic and to AI services?

- Status: owner
- Chosen: full release of general traffic comes first. The user always has a network. After that release, a narrow secondary layer is allowed: a system-resolver sinkhole of exclusive first-party AI suffixes, plus a static block of Anthropic's published inbound prefixes `160.79.104.0/23` and `2607:6bc0::/48` only. That layer may exist only when it cannot block general traffic or captive-portal login, and Restore network removes it. Customers are in mainland China, where direct access to those AI services does not work, so real-IP exposure after a crash is limited. Never trade network availability for that exposure. Rejected: blocking Cloudflare, Fastly, Azure, Google, or AS13335; using `CLAUDE_HOME_DOMAINS` as the sinkhole list; a TLS-SNI callout; fetching a fresh prefix list while the core is dead; keeping any general block up in order to hide the real IP; re-enabling PF to carry the two prefixes; putting the prefixes in the Windows kill-switch provider (a leftover filter there is treated as still armed and installs an emergency block-all). Strict mode keeps the full block. [#701](https://github.com/raydocs/tono/pull/701) and [#703](https://github.com/raydocs/tono/pull/703) are still open, so this layer is prepared on top of them and must not merge first.
- Why stricter: availability is the constraint the owner put above the AI hold. The narrow layer does not widen a general outage, and refusing a CDN block does not widen exposure past the full release. The cost, accepted here, is that a crash can still let the real IP reach an AI service when that service is reachable from the network.
- Applied in: [#709](https://github.com/raydocs/tono/pull/709), [selective-fail-open.md](selective-fail-open.md). The layer is [#738](https://github.com/raydocs/tono/pull/738), blocked on #701 and #703.

[036 crash-hang-releases-then-ai-layer](decisions/036-2026-09-30-crash-hang-releases-then-ai-layer.md)

## 2026-09-30 · On boot, crash, or helper death, does a saved kill switch stay up?

[035 boot-does-not-rearm-kill-switch](decisions/035-2026-09-30-boot-does-not-rearm-kill-switch.md)

## 2026-09-30 · Should `/etc/pf.conf` keep loading the kill-switch rule file at boot?

[034 pf-conf-does-not-load-rules-at-boot](decisions/034-2026-09-30-pf-conf-does-not-load-rules-at-boot.md)

## 2026-09-30 · On arm or sleep-barrier failure, keep the all-block until the next helper start?

[033 arm-failure-releases-immediately](decisions/033-2026-09-30-arm-failure-releases-immediately.md)

## 2026-09-30 · Should an unreadable update ledger refuse emergency network release?

[032 unreadable-ledger-still-releases](decisions/032-2026-09-30-unreadable-ledger-still-releases.md)

## 2026-09-30 · When fail-open runs, does AI-service traffic also go out on the real address?

[031 fail-open-keeps-ai-block](decisions/031-2026-09-30-fail-open-keeps-ai-block.md)

## 2026-09-30 · After login or connect recovery is exhausted, does the machine stay blocked?

[030 exhausted-recovery-fails-open](decisions/030-2026-09-30-exhausted-recovery-fails-open.md)

## 2026-09-30 · When a configured exit fails, may self-heal tear the tunnel down to try another, and may it leave the machine blocked?

[029 self-heal-does-not-tear-down](decisions/029-2026-09-30-self-heal-does-not-tear-down.md)

## 2026-09-30 · Continuity 要不要改 PF 在网放行或组播状态

[028 continuity-tun-exclude-only](decisions/028-2026-09-30-continuity-tun-exclude-only.md)

## 2026-09-30 · On Windows, should corrupt WFP state or an unhealthy watchdog keep a block?

[027 windows-corrupt-wfp-releases](decisions/027-2026-09-30-windows-corrupt-wfp-releases.md)

## 2026-09-30 · Should the 10s TUN and 12s first-byte budgets be shortened now?

- Status: provisional
- Chosen: no. Record per-stage durations under the existing wire keys (`preparing` … `verifyingTraffic`) so a later field trace can be compared. Rejected: cutting those budgets without a device trace, installing the tunnel in parallel with the handshake, and building a Clash-versus-Tono harness here.
- Why stricter: a shorter budget fails connects that are merely slow, and a parallel tunnel install is the silent-drop case. The keys do not add a second telemetry upload.
- Applied in: branch `cursor/connect-stage-timings-a925`.

## 2026-09-29 · After an unexpected restart on Windows, does the Service start the Core by itself, and does the App say why it did not?

[026 windows-boot-does-not-replay](decisions/026-2026-09-29-windows-boot-does-not-replay.md)

## 2026-09-29 · Does the Windows App's native-update recovery reconnect by itself after a restart?

[025 windows-update-recovery-holds](decisions/025-2026-09-29-windows-update-recovery-holds.md)

## 2026-09-29 · macOS kill switch hosts pins when `/etc/hosts` cannot be safely rewritten

[024 macos-hosts-pins-best-effort](decisions/024-2026-09-29-macos-hosts-pins-best-effort.md)

## 2026-09-28 · Who approves GitHub Actions environment approvals (e.g. `windows-release`)?

[023 agents-approve-gha-environments](decisions/023-2026-09-28-agents-approve-gha-environments.md)

## 2026-09-27 · Windows installer gate and lock: a Tono adapter that is not present is neither a refusal nor a tunnel

[022 windows-absent-tono-adapter](decisions/022-2026-09-27-windows-absent-tono-adapter.md)

## 2026-09-27 · Windows installer gate: which leftovers may it clear itself, and when does the uninstaller hand back its lease?

[021 windows-installer-leftover-lease](decisions/021-2026-09-27-windows-installer-leftover-lease.md)

## 2026-09-26 · hy2 on macOS via a separately published SPKI pin

[020 macos-hy2-spki-pin](decisions/020-2026-09-26-macos-hy2-spki-pin.md)

## 2026-09-26 · Does 0.0.74 wait for the G3 protected-update device test?

[019 release-0074-defers-g3](decisions/019-2026-09-26-release-0074-defers-g3.md)

## 2026-09-26 · Which version is the customer release?

[018 customer-release-is-0074](decisions/018-2026-09-26-customer-release-is-0074.md)

## 2026-09-26 · Does #352 / H2-F3 (Windows Service IPC not bound to the Tono image) block 0.0.74?

[017 h2-f3-does-not-block-0074](decisions/017-2026-09-26-h2-f3-does-not-block-0074.md)

## 2026-09-26 · G4.2 for 0.0.74: is an old-client first hop required before the customer feeds move?

[016 g42-no-old-client-hop](decisions/016-2026-09-26-g42-no-old-client-hop.md)

## 2026-09-26 · SHIP_PLAN §6 "macOS Sparkle 真机一次成功更新" under the v1 update path

[015 sparkle-line-met-by-g3](decisions/015-2026-09-26-sparkle-line-met-by-g3.md)

## 2026-09-26 · Windows: may the installer or the App's repair re-enable a Disabled Base Filtering Engine?

[014 windows-bfe-disabled-stays](decisions/014-2026-09-26-windows-bfe-disabled-stays.md)

## 2026-09-26 · May the G3 test kit use the production v1 update pointer before G4?

[013 g3-kit-may-use-v1-pointer](decisions/013-2026-09-26-g3-kit-may-use-v1-pointer.md)

## 2026-09-26 · May the agent approve the `windows-release` environment for test-kit signing?

[012 agent-approves-windows-release-kit](decisions/012-2026-09-26-agent-approves-windows-release-kit.md)

## 2026-09-26 · Does #331 (macOS bootstrap exception not bound to Tono) block the customer release?

[011 issue-331-does-not-block-release](decisions/011-2026-09-26-issue-331-does-not-block-release.md)

## 2026-09-26 · Windows: which vault session does the next launch trust after a sign-in that did not finish saving?

[010 windows-vault-session-after-signin](decisions/010-2026-09-26-windows-vault-session-after-signin.md)

## 2026-09-26 · May macOS dial the cached catalog before Tono has verified the account?

[009 macos-catalog-needs-admission](decisions/009-2026-09-26-macos-catalog-needs-admission.md)

## 2026-09-24 · When may an agent merge a PR without asking?

[008 merge-without-asking](decisions/008-2026-09-24-merge-without-asking.md)

## 2026-09-24 · May an agent deploy and publish?

[007 agent-may-deploy-and-publish](decisions/007-2026-09-24-agent-may-deploy-and-publish.md)

## 2026-09-24 · Who makes product decisions that used to wait for the owner?

[006 agent-chooses-stricter-option](decisions/006-2026-09-24-agent-chooses-stricter-option.md)

## 2026-09-24 · hy2 blocks in the customer catalog before client admission is proven

[005 hy2-stripped-until-admission](decisions/005-2026-09-24-hy2-stripped-until-admission.md)

## 2026-09-24 · Where may a secret value come from?

[004 secret-values](decisions/004-2026-09-24-secret-values.md)

## 2026-09-24 · Does the G1–G3 acceptance cover a different candidate?

[003 g1-g3-names-one-candidate](decisions/003-2026-09-24-g1-g3-names-one-candidate.md)

## 2026-09-30 · Automatic diagnostics stay on; raw hostname logs stay gated

[002 diagnostics-default-on](decisions/002-2026-09-30-diagnostics-default-on.md)

## 2026-09-30 · Failure-cluster alerts are off until both webhook settings exist

[001 failure-cluster-needs-both-secrets](decisions/001-2026-09-30-failure-cluster-needs-both-secrets.md)
