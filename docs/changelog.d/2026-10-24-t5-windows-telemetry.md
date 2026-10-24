## 2026-10-24 · Windows 429 重试与独立 P0 outbox（T5 首批）
- 归属：SHIP_PLAN §2 item 10 稳定性缺陷修复；Windows 客户端诊断。T5 全范围尚未完成。
- 来源：`origin/main` `322f48c6f` → `eef0b68ac`；分支 `fix/t5-windows`，未合 main。
- 缺陷修复：429 不再删除/丢弃报告，保留并推进既有有界退避；P0 不再被普通报告积压淘汰，按 kind+body 确认/延期；保留旧混合队列 P0 与诊断关闭时的保留行为。
- 新增/优化：P0 独立文件及 32 条/256 KiB 容量，优先 drain；同步文件事务互斥，避免并发生产者覆盖。没有第二条网络上传路径。
- 工程与测试：portable tono-core integration test 引用生产 outbox 源码；测试目录加原子序号以免并行同一墙钟时间碰撞。
- 验证：`22419bce6` RED（3 pass/2 fail）→ `eef0b68ac` GREEN（7 pass），命令/原始输出及未验证范围见 [T5 报告](../agent-reports/2026-10-24-t5-windows/README.md)。本机 rustc 1.97.1 使用 `--ignore-rust-version`，不替代 Windows Rust 1.98 CI。
- 候选/发布：仅源码，无新候选、签名或部署；无 feed/migration/部署脚本变更。不自动合并。
- 剩余限制：上行宽限、resume receipt、DIRECT 回滚基线及 Service owner 退休尚未修复；可选 P2 留待后续。#1668/#1733 只读检查，Win10/11 验收由编排者负责。

### 2026-10-24 · T6 契约接入续记
- `c5519957e` 两项真实 RED（丢 Retry-After 元数据、重试早于服务端期限）→ `5eacf5be5` 修复。429 元数据贯穿 HTTP transport/ApiResponse/ApiError，初次保存与 outbox drain 都遵守 Retry-After 下限；缺失/非法头才用本地退避。
- 共享 ApiResponse/RateLimited 形状变更后运行整个 portable tono-core suite：360 unit + 24 integration 全通过，详见同一报告 core-green.log。Windows native transport 真实 HTTP 429 回归待 CI，本机未跑 Tauri/Service。
- T6 的三个 403 码均有保留 token/identity、不得发 refresh/logout 或 Refused verdict 的兼容测试；未实现码别续费/重新验证 UI，不声称完整 UX 验收。

### 审查纠正
- 独立 Codex xhigh 第一轮只覆盖 `eef0b68ac`，发现首次 429 未退避（P2，已由 Retry-After 续修一并纠正）及并发回归只同步入口（P3）。`2909677ac` 受控暂停真实读写边界并验证锁所有权；移除该互斥的 mutation check 真实失败，恢复后全量 portable 测试通过。不是原 main 的新 RED 证据。
- 第二轮当前差异审查未完成前不声称通过；本线程不合并或自动合并。
