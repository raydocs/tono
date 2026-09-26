## 2026-09-26 · macOS：helper 命令执行器加 15 s 期限，超时按失败处理
- 归属：G1（断开要收回保护/DNS：`/core/stop` 不能被卡住的 `pfctl` 挂住）；Issue #601 条目 R609-F2。helper
  `KillSwitchPF.swift`、`KillSwitchManager.swift`、`KillSwitchTests.swift`、`CONTRACT.sha256`；App `Core/HelperProtocolVersion.swift`。
- 来源：基线 origin/main `8b5f6fcd`；红分支 `wip/macos-pfctl-deadline-20260926-red`（`9f725ed9`），修复分支
  `fix/macos-pfctl-deadline-20260926`，[#639](https://github.com/raydocs/tono/pull/639)；未合 main。
- 缺陷修复：helper 的 `KillSwitchManager.run` 等 `pfctl`（以及拉中继表的 `curl`）没有期限。`/core/stop` 现在先撤回
  reviewed-bundle 许可（#608），卡住的 `pfctl` 会一直占着 Core 停止和 helper 唯一的请求线程；App 的 6 s 接收超时取消不了它。
  改后：输出在单独线程读完，等退出和读尽最多 15 s；超时先 SIGTERM、再 SIGKILL（各等 1 s），然后抛
  `HelperFailure.system`。超时一律是失败，不当成功：`try run` 的调用方（装载、`-E`、清状态、disarm、撤回、紧急拦截、`curl`）
  照原样报错。读线程持有进程和读端直到子进程管道关闭，放弃的读取也会结束，不漏 fd，子进程会被回收。
- 缺陷修复（#639 双厂商复核）：只读查询（`-s info`、`-sr`、`-a <锚点> -sr`、`-s References`）没有回答（启动失败或超时）时
  改为抛错，不再读成「否」；非零退出仍按原义。codex:F1：disarm 清空后的子锚点复核没有回答就抛错，删意图、释放引用之前停下。
  opus:F2（释放侧）：`releasePFEnableReference` 在查询或 `-X` 没有回答时抛错并保留记录（和未记录的 token），留给下次 arm 复用或
  下次 disarm 释放；disarm 记日志，照常报告已解除（锚点已空、意图已删）。opus:F2（获取侧）：`-E` 超时被杀时按子进程 PID 记下，
  之后的 hold / release 在 `pfctl -s References` 的 `PID 进程名 TOKEN` 行里找回这个 token，收作未记录引用；子进程已退出且无此行
  则放下；子进程可能仍在内核里时，hold 改用匿名引用 `pfctl -e`，不再取第二个 token。opus:F1：只读查询期限改为 3 s（连两次各 1 s 的
  终止等待约 5 s，低于 App 默认 6 s 的请求等待），装载、清状态、`-E`/`-X`、`curl` 仍为 15 s；超时的读取中止整条链：巡检跳过本轮，
  `ensureAnchorLoaded` / `holdPFEnableReference` 直接抛错。codex:F2：特权生命周期自测读不到初始 PF 状态时按「已启用」处理并判失败
  （`reference-start-state-read`），不会据此 `pfctl -d`。
- 新增/优化：无。15 s 的依据：`pfctl` 装载和查询在高负载机器上也远低于 1 s，`curl` 自带 `--max-time 10`，只有卡死的子进程会碰到。
  helper 协议 4.47.0 → 4.48.0，CONTRACT 哈希按 `build-core-helper.sh` 同一管线重算（先复现 main 记录的 4.47.0 哈希）。
- 工程与测试：helper `--self-test` 新增检查 `command-deadline`：`run("/bin/sleep", ["6.0417"], deadline: 0.5)` 必须在 4 s 内抛错，
  且 `pgrep -f '^/bin/sleep 6.0417$'` 找不到进程。红分支只含该检查、忽略 `deadline:` 的骨架和协议号，应以断言失败（6 s 后返回状态 0）。
  复核修复另加特权 `--lifecycle-self-test` 检查 `reference-kept-past-unanswered-query`（9c）：写一条本次开机的假 token 记录，
  `releasePFEnableReference(recordPath:queryDeadline: 0)` 必须抛错且记录仍在。红分支 `wip/macos-pfctl-deadline-20260926-red2`
  （`b42ac598`，基于 `03f23ef6`，只加该检查和被忽略的 `queryDeadline:` 骨架）应以断言失败：查询答「未列出」，记录被删。
  其余改动未单独测：`-E` 超时后找回 token 需要内核在期限后才发出 token，无法在 CI 复现；3 s 期限与巡检跳过是时序行为；
  disarm 的子锚点复核抛错要真实挂住 `pfctl`；初始状态读取失败的分支同理。
- 验证：未在本地编译（MacBook 不是构建机）；以 macOS CI（`macos-26`，`build-core-helper.sh` 内的 `--self-test`、特权 `--self-test`
  与 `--lifecycle-self-test`）为准。首轮：红 run 36209679782 以断言失败，修复 CI 通过。复核修复推送时 CI 尚未出结果。
  协议号仍为 4.48.0（未发布），CONTRACT 哈希按同一管线重算。
- 候选/发布：仅源码，无新候选。
- 剩余限制：回归不覆盖 SIGKILL 升级（忽略 SIGTERM 的子进程）；卡在内核不可中断等待、SIGKILL 后仍不退出的 `pfctl` 不再等待，
  由它自行退出后回收。撤回时被杀的 `pfctl -f` 可能已提交收紧后的规则，文件回滚为旧规则（内核只会更严），沿用原回滚逻辑。
  每个请求最多只等一次超时，但装载等写操作仍是 15 s：`/core/stop` 的撤回若卡在装载上，仍会超过 App 的 6 s（helper 随后照常停 Core）；
  `status()` 的自愈和紧急拦截是保护兜底，超时后仍会各试一次，未改。`-E` 找回依赖 `pfctl -s References` 的 `PID 进程名 TOKEN`
  行格式（公开样例，未在 macOS 26 实机核对）；格式不符时找不回，子进程退出后放下，等同修复前的泄漏。待定的 `-E` 和未记录 token
  只在内存里，helper 进程退出即丢。非零退出仍按「否」处理（修复前语义）。未实机。
