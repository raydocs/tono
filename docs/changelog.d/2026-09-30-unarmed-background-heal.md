## 2026-09-30 · 放行之后继续在原网络上探测，通了再连

- 归属：SHIP_PLAN 客户连接路径（零配置出口）。不是 G4 发布项，不发客户包。叠在 #706 上，放行与否只调用 `disposition_after_exhausted_failure`。
- 来源：#706 `47d0c564` → 本分支；未合 main。
- 缺陷修复：普通失败把网络放回来之后不再停在「请再点一次连接」。原网络保持可用，后台只做 TCP 探测。
- 新增/优化：先探测当前节点，再同一地区最多两个 TCP 节点。间隔 2/5/15/30/60/120 秒，到顶后继续，不装 TUN、WFP 或 PF。只有一次探测成功才开始连接。Hysteria2 不算 TCP 成功。屏障仍在（严格 `permanent`）时仍走原来的保护重连。断开连接会停掉这条探测。住宅路由不改。
- 工程与测试：`tono-core` `unarmed_probe` 三个测试（顺序、退避且不重连、健康监视器复用共享放行判定）。没有表驱动测试。
- 验证：本机 Cargo 1.83 解析不了 edition 2024，`cargo test -p tono-core --lib unarmed_probe` 未执行。需要托管 CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：健康监视器里拆掉隧道再保护重连的路径还没改到这条探测上。macOS 还没接。Hysteria2 单独节点不会被这次 TCP 证明。释放 IPC 失败时屏障可能仍在，那种情况不开始探测。没有实机计时。

### 2026-09-30 续记 · 变基到当前 #706

- 来源：只重放探测提交到 [#706](https://github.com/raydocs/tono/pull/706) `55e68e93`。没有把旧的 #706 提交再打一遍。`state.client` 仍走锁内的 `inner.client`。放行之后才探测；屏障还在时仍走保护重连。
- 缺陷修复：`app-rust` 报 `TonoState` 上没有 `client`。那是旧基线上的调用。变基后沿用 #706 的锁内写法，探测行为没有放宽。

### 2026-09-30 续记 · 探测任务里的连接不再嵌套自己的类型

- 缺陷修复：`app-rust` 报探测任务的 future 不能 `Send`。连接失败会再调用 `spawn_after_release`，任务类型把自己包进去。现在把这一次连接收成 `Box<dyn Future + Send>`。仍然只有证明成功才连接，屏障还在时不探测，失败不装隧道。

### 2026-09-30 续记 · 启动探测不再是异步函数

- 缺陷修复：`1e8d0def` 的 `app-rust` 仍失败，错误是 `E0391`。`spawn_after_release` 的异步类型要检查 `connect_for_generation` 是否 `Send`，而连接失败又会等回这个启动函数，类型算不完。启动改成同步函数，世代号由调用方传入；句柄用 `try_lock` 装上，锁被占用时另起一个只装句柄的任务。票号变了就丢掉旧句柄，不覆盖更新的探测。
- 行为不变：屏障还在时仍走保护重连；只有 TCP 证明成功才连接；探测过程不装 TUN、WFP 或 PF。本机仍不能跑 `cargo test`。

### 2026-09-30 续记 · 变基到已含 #703 的 main

- 来源：变基到 `origin/main` `01c2403f`（[#703](https://github.com/raydocs/tono/pull/703) 已合入）。没有把 main 合并进来。`connection.rs` 的失败分支两边都留：`FailOpen` 仍调用 `release_explicit`，然后才同步启动探测；`SelectiveAiHold` 不探测、不显式全量释放；`HoldClosed` 仍走保护重连。助手协议仍是 `4.52.6`。

### 2026-09-30 续记 · 变基到已含 #733 的 main

- 来源：变基到 `origin/main` `cbb4f56a`。没有把 main 合并进来。唯一冲突是 `docs/DECISIONS.md`：Continuity 与 Windows WFP 放行记录留在探测记录上面。`FailOpen` 仍先 `release_explicit` 再同步 `spawn_after_release`。助手协议仍是 `4.52.6`。
