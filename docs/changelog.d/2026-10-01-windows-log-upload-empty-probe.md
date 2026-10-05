## 2026-10-01 · Windows 日志上传先发空探测

- 归属：ops / 隐私；影响 Windows App 网络日志上传（`log_upload.rs`）。
- 来源：main `14347158`；分支 `fix/win-log-upload-empty-probe`；Fixes #1191。未合 main。
- 缺陷修复：上传默认开启，但没有收集窗口时，首轮会发最多 4 MiB 真实审计行，之后每 30 分钟再发 64 KiB，服务器不读正文就回 `not_enabled`。改为：服务器存下过一次之前，只发 0 行的空 gzip 探测；存下后才发真实行。探测占用的回执序号不复用。只有其他账号行的块照旧本地跳过，不触发探测。
- 新增/优化：无。
- 工程与测试：`a_not_stored_receipt_stands_down_to_a_small_probe` 改为 `no_log_line_is_sent_until_the_server_stores_an_empty_probe`。
- 验证：本机不跑 `cargo`；rustfmt 解析通过。Windows CI 是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：窗口关闭后的第一段真实数据仍会发出一次再停下。macOS 同类问题已由 #1192 修复（`62ed22d4`）。
- 续记 2026-10-05：这个 PR 自 10-01 起一直是草稿并与 main 冲突，#1191 被提前关闭，main 上 Windows 仍在发真实行。所有者指示「能合并的合并」后变基到 main `a97c963e`（唯一冲突是 `MAC-LOG-UPLOAD-PROBE-LINES.md`，取 main 的已修版本），并把提交拆成先红后绿：红提交 `7e5510e0` 只改测试，修复在其后。归属：运维计划（诊断隐私；不是发布门）。

