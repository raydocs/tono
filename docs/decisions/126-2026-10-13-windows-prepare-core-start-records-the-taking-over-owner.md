## 2026-10-13 · 用户 B 接管已注销用户 A 的屏障：在持有释放锁 C 的同一事务里改 owner、退休 A、停旧 Core
- Status: provisional；当前是第三版（见文末“第三版”）。第一版、第二版（a43500d2c）各被 Codex 审阅 block 一次；第二版的两个 major 与一个未验证项已按总监方案修改，待第三次 Codex 审阅。第二版的审阅结果保留在“第二版审阅结果”。
- Chosen: `PrepareCoreStart` 在需要停掉的 Core 属于一个已注销的 owner A 时，把下面几步放进一个事务，全程持有独立释放进程用的跨进程锁 C（`release.lock`）：
  1. `Authority::hold_for_takeover` 取 C 并确认没有在途释放：C 被占用返回 `InProgress`；上一次释放的 worker 或幸存进程仍在运行返回 `Unfinished`；记录不可读返回 `Corrupt`。三者都映射成现有的 `ReleaseInProgress` / `ReleaseUnfinished` / `ReleaseRecordCorrupt`，可重试，且什么都没改、没停。
  2. 在 `WFP_OPERATION` 下用 `authorize_takeover_for` 重新判定（A 仍有登录会话则与 `arm_bootstrap` 一样拒绝）；退休 A 的 active-owner 记录和 desired 运行状态（`desired::retire_owner_if_active`）；再把记录的 `owner_key` 改成 B（`verified=false`，A 的验证不属于 B）。退休在前且幂等：中途失败时 A 仍是记录的 owner，B 重试会把整步重做。
  3. 仍在 C 下停掉旧 Core（`CoreManager::prepare_start`）。
  没有需要接管的 owner 时（没有武装、意图无 owner、调用者已是 owner）不取 C，流程与之前完全一致。`authorize_write_for` 与 `release::worker::owner_refusal` 一行没改：事务之后 B 真的是记录的 owner，也没有别人的连接在记录里，两个入口自然放行 B 的 `fail_connect` 释放。
- 对第一版三个主要问题的回应：
  1. 与释放进程串行：释放 worker 从第一个副作用之前到读回全部结果都持有 C，并在 C 下用 `owner_refusal` 检查；接管持有同一把 C，所以 worker 不可能在接管中途或之后用旧 owner 的判断解除 B 名下的屏障，而在途释放会让接管以可重试错误失败。
  2. A 的 active-owner 与 desired 一并退休，否则 `owner_refusal` 读到的 `load_active_owner` 仍是 A，B 的释放依旧被拒（目标故障没消除），A 的 desired 还会让服务重启把 A 的 Core 拉起来。
  3. 写盘可确认：内存只在磁盘确认持有新记录之后才改。`atomic_write` 报错时重读意图文件：字节等于新记录则视为已提交（rename 已落地，只是报告失败）；仍是旧 owner 则原样返回错误、内存不变；其余（缺失、半写、陈旧）则把旧记录写回，写回也失败时报告“状态未知”。
- Why stricter: 没有放宽任何释放权限。B 能成为 owner 的条件和 `arm_bootstrap` 里已有的完全一样；这里只是把“写 owner”从 `StartClash` 提前到“停 Core”那一刻，并加上与释放进程的互斥。A 仍登录时被拒绝，且拒绝发生在停 Core 之前。
- 偏离原话：协调者的措辞是“不要在新用户 `arm_bootstrap` 成功前停 A 的 Core”。没有这样做，因为 App 的 DNS 预检要绑定 loopback:53，A 的 Core 不停，B 就永远过不了预检；而 `PrepareCoreStart` 没有 `arm_bootstrap` 需要的配置。取而代之的是让所有权转移与停 Core 在同一事务里发生，目标（失败的 B 连接不会让机器停在 Blocked）相同。
- Residual: 已被 `atomic_file::replace` 超时放弃、之后才落地的 rename 仍是 `atomic_write` 已记录的 BRICK-W11 限制，本事务同样不覆盖。事务里“写回旧记录也失败”时磁盘状态未知，返回错误、内存不变，由后续的 `StartClash` 或启动恢复重新对账。未做双账号实机验证。
- Applied in: 本 PR（`apps/windows/service/src/core/release/mod.rs`、`core/windows_kill_switch/takeover.rs`、`core/server/handlers.rs`）

