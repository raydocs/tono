## 2026-10-10 · Windows 登录在保护下可用，中继失败有独立反馈
- 归属：SHIP_PLAN G2；有限 UIUX 2/3/4 的登录收口，完整候选包验收仍在之后。
- 来源：生产 UI 基线 [2ad39dba](https://github.com/raydocs/tono/commit/2ad39dba3446cc9673d557314c76cb371ac89feb) → [3e3a17336](https://github.com/raydocs/tono/commit/3e3a173361340f9880f2a870ae3b2b9a0b08538f)；`amp/login-relay-feedback-ui`，本 PR；尚未合 main。#1478 旧 transport 实现未移植，未关闭其草稿。
- 缺陷修复：决策 091 下保护开启不应阻止邮箱/发送/验证/重发与自动验证；只去掉前端的 `internetBlocked` 门禁，保留验证、冷却、IO 锁和显式恢复操作。已知/未知保护照旧取真实状态证据；不隐式释放保护。见 `WIN-LOGIN-RELAY-GATE`。
- 新增/优化：只有 `TONO_RELAYS_UNREACHABLE` 才解释备用线路不可达、检查网络或稍后重试；无标记仍用既有通用反馈。渐进展开三个中继的编号/失败分类，说明分类不是网络诊断，复制给客服只保留白名单；原始 URL/token/端点/设备 ID 不进详情。恢复网络为可选次要操作，解除保护和前会话替换代价不隐藏。
- 工程与测试：沿用合成 shell 增加有界 authDelay/relaysDown；生成三个新 i18n 类型键，不改传输语义。归档 [一张 before、十二张 after](../screenshots/windows-login-relays-2026-10-10/README.md)，after 同一源码 SHA、Linux Chromium DPR2，并非原生真机。
- 验证：新 relay-only UI 回归先失败，再运行 `vitest run src/pages/tono/login.test.tsx src/pages/tono/login-support.test.tsx --maxWorkers=1` 输出 2 files /17 tests passed；`pnpm typecheck` 输出 `unchecked indexed access errors 69 (baseline 79)`，预算未改；定点 ESLint exit0/零 warning。浏览器实际执行 pending/拒码/重试，Enter 展开和 Tab 到客服按钮使内层 main 滚动，英/中按钮完整进入视口、无横向溢出。详见截图 README；不是 native 保护验收。
- 候选/发布：仅源码/图像，无新候选、无签名设备验收、无客户发布。
- 剩余限制：准确 head CI/Sol 和主线程视觉审核仍为合并条件，不能自签核或提前合并。真实 Windows Service/WFP、旧版 Service、控制面故障/恢复和全组合包留待设备验收。

### 2026-10-10 · #1553 合入后的 rebase 续记
- #1553 已合入 [62bab6ed](https://github.com/raydocs/tono/commit/62bab6ed59941026da280d02598682ccd623a4cf)；#1554 的四个提交无冲突 rebase，`git range-diff` 四项均为 `=`。已读实际 native 前缀/编号/分类格式，与 UI 契约一致；没有修改或移植 native transport。
- Linux 同一定点 login/support 命令重新执行，原始输出 `Test Files 2 passed (2)`、`Tests 17 passed (17)`。截图来源保留原捕获 SHA，不把 rebase 称为重拍；后续类型/lint/CI 的准确 head 证据记在 #1554，不能把本条当签核。
- 按主线程最新安排：准确 pushed head ci-gate 绿后 Ready，主线程送 Sol、做视觉审核并合并。#1555 独立 transport 续修与 #1478 的 full-walk「Paths tried」/逐路径耗时不属于本轮。

### 2026-10-10 · 既有 auth-guard 回归同步决策 091
- 工程与测试修正：[CI 38094468122](https://github.com/raydocs/tono/actions/runs/38094468122/job/114337468280) 在 [866c26734](https://github.com/raydocs/tono/commit/866c26734a35e5698dd74c9ce9de1f2dd76c419a) 的 PR merge checkout `5360ad4969a01d38c681c8dc542750e6299893ec` 输出 `1 failed /406 passed`，唯一失败为 `tono-auth-guard.test.tsx:328` 仍要求保护下禁用 Send code。本地同场景复现 `expected false to be true`，不是 typecheck 或 native transport 失败。
- 将该既有集成测试改为断言保护下邮箱和 Send code 可用、点击 Restore 前无释放；保留显式 Restore 后的操作/重读，以及相邻恢复失败、authenticating 状态推送断言。没有删测试、跳过断言或改生产代码；仅同步已授权的 UI 合约并增加保护边界检查。
- 修正后 Linux `pnpm --dir apps/windows/app test` 原始输出 `Test Files 58 passed (58)`、`Tests 407 passed (407)`；`pnpm typecheck` 输出 `unchecked indexed access errors 69 (baseline 79)`；该文件 ESLint exit0/零 warning，格式化与 diff-check 通过。新 pushed head 的 CI 尚待，旧失败如实保留；十三张 PNG 和生产源码未改，仍为原捕获 SHA。
