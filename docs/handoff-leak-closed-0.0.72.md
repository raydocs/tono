# Handoff: Windows 0.0.72 connect after 3-TLS off the control plane

**For:** GPT / Claude (adversarial review + next-edit recommendations)
**From:** Tono Windows connect, 2026-09-09
**Repo:** `pteropod`  branch `client/windows-connection-contract`
**Git HEAD:** `0cb5842` — **do not review HEAD**. Review the **uncommitted working tree**.
**Ask:** Read this, then the cited files. The product is Proton-shaped: **kill switch + no DNS leak + fast connect + stays connected**. Those are one bar, not a sequence. A leak is a fail. A 10-second “Connecting…” while WFP is already up is also a fail. Edits that skip KS/DNS/IPv6/home to look fast are rejects; edits that leave duplicate WFP/DNS/core rebuilds in place are also rejects. Return remaining holes and the next edits that make **this same barrier** come up faster and stay up. Do **not** pack, deploy, commit, or bump the version. Do **not** print VLESS UUIDs, Reality keys, catalog YAML, SOCKS passwords, or admin tokens.

`connection/` below means `apps/windows/app/src-tauri/src/tono/connection/`.

---

## 0. Product core (non-negotiable)

Tono Windows must feel like Proton: **tap Connect → Connected almost immediately, then use the network**, with the same leak contract, and it must **stay** Connected. Third-party TLS (Google / Cloudflare / Apple) is **not** the gate — that exam made Tono both slower and more brittle than Proton.

Proton is fast **because** Connected means the barrier is up, not because they wait on google.com, and not because they skip kill switch. Copy that: prove KS + DNS locally, go green, keep the lock. Do all four below. Skipping 1–3 to win 4, or treating 4 as “later”, are both rejects.

### 1. Kill switch (WFP)

While the user is Connected or Protected Offline:

- No real IPv4 off the physical NIC except core + approved node endpoints.
- Tunnel drop → stay blocked (`tunnel_died` → Protected Offline). Home ISP IP must not appear.
- Connected requires `wanted && live && Locked && tunnel_permit_rendered`.
- IPv6 is blocked at WFP (`wfp_model.rs` intent `block-all-v6` ~337, session `AleAuthConnectV6` ~674–685). Runtime `ipv6: false`. Do not permit IPv6 on the physical NIC to “make connect work”.

After Connected, a core error may show a diagnosis. It must **not** FullRelease the kill switch.

First-connect **admit** failure still FullReleases (user can use 裸网). That is only before a protection session is committed.

### 2. DNS must not leak

Proton-shaped DNS: resolver traffic goes into the tunnel, not the ISP.

- Live apply via `SetInterfaceDnsSettings` (`apps/windows/service/src/core/dns/engine.rs`).
- Admit proves **system** fake-ip with Windows `DnsQueryEx` (`verify_fake_ip`). Not the 198.18.0.2 query used inside TUN HTTPS probes.
- Unique-adapter DNS apply fail → refuse Connected (Win11 Home often has one adapter; fake-ip can still pass while Chrome uses ISP DNS).
- Browser Secure DNS / DoH is a separate bypass (Proton tells users to turn it off). Do not pretend system DNS covers Chrome DoH.
- Do not loosen DNS, UDP:53, or physical-NIC resolver permits for speed.

### 3. Home chain, when assigned

If this account’s catalog has a valid `homeSocks5` (or `homeProxy`) **and it is applied in this session’s runtime**:

```
client → selected VPS (Tono-Exit) → home SOCKS5 (Tono-Home-Residential)
```

Implemented as `dialer-proxy: Tono-Exit` (`tono-core/src/config.rs` ~673–687). The VPS needs no extra listener. Node switch follows the selector.

This is **split routing, not whole-internet home**:

- Specified AI domains / processes / Anthropic IPv4 CIDR → `Tono-Claude-Home` (TCP only; UDP would fall to physical DIRECT, which is a leak).
- Everything else → selected VPS (e.g. Los Angeles · Mesa).
- No home assigned → all of that goes to the selected VPS. Do not invent a home hop.
- Home configured but broken → **fail that split closed**. Do not silently treat as unbound and send Claude out the VPS as if there were no home.
- Catalog downloaded ≠ runtime applied. UI must not say “走家宽” until this session’s YAML contains the chained outbound.
- Home SOCKS5 stays inside the tunnel (no TUN exclusion, no extra WFP permit for the home IP).
- Independent of the Windows WeChat DIRECT overlay (that overlay is **off** this ship).