## 第二版审阅结果（Codex gpt-6.1-sol，a43500d2c，verdict: block）
- Major 1（成立）：`retire_owner_if_active(&departed)` 在 active owner 是第三方 X 时返回 `Ok(false)`，事务忽略这个布尔值，仍然把屏障改记 B 并停掉全局 Core。X 的 active-owner 记录和 desired 运行意图保留，`owner_refusal(B)` 与主 Service 的释放仍拒绝 B，重启还可能恢复 X。修复方向：active owner 既不是 departed owner 也不是调用者时，在改 owner、停 Core 之前拒绝（保留 X 的记录和进程），并补第三方 X 的回归。
- Major 2（成立）：`commit_owner` 的 Unknown 分支在“新记录已落地、读回失败、写回旧记录也失败”时只返回错误，内存保持旧 owner，磁盘实际是 B：独立 worker 的 `owner_refusal(B)` 通过而 Service 的 `authorize_write_for(B)` 拒绝、`authorize_write_for(A)` 通过。这不是已接受的 BRICK-W11（本次 rename 已完成）。修复方向：补偿后也读回确认；仍未知时进入双方都尊重的待对账状态或隔离 Service，不能返回后继续按旧内存 owner 授权；补该场景的回归。
- 未能验证（Codex 的覆盖说明）：`hold_for_takeover` 只检查记录里的 worker/stuck 进程，不检查 `jobs_unproven`、`completed`、历史丢失和 DNS ledger，所以它是“没有已知存活的释放进程”而不是完整的“无在途释放”证明；`admit_start` 之后阻止新的 Core admission，但不能证明 Prepare 期间旧异步工作已静止。是否需要改用 `unretired_reason`（会让 DNS ledger 未清时也拒绝 Prepare）需要协调者定。测试没有在 stop 闭包内断言 C 仍被持有。
- 已验证为正确的部分：worker 先取 C 再 `owner_refusal`，C 覆盖转移和 stop；锁序无反向等待；A→B 正常路径两个授权入口都放行；`authorize_takeover_for` 在退休/移动/停之前拒绝仍登录的 owner；`authorize_write_for` 与 `owner_refusal` 未改；handler 的 freshness、OperationGuard、错误码映射保持。
- 红跑：首版 stub 的 ci-gate run 38380465938 在 `windows / service` 失败 4/8（在途释放返回 `Ok(7)`、A 的 active-owner 未退休、commit-then-error 与写后不可读两种写盘错误）；第二版 head 的同一 job 通过（run 38380501700）。
- 结论：按协调者的约定，第二次被 Codex block 后不再自行修第三轮，PR #1643 保持 draft，由协调者接手。

