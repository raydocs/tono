## 2026-10-13 · 用户 B 接管已注销用户 A 的屏障：在持有释放锁 C 的同一事务里改 owner、退休 A、停旧 Core
- Status: provisional（第二版；第一版被 Codex 审阅 block 后按协调者给出的事务设计重做）
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
