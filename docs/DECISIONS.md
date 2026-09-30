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

## 2026-09-30 · macOS 已连接时，哪些网络变化可以拆掉隧道？

- Status: provisional
- Chosen: 只在默认上行的服务、接口、可用 IPv4 地址或 IPv4 网关变成另一个具体值时重建；IPv6-only 才把 IPv6 默认下一跳算进身份。次要网卡出现、DHCP 空窗、APIPA、动态库读失败、双栈上的 IPv6 路由器抖动都保持隧道。拒绝：继续用「所有 up 的 IPv4 地址」指纹（插扩展坞就拆隧道），以及为了门户登录临时放开 PF。
- Why stricter: PF 保持失败关闭，不新增旁路。少拆一次隧道就是少一次 Kill Switch 把机器扣在无网络上的窗口。双栈不因 IPv6 RA 抖动拆掉仍可用的 IPv4 上行。
- Applied in: [#702](https://github.com/raydocs/tono/pull/702)（`NetworkUplinkSnapshot`）。

## 2026-09-30 · Windows 网络事件的第一次数据面探测失败，要不要立刻拆隧道？

- Status: provisional
- Chosen: 不拆。核心和 WFP 保持原样，下一拍监视器再探一次；第二次仍失败才按原路径重建。核心身份变化、WFP/DNS 不健康、DIRECT 绑的网卡不再有默认路由，都不走这次等待。拒绝：一次失败就 Stop core（弱网闪断会把机器扣在 Kill Switch 里，比闪断更长）。
- Why stricter: 不放开 WFP，不增加旁路。少一次无谓的拆隧道。确认失败后的重建仍然失败关闭。
- Applied in: [#705](https://github.com/raydocs/tono/pull/705)（`plan_network_event_probe`）。

## 2026-09-30 · On crash or hang without an explicit strict kill switch, what happens to general traffic and to AI services?

- Status: owner
- Chosen: full release of general traffic comes first. The user always has a network. After that release, a narrow secondary layer is allowed: a system-resolver sinkhole of exclusive first-party AI suffixes, plus a static block of Anthropic's published inbound prefixes `160.79.104.0/23` and `2607:6bc0::/48` only. That layer may exist only when it cannot block general traffic or captive-portal login, and Restore network removes it. Customers are in mainland China, where direct access to those AI services does not work, so real-IP exposure after a crash is limited. Never trade network availability for that exposure. Rejected: blocking Cloudflare, Fastly, Azure, Google, or AS13335; using `CLAUDE_HOME_DOMAINS` as the sinkhole list; a TLS-SNI callout; fetching a fresh prefix list while the core is dead; keeping any general block up in order to hide the real IP; re-enabling PF to carry the two prefixes; putting the prefixes in the Windows kill-switch provider (a leftover filter there is treated as still armed and installs an emergency block-all). Strict mode keeps the full block. [#701](https://github.com/raydocs/tono/pull/701) and [#703](https://github.com/raydocs/tono/pull/703) are still open, so this layer is prepared on top of them and must not merge first.
- Why stricter: availability is the constraint the owner put above the AI hold. The narrow layer does not widen a general outage, and refusing a CDN block does not widen exposure past the full release. The cost, accepted here, is that a crash can still let the real IP reach an AI service when that service is reachable from the network.
- Applied in: [#709](https://github.com/raydocs/tono/pull/709), [selective-fail-open.md](selective-fail-open.md). The layer is [#738](https://github.com/raydocs/tono/pull/738), blocked on #701 and #703.

## 2026-09-30 · On boot, crash, or helper death, does a saved kill switch stay up?

- Status: provisional
- Chosen: no. macOS has no user-facing strict kill switch, so a leftover `killswitch.state` is not an opt-in. Startup does not re-arm. A Core that is not running releases the block and restores a DNS snapshot. A startup failure and a corrupt update ledger do not install a block. While a Core is running, the in-session supervisor may still reload the saved rules. Rejected: re-arming at every helper start, and holding DNS at `127.0.0.1` when the Core is dead because PF is not confirmed live. Also rejected: a second LaunchDaemon as the watchdog (it can fight this helper). The watchdog is the helper's idle loop; if this process itself is stuck, that loop does not run.
- Why stricter: the host keeps a working network after reboot, crash, uninstall and Safe Mode. The cost is that a connected session's block does not survive helper restart unless the Core is still running, and there is a short gap after boot before this helper has migrated `/etc/pf.conf`. Traffic is not widened during a live Core.
- Applied in: [#701](https://github.com/raydocs/tono/pull/701) (`KillSwitchManager.swift`, `SocketServer.swift`, `UpdateExecutor.swift`, `ProtectedDNSManager.swift`).

## 2026-09-30 · Should `/etc/pf.conf` keep loading the kill-switch rule file at boot?

- Status: provisional
- Chosen: no. The on-disk hook only declares `anchor "tono.killswitch"`. While the helper is enforcing, it loads the rules with one `pfctl -f` of a temporary copy that still contains `load anchor from`, so an already-enabled PF does not see an empty anchor. Rejected: leaving `load anchor from` in `/etc/pf.conf` (Safe Mode still runs Apple's pfctl and does not run this LaunchDaemon, so a block file or a stuck file survives the mode people use to recover). Also rejected: skipping protection only when `kern.safeboot` is set (BRICK-M10). This daemon does not run in Safe Mode; the boot path does not re-arm at all.
- Why stricter: a live Core can still install the block before PF is enabled. The cost is a short interval after boot, before the helper starts, where another program enabling PF evaluates an empty anchor. Safe Mode, where this helper does not run, no longer reinstalls the block from the rule file once this helper has rewritten the hook.
- Applied in: [#701](https://github.com/raydocs/tono/pull/701) (`KillSwitchPF.swift`); BRICK-M9, MAC-BOOT-DNS-ORPHAN.

## 2026-09-30 · On arm or sleep-barrier failure, keep the all-block until the next helper start?

- Status: provisional
- Chosen: no. Release the anchor and the saved intent immediately. A failed update rollback does the same before it returns. Rejected: installing an emergency all-block and waiting for the next daemon start. macOS has no strict kill-switch opt-in.
- Why stricter: a failed commit does not leave the host offline. A successful sleep barrier is unchanged. The cost is that a failed re-arm also drops the previous block.
- Applied in: [#708](https://github.com/raydocs/tono/pull/708) (`KillSwitchManager.swift`, `UpdateExecutor.swift`); BRICK-M8, BRICK-M13.

## 2026-09-30 · Should an unreadable update ledger refuse emergency network release?

- Status: provisional
- Chosen: no. `--emergency-disarm` releases PF and attempts DNS restore, and leaves the ledger bytes in place. `--emergency-reset` does not remove the install when the ledger cannot be trusted, but it still releases the network. Rejected: #691's bootout of every `pfctl`/`networksetup`, requiring DNS verification before opening PF, and a durable flag that stops later helper starts. That draft stays untouched.
- Why stricter: recovery cannot be refused by evidence the helper cannot read. Nothing is deleted. Launch does not re-arm, and a DNS restore failure still releases PF.
- Applied in: [#711](https://github.com/raydocs/tono/pull/711) (`main.swift`).

## 2026-09-30 · When fail-open runs, does AI-service traffic also go out on the real address?

- Status: owner
- Chosen: selective. Release general traffic, and keep blocking AI-service traffic (Claude/OpenAI and the same class) so the real address never reaches them. The PF/WFP rule set is bc-3c5ccfd4's. Until that hook is registered and returns true, the decision stays today's full release. An explicit strict kill switch (`permanent`) still keeps the whole block and is not overridden. Rejected: inventing the filter rules in this change, and leaving every exhausted failure fully blocked.
- Why stricter: the real address stays off AI services once the hook exists. Until then nothing new is blocked, and nothing new is punched through a filter the hook did not install. Certificate checks stay on. System DNS is not changed.
- Applied in: [#706](https://github.com/raydocs/tono/pull/706) owns `network_disposition::exhausted_protection`. [#703](https://github.com/raydocs/tono/pull/703) calls that function and does not keep a second match. The later decision above (#709) governs a crash: full release first. This hook stays unregistered until that narrow layer exists, and a true return must not hold general traffic.

## 2026-09-30 · After login or connect recovery is exhausted, does the machine stay blocked?

- Status: owner
- Chosen: fail open to the original network, unless the user explicitly enabled a strict kill switch (`permanent`). Rejected: keeping the block after every verified-session failure.
- Why stricter: retries do not install filters, change system DNS, or replace routes. Certificate checks stay on. A strict kill switch the user turned on still keeps the block. The cost is a direct path after an exhausted failure when strict mode is off.
- Applied in: [#706](https://github.com/raydocs/tono/pull/706)（`customer_failure`、Windows `plan_failure`）。

## 2026-09-30 · When a configured exit fails, may self-heal tear the tunnel down to try another, and may it leave the machine blocked?

- Status: provisional
- Chosen: no tear-down between hops. A new dial name is used only while protection is down, before the next tunnel exists. If a verified barrier is already up and the user has not explicitly enabled a strict kill switch, stop and restore the original network through the existing explicit release, once, with no reconnect. Strict (macOS Kill Switch "Permanent" only; Windows has no such toggle, so Windows is ordinary) may keep the barrier and retries the same node. Rejected: rotating cities under WFP/PF, a positive mihomo `handshake-timeout` (it detaches the QUIC dial from the caller), and `skip-cert-verify`.
- Why stricter: the healer writes no PF, WFP, TUN, or route. It does not widen the permit set to probe backups. Residential SOCKS identity is not replaced. The cost is that a dead preferred path is not hot-swapped under an armed barrier; the machine goes back to its original network instead of sitting in Protected Offline.
- Applied in: `tono-core` `heal` and the Windows connect failure path. macOS has the same decision type and tests; it is not called from the live connect path until a device proves the PF release.

## 2026-09-30 · Continuity 要不要改 PF 在网放行或组播状态

- Status: provisional
- Chosen: 只把静态、不可路由的前缀（有限广播 `255.255.255.255/32`、IPv6 组播 `ff00::/8`，加上原先已排除的私网/链路本地/IPv4 组播）放进 sing-box `route_exclude_address`，让 Darwin auto-route 不要把它们装进 utun。不改 PF、不升级 helper、不按网卡现算在网前缀、不把 mDNS/链路本地从 `keep state` 改成 `no state`、不恢复 Apple 进程的公网 DIRECT。
- Why stricter: 连接时 Kill Switch 在 TUN 起来之前就已经武装。动态 PF 或未在 Mac 上解析过的规则一旦写坏，整份规则装不进去，恢复仍要靠已有的 Restore internet，但这次改动本身不能增加那条路径的失败面。排除有限广播不会打开公网，也不替换默认路由。在网全球 IPv6 / 非私网 IPv4 仍按现有 Kill Switch 丢弃，直到有实机证明一条静态、可重复的放行。
- Applied in: [#700](https://github.com/raydocs/tono/pull/700) `cursor/macos-continuity-onlink-3d9f`（`ConfigPipeline.tunRouteExcludeCIDRs`）。

## 2026-09-30 · On Windows, should corrupt WFP state or an unhealthy watchdog keep a block?

- Status: provisional
- Chosen: no, unless the on-disk record explicitly sets `strict_kill_switch` (or the PF desired mode is Permanent). Corrupt, unreadable, unusable, and residual-without-intent paths release WFP and attempt DNS restore. The unhealthy watchdog waits three ticks, then releases; strict mode reinstalls and still releases after thirty consecutive unhealthy ticks. Rejected: keeping the ownerless emergency block, and deleting corrupt bytes to synthesize a tombstone.
- Why stricter: an unreadable file is not an opt-in, so it cannot keep the machine closed. A live wanted session is still restored when the record parses and the install verifies. The cost is a connected session whose WFP verify fails for about three seconds loses the block until the next arm. Needs real-hardware testing.
- Applied in: [#733](https://github.com/raydocs/tono/pull/733) (`windows_kill_switch.rs`, `macos_kill_switch.rs`).

## 2026-09-29 · After an unexpected restart on Windows, does the Service start the Core by itself, and does the App say why it did not?

- Status: provisional
- Chosen: no replay, and no new notice. The Service replays a run intent only if the intent was recorded
  in this boot (the volatile `BootSession` marker) and a wanted barrier was restored. Otherwise it holds
  the Core stopped with the barrier up until the user connects, and it does not rewrite the intent. The App
  shows its existing Protected Offline state. Rejected: a clean-shutdown marker that would replay after a
  crash, since holding is stricter; an App notice for the hold (plan OQ1, left open because it needs new
  UI strings); rewriting the intent at a held boot (a boot-path write that can fail, and it erases evidence).
- Why stricter: nothing connects before logon without the user, and fail-closed is unchanged, because the
  barrier stays up while the Core is held. The cost is availability. The user connects once after a crash,
  a blue screen or a power loss, and taps Retry once after a planned restart whose logoff release did not
  finish.
- Applied in: PR [#680](https://github.com/raydocs/tono/pull/680) (`core/boot_session.rs`,
  `core/desired.rs`; BRICK-W1); plan PLAN-win-boot-uninstall r3, plan review 38c453fa.

## 2026-09-29 · Does the Windows App's native-update recovery reconnect by itself after a restart?

- Status: provisional
- Chosen: no. The App starts the update-recovery Connect only when its own Adopt returned a certain answer
  that it is the successor the executor launched (`successor_relaunched` false). A later App after a
  restart, or an Adopt that failed or gave an uncertain answer, holds for the life of that App process, and
  the existing "update recovery incomplete" banner shows beside Protected Offline. The user's own Connect
  and Restore internet are unchanged. Rejected: a boot marker in the update receipt or attempt (changes the
  shared v1 contract with macOS); an App-side boot record taken at update start (would hold every connected
  user after the first routine update into this version); making `successor_relaunched` durable (a schema
  change in the shared transaction store).
- Why stricter: no Connect at logon that the user did not ask for. Nothing widens exposure. The cost is
  that recovery waits for the user; the 48 h receipt-expiry dead end stays open as BRICK-W6.
- Applied in: PR [#680](https://github.com/raydocs/tono/pull/680) (`tono/commands/update.rs` `Adoption`,
  `tono/commands/restore.rs`, Service `successor_relaunched`; BRICK-W1).

## 2026-09-29 · macOS kill switch hosts pins when `/etc/hosts` cannot be safely rewritten

- Status: provisional
- Chosen: the helper writes its `/etc/hosts` pins on a best-effort basis at arm, status repair,
  supervisor repair and launch restore. An unsafe file (not a root-owned regular file, group or
  world writable, over 1 MiB, a symlink, not UTF-8, or a lone marker) is never rewritten or backed
  up. A release never waits on hosts: it removes the pins only after the anchor flush and the intent
  removal, and a failure there is logged, not returned. Rejected: refusing the arm on such a file
  (it bricks the release path, BRICK-M2), and normalising the file (rewriting a third-party file).
- Why stricter: no PF permit depends on the pins, so skipping them widens nothing; PF rules are
  rendered the same; no third-party file is rewritten. Cost: pinned names may not resolve while
  protection is on, and stale Tono pins stay inside an unsafe file.
- Applied in: [#679](https://github.com/raydocs/tono/pull/679) (BRICK-M2).

## 2026-09-28 · Who approves GitHub Actions environment approvals (e.g. `windows-release`)?

- Status: owner
- Chosen: agents approve them themselves with `gh` (`windows-release` for any candidate,
  `windows-update-channel` at G4) and record each one (run URL, environment, candidate SHA and
  release sequence) in `docs/changelog.d/`. Rejected: signed candidates outside the test kit
  waiting for the owner's approval.
- Why: owner, 2026-09-28 in chat: "之后都 ai 可以自行批准 不需要我批". Unchanged: customer
  channels move only after the owner's `[x]` for G1–G2 in SHIP_PLAN §6 (0.0.74), and only with
  the candidate that evidence names.
- Supersedes: "May the agent approve the `windows-release` environment for test-kit signing?"
  (2026-09-26), widened from the kit to every run, and RELEASE_LINES' "any other signed G3
  candidate waits for the owner's approval".
- Applied in: [RELEASE_LINES](RELEASE_LINES.md#customer-publish-g4); first self-approval
  [windows-release run 36383440146](https://github.com/raydocs/tono/actions/runs/36383440146)
  (0.0.74 sequence 7422, `ccbc50a8`), recorded in `docs/changelog.d/2026-09-28-regression-a1d498c8-minors.md`.

## 2026-09-27 · Windows installer gate and lock: a Tono adapter that is not present is neither a refusal nor a tunnel

- Status: provisional. The requirement is the owner's (2026-09-27, relayed): a leftover `Tono` adapter must not block
  a reinstall, and it may be removed only if leaving it breaks connecting. The mechanism below is
  the smaller option the owner asked to evaluate (agent, plan PLAN-stale-adapter r3, plan review
  1e546b82).
- Chosen: the manual-install gate, and every other `tunnel_present` / `tunnel_absent` caller,
  counts an interface named `Tono` as present only when Windows reports any status but
  `IfOperStatusNotPresent`; a gate that sees only not-present rows passes and notes them in
  install-gate.log. The WFP lock treats a not-present row, or `ERROR_FILE_NOT_FOUND` from
  `GetIfEntry2` after the alias resolved, as the existing retryable "did not resolve to a LUID"
  state. Nothing is removed. Exit 87 and `TONO_INSTALL_TONO_ADAPTER_PRESENT` stay for a present
  adapter; the 87 dialog no longer sends the user to Device Manager.
- Rejected: A. remove the leftover from the elevated helper (SetupDi `DIF_REMOVE`); B. have the
  Service remove it before StartClash; C. stop the Core gracefully; D. relax only the gate and keep
  `tunnel_absent` strict; E. only reword the 87 dialog; F. remove only a different-device leftover
  at the gate; G. make "tunnel LUID changed" retryable in the App; H. retry every `GetIfEntry2`
  failure.
- Why stricter: a present `Tono` adapter still refuses (a present WinTUN device always has a live
  owner); the tunnel permit is never keyed to a missing or not-present interface; every other
  row-read failure stays a permanent refusal; no privileged device code is added.
- Supersedes: the adapter clause of 2026-09-27 "which leftovers may it clear itself…" (the gate
  still removes no adapter, but no longer refuses a not-present one, and the dialog no longer names
  Device Manager). That entry's status is unchanged.
- Applied in: `fix/win-ghost-tono-adapter-20260927` (WIN-GATE-GHOST-TUN).

## 2026-09-27 · Windows installer gate: which leftovers may it clear itself, and when does the uninstaller hand back its lease?

- Status: provisional (agent). Reason codes on every refusal, and Chinese + English dialogs with
  Russian repeating the English text, are owner decisions (2026-09-27).
- Chosen: the gate clears by itself only a core runtime record whose Core is gone (the pid exited
  or now runs another image) and only when no Tono Service is registered. It does not remove a
  leftover `Tono` network adapter (the dialog says restart, then Device Manager), does not treat an
  unreadable active-owner record or a DNS restore that carries a note as absent, and does not
  auto-retire a stale connected owner (that stays the confirmed 78 path). The uninstaller hands
  its manual lease back at the end of its Uninstall section instead of when its window closes; an
  aborted section keeps the lease as before. Rejected: PnP removal of the adapter from the elevated
  helper, quarantining owner or DNS evidence in the gate, one generic code with the cause only in
  the log.
- Why stricter: residual Tono WFP filters with no Service still need the 78 consent, active
  protection still refuses with 77, and nothing that can hold or re-arm protection is cleared. The
  one automatic clear is a record for a process that no longer exists, with no Service left to
  write another; the earlier lease release follows the section's last change and never an abort.
- Applied in: `fix/windows-gate-reasons-20260927` (WIN-GATE-OPAQUE).

## 2026-09-26 · hy2 on macOS via a separately published SPKI pin

- Status: owner
- Chosen: hy2 must work for every user in 0.0.74, macOS included; fix the pin now (owner).
  Mechanism: each managed hysteria2 block may carry `certificate-public-key-sha256`, the
  standard base64 SHA-256 of the leaf's SubjectPublicKeyInfo, computed by the operator on the
  node and published beside the DER `fingerprint`, which stays mandatory (Windows/mihomo keeps
  using it). macOS passes it to sing-box as `tls.certificate_public_key_sha256`; a block without
  a valid pin stays unavailable. Rejected: deriving SPKI from the DER hash on the client
  (impossible), `insecure: true`, dropping the pin, and shipping macOS without hy2.
- Why: hy2 nodes serve operator-generated self-signed certificates whose private key never
  leaves the node, and the DER pin never relied on a CA, name or validity period, so a key pin
  gives the same MITM protection. Evidence: [product contract](../tooling/scripts/sing-box/product-contract.md).
- Applied in: `feat/macos-hy2-spki-pin-20260926`. Publishing the pins is a separate ops step.

## 2026-09-26 · Does 0.0.74 wait for the G3 protected-update device test?

- Status: owner
- Chosen: no. G3 (protected v1 update: success + interrupted rollback) moves to the 0.0.75
  cycle, where the installed 0.0.74 is the bootstrap and 0.0.75 the update target. 0.0.74 ships
  after the owner's G1 + G2 device round on ONE package per platform (release sequence 7411,
  built from one frozen source). Rejected: the three-package kit (bootstrap / failure target /
  success target) and the signed v1 pointer steps for this release.
- Why: owner, 2026-09-26. Customers uninstall and install 0.0.74 by hand, so no customer takes
  the v1 update path in this release; the first real v1 update is 0.0.74 → 0.0.75. Cost: a
  defect in 0.0.74's update path would surface only then, and customers would reinstall by hand
  again. The SHIP_PLAN §6 G3 lines stay unticked until the 0.0.75 round (agents never edit them).
- Supersedes for 0.0.74: "May an agent deploy and publish?" (2026-09-24) — its publish gate
  needs G1 and G2 only for this release; "May the G3 test kit use the production v1 update
  pointer before G4?" and "May the agent approve the `windows-release` environment for
  test-kit signing?" — no kit this release (the uploaded 7402/7403 objects stay immutable and
  unreferenced; `desktop/v1/latest` stays unset; release-build approvals still follow
  RELEASE_LINES); the G4.2 entry — G4 publishes the owner-accepted 7411 packages; the SHIP_PLAN §6
  macOS Sparkle line entry — that line is part of G3 and moves to 0.0.75 with it.
  AGENTS.md, SHIP_PLAN and RELEASE_LINES carry the 0.0.74 exception next to each G1–G3 gate.

## 2026-09-26 · Which version is the customer release?

- Status: owner
- Chosen: 0.0.74 / macOS build 74 (owner: "74"). The `tono-macos-0.0.73-build73` tag and the
  0.0.73 internal candidates stay as history. Rejected: reusing build 73 (its tag already
  points at another commit).
- Applied in: [#660](https://github.com/raydocs/tono/pull/660).

## 2026-09-26 · Does #352 / H2-F3 (Windows Service IPC not bound to the Tono image) block 0.0.74?

- Status: owner
- Chosen: no. 0.0.74 ships H2-F3 as a known limitation; #352 merges after the owner's Win11
  `icacls` / owner evidence (last step of the device round), for 0.0.75. Rejected: holding the
  release for that evidence.
- Why: owner, 2026-09-26. Not a regression; the caller must already run code as the signed-in user.

## 2026-09-26 · G4.2 for 0.0.74: is an old-client first hop required before the customer feeds move?

- Status: owner
- Chosen: no. The owner has no device kept on 0.0.67 / 0.0.34; customers uninstall and install
  0.0.74 directly. G4 publishes the owner-accepted kit bytes (success target) to the customer
  feeds, then the owner checks the published build; Windows still requires the release row's
  `verifiedAt` before promotion. Rejected: holding the Windows publish for a pre-promotion
  old-client path (0.0.34's update endpoint is fixed in production).
- Why: owner, 2026-09-26.

## 2026-09-26 · SHIP_PLAN §6 "macOS Sparkle 真机一次成功更新" under the v1 update path

- Status: owner
- Chosen: the macOS v1 protected update success in the G3.3 device round satisfies that line;
  the §6 checkbox text itself is unchanged (agents never edit it). Rejected: a separate
  Sparkle-only device test.
- Why: owner, 2026-09-26.

## 2026-09-26 · Windows: may the installer or the App's repair re-enable a Disabled Base Filtering Engine?

- Status: provisional
- Chosen: no. `tono-service-install.exe` starts a BFE that is only stopped (its start type
  unchanged) and waits out StartPending, before the manual gate's first WFP read. A BFE whose
  start type is Disabled is left as it is: the gate refuses with exit 79, NSIS shows the
  `sc.exe config BFE start= auto` / `sc.exe start BFE` commands, and the App's repair fallback
  text names the same commands. The silent `sc config BFE start= auto` the helper used to run
  (it never ran with BFE stopped once the manual gate read WFP first, b6b42ea0) is removed. Rejected: re-enabling it
  silently (the old behaviour), or after an NSIS Yes/No prompt like the orphaned-block (78) one.
- Why stricter: the installer changes no machine setting the user or their security software
  chose; the user makes that change. Protection is not loosened: an unreadable WFP still
  refuses the gate, and a stopped (not Disabled) BFE installs as before the regression.
- Applied in: [#658](https://github.com/raydocs/tono/pull/658) (H22-O-F1)

## 2026-09-26 · May the G3 test kit use the production v1 update pointer before G4?

- Status: owner
- Chosen: yes. The one-round G1–G3 test kit publishes its signed update pair behind
  `releases.afk.ccwu.cc/desktop/v1/latest/manifest.json`, which no shipped customer build
  reads (0.0.67 / 0.0.34 use Sparkle `public/appcast.xml` and `public/windows/latest.json`).
  Customer feeds stay untouched until G1–G3 are ticked. Rejected: testing G3 only after
  publish, a second device round.
- Why: owner, 2026-09-26 in chat; conditional on the plan review confirming no shipped build
  reads the pointer. The kit's own builds do read it (NativeUpdateDownload.swift:5,15;
  update_wire.rs:5). During the owner's round it serves only the kit's signed pair: the
  failure-target manifest while the owner runs the injected-failure step, then the
  success-target manifest, where it stays until G4; that package is the exact candidate the
  owner accepts and G4 publishes, and the kit's release sequences are the ones the published
  build continues from. Nothing else is placed behind it.
- Applied in: G1–G3 test kit (this session).

## 2026-09-26 · May the agent approve the `windows-release` environment for test-kit signing?

- Status: owner
- Chosen: yes, the agent approves the signing runs of the test kit with `gh`, and records
  each approval (run id, source SHA) in `docs/changelog.d/`. Rejected: waiting for the owner
  at the computer.
- Applied in: G1–G3 test kit (this session).

## 2026-09-26 · Does #331 (macOS bootstrap exception not bound to Tono) block the customer release?

- Status: owner
- Chosen: no. The customer release (0.0.74, see above) ships with H1-F5 (macOS half) as a
  known limitation in the release notes; #331 continues from plan v5 for 0.0.75. Rejected:
  holding the release for a helper/PF redesign rejected five times in plan review.
- Why: owner, 2026-09-26. Not a regression (present since 0.0.67); reach is limited to
  shared control-plane anycast addresses while Protected Offline.

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

## 2026-09-26 · May macOS dial the cached catalog before Tono has verified the account?

- Status: provisional
- Chosen: no. Connect (and every protected reconnect, wake recovery and Retry through it)
  needs Tono to have accepted the session in this process (a 2xx answer, `me()` readmitting
  the account, or a sign-in) or an offline admission on a matching grant. A launch still
  restoring waits for that; a restore that fails without a grant stays in error with PF held
  until Retry succeeds. Rejected: dial the cached exit whenever no offline grant is in play
  (previous behavior).
- Why stricter: no exit is dialed for a session no server accepted and no grant admitted.
  Availability narrows only for a crash-recovery launch during restore and an unverified
  error state, both already fail-closed.
- Applied in: [#652](https://github.com/raydocs/tono/pull/652) (R612-O5).

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

## 2026-09-30 · Automatic diagnostics stay on; raw hostname logs stay gated

- Status: provisional
- Chosen: failure, usage, DNS, and chain uploads are on by default and are not
  gated on `diagnostics_log_access`. Raw network logs stay operator-granted.
  AI-service rows (claude / openai only) require explicit consent and expire
  after 60 days; other diagnostics rows expire after 90 days. A one-shot client
  migration may turn the periodic snapshot back on only when the user has not
  recorded a choice after the v2 force-off. Rejected: re-enabling hostname log
  upload, or leaving the snapshot default off.
- Why stricter: the reports the owner never received were privacy-safe failure
  facts, not browsing history. Hostname logs stay denied.
- Applied in: [diagnostics-privacy.md](diagnostics-privacy.md);
  [#707](https://github.com/raydocs/tono/pull/707).

## 2026-09-30 · Failure-cluster alerts are off until both webhook settings exist

- Status: provisional
- Chosen: the engineering webhook sends only when `FAILURE_ALERT_WEBHOOK_URL`
  and `FAILURE_ALERT_WEBHOOK_SECRET` are both set, the secret is at least 32
  characters, and the URL is public https. One open cluster per
  code+stage+app version+platform+node. A 30-minute quiet gap closes it. Spike
  alerts need a 5× growth of at least 10 events and 15 minutes since the last
  send, with at most 12 sends an hour. The read API is GET-only and uses a
  separate `DIAGNOSTICS_READ_TOKEN`. Rejected: posting to the human alert
  allowlist, or a token that can write.
- Why stricter: an unset bot cannot be reached, and one outage is one alert.
- Applied in: [diagnostics-privacy.md](diagnostics-privacy.md);
  [#707](https://github.com/raydocs/tono/pull/707).
