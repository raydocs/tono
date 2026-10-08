| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | Normal macOS Quit fully releases the selective AI hold, requiring reconciliation with the current stop safety requirement | fixed(53676e913) | 修复 [#1445](https://github.com/raydocs/tono/pull/1445)；decision 073 provisional | 高·已确认（P1，代码路径） | 本轮普通 Quit 武装/retain-ai 保留窄层，显式 Disconnect/Restore 完全释放并优先于重叠 Quit；次启可观察/移除。已合 main 53676e913（#1445，经 merge queue 的 ci-gate、Jev PASSED）；原生 PF/DNS 实机留 G1/G2。 |

Reverified on `origin/main` **72a9c98db24f5b3f5ad30a1be7191ce17a0df0be**.
Ownership: SHIP_PLAN §2 item 10. This is the previously reported M5/M7 finding,
recorded for policy reconciliation rather than reported as a new independent bug.

An ordinary successful Quit, with no pending native update, reaches
[AppDelegate.swift:350](https://github.com/raydocs/tono/blob/72a9c98db24f5b3f5ad30a1be7191ce17a0df0be/apps/macos/Tono/App/AppDelegate.swift#L350).
It drains runtime teardown, then calls `disconnectAndWait(releaseKillSwitch: true)`.
After proving Core stop and DNS restoration,
[AppState+Connect.swift:970](https://github.com/raydocs/tono/blob/72a9c98db24f5b3f5ad30a1be7191ce17a0df0be/apps/macos/Tono/Services/AppState%2BConnect.swift#L970)
calls `networkProtection.disarm`. The production boundary is
`NetworkProtectionOperations.swift:23` → `PrivilegedRuntimeCoordinator.swift:165`
→ `Services/KillSwitchService.swift:332–333` →
[HelperManager.swift:871](https://github.com/raydocs/tono/blob/72a9c98db24f5b3f5ad30a1be7191ce17a0df0be/apps/macos/Tono/Core/HelperManager.swift#L871)'s
bodyless `POST /killswitch/disarm`.

[SocketServer.swift:517–524](https://github.com/raydocs/tono/blob/72a9c98db24f5b3f5ad30a1be7191ce17a0df0be/tooling/scripts/core-helper/SocketServer.swift#L517)
calls `killSwitch.disarm()` and clears the session owner without a selective
follow-up. [KillSwitchManager.swift:577–585](https://github.com/raydocs/tono/blob/72a9c98db24f5b3f5ad30a1be7191ce17a0df0be/tooling/scripts/core-helper/KillSwitchManager.swift#L577)
releases PF and persisted intent, then removes the AI resolver sinkholes and
Anthropic prefix blackhole routes. Thus Quit neither installs an AI floor for a
connected session nor preserves a floor already installed by crash recovery.
The launch-time fallback at `AppDelegate.swift:356` uses the same full disarm.
The watchdog does not repair this after a successful release: its selective
application requires the now-deleted state file (`SocketServer.swift:250–268`).
The successful path requires no second failure or timing race. No installed-device
reproduction or proof of actual AI traffic exposure is claimed.

The exception is deliberate. [selective-fail-open.md:101](../selective-fail-open.md)
says: “用户明确断开：回到原来的网络，不留下 AI 拦截。” Explicit Disconnect
returns the original network without leaving AI blocking. This appears under the
proposed state machine, but the implemented helper and its existing self-test
codify the same choice: `.restoreOrDisconnect` maps to `.remove`
(`SelectiveFailOpen.swift:60–65,112–116`).
[Decision 036](../decisions/036-2026-09-30-crash-hang-releases-then-ai-layer.md)
requires ordinary network availability first and preserves Restore network's full
release. Neither that decision nor the other current decision records explicitly
redefines user-requested Quit.

Windows connected explicit Quit is the same full-release policy:
`commands/quit.rs:331` calls `connection::release_explicit`,
`connection/disconnect.rs:90` requests `apply_narrow=false`, and
`windows_kill_switch.rs:2939` calls `release_with(false)`.
`selective_fail_open.rs:71` also maps `RestoreOrDisconnect` to removal.
PRs [#974](https://github.com/raydocs/tono/pull/974),
[#976](https://github.com/raydocs/tono/pull/976),
[#978](https://github.com/raydocs/tono/pull/978),
[#1003](https://github.com/raydocs/tono/pull/1003), and
[#1010](https://github.com/raydocs/tono/pull/1010) cover automatic recovery paths;
they do not establish an AI hold for connected explicit Quit.
Automatic Service stop has a separate disposition (`windows_kill_switch.rs:2960–2967`).

**Decision required:** does the current requirement to retain AI blocking on
“stop” include explicit Quit, and should explicit Disconnect retain its existing
full-release exception? If Quit must retain the floor, its helper request needs
a distinct release disposition that reuses the existing selective installer.
Explicit Restore network and strict-mode semantics must remain intact, and the
ordinary network must remain available. The assigned slot expressly forbids a
runtime change when the documented explicit Disconnect exception exists, so this
PR changes only records and stays out of auto-merge.

Verification: exact source trace and two independent read-only audits. Swift,
XCTest, helper self-tests and native PF/DNS testing are unavailable on this Linux
host; no new runtime test is appropriate for a docs-only unresolved decision.
No helper source or contract changed; no protocol bump or contract regeneration.

Rejected hypotheses: the watchdog reinstates the AI hold after successful Quit
(its state-file guard prevents that), and Windows connected explicit Quit already
uses an AI-preserving disposition (it passes `false`; automatic stop is separate).

2026-10-07 续修：上述原始源码追踪保留为历史。当前实现依据 [decision 073](../decisions/073-2026-10-07-normal-quit-retains-ai-floor.md)，原 `Decision required` 已以 provisional 严格选择回应，并非 owner 实机验收。
