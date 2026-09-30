## 2026-09-30 · 健康监视器失败时放行，不再保护重连

- 归属：SHIP_PLAN 客户连接路径。叠在后台探测分支上。不是 G4，不发客户包。
- 来源：`cursor/unarmed-background-heal-a925` `a88b1c36` → 本分支；未合 main。
- 缺陷修复：Windows 健康监视器在隧道证明失败后会停核心、保持 WFP，再保护重连。这和「不能把机器留在没有网络的状态」冲突。
- 新增/优化：原地证明失败后，普通健康失败调用共享的 `health_monitor_releases`（内部仍是 `disposition_after_exhausted_failure`）。放行成功才开始不装隧道的探测。策略行为变更仍走原来的保护重建。Windows 没有 `permanent` 开关，所以这条健康路径放行。释放失败不另起隧道。
- 工程与测试：判定本身的测试在 `unarmed_probe::health_failure_uses_the_shared_disposition`。本 PR 只接调用点。
- 验证：本机不能跑 `cargo test`（rustc 1.83 / edition 2024）。需要 CI。未改 #705 的网络变化确认逻辑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：macOS 健康路径另接。策略重建期间屏障仍在。释放失败时屏障可能仍在。#705 若先合并，本文件的探测规划区段可能要手工合。

### 2026-09-30 续记 · 跟上同步的探测启动

- 来源：重放到探测分支 `bc0a087b`。放行成功后读取当时的 `connect_generation`，再同步调用 `spawn_after_release`。释放失败仍不启动隧道。普通健康失败仍放行；策略重建和严格模式仍走保护重连。

### 2026-09-30 续记 · 跟着重放到已含 #733 的探测分支

- 来源：`--onto` 重放到 `cursor/unarmed-background-heal-a925` `125721ef`（该分支已变基到 main `cbb4f56a`）。没有把 main 合并进来。放行成功后仍同步启动探测。助手协议仍是 `4.52.6`。
