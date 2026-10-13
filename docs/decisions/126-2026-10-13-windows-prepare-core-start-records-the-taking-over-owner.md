## 2026-10-13 · 用户 B 接管已注销用户 A 的屏障：在持有释放锁 C 的同一事务里改 owner、退休 A、停旧 Core
- Status: provisional；**第二版同样未采纳（Codex 审阅再次 block，PR 保持 draft，交协调者接手）**。第一版被 block 后按协调者给出的事务设计重做；第二版（a43500d2c）的三个原问题都已被测试覆盖并通过，但 Codex 又提出两个 major，见下方“第二版审阅结果”
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
