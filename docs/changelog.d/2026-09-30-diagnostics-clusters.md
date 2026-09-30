## 2026-09-30 · 失败聚类告警与隐私安全诊断入库

- 归属：G2（失败可见）；控制面、运维只读接口。不改客户发布通道。
- 来源：基线 `d2363002` → 本分支 `cursor/diagnostics-control-plane-e0fd`；[PR #707](https://github.com/raydocs/tono/pull/707)；尚未合入 main。
- 缺陷修复：H8-F4 的服务端一半。flatten 把事件上的 `bytesUp`/`bytesDown` 写入 `connection_events`；活动时长只在窗口重叠的最后一个小时累加这些字节。客户端仍须实际上报字节，见台账剩余限制。
- 新增/优化：`POST /api/v1/telemetry/diagnostics` 接收版本、会话、链路跳、`/24` 出口、DNS 检查和（需同意的）Claude/OpenAI 路由事实。失败按错误码、阶段、应用版本、平台、节点并成一个未关闭聚类；新聚类和限速后的尖峰才打 HMAC webhook，URL 或密钥缺一则不发送。工程机器人用只读 token 列聚类、取时间线。原始主机名日志仍由 `diagnostics_log_access` 把关。断网类代号（`TONO_NETWORK_LOSS`、`TONO_FAIL_OPEN`、`TONO_WATCHDOG_RESTORE`、`TONO_KILL_SWITCH_STUCK`、`TONO_RESTORE_NETWORK`、`TONO_CRASH_WHILE_PROTECTED`）的告警带 `severity: "p0"`，该聚类第一次出现就发，不等尖峰，也不被每小时条数上限挡住。
- 工程与测试：migration `0093`；`docs/diagnostics-privacy.md` 写明表和 webhook schema。
- 验证：`services/control-plane` 上 `npm test` 通过（943 项，含聚类 webhook、只读 token、flatten 字节）。macOS XCTest 与 Windows `cargo test` 未在此 Linux 环境执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：客户端默认开启、离线重试和设置文案在后续 PR。未配置 webhook 与只读 token 之前，生产不会外呼、只读接口返回 503。
