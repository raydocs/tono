## 2026-10-02 · Windows：连接中可以取消
- 归属：SHIP_PLAN §2 第 10 项；Windows App 界面（`pages/tono/dashboard.tsx`）。
- 来源：基线 `cc673eaa` → 分支 `fix/win-connecting-cancel-20261002`，PR #1356；已合入 main（见文末续记）。
- 缺陷修复：主界面连接中原先没有任何取消入口（事务预算 310 秒）。现在连接按钮下方有独立的「取消连接」按钮；已持有保护屏障时先确认。所有者决定加取消。关联 WIN-CONNECTING-NO-CANCEL。
- 新增/优化：文案 `tono.dashboard.cancelConnecting`（中、英）。后端不变，沿用托盘断开在连接中的既有路径。
- 工程与测试修正：回归 `cancels a live attempt from its own control, not from the pill` 先单独推送为 `e17105cd`（红），结果记在 PR。原测试里「没有任何 Cancel 按钮」的断言改为「主按钮不是取消」。
- 验证：本机 vitest `dashboard.test.tsx` 25 通过、`tsc --noEmit` 通过、eslint 通过；托管 CI 见 PR。未在 Windows 实机上验证。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1356，merge commit `8b75c5ff`，PR 头 `4fc1b770`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37066557704 。红测试 `e17105cd`：run 37065128873（`windows / app` vitest `1 failed | 315 passed`，只有 `cancels a live attempt from its own control, not from the pill` 失败）。
- 独立评审：普通风险（只加界面入口），主会话核对 diff；未做独立评审。合并前 0 个未解决的评审线程。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
