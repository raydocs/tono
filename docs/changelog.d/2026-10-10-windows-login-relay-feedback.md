## 2026-10-10 · Windows 登录在保护下可用，中继失败有独立反馈
- 归属：SHIP_PLAN G2；有限 UIUX 2/3/4 的登录收口，完整候选包验收仍在之后。
- 来源：生产 UI 基线 [2ad39dba](https://github.com/raydocs/tono/commit/2ad39dba3446cc9673d557314c76cb371ac89feb) → [3e3a17336](https://github.com/raydocs/tono/commit/3e3a173361340f9880f2a870ae3b2b9a0b08538f)；`amp/login-relay-feedback-ui`，本 PR；尚未合 main。#1478 旧 transport 实现未移植，未关闭其草稿。
- 缺陷修复：决策 091 下保护开启不应阻止邮箱/发送/验证/重发与自动验证；只去掉前端的 `internetBlocked` 门禁，保留验证、冷却、IO 锁和显式恢复操作。已知/未知保护照旧取真实状态证据；不隐式释放保护。见 `WIN-LOGIN-RELAY-GATE`。
- 新增/优化：只有 `TONO_RELAYS_UNREACHABLE` 才解释备用线路不可达、检查网络或稍后重试；无标记仍用既有通用反馈。渐进展开三个中继的编号/失败分类，说明分类不是网络诊断，复制给客服只保留白名单；原始 URL/token/端点/设备 ID 不进详情。恢复网络为可选次要操作，解除保护和前会话替换代价不隐藏。
- 工程与测试：沿用合成 shell 增加有界 authDelay/relaysDown；生成三个新 i18n 类型键，不改传输语义。归档 [一张 before、十二张 after](../screenshots/windows-login-relays-2026-10-10/README.md)，after 同一源码 SHA、Linux Chromium DPR2，并非原生真机。
- 验证：新 relay-only UI 回归先失败，再运行 `vitest run src/pages/tono/login.test.tsx src/pages/tono/login-support.test.tsx --maxWorkers=1` 输出 2 files /17 tests passed；`pnpm typecheck` 输出 `unchecked indexed access errors 69 (baseline 79)`，预算未改；定点 ESLint exit0/零 warning。浏览器实际执行 pending/拒码/重试，Enter 展开和 Tab 到客服按钮使内层 main 滚动，英/中按钮完整进入视口、无横向溢出。详见截图 README；不是 native 保护验收。
- 候选/发布：仅源码/图像，无新候选、无签名设备验收、无客户发布。
- 剩余限制：#1553 尚未合入；需依赖合入后 rebase、准确 head CI/Sol 和主线程视觉审核，不能自签核或提前合并。真实 Windows Service/WFP、旧版 Service、控制面故障/恢复和全组合包留待设备验收。