Do **not** add a home admit probe (no extra Google/home TLS handshake).

### 4. Fast and stable (same product, not a later phase)

Proton users tap Connect and are in. Tono must do that **on the KS+DNS path**, not a weaker path.

- Fast = the local barrier (Service, WFP lock, TUN permit, DNS + fake-ip) comes up with no extra handshake and no duplicate install. User opens a site themselves.
- Stable = once green, it stays green: NIC flaps / 3-TLS fail / `/delay` 504 must not tear the session. Core death keeps the lock. Repeated adapter noise must not restart the core. Recovery must not stop the core unless identity or protection actually broke.
- How Proton is fast: they do **not** wait on a public website. How Tono got slow: we did (3-TLS admit + monitor + switch). That is already off the control plane. What is left is local duplication (reinstall WFP, re-apply DNS, rebuild core on every NIC event).
- How **not** to get fast: skip WFP, skip fake-ip, open IPv6, or lower timeouts until it fails more often.

**Connected means:** core up, KS locked with TUN permit, system DNS on fake-ip, home chain present in runtime **if assigned**. Then the session holds. User traffic is the usability check.

---

## 0.1 One-screen brief (中文)

Proton 是**又快又稳**：点了就绿，绿了不跳，同时 kill switch 和 DNS 不漏。Tono 要的是同一件事，不是「先安全、以后再快」。

1. **Kill switch**：连上和断隧道时都不能从物理网卡漏真 IP；IPv6 也堵住。
2. **DNS 不泄露**：系统 DNS 进隧道，fake-ip 证明过才显示 Connected。
3. **快且稳**：本地保护一就绪就 Connected；网卡抖动 / 三站失败不得拆会话。剩下要砍的是重复装 WFP、重复配 DNS、不该停的核心，不是再加考试。
4. **有家宽就链式代理**：`客户端 → 所选 VPS → 家宽 SOCKS5`。只覆盖指定 AI 域名/进程，不是全站家宽。配了但坏了不能假装没配。

三站探测已经从入门、监控、切网、切节点、DIRECT、主按钮拆走。请审**未提交树**，不要审 HEAD `0cb5842`，不要重写整套连接系统。放松保护装快、或把「快」留到下一版，都否决。

---

## 1. Locked product (do not reopen)

| Item | Rule |
|---|---|
| Version | Stay `0.0.72` (`tauri.conf.json`, `src-tauri/Cargo.toml`) |
| Build id | `leak-closed` |
| Protection | KS + DNS-into-tunnel + IPv6 block. Required **and** must come up fast. |
| Connected | Local protection ready. Not a third-party exam. |
| Admit refuse | WFP lock not live / no TUN permit; system fake-ip fails; unique-adapter DNS apply fails. |
| Must not refuse Connected | TUN HTTPS to gstatic / Cloudflare / Apple; controller `/delay` |
| After Connected | KS stays armed (`tunnel_died` → Protected Offline). Not FullRelease. |
| Pill | Connecting / Connected / Protected Offline / Disconnected. Delay / exit IP are independent (`—` if missing). 3-TLS must not change the button or auto-suggest a node. |
| Home | Assigned → chain through selected VPS. Unassigned → VPS only. Broken assignment → fail closed on that split. Downloaded ≠ applied. Not whole-internet home. |
| IPv6 / UDP / NIC | Do not loosen to buy speed. |
| No auto node-switch | Never change the selected node for the user. |
| Fast + stable | Same bar as Proton: barrier up quickly, session holds. Measure Service / WFP / TUN / DNS. Remove duplicate work. Do not lower timeouts. |
| Scope | Do **not** rewrite the whole connect system. |

Proton here is a **product analogy**, not sourced Proton internals. Public Proton docs we read: KS blocks if the tunnel drops; DNS forced into the tunnel; IPv6 blocked; they tell users to turn off browser Secure DNS. We have **not** proven their internal Connected timing. Do not claim “as fast as Proton” from unit tests.

Dump token `REALITY` = reqwest TUN HTTPS TLS fail, **not** Reality dest/SNI.

---

## 2. What this uncommitted tree already did

Review these files as they sit on disk, not `0cb5842`.

### 2.1 Admit (`connection/stages.rs` ~298–384)

