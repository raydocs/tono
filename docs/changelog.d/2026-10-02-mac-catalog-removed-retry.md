## 2026-10-02 · macOS：重试期间所选出口被移除不再卡在全阻断
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState+Catalog.installManagedExitCatalog`）。
- 来源：基线 `f7279dd9` → 分支 `fix/mac-catalog-removed-retry`，PR #1341；尚未合入 main。
- 缺陷修复：会话断开后处于「保护中，未连上」并在自动重试（或唤醒恢复）时，新目录移除了所选出口。
  没有家宽默认出口的账号被置为「需要手动选择」，重试循环在下一次尝试时直接结束，PF 继续全阻断，
  之后没有任何自动动作。现在：目录里还有出口就换到默认出口并继续原来的重试，PF 不变；一个出口都不剩
  就按既有的移除结算恢复普通网络并保留 AI 阻断（决定 031），再提示选择。发现 MAC-CATALOG-REMOVED-RETRY-STUCK。
- 新增/优化：无新文案；空闲未武装、已暂停等待用户、已连接和连接进行中的行为不变。
- 工程与测试修正：`CatalogRemovedExitTests` 两条回归（有幸存出口继续重试；无幸存出口恢复网络）
  先单独推送为 `8ab893b8`（红），结果记在 PR。
- 验证：仅托管 CI；未在实机上触发目录移除。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1341，merge commit `373e7316`，PR 头 `931a7c5c`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37025595739 。
- 独立评审：Codex `gpt-6.1-sol`（high），第一轮一个 major 和一个 minor 已修，第二轮无 major，剩一个 minor 记在 PR 限制里；记录在 https://github.com/raydocs/tono/pull/1341#issuecomment-5955439163 。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