## 第三版（总监方案，对 Codex 两个 major 和一个未验证项的回应）
保留第二版的事务（C 下确认无在途释放、退休 A、改 owner、停旧 Core）。模式：内存跟随已确认的磁盘读取；不确定性变成明确的拒绝状态，永远不是第二次写。没有改任何门：`authorize_write_for` / `authorize_takeover_for` / `owner_refusal` 字节不变。
1. 第三方连接（major 1）：`retire_owner_if_active` 返回 `Ok(false)`（active owner 不是 A）时，`move_ownership` 在改 owner 与停 Core 之前返回可重试的 `still_protected` 拒绝，没有例外分支。X 的 active-owner 与 desired 保持原样。已知取舍：active owner 恰好是调用者 B 本人而意图记在 A 名下的不一致状态也会被拒绝（方案要求不留例外）。
2. 写盘不确定（major 2）：删除“写回旧记录”的补偿写。写盘报错后最多重读 3 次（间隔 100 ms）：读到新记录 -> 内存改为 B；读到仍是旧 owner -> 返回错误、内存不变；仍无法判断 -> 置位 `OWNER_RECORD_UNCONFIRMED`（`windows_kill_switch/state.rs`）、返回错误，不停 Core、不再写。
3. 门侧对账：`reconcile_owner_record_if_unconfirmed()`（`windows_kill_switch/intent.rs`）在 `WFP_OPERATION` 下重读意图文件；可读则把 `owner_key` / `verified` / `updated_at` 拷进内存并清除标志；缺失或无法解析则返回可重试的拒绝（"the protection owner record cannot be read; try again"），标志保留。它在 `enter_owner_lifecycle`（`server/mod.rs`，覆盖 ArmedPolicyOwner / ArmedPolicyRelease / ArmedPolicyTakeover 和其余所有门，且早于 `update::lifecycle_allowed`）和 `UpdateTransaction` 路由（它直接拿 `OWNER_LIFECYCLE_LOCK`，随后 `update.rs` 的 `protection` 与 `begin_update_release` 才调用 `authorize_write_for`）里先于任何 owner 判断执行。`authorize_*_for` 的其余调用点只有 `arm.rs` 的 `arm_bootstrap`（StartClash 经 `enter_protecting_owner_lifecycle` 进入）和 `takeover.rs` 自身。恢复：Service 重启会从磁盘重新加载 owner 记录；标志存在期间，A 或 B 的释放都收到可重试拒绝。
4. 无在途释放（未验证项）：`hold_for_takeover` 改用 `Processes::unretired_reason`，与 `admit_start` 相同的证明（存活 worker/幸存者、jobs 未证明、释放未完成、DNS 账本未清或不可读、历史丢失）；任何一项都以 `Unfinished` 可重试拒绝，不改任何东西。
5. 测试：happy path 在 stop 闭包内断言 C 仍被持有且 owner 已改成 B。
6. 退休 A 的 active-owner 同时关闭了第二个砖化窗口：B 的 StartClash 在 `arm_bootstrap` 之后、`commit_active_owner_session` 之前失败时，active-owner 不会还是 A。

接受的限制与恢复：被 `atomic_file::replace` 超时放弃、之后才落地的 rename 仍是 BRICK-W11（`atomic_write` 已记录）。若第三次 Codex 审阅再因新类别问题 block，则按总监方案记为接受的限制：A 重新登录并 Disconnect，或管理员停止 Service 后用紧急释放；PR 保持 draft，不开第四版。

红跑（第三版测试对第二版逻辑）：ci-gate run 38385306359，在抛弃分支 `claude/win-prepare-tx-red-3`（第三版测试 + a43500d2c 的 `takeover.rs` / 旧 `hold_for_takeover` / 无门侧对账；已删除）上，`windows / service` 失败 5 个：`a_third_users_connection_refuses_the_takeover_and_stops_nothing`（got Ok(7)）、`a_release_not_proven_finished_refuses_the_takeover_and_changes_nothing`（got Ok(7)）、`an_unclassifiable_intent_after_an_error_is_flagged_not_rewritten`（an owner write that cannot be classified must be flagged）、`an_unconfirmed_owner_record_is_reconciled_from_the_disk_by_the_gate`（OWNER_RECORD_UNCONFIRMED 未置位）、`owner_lifecycle_tests::an_unconfirmed_owner_record_refuses_the_owner_gates_until_it_can_be_read`（Unchecked admitted a caller on an unconfirmed owner record）。绿跑：同一 job 在第三版 head 通过（run 38384127202，9e66cb45c）。happy path 里“stop 闭包内 C 仍被持有”的断言在第二版逻辑上本来就成立（第二版也在 C 下停 Core），它是回归保护，不是红测试。