Target sequence (implemented):

```
prepare this session's routing
  → start core, arm WFP
  → wait controller ready ∥ lock TUN   (parallel)
  → apply DNS, verify system fake-ip, verify lock (incl. tunnel_permit_rendered)
  → MarkVerified + mark_protection_committed
  → ConnectOk.outcome = "protectionReady"
  → Connected
```

Kept: `verify_fake_ip()`, `verify_locked()`, Service `MarkVerified`, `fsm.mark_protection_committed()`.
Gone: admit `mark_exit_verified()`, `exit_probe_pending = true`.
`/delay` is spawned advisory only (`spawn_advisory_exit_delay`).

`verify_locked` (`connection/probes.rs` ~321–325) now requires `wanted && live && Locked && tunnel_permit_rendered`, matching runtime `kill_switch_unhealthy`.

### 2.2 Auto 3-TLS off the lifetime

Deleted from automatic paths:

- Node switch 3-TLS + rollback (`connection/switch.rs`)
- DIRECT 3-TLS commit gate (`connection/direct.rs`)
- Monitor periodic `verify_tun_data_plane` await
- Service-unreachable “HTTPS proves we can keep the session”
- Combinator 4th argument `event_probe_failed`
- Entire `network_change_uses_probe_veto()` switch (must stay gone)

Combinator now (`connection_health.rs` ~162–168):

```
health_invalid || (event_invalidated && core_changed)
```

Adapter noise keep-session (`adapter_noise_keeps_session`): network counter bump, core unchanged, protection legs healthy → keep Connected, refresh pins, do not rebuild.

`verify_tun_data_plane()` still **exists** in `probes.rs` ~356. That is OK only as future **user-initiated diagnostics**. It must not write connect state. Auto paths must not call it (source tests assert this for stages/switch/direct/monitor).

### 2.3 Recovery reasons (`connection_health.rs` `RecoveryReason`)

Callers of `handle_network_change` now pass a reason. Logs are no longer one “切网重连” line.

| Reason | Intended behavior | Current code |
|---|---|---|
| Adapter noise, core/TUN/protection unchanged | Keep session | Done in monitor before calling recovery |
| Default physical exit actually changed | Reconcile routes/DNS; keep core if possible | **Not distinguished.** Windows counter bump without core/health change is treated as adapter noise. No GetBestRoute2. |
| Core exit / TUN identity | Keep lock, controlled rebuild | `CoreOrTunIdentity` → `tunnel_died` + `stop_core(false)` + `attempt()` |
| WFP / DNS protection failed | Repair immediately, no website probe | `ProtectionFailed` → same rebuild |
| Service IPC brief fail | Limited retry; HTTPS is not protection proof | Time hold via `IN_PLACE_RECOVERY_COOLDOWN` (120 s), then `ServiceUnreachable` rebuild |
| Service unobservable | Show protection unconfirmed, repair, do not auto-release lock | Rebuild under lock (`stop_core(false)`). Pill is Protected Offline during that, not a dedicated “unconfirmed” state. |
| Routing policy actually changed | Apply + read back; do not skip because old tunnel still fetches a site | `policy_sync.rs` → `RoutingPolicyChanged` → full rebuild |
| Signed WeChat path set / browser DNS | Rebuild | `DirectAppPathsChanged` / `BrowserDnsFailed` |

Single-flight: `TonoState.recovery_in_flight` CAS. Second caller merges.
Generation: checked before teardown, before `attempt()`, and on switch rollback.

**Important current shape:** `handle_network_change_inner` (`monitor.rs` ~731–830) **always** `tunnel_died` + restrict bootstrap + `stop_core(false)` + `attempt()`. It never returns `RecoveredInPlace`. In-place keep is only the adapter-noise branch and the Service cooldown `continue`. Policy change therefore always rebuilds the core (correct vs “HTTPS keep skipped the new policy”). A real default-route flap that is **not** a core/TUN identity change currently keeps the session and does **not** reconcile routes/DNS.

### 2.4 UI

- `ConnectPill.tsx`: Connected title/subtitle ignore `exitVerified` / `suggestedServer` (props kept, underscored unused).
- `dashboard.tsx`: no longer passes `exitVerified={true}`.
- Test: `connected stays Connected even when exitVerified is false`.

Delay and exit IP are still stored (`last_exit_delay_ms`, `exit_ip`) from advisory lookups. They are **not** yet a separate always-visible `—` row on the pill. If you want that, add a small independent fact, do not put it back on the main button.

