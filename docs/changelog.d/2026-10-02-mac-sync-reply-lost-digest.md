## 2026-10-02 · macOS：`/core/sync` 应答丢失后不再沿用旧的「已安装文档」记录
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState.reloadCoreConfig`）。
- 来源：基线 `ecdc3f96` → 分支 `fix/mac-sync-reply-lost-digest`，PR #1342；尚未合入 main。
- 缺陷修复：helper 处理 `/core/sync` 时先换 Core 再应答。pins 刷新的应答丢失（超时、空应答、无效应答）时会话保留，
  App 记的已安装文档摘要还是旧的一份；之后内容相同的完整 reload 判定「没有变化」而跳过，实际运行的是另一份文档。
  现在应答丢失时把记录置为未知，下一次完整 reload 照常替换。关联 MAC-SYNC-REPLY-LOST-DIGEST。
- 新增/优化：无。helper 明确拒绝、请求没送到 helper 时记录不变，不多重启 Core。
- 工程与测试修正：`PinRefreshKeepSessionTests.testPinsRefreshWithALostSyncReplyForgetsTheInstalledDocument`
  先单独推送（红），结果记在 PR。
- 验证：仅托管 CI；未在实机上制造 helper 应答丢失。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1342，merge commit `8006e57e`，PR 头 `995f0684`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37027746080 。
- 独立评审：Codex `gpt-6.1-sol`（high），两轮均无 major；两个 minor 未修，记在 finding；记录在 https://github.com/raydocs/tono/pull/1342#issuecomment-5955746282 。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
