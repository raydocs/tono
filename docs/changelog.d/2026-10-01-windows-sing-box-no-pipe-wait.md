## 2026-10-01 · Windows Service 启动 sing-box 不再等 mihomo 管道

- 归属：SHIP_PLAN G1；影响 Windows Service 核心启动与看门狗重启（`manager.rs`）。协议版本不变。
- 来源：main `14347158`；分支 `fix/win-singbox-no-ipc-pipe-wait`；Fixes #1195。未合 main。
- 缺陷修复：启动和重启核心后都会等 `\\.\pipe\tono-core-*`，等不到就杀核心。只有 mihomo 建这条管道，sing-box（`run -c`）不建，所以每次 sing-box 启动都失败并回滚。改为 sing-box 镜像跳过这一步；mihomo 不变。
- 新增/优化：无。
- 工程与测试：`a_sing_box_start_does_not_wait_for_the_mihomo_controller_pipe`。
- 验证：本机不跑 `cargo`；rustfmt 只剩 main 上原有的 import 顺序差异。Windows CI service 作业是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：高风险（核心生命周期），合并前需要独立 Codex high 审查。实机 sing-box 启动需备用机。