### 2.5 Node switch (`connection/switch.rs` + `controller.rs`)

Hot path kept:

```
WFP widen old ∪ new
  → PUT Tono-Exit
  → GET now, must equal the written name   (controller.rs ~137–163)
  → close sockets bound to old exit
  → WFP shrink to new
  → emit
```

Write/readback fail → PUT previous + GET confirm. Confirm fail → cold switch, do **not** tell the UI it restored. Generation mismatch → return without rolling selector/WFP (newer owner owns the machine).

### 2.6 DIRECT this ship

`WINDOWS_OPTIONAL_DIRECT_ENABLED = false` (`direct.rs` ~121). Overlay is not installed.

`reconcile_direct_reload_failure` (`direct.rs` ~1018–1037) still asks Service for **Blocked** + empty DIRECT digest. That is **not** restore-this-session-full-tunnel. Log no longer claims “rolled back to full tunnel”. Do not re-enable the flag until rollback is:

```
keep protection, revoke temp DIRECT
  → restore this session's full-tunnel config
  → read back controller / core identity / routing
  → restore and confirm TUN permit
  → mark DIRECT off, main session continues
```

Home SOCKS5 is independent of this overlay. Keep them separate.

### 2.7 Home (unchanged this round)

`tono-core/src/config.rs` ~673–687: `Tono-Home-Residential` SOCKS5 with `dialer-proxy: Tono-Exit`, `udp: false`. Specified AI/process traffic only. General web stays on the selected VPS. No extra home admit probe.

### 2.8 Tests already green on this tree

From `apps/windows/app`:

```
cargo +1.98.1 test -p tono-windows --features clippy --lib -- tono::connection::tests
→ 88 passed
```

```
npx vitest run src/tono-ui/connect-pill.test.tsx
→ 9 passed
```

```
cargo +1.98.1 test -p tono-core --lib -- protected_connectivity
→ 7 passed
```

Named pins in `tono::connection::tests`: combinator has no TLS input; stages outcome `protectionReady`; `exit_probe_pending = false`; `verify_locked` requires `tunnel_permit_rendered`; monitor/switch/direct do not call `verify_tun_data_plane`; `event_probe_failed` / `network_change_uses_probe_veto` gone; selector PUT+GET; DIRECT flag false; recovery reasons distinct; recovery single-flight.

This Mac **cannot pack NSIS**. CDN 0.0.72 and older tester builds (`dns-latch`, `named-recommend`) are the old gate. Do not treat them as this tree.

---

## 3. Honest speed picture (do not overclaim)

Removing 3-TLS from **admit** (already in leak-closed) is what makes first Connected appear earlier vs `dns-latch` / CDN 0.0.72. Worst-case TUN HTTPS race was ~18 s (`TUN_DATA_PLANE_TIMEOUT`) and a fail FullReleased.

This round (monitor / combinator / pill / switch) does **not** shorten first-connect wall clock vs leak-closed admit. Remaining budget (`connection/transaction.rs` `CONNECT_BUDGET_LEGS`, 142 s worst, 240 s cap):

| Leg | Budget worst | Note |
|---|---|---|
| Service readiness | 3 s | Reuse vs cold start is the real question |
| StartClash #1 cold WinTUN + WFP | 60 s | Old dump ~10 s WFP; do not lower the Service budget |
| Controller ready | 15 s | Parallel with lock |
| Lock ladder | 10 s | Old dump ~3.8 s |
| securingDNS | 30 s | Comment still says PowerShell/CIM; live engine is `SetInterfaceDnsSettings` (`apps/windows/service/src/core/dns/engine.rs`) |
| fake-ip | 16 s | System `DnsQueryEx`, not 198.18.0.2-inside-TUN |
| lock verify | 3 s | 4 samples of decaying `live` cache |
| MarkVerified | 5 s | |

Warm connect is usually seconds to low tens, not 142 s. That is still not Proton. The bar **is** tap-and-in on this same KS+DNS path. This tree removed the exam that made us slow and jumpy; it has **not** yet made WFP/DNS/Service as short as they can be. Next work is measure those legs and delete duplicate install/apply/rebuild — still this product, not a later version.

What this round **does** improve toward “稳”: Connected stays up across NIC bursts; switch does not fail because Google is blocked; pill does not say “出口未验证 / 建议换节点”; Service blip is not “proven” by HTTPS. Fast on the remaining local path is still open.

