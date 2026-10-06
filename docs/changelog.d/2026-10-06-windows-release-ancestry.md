## 2026-10-06 · 归并 Windows 发布线旧历史，为 0.0.75 同源冻结准备
- 归属：SHIP_PLAN G4.1、RELEASE_LINES 的 release/windows 快进约束；非 UI 功能。
- 来源：main `9b5cf144` 正常合并 release/windows `86d9539a`（旧 PR #663）；main 已通过 `06cd285e` 移植相同 TUN 路由等待行为。本 PR 只补齐祖先关系，不重写任一发布线。
- 缺陷修复：无新运行时修复；避免发布线无法快进到最终冻结 SHA 的工程阻塞。
- 新增/优化：无。不使用 ours 策略、不 force-push、不丢弃 release/windows 历史。
- 工程与测试：正常 merge 仅有同名 changelog 的 add/add 冲突；保留 main 的详细移植/限制记录，并追加历史归并说明。
- 验证：MacBook `git diff --cached --name-only HEAD` 仅列两个 docs/changelog.d 文件；相对 main 基线没有 apps/services/tooling/.github 的代码、配置或流程改动。原生测试未运行；文档/历史整合无需重复产品测试，仍须 exact-head ci-gate。
- 候选/发布：仅历史与文档，无新候选、不推进客户更新源。
- 剩余限制：归并不等于 #663 真机验收；须先完成 #1379/#1386/#1395/#1400，再由 #1399 冻结最终 0.0.75 同源候选。
