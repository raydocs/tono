## 2026-09-30 · Windows 更新执行器失败恢复与网络放行
- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；影响 Windows 原生更新执行器与恢复路径。
- 来源：main `ff81118a` → 分支 `codex2/win-update-suspended-successor`；PR #858；未合 main。
- 缺陷修复：执行器已用 `CREATE_SUSPENDED` 启动后继 App 并持久化其身份，在等待 Service 就绪期间突然退出，恢复仅凭后继存活就返回，App 永不运行、无法 Adopt/恢复连接，更新保留的 WFP 阻断可能持续拦住普通网络。恢复现在先唤醒身份完全相符的后继，再返回；恢复失败向上传递。关联 `WIN-UPDATE-SUSPENDED-SUCCESSOR`。
- 新增/优化：无。沿用后继 App 的现有收养、恢复与标准释放路径，不新增 AI 阻断层，不改健康连接的 AI 拦截或严格杀开关。
- 工程与测试：新增一条同模块 Rust 回归 `update_recovery_resumes_a_live_successor_before_returning`，覆盖返回前唤醒、唤醒失败不能算恢复成功、无身份匹配后继时不唤醒。使用已有 `windows-sys` Toolhelp/Threading 特性，无 Cargo 特性改动；进程句柄固定 PID、复核创建时间/路径/摘要，线程句柄复核所属 PID；每个线程只调一次 `ResumeThread`，计数 0 接受为已运行，先前计数大于 1 或枚举失败报错。
- 验证：本 worktree 人工逐行复核 Rust 差异；`git diff --check`、`node tooling/scripts/records.mjs findings --id WIN-UPDATE-SUSPENDED-SUCCESSOR` 与记录读取/来源/状态检查通过。此环境无 cargo、Swift/Xcode 或 Windows，未运行 Rust 单元测试、原生构建与 WFP 网络恢复实机测试；需 hosted Windows CI 执行原生检查。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络恢复仍为 `needs-hardware`，不能声称客户已修复。Service 启动检查时原执行器若仍存活、随后才崩溃，可能要等下一次 Service 启动或重启系统才触发恢复；创建挂起 App 到身份持久化之前的另一个崩溃窗口不在本轮修复范围。

### 2026-09-30 续记 · Service 重启失败时非严格放行
- 归属：同一 SHIP_PLAN §2 第 10 项；同分支扩展为 Windows 更新执行器失败后不遗留全网阻断的一组修复。
- 来源：main `ff81118a` → 分支 `codex2/win-update-suspended-successor`；PR #858；未合 main。
- 缺陷修复：替换后的 Service 启动失败或 IPC 就绪超时，原执行器在成功发布与失败回滚两条路径都直接传播 `restart?`，App 无可用 IPC 释放保留的 WFP。现在两条出口共用重启失败处理：非严格会话先暂停 SCM 自动恢复、停止可能仍活着的 Service，取得 owner 后复核严格标志，调用现有 `emergency_disarm_windows_kill_switch` 恢复 DNS、移除 Tono 持久 WFP 与 NRPT 遗留；显式严格会话保留阻断。释放失败记日志，返回原重启错误；后继唤醒失败也不覆盖已有重启错误。关联 `WIN-UPDATE-RESTART-FAIL-OPEN`。
- 新增/优化：无。沿用既有 `IntentRecord` 解析与启动策略，只读到 `wanted:true` 且 `strict_kill_switch:true` 才视为严格；缺失、损坏或读不出的记录不能证明严格 opt-in，`wanted:false` 沿用已释放语义。只调用标准应急释放，不新增 AI/WFP 层、不改健康连接 AI 拦截，不回滚、不删除更新计划、备份或证据。
- 工程与测试：保留上一轮唤醒修复，新增一条同模块回归 `update_restart_failure_releases_only_non_strict_protection_and_keeps_the_error`，覆盖成功不释放、严格失败不释放、非严格失败尝试释放，以及释放失败仍返回原重启错误类型与消息。共两条新增 Rust 回归，每行为一条。使用已有修复门、停服与 owner 函数；释放运行在既有 `shared::block_on_abandoning`，避免超时后的阻塞工作令 runtime 析构无限等待。不论暂停 SCM 恢复、停服或释放的结果如何都尝试恢复 SCM 恢复策略，不主动重启 Service，避免后续健康会话丢失自动恢复。
- 验证：本 worktree 人工逐行复核第二组 Rust 差异；本轮 `git diff --check`、两项 finding 读取与同一 changelog 的来源/状态读取检查通过。无 cargo、Swift/Xcode 或 Windows，未运行两条 Rust 回归、原生构建、Service 启动/IPC 超时故障注入、DNS/WFP 与严格模式实机验收；需 hosted Windows CI 执行原生检查，前一轮静态结果不冒充本轮测试证据。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`needs-hardware`。修复门、停服、owner、DNS 或 WFP 释放本身失败时只记日志并保留原重启错误，不能声称网络一定恢复；标准应急路径的墓碑写入失败仍可能在 WFP 删除前返回。上一轮延迟触发与未记录后继的崩溃窗口继续保留；进入重启步骤之前的 SCM 恢复配置失败仍沿用旧错误路径，本轮未改。