---

## 4. Remaining holes (please confirm / rank)

These are the things to poke. File:line are for the uncommitted tree.

### 4.1 Speed (highest product value if measured first)

1. **Budget comment vs live DNS.** `transaction.rs` ~20 still accounts “PowerShell/CIM 30 s”. Service path is `SetInterfaceDnsSettings`. Measure real DNS apply on Win11 Home. If native apply is already ~1–2 s, the 30 s comment is scaring the wrong bottleneck.
2. **Cold vs warm Service / WFP.** First connect after install vs second connect. Hunt duplicate WFP install, duplicate StartClash, duplicate DNS apply. Reuse a healthy Service; do not reinstall filters every click.
3. **Lock ladder vs `verify_locked`.** Both sample decaying `live`. Possible double-wait. See `LOCK_ATTEMPTS` / `VERIFY_LOCK_ATTEMPTS`.
4. **No per-leg clocks in ConnectOk.** `ConnectOk.elapsed_ms` is one number. Next instrumentation should log: Service start/reuse, WFP install/verify, TUN appear, DNS apply, fake-ip, Connected publish. Cold / warm / switch separately.
5. **Do not** shrink `CONNECT_TRANSACTION_TIMEOUT`, lock retries, or fake-ip budget to “look faster”.

### 4.2 Recovery still coarse

6. **Default-route change vs adapter noise.** Spec wanted: if the physical default exit really changed, reconcile routes/DNS and keep the core. Code treats any counter bump without core/health change as keep-session (`monitor.rs` ~690–698). GetBestRoute2 was the documented follow-up and is not implemented. Risk: DNS/routes stale after a real Wi-Fi→hotspot change, UI still Connected.
7. **Every non-noise recovery stops the core.** `handle_network_change_inner` does not have an in-place repair path for “WFP/DNS broken but core identity unchanged”. Spec said protection fail → repair immediately; current repair **is** a full `attempt()` rebuild under lock. That is fail-closed but slow. A narrower WFP/DNS re-arm without `stop_core` would be faster **if** it can be proven locally (no HTTPS).
8. **Service unobservable UI.** After cooldown it still `tunnel_died` (Protected Offline) then reconnects. Spec also allowed “show protection unconfirmed” without auto-release. There is no dedicated unconfirmed Connected state.
9. **`RecoveredInPlace` is dead** for `handle_network_change_inner` (always `Handled`). Comments still talk about in-place TUN proof. Clean or reintroduce only for local reconcile, never HTTPS.
10. **Single-flight vs `schedule_reconnect`.** Flag clears when `handle_network_change_inner` returns, before a scheduled reconnect `attempt()` may run. Overlap possible.

### 4.3 DIRECT

11. Overlay off. Correct for this ship. `reconcile_direct_reload_failure` is still a Blocked-mode function. Re-enable only after real full-tunnel restore + readback. WeChat DIRECT is a later product; do not mix it into the speed cut.

### 4.4 Home

12. No proof in this cut that a newly assigned SOCKS5 is **applied** (catalog downloaded vs runtime loaded). UI must not say “走家宽” until the current session’s config contains that outbound. Configured-but-broken must fail closed on that split, not fall through to VPS as if unbound.
13. Do not add a home admit probe.

### 4.5 Leftover 3-TLS / exam UI

14. `verify_tun_data_plane` / `HealthLegs.probe` / `observe_probe` still exist. Fine as diagnostics counters; must not re-enter `invalid()` or recovery.
15. `ConnectPill` still accepts `exitVerified` / `suggestedServer`. Dead. Locales still have `connectedUnverified`. Safe to delete later; do not wire them back.
16. Advisory `/delay` and ipapi exit lookup still run. They must stay display-only. Missing → `—`, not unverified.

### 4.6 Switch

17. Selector readback is local controller GET, good. Rollback confirm is there. WFP shrink failure leaves old∪new permits (fail-closed, extra endpoints). Fine.
18. Cold switch still stops core. Hot path should stay the default.

### 4.7 IPv6 / leak

19. Mihomo `ipv6: false`. WFP has IPv6 default block (`apps/windows/service` wfp model). Do not open physical IPv6 to make connect “work”. Acceptance: IPv6 must not egress from the physical NIC while Connected.

---

