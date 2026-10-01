## 2026-10-01 · macOS helper：选择性 AI 清理不再删除别人的同前缀路由
- 归属：macOS helper（G4 冻结外的 issue 修复）；协议 4.52.32 → 4.52.33。
- 来源：origin/main `8f1b720b` → 分支 `claude/fix-1164-selective-route-ownership`（Fixes #1164）。
- 缺陷修复：
  - #1164：每次成功 arm、显式恢复和中断清理都对 `160.79.104.0/23`、`2607:6bc0::/48` 执行只按目的地的 `route delete`，管理员或安全软件事先装的同一前缀路由会被删掉且不恢复。现在删除前先只读查询该前缀（`route -n get`）：查询结果正是这个前缀、且 flags 里没有 `BLACKHOLE` 时保留它，不删；查不到、读不懂或最佳匹配是别的路由时照旧删除，保证 Tono 自己的黑洞路由不会残留。
- 新增/优化：无。apply 行为不变；不改 PF、DNS 或全局放行。
- 工程与测试：`SelectiveFailOpen.runSelfTests`（`--self-test`）加一条：外来非黑洞路由判为外来，Tono 黑洞和默认路由仍删除。
- 验证：本机不运行 Swift；`route -n get` 的输出格式在 macOS 26（Darwin 25.5）上只读核对过（精确前缀的 v4、v6 均为 `destination:`、`mask:`、`flags: <...>`）。CONTRACT 用 build-core-helper.sh 的同一清单和规则重算（main 上 4.52.32 复算一致）。Swift 自测由托管 macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：管理员自己装的同前缀黑洞路由仍会被删；外来路由存在时 apply 的 add 照旧失败，fail-open 期间该前缀不被黑洞（与之前相同）；真实 /23、/48 黑洞的读回需要实机（needs-hardware）。
