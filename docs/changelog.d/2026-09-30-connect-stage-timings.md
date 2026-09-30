## 2026-09-30 · 连接阶段用同一套 wire key 记耗时

- 归属：SHIP_PLAN 客户连接路径。不是 G4，不发客户包。
- 来源：`main` `d2363002` → 本分支；未合 main。
- 缺陷修复：无。macOS 审计以前只写英文阶段句，和 Windows 的 `stage` 键对不上。
- 新增/优化：`connect_timing::WIRE_KEYS` 是唯一列表。Windows `stage_key` 改成调用它。macOS `ConnectionStage.wireKey` 用同一组字符串，审计增加 `stage_key` 和 `previous_stage_key`。耗时仍走现有的 `elapsed_ms` / `previous_stage_duration_ms`，不新开上传。没有缩短 10 秒 TUN 或 12 秒首字节预算，也没有把 TUN 和握手并行。跨协议对打不在这里做。
- 工程与测试：Rust `wire_keys_follow_connect_stage_order`；Swift `ConnectStageWireTests`。本机都没跑（无 1.98 rustc，无 Xcode）。
- 验证：需要 Windows 与 macOS CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机阶段数字，所以预算不动。TCP 证明与服务启动重叠在另一条 PR。

### 2026-09-30 续记 · 变基到 `5d46b896`

- 来源：变基到 `origin/main` `5d46b896`。助手协议仍是 main 的 `4.52.6`。
- 新增/优化：main 已有的 `telemetryKey` 保留（`preparingHelper` 仍是 `preparingHelper`）。新的 `wireKey` 与 Windows `WIRE_KEYS` 对齐，`preparingHelper` 在这条键上是 `preparingService`。预算没有缩短。

### 2026-09-30 续记 · 变基到已含 #706 的 main

- 来源：变基到 `origin/main` `7e475245`。没有把 main 合并进来。唯一冲突是 `docs/DECISIONS.md`：#706 的两条所有者记录留在「不缩短 TUN / 首字节预算」上面。两条都保留。
- 新增/优化：`telemetryKey` 与 `wireKey` 仍同时存在。10 秒 TUN 和 12 秒首字节预算没有缩短。助手协议仍是 `4.52.6`。
