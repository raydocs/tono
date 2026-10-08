## 2026-10-08 · 控制面部署 main@639966e0 与 main 批次评审
- 归属：所有者 2026-10-08 决定（[decision 076](../decisions/076-2026-10-08-raw-network-logs-stored-by-default.md)）；控制面。
- 来源：main `639966e0e`（#1455 合并提交）。相对上次部署 `142c8ca67`，控制面代码只多了 #1455（默认存储完整网络日志）；其余是桌面端、工作流与文档。
- 缺陷修复：见 [2026-10-08-cp-raw-logs-stored-by-default.md](2026-10-08-cp-raw-logs-stored-by-default.md)。
- 新增/优化：无。
- 工程与测试：main 批次评审 `e99678129...639966e0e`（#1454、#1455），决策 `230d14e2`，Grok-only（所有者 2026-10-08：Codex 不可用，不跑双厂商），PASSED，1 条 suggestion（`sign=true` 但签名身份为空时产物名仍带 `signed`；文件名本身带 `-unsigned`，未改）。#1454 修正轮 `eed50e63`、#1455 `17af398d` 同为 Grok-only PASSED。
- 验证：部署前 D1 导出 `2026-10-08T04:35:38Z.sql.gz`（SHA-256 `14fe2d9562eb87a892630dd4266588de3665e6c3336e9b7bef6e0f26fd2173ac`），与 `.sha256` 一起上传 `tono-releases/backups/control-plane-d1/`。`npm run deploy`（`git pull --ff-only` 后的干净 main）：无迁移；API Worker 版本 `826120c2-823e-40c7-bc6d-2769843057e9`，admin Worker `a46fca23-0c95-4f58-8034-68e77f941dbd`；`/api/v1/system/version` buildSha `639966e0e…`。部署后 15 分钟内 `diagnostics_log_objects` 已有 1 段（1 台设备）。
- 候选/发布：无新包。
- 剩余限制：评审只有一个厂商；R1455-grok-F1（解析汇总删号不删）开放。
