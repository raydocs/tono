## 2026-09-30 · 解除杀开关时 Core 没停住就把隧道 DNS 装回去
- 归属：SHIP_PLAN §2 item 10（不断网）；Windows Service `ReleaseKillSwitch`。Issue #846。
- 来源：基线 `50bbbbf0` → 分支 `cursor/win-release-dns-compensation-f0e7`（本分支 PR），未合 main。
- 缺陷修复：`POST /kill-switch/release` 先 `ensure_restored()`，把解析器改回公网并清掉保护意图，再停 Core。停 Core 失败时函数直接返回，WFP 仍武装。公网解析器被这道屏障拦住，隧道解析器又已经拆掉。现在 `stop_core` 没有完成时调用 `dns::enable()`，把隧道 DNS 装回去，屏障不拆。停 Core 已经成功、只是记账失败时不装回去：没有进程在听 `198.18.0.2`，装回去会把名字打进空地址。这条也不拆 WFP。
- 新增/优化：无。
- 工程与测试：`a_failed_core_stop_puts_protected_dns_back_and_bookkeeping_does_not`。
- 验证：本机 `rustc 1.83.0` 编不过 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 `windows-2025` CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Core 已停、记账失败时，公网 DNS 仍可能被武装的 WFP 拦住。拆掉这道屏障会同时丢掉 AI 服务拦截，本 PR 不做。需要实机确认停 Core 失败后 `dns::enable()` 真的把适配器指回隧道。
