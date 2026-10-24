## 2026-10-24 · Display follows user intent and generation, not the later tunnel event
- Status: provisional
- Chosen: a user intent (disconnected, signed out, stopping) stays on screen until a later intent or a new connect attempt in the same session generation replaces it. A later tunnel report of "not running" or "failed" must not. Failures carry `{source, generation, at}`. `coreStopped` must know whether this process is already stopping; a user stop never writes a failure. `403 PLAN_EXPIRED` / `403 QUOTA_EXHAUSTED` keep the account, tokens and VPN profile, revoke only the network grant, and show renew / contact family. `403 DEVICE_REAUTH_REQUIRED` keeps the account and profile, asks the user to verify again, and does not auto-connect. Explicit revoke, disabled and expired credentials stay `401` and end the session. `429 RATE_LIMITED` does not sign out and does not delete unsent reports. A failed or rolled-back path updates the same baselines, owner flags and UI state the success path updates, or it clears them. Rejected: last-write-wins on `beatAt`, mapping plan or quota exhaustion to logout, and leaving a rollback's new process identity unread (`let _ =`).
- Why stricter: this does not widen PF, WFP, TLS, account isolation or the kill switch. Ordinary traffic stays fail-open unless the user has armed a strict kill switch ([RELEASE_READINESS](../RELEASE_READINESS.md)). An account hold stops presenting the device as signed out; it does not keep an exit credential after T6 has revoked the network grant. A user disconnect is not stored as a core failure, so the UI cannot offer Retry for a stop the user asked for.
- Applied in: `fix/t8-state-rule` (`134-2026-10-24-state-intent-rule.md`). Account codes are [PR 1738](https://github.com/raydocs/tono/pull/1738) head `429e23427` (contract introduced `3205b5c76`), file `docs/control-plane-error-contract.md` on that branch. This decision does not copy that file and does not edit that branch. Decision 133 is that PR's account-entitlement file; this one is 134 so the numbers do not collide.

## 2026-10-24 · 显示跟着用户意图和代次走，不跟着更晚的隧道事件走
- 状态：provisional
- 选定：用户意图（已断开、已退出、正在停止）一旦记下，后来的隧道“未运行 / 失败”不能改画面。只有同会话里更新的用户意图，或新的一次连接尝试，才能盖过它。失败带 `{source, generation, at}`。`coreStopped` 必须知道当前是不是自己在停；用户发起的停止不写 failure。`403 PLAN_EXPIRED` / `403 QUOTA_EXHAUSTED` 保留账户、令牌和 VPN 配置，只撤销网络授权，画面是续费或联系家人。`403 DEVICE_REAUTH_REQUIRED` 保留账户和配置，请用户重新验证，不自动连接。显式撤权、停用、过期凭据仍是 `401`，会话结束。`429 RATE_LIMITED` 不登出、不删未发送的报告。失败或回滚要更新成功路径会更新的基线、owner 和界面状态，或者明确清掉。否决：用 `beatAt` 谁晚谁赢、把套餐或额度问题当成登出、以及 `let _ =` 丢掉新进程身份。
- 为何更严：不放宽 PF、WFP、TLS、账户隔离或 Kill Switch。用户没开严格 Kill Switch 时，普通流量仍 fail-open（[RELEASE_READINESS](../RELEASE_READINESS.md)）。账户暂停不再显示成已登出，也不在 T6 已撤销出口凭据之后继续提供 VPN。用户断开不会被存成 core 失败，界面就不能对用户自己的停止给出“重试”。
- 落地：`fix/t8-state-rule`。账户码以 [PR 1738](https://github.com/raydocs/tono/pull/1738) head `429e23427`（契约首提交 `3205b5c76`）为准，文件在该分支的 `docs/control-plane-error-contract.md`。本决策不复制该文件，也不改那条分支。133 是该 PR 的套餐暂停决策；本文件用 134，避免撞号。

The machine table is [state-intent-scenarios.json](../contracts/state-intent-scenarios.json). The same file is the fixture for the iOS TonoKit, Android engine JVM, macOS TonoTests and Windows `tono-core` contract tests. A row's `enforcement` is `enabled` when a product probe already matches, `expected-failure` when the probe still disagrees (the test goes red when the product starts matching, until the flag flips), or `todo` when this thread has no probe. Todo is not a pass.

机器表在 [state-intent-scenarios.json](../contracts/state-intent-scenarios.json)，四端契约测试读同一份。`enabled` 是现有探针对得上；`expected-failure` 是探针仍不一致（产品一旦对上，测试会变红，直到把标志改成 enabled）；`todo` 是本线程没有探针。todo 不是通过。

### Rules / 规则

1. Intent first / 意图优先. A recorded user intent survives any later tunnel-side "down" or "failed" from that same generation. Wall-clock time is only a tiebreak inside one generation.
2. Failure source / 失败带来源. `{source: user|system|core|network|account, generation, at}`. A user stop writes no failure.
3. Account hold is not an auth failure / 账户状态不是认证失败. Plan, quota and rate limit do not become logout and do not delete the VPN profile. Copy is renew or contact family. After renewal, `DEVICE_REAUTH_REQUIRED` restores nothing by itself.
4. No silent no-op / 主按钮没有静默空操作. Connect, retry and mode switch end in progress, success, or a stated reason.
5. Internal codes stay off the screen / 内部错误码不直接给用户看. Map them to words and a next button. The allowlist of current renders is [state-intent-error-code-allowlist.json](../contracts/state-intent-error-code-allowlist.json). New renders fail the scan. Android's current renders are T3's; iOS HomeView's are T1's.
6. Generation, not timestamps / 代次，不比时间戳. Snapshots carry session and generation. Compare generation across attempts. `beatAt` only orders events inside one generation.
7. Failure updates the same facts as success / 失败路径和成功路径对等. Core PID baseline, desired / active owner, and flags such as `nativeUpdateBlocksConnect` move on the failure path too, or are explicitly cleared. Do not discard a new process identity with `let _ =`.

An unobservable process death (jetsam with no stop write) may stay last-known only until the freshness window. It must not stay "protected now", and it must not be labeled as the user's disconnect. Once the platform knows the process died, the display is a system failure.

进程死亡如果当时看不出来（jetsam 没有停写），只能在新鲜窗口内显示“上次已知”，不能继续显示“正在保护”，也不能标成用户断开。一旦知道进程没了，就是系统失败。

### Scenario table / 场景表

One expectation for every platform. The owner column is who makes the product match. T2 (iOS account) and T3 (Android) adopt PR 1738's codes; this thread does not implement those clients. T4 owns macOS 429 and the new code names. T5 owns Windows, including the DIRECT rollback baseline.

四端同一期望。owner 是把产品改到符合期望的线程。T2、T3 接入 1738 的错误码；本线程不改那两端的账户实现。T4 负责 macOS 的 429 和新码文案。T5 负责 Windows，包括 DIRECT 回滚的 PID 基线。

| id | display | notification | button | session | VPN profile | notes |
|---|---|---|---|---|---|---|
| user-disconnect | off | none | connect | kept | kept | Later `CORE_STOPPED` must not show "connection dropped" or Retry. iOS probe is expected-failure (`SharedStatus.governs`). Android ledger stop to idle is enabled. |
| system-revoke | needs-permission | permission-revoked | open-settings | kept | kept | OS consent / `onRevoke`, not T6 entitlement suspension. Android phase probe is enabled. |
| core-crash | failed | core-crashed | retry | kept | kept | source `core`. iOS shared-status probe is enabled. |
| jetsam-or-process-killed | failed | process-killed | retry | kept | kept | Once observed. iOS `TunnelStop.classify` is enabled. |
| network-lost | failed | network-lost | retry | kept | kept | source `network`. Not a user disconnect. Probe todo. |
| sign-out | signed-out | none | sign-in | ended | removed by the sign-out itself | A later stopped tunnel must not show "off" plus Connect. iOS probe is expected-failure. |
| plan-expired | account-hold | plan-expired | renew | kept | kept | HTTP 403 `PLAN_EXPIRED`. Network grant revoked. No auto-connect. Not logout. Display probe expected-failure on iOS and Android; `isSessionEnded` is already false for this code. |
| quota-exhausted | account-hold | quota-exhausted | renew | kept | kept | HTTP 403 `QUOTA_EXHAUSTED`. Same hold as plan-expired. |
| device-reauth-required | reauth | reauth-required | verify-login | kept | kept | HTTP 403 `DEVICE_REAUTH_REQUIRED` after renewal. Do not auto-connect. |
| explicit-credential-revoke | signed-out | signed-out | sign-in | ended | follows sign-out | HTTP 401 `UNAUTHORIZED` or `INVALID_REFRESH_TOKEN`. Disabled and expired credentials stay on this row. Probe enabled. |
| rate-limited | limited | rate-limited | retry | kept | kept | HTTP 429 `RATE_LIMITED`. Do not delete unsent reports. Honor `Retry-After`. Probe enabled for "not signed out". T4/T5 own desktop copy and the outbox. |
| recovery-success | connected | recovered | disconnect | kept | kept | The previous failure is cleared. Live bug is iOS `AppModel` keeping the old failure; no TonoKit probe, so todo. |
| retry-without-catalog | catalog-missing | catalog-missing | retry | kept | kept | The button must say why. Not a silent no-op. T2. Probe todo. |
| cancel-then-late-start | off | none | connect | kept | kept | A start from the cancelled generation must not come up. Android ledger probe is enabled. iOS is T1, todo here. |
| recheck-while-connected | connected | none | disconnect | kept | kept | A recheck must not demote the visible phase to a fresh connect. iOS `ConnectionState.derive` and Android `TunnelLedger.rechecking` are expected-failure. |
| optional-rollback-failed | failed | rollback-failed | retry | kept | kept | source `core`. Baseline and owner match the process that is actually running, or are cleared. Not shown connected. Android's failed reload is enabled. Windows PID baseline is T5, todo here. |
| network-restored-update-retired | ready | none | connect | kept | kept | Connect works when the pending update was retired. The known latch is macOS `nativeUpdateBlocksConnect`. T4. Probe todo. |
| network-restored-update-still-pending | update-pending | update-still-pending | explain-blocked | kept | kept | Connect stays blocked, with a reason. Not a silent no-op, and not "ready". |

### Not in this change / 本变更不做

- No edit to `docs/agent-reports/2026-10-19-ios-r12-receipts/stubs/LibboxStub.swift`. That receipt is hashed (`stubs/LibboxStub.swift` in `SHA256SUMS`). `LibboxNewStandaloneCommandClient()` returns nil there, so filling in `serviceClose()` would not replay `serviceStop` and would rewrite sealed evidence. T1 owns the one live test double.
- No client fix for T1–T5. Those threads change the product. This thread locks the rule and the probes.
- No feed, migration, signing or deploy change.

不改 r12 收据里的 `LibboxStub.swift`（`SHA256SUMS` 已封存）。那里的 `LibboxNewStandaloneCommandClient()` 返回 nil，补上 `serviceClose()` 也不会重放 `serviceStop`，还会改掉封存证据。活的测试桩只改一次，归 T1。

不替 T1–T5 修产品。本线程只锁规则和探针。

不改 feed、migration、签名或部署。
