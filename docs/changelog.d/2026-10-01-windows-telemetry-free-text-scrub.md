## 2026-10-01 · Windows 遥测自由文本按支持报告标准脱敏

- 归属：ops / 隐私；影响 Windows App 遥测（`apps/windows/app/src-tauri/src/tono/telemetry.rs`）。
- 来源：main `0676435b`；分支 `claude/fix-1201-windows-telemetry-scrub`；关联 #1201（发现 TELEMETRY-FREE-TEXT-IDENTIFIERS，分片随服务器端 PR #1224）。未合 main。
- 缺陷修复：连接失败上报的 `error`（Full 范围）和时间线事件的 `error`、`reason`、`probe`、`from`、`to` 只经 `audit::redact`，`dial <出口IP>:443` 保留出口地址和 UUID。改为与用户主动支持报告相同的 `diagnostics::scrub_text_with`（凭据、UUID、IPv4、混合长串）。节点名、代码等其他字段不变；采集内容和开关默认值不变。
- 新增/优化：无。
- 工程与测试：新增 `timeline_free_text_drops_exit_addresses_and_uuids`。
- 验证：本机不跑 `cargo`；`rustfmt --check`（仓库配置）对改动处无差异（第 218 行的既有差异在 main 上同样存在）。Windows CI 是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不去 IPv6、邮箱、家目录路径；macOS 无现成脱敏器，未改。