## 5. Suggested next edits (for GPT/Claude to rank, not execute yet)

Prefer the smallest change that is measurable on a real Win11 box.

**A. Instrumentation only (do this before any timeout/WFP rewrite)**  
Log the five local timestamps on ConnectOk (and on switch complete). Cold / warm / node-switch. Without this, “make it as fast as Proton” is guessing.

**B. Kill duplicate local work**  
If warm connect still does a full WFP reinstall or a 30 s DNS path, that is the win. Reuse Service + already-locked filters when identity is unchanged.

**C. Default-route reconcile without HTTPS**  
If you add GetBestRoute2 (or equivalent), it must only trigger route/DNS readback. It must **not** call `verify_tun_data_plane`. If the default exit did not change, keep the session.

**D. Protection repair without core death**  
Only if A shows `stop_core` + StartClash dominating recovery. Re-arm WFP/DNS, confirm `tunnel_permit_rendered` + fake-ip, keep the same core pid. Generation still required.

**E. Do not** re-enable DIRECT, add 3-TLS make-up exams, fake `exitVerified=true`, lower lock/DNS timeouts, skip fake-ip, open IPv6, or skip the home `dialer-proxy` chain when `homeSocks5` is assigned.

---

## 6. Acceptance the next cut must still pass

- Kill switch stays armed after Connected; core death does not FullRelease.
- System DNS on fake-ip; unique-adapter apply fail refuses Connected; IPv6 not from physical NIC.
- 3-TLS all fail: still connect, still hot-switch.
- Repeated NIC notifications: do not restart core.
- Assigned home: specified AI traffic is `VPS → SOCKS5`, not VPS-only and not whole-internet home. Unassigned: VPS only. Broken assignment: do not pretend unbound.
- DIRECT still off, or real rollback (no Blocked-as-full-tunnel lie).
- Version stays `0.0.72`.
- No secrets in the review.

---

## 7. Files to read (uncommitted)

| Path | Why |
|---|---|
| `connection/stages.rs` | Admit sequence, `protectionReady` |
| `connection/probes.rs` | `verify_locked` + leftover `verify_tun_data_plane` |
| `connection/monitor.rs` | Adapter noise, Service hold, recovery always rebuilds |
| `connection_health.rs` | Combinator, `RecoveryReason`, single-flight |
| `connection/controller.rs` | Selector PUT+GET |
| `connection/switch.rs` | Hot switch + confirmed rollback |
| `connection/direct.rs` | Flag false; Blocked reconcile |
| `connection/transaction.rs` | 142 s budget table |
| `policy_sync.rs` | Policy → `RoutingPolicyChanged` |
| `state.rs` | `recovery_in_flight` |
| `ConnectPill.tsx` + `connect-pill.test.tsx` + `dashboard.tsx` | Main button |
| `tono-core/src/config.rs` ~673–687, `ipv6: false` | Home chain, no IPv6 |
| `apps/windows/service/src/core/dns/engine.rs` | Native DNS apply |

---

## 8. Return format

Proton is fast **and** leak-closed. Score both. A faster leak is a fail. A leak-closed 15 s connect is also not done.

1. **Protection blockers** — any path that can leak real IPv4/IPv6, leak DNS to the ISP, drop the lock on core death, or skip `tunnel_permit_rendered` / fake-ip. `file:line`.
2. **Home chain** — assigned `homeSocks5` must be `客户端 → Tono-Exit → Tono-Home-Residential`. Unassigned must not invent a hop. Broken must not silently unbound. Downloaded vs applied. TCP-only Claude pins (UDP to physical is a leak).
3. **Fast** — ranked remaining **local** time (Service / WFP / TUN / DNS). What duplicate work to delete so this same barrier comes up faster. Guessing “cut the lock timeout” or “skip KS” is a reject.
4. **Stable** — recovery coarseness, default-route vs noise, generation, single-flight, “every recovery stops the core”. 3-TLS must stay off the control plane.
5. **Nits** — dead comments (`RecoveredInPlace`, PowerShell/CIM budget), unused pill props.
6. **Do not** propose a connect-system rewrite, a version bump, packing, re-arming `network_change_uses_probe_veto`, whole-internet home, loosening IPv6/UDP/physical NIC, or “ship protection now, speed later”.

If a claim needs a Windows box (WFP wall-clock, NSIS, live home SOCKS5), mark it `unverifiable here` instead of inventing a number.
