## 2026-09-26 · macOS：helper 命令执行器加 15 s 期限，超时按失败处理
- 归属：G1（断开要收回保护/DNS：`/core/stop` 不能被卡住的 `pfctl` 挂住）；Issue #601 条目 R609-F2。helper
  `KillSwitchPF.swift`、`KillSwitchManager.swift`、`KillSwitchTests.swift`、`CONTRACT.sha256`；App `Core/HelperProtocolVersion.swift`。
- 来源：基线 origin/main `8b5f6fcd`；红分支 `wip/macos-pfctl-deadline-20260926-red`（`9f725ed9`），修复分支
  `fix/macos-pfctl-deadline-20260926`，[#639](https://github.com/raydocs/tono/pull/639)；未合 main。
- 缺陷修复：helper 的 `KillSwitchManager.run` 等 `pfctl`（以及拉中继表的 `curl`）没有期限。`/core/stop` 现在先撤回
  reviewed-bundle 许可（#608），卡住的 `pfctl` 会一直占着 Core 停止和 helper 唯一的请求线程；App 的 6 s 接收超时取消不了它。
  改后：输出在单独线程读完，等退出和读尽最多 15 s；超时先 SIGTERM、再 SIGKILL（各等 1 s），然后抛
  `HelperFailure.system`。超时一律是失败，不当成功：`try run` 的调用方（装载、`-E`、清状态、disarm、撤回、紧急拦截、`curl`）
  照原样报错；`try?` 的调用方把超时读成「未启用 / 锚点不在 / token 未列出 / 释放失败」，只会重装或继续持有 PF，不会因超时放开。
  读线程持有进程和读端直到子进程管道关闭，放弃的读取也会结束，不漏 fd，子进程会被回收。
- 新增/优化：无。15 s 的依据：`pfctl` 装载和查询在高负载机器上也远低于 1 s，`curl` 自带 `--max-time 10`，只有卡死的子进程会碰到。
  helper 协议 4.47.0 → 4.48.0，CONTRACT 哈希按 `build-core-helper.sh` 同一管线重算（先复现 main 记录的 4.47.0 哈希）。
- 工程与测试：helper `--self-test` 新增检查 `command-deadline`：`run("/bin/sleep", ["6.0417"], deadline: 0.5)` 必须在 4 s 内抛错，
  且 `pgrep -f '^/bin/sleep 6.0417$'` 找不到进程。红分支只含该检查、忽略 `deadline:` 的骨架和协议号，应以断言失败（6 s 后返回状态 0）。
- 验证：未在本地编译（MacBook 不是构建机）；以 macOS CI（`macos-26`，`build-core-helper.sh` 内的 `--self-test` 与特权 `--self-test`）为准，
  PR 提交时尚未出结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：回归不覆盖 SIGKILL 升级（忽略 SIGTERM 的子进程）；卡在内核不可中断等待、SIGKILL 后仍不退出的 `pfctl` 不再等待，
  由它自行退出后回收。撤回时被杀的 `pfctl -f` 可能已提交收紧后的规则，文件回滚为旧规则（内核只会更严），沿用原回滚逻辑。未实机。
