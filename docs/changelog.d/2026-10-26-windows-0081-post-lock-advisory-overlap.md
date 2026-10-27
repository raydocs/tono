## 2026-10-26 · Windows 0.0.81 后锁验证失败时，控制器咨询探测与最后一轮诊断并行
- 归属：G2（Windows 客户端）；模块 `apps/windows/app`（src-tauri `tono/connection/probes.rs`）。
- 来源：基线 main `29384fc48`（PR #1762 合入后）→ 分支 `fix/windows-0081-connect-latency`；一个提交。未合 main。
- 缺陷修复：后锁验证（`verify_post_lock`）失败时，控制器 `/delay` 咨询探测要等最后一轮「TUN + 回环诊断」join 结束后才开始，每次失败的连接除了 18 秒数据面预算，还要再多等最多 8 秒（`EXIT_PROBE_CORE_TIMEOUT_MS`）→ 最后一轮现在把咨询探测与 join 放在同一个 `transaction.wait` 里同时启动，总耗时约为 `max(数据面, 咨询探测)` 而不是两者之和。失败的连接最多少等 8 秒。
- 新增/优化：新增小函数 `verify_final_round`（`probes.rs`）。数据面成功时咨询探测的结果不被使用、未完成的探测直接丢弃（与 `verify_with_diagnostic` 丢弃诊断一致），`controller_probe` 仍为 `Ok(())`，Verified 分支与 1500 ms 之后的延迟咨询采样不变；数据面失败时才取咨询结果，照旧交给 `classify_post_lock_verification` 与 `classify_exhausted_data_plane`，「controller」记录（含耗时毫秒）和正延迟的 `record_exit_delay` 也只在数据面失败后写入。函数顶部注释已改为：串行约束对成功路径和第 1 轮成立，只在第 1 轮失败后才有的最后一轮把咨询采样与诊断 join 并行启动。
- 未变：第 1 轮仍只做 TUN、不做控制器探测；结论、归类、fail-closed 规则、`FullRelease`、所有常量/超时/轮数/错误文本/前缀/错误码均未改；无新依赖；事务取消时三个 future 仍在同一个 `transaction.wait` 内一并取消。
- 工程与测试：`probes.rs` 新增 4 个测试（注入 future + 真实短睡眠）：数据面成功时不使用也不等待咨询结果（20 ms 对 400 ms，断言 < 300 ms）；数据面成功而咨询先完成时结果被丢弃；数据面失败时返回咨询结果且总耗时约为 `max`（60 ms 对 80 ms，断言 ≥ 80 ms 且 < 120 ms，而非 140 ms）；咨询先于失败的数据面完成时结果仍被返回。
- 验证：本机 macOS（`cargo +1.98.1`，stub 已就位）：`cargo test --lib connection` 216 通过、1 失败（`outcome::tests::late_failure_keeps_successor_auth_tunnel_port` 需 127.0.0.2，本机环境失败，与改动无关）；`probes::tests` 5 通过；`cargo check --lib` 通过，`probes.rs` 本次改动行无新警告。`cfg(windows)` 内代码本机未编译，依赖 PR 上 `windows-ci.yml`。
- 候选/发布：无新包，仅源码；版本号未改。
- 剩余限制：真实 Windows 上失败路径的实际耗时未实测；并行后失败时的回环诊断、TUN 探测与咨询 `/delay` 同时占用同一出口，只发生在已经失败的最后一轮。
