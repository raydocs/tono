## 2026-09-26 · macOS：`-E` 超时找回只认本子进程的 token，记录失败回退不遗忘未确认释放的 token
- 归属：G1（断开收回保护，PF 引用不误释放、不泄漏）；Issue #601 条目 R609-F2 的 #639 复核续修（R639-O1、R639-F2）。helper
  `KillSwitchPF.swift`、`KillSwitchTests.swift`、`CONTRACT.sha256`；App `Core/HelperProtocolVersion.swift`。
- 来源：基线 origin/main `42e3afd6`；红分支 `wip/macos-pf-token-recovery-20260926-red`（`0c932dcc`），修复分支
  `fix/macos-pf-token-recovery-20260926`，[#643](https://github.com/raydocs/tono/pull/643)；未合 main。
- 缺陷修复：
  - R639-O1（opus:F1 = codex:F1；合并回归审查 run `4459fadd` 复报）：#639 的 `-E` 超时找回只按 PID + 进程名 `pfctl` 认领
    `pfctl -s References` 的行。token 比取得它的 pfctl 活得久，PID 会回绕：同次开机更早别的程序在同一 PID 下取得的 token
    会被认成本 helper 的，disarm 时被 `-X`；PID 被无关长寿进程复用时 `kill(pid, 0)` 一直成功，待定获取永不结算，hold 一直走匿名
    `pfctl -e`。改后：`-E` 启动前记墙钟秒，子进程被回收后由它自己的终止回调记退出秒（`run` 新增 `ended` 回调）。子进程退出前不结算，
    hold 照旧用匿名引用；退出后第一次有回答的列表即结算：只认领 PID、进程名相符，且按 TIMESTAMP 年龄（`<d> days HH:MM:SS`）
    推算的签发秒整段落在 [启动, 退出] 内的唯一一行。证明不了（更早或更晚的持有者、窗口内两行、时钟回拨、格式不符）就不认领：
    宁可泄漏一个 token（PF 在解除后保持开启、锚点已空，与匿名引用的已接受状态相同），也不释放可能属于别人的 token。
  - R639-F2（codex:F2；合并回归审查复报 codex:F3）：引用记录写失败时的匿名回退用 `try?` 吞掉新 token 的 `-X` 超时，并清掉唯一的
    内存 token，重新造成 TM-claude-6 类累积。改后：`-X` 有回答才遗忘；没有回答时 token 留作未记录引用，下次巡检重试，disarm 释放。
- 新增/优化：无。helper 协议 4.48.0 → 4.49.0（fb5e8485 的内部候选带 4.48.0），CONTRACT 哈希按 `build-core-helper.sh` 同一管线重算
  （先复现 main 记录的 4.48.0 哈希）。
- 工程与测试：特权 `--lifecycle-self-test` 新增两项。`recovered-token-only-within-child-lifetime`（9d，纯解析，不跑 pfctl）：同一 PID
  两小时前的行不认领，40 s 前、落在子进程存活期内的行认领。`unanswered-fallback-release-keeps-token`（9e）：记录路径不可写（同 9b），
  注入的释放按 `run` 超时的方式抛错，token 必须留在内存且仍被内核列出；随后 disarm 释放，PF 起始为关时 `pfctl -d` 复原。9e 用注入
  代替 0 s 期限，没有 codex:F4 指出的时序竞争。红分支只加这两项检查、忽略窗口的 `pfEnableToken` 重载和被忽略的 `releaseToken:`
  参数，应以断言失败（返回旧持有者的 token；真实 `-X` 有回答，token 被释放并遗忘）。`-E` 超时后的完整找回（内核在期限后才发
  token）仍无法在 CI 复现，只覆盖认领规则。
- 验证：未在本地编译（MacBook 不是构建机）；以 macOS CI（`macos-26`，`build-core-helper.sh` 内的 `--self-test`、特权 `--self-test` 与
  `--lifecycle-self-test`）为准。红 run 36213252890 记录时仍在运行；修复分支 CI 结果未出。
- 候选/发布：仅源码，无新候选。
- 剩余限制：TIMESTAMP 是年龄的判断来自 macOS 26 `pfctl` 的格式串（`%-u days %.2u:%.2u:%.2u`）、xnu 按日历秒记 token 时间
  （`pf_calendar_time_second`）和公开样例，未在实机 root 下核对；若不是年龄，推算的签发秒落不进窗口，只会不认领，不会误领。
  整秒精度下，列表恰好跨秒且 token 与退出同一秒签发时，自己的 token 也会不认领（泄漏）。别的程序取 token 之后墙钟回拨、且 PID
  回绕到本子进程时，旧行可能落进窗口，未防。结算依赖 Foundation 在 `run` 放弃之后仍回收子进程并调用终止回调；不调用或子进程永远
  卡在内核时，待定获取不结算，hold 一直用匿名引用（不误释放）。待定获取与未记录 token 仍只在内存里。9c 的 0 s 期限竞态（codex:F4）
  未改。未实机。
- **2026-09-26 续记（#643 审查 run `2427b88c` 通过，确认 minor 续修）**：
  - 缺陷修复（grok:F2 = opus:F2）：`holdPFEnableReference` 在记录已写成新 token、内存槽已清空之后才 `try?` 列出并 `-X` 旧 token，
    列表或 `-X` 没有回答时旧 token 被遗忘，disarm 后仍被内核持有（#639 之前就存在的旧代码缺陷）。改后按 R639-F2 同一规则：旧 token
    进入内存列表 `supersededPFEnableReferences`，只有 pfctl 回答（已释放或已不在列表中）才遗忘；没有回答的留着，下次巡检（记录的 token
    仍被列出时）重试，disarm 释放。释放只在新 token 已记录且持有时发生；值等于当前持有 token 的旧项只遗忘、不释放；超时不算释放。
  - 工程与测试（codex:F3）：TIMESTAMP 年龄解析改为严格形状：天数 1–6 位数字，`HH:MM:SS` 每段恰好两位并检查范围；`00::00:40`、
    `0:00:40`、带符号的天数都不算年龄，不认领。
  - 工程与测试（grok:F3）：9d 增加窗口内两行（不认领）、跨秒列表使签发秒超出退出一秒（不认领）及恰好落入的对照行（认领）；新增
    `recovered-token-age-shape-strict`。9e 新增 `unanswered-fallback-token-released-at-disarm`：disarm 必须成功（不再 `try?`）、
    token 不再被列出、PF 回到起始状态。新增 9f `unanswered-superseded-release-keeps-token`：一个真实旧 token 放进被替换列表，注入的
    `-X` 无回答时它必须留在列表且仍被列出，下一次巡检用真实 `-X` 释放。9f 直接放入列表，不经记录写入覆盖旧记录的路径（该路径需要
    `heldPFEnableReference` 对仍被列出的记录回答否，CI 上无法廉价造出）。
  - helper 协议仍为 4.49.0（本 PR 未合入）；CONTRACT 哈希按 `build-core-helper.sh` 同一管线重算（先复现上一版记录的哈希）。
  - 剩余限制（补充）：`spawned` 读取之前墙钟被回拨时，别的程序更早签发的 token 可能落进窗口并被认领（grok:F1 / codex:F1，仍未防）。
    保留下来的未回答 token 之后只按数值在列表中匹配；xnu 的 token 值在释放后可能被再次签发给别的程序，此时可能误释放（opus:F1，
    未能确证）。`exited` 是终止回调运行的时刻，不是子进程被回收的时刻，二者间隔无上界（codex:F2，按回收后需整轮 PID 回绕才会误认领判断为
    极难触发）。被替换 token 列表同样只在内存里，helper 退出即丢。未本地编译，以 macOS CI 为准；未实机。
