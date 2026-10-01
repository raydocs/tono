## 2026-09-30 · 被放弃的 DNS 写入在返回前仍算自己的网络事件
- 归属：SHIP_PLAN §2 item 10（不断网）；Windows Service DNS 自写窗口。发现 R3-O2。
- 来源：基线 `50bbbbf0` → 分支 `cursor/win-dns-self-write-holds-f0e7`（本分支 PR），未合 main。
- 缺陷修复：`bounded_dns_call` 超时或外层 future 被丢弃时，异步函数上的自写窗口立刻关闭，但 `spawn_blocking` 里的注册表写入还在进行。写入完成时的 `NotifyIpInterfaceChange` 若晚于 1.5 秒尾巴，会被当成机器自己的网络变化。保护中的一次自写被误报后，连接会按外部变化重来一轮。现在 apply、快照恢复、NRPT 抑制/恢复，以及卸载用的 NRPT 清扫，都在写入线程上另持一把窗口，直到这次写入返回。60 秒年龄上限不变，卡住的写入不能一直压住真实网络事件。解除杀开关的证明失败仍保持拦截。
- 新增/优化：无。
- 工程与测试：`an_abandoned_caller_does_not_close_the_window_the_write_still_holds`。
- 验证：本机 `rustc 1.83.0` 编不过 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 `windows-2025` CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：通知是否真的在超时之后才到达，要在 Windows 上才能看到。本修复只保证窗口覆盖仍在进行的写入。
