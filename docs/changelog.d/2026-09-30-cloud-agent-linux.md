## 2026-09-30 · Linux Cloud Agent 可跑范围

- 归属：ops 文档，非客户发布门；不影响 macOS / Windows 产品行为。
- 来源：`main` 工作区说明；分支 `cursor/cloud-agent-linux-notes-3564`；未合 main。
- 缺陷修复：无。
- 新增/优化：`AGENTS.md` 增加 Cursor Cloud 一节：Node 24、控制面与运维台 `npm ci`、运维夹具台、Windows 前端 `pnpm web:dev`、本地 D1、Python/Ruby 检查；原生 macOS/Windows/Tauri 仍走托管 CI。
- 工程与测试：无产品代码改动。
- 验证：文档。同机已跑通的命令记在环境设置，不把本次文档 SHA 写成产品测试证据。
- 候选/发布：无新包，仅文档。
- 剩余限制：Cloud Agent 不能代替 macOS/Windows 实机验收，也不能部署生产 Worker。
