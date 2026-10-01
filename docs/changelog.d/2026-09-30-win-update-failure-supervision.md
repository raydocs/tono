## 2026-09-30 · Windows 更新准备失败后的连接收敛
- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；Windows App 原生更新、连接监控与 DIRECT 租约。
- 来源：main `64af499a` → 分支 `codex2/win-update-failure-supervision`；PR #779；已并入 `origin/main` `0484176a`。Prepare 失败的释放走 `apply_narrow`，普通网络打开且 AI 拦截装回；用户 Disconnect 仍不装这层。
- 缺陷修复：更新先取消连接代际与监控，私有解包等 Prepare 失败却留下运行中的 Core 时，不再继续显示无人监督的 Connected。仅对本次更新取消且代际未变的会话，先用 `tunnel_died` 收敛，再复用带更新账本释放的 Disconnect 工作器恢复 DNS、停止 Core、释放 WFP。Preparing 账本会拒绝普通重连和 DIRECT 续租，因此不靠重启监控或另一个 Service 到期修复维持联网。准备成功以有效 `InstallationAuthorized` 收据为界，不把 Install 的丢失确认当成准备失败。状态快照读不出时仍收敛本次取消的 Connecting；缺失证据不折叠 Connected。关联 [WIN-UPDATE-PREP-FAIL-UNSUPERVISED](../findings.d/WIN-UPDATE-PREP-FAIL-UNSUPERVISED.md)、[WIN-UPDATE-PREP-FAIL-STUCK-CONNECTING](../findings.d/WIN-UPDATE-PREP-FAIL-STUCK-CONNECTING.md)。
- 新增/优化：无。释放准入在同一状态锁下核对代际，后继连接或用户 Disconnect 胜出；释放未被 Service 证明前不清武装标记。更新错误不再笼统声称保护仍保留。
- 工程与测试：在 `update.rs` 原单测模块新增两条窄回归，覆盖运行中 Core 的失监会话释放决策（含代际与 Install 边界），以及不可读快照下的 Connecting 收敛；原测试只适配参数。
- 验证：本 worktree 逐行检查 Rust 类型、借用、锁与 await，`git diff --check` 通过；分片读取通过。未运行 Rust 回归或 Windows 实机测试：本环境无 cargo/Windows；无 Xcode，未跑 Swift/macOS 测试。hosted `windows-ci.yml` 的 Tauri `cargo test --locked` 执行这些回归，尚无本分支 CI 结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：DNS/WFP 真机释放、Service 不可达或拒绝释放仍需验证，不把释放请求当作成功。快照不可读时 Connected 保留原判定。长时间私有解包本身阻塞 DIRECT 续租、失败后 catalog sync 未重启是邻接问题，本轮未改。
