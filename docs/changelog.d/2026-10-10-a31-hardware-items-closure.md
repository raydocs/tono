## 2026-10-10 · A31 真机验收项的代码侧收口（W2、W8、#171、H16-O-F6、I2/#273）
- 归属：ops 计划（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §6 A31），不是发布门；文档（总账五行）。
- 来源：基线 origin/main a504ca31；分支 `amp/a31-hardware-items-closure`。
- 缺陷修复：无新修复。逐项核对修复已在 main：W2、W8 → #267（0e20f2df）；#171 → #174（d769e134）；
  H16-O-F6 → #520（a36a89c5，经 #606 合入 main 42cea896），后续 F520-1（e2aff1a3）；I2/#273 → #276（f1c1c9d9）。
  对应 issue #249、#259、#171、#519、#273 均已于 2026-09-26 关闭。
- 新增/优化：无。
- 工程与测试：五项的回归测试都已在 main，本 PR 未新增测试：W2 `dns/tests.rs` 两个 NRPT 恢复失败用例；
  W8 `netmon.rs` `a_real_network_change_during_dns_write_is_deferred_not_discarded`；#171 macOS
  `ConnectionCoordinatorTests` 与 Windows `switch.rs` `failed_exact_endpoint_commit_recovers_instead_of_completing_the_switch`；
  H16-O-F6 `window.rs` `refusal_dialog_promises_protection_only_for_a_live_barrier_after_the_release_ended`；
  I2 `tooling/scripts/tests/macos-candidate-workflow.test.rb`。
  总账五行状态保持 `fixed(<SHA>)`，「剩余限制」改为「待实机」+ 缺的设备证据 + hardware evidence pending。
- 验证：Linux orb 上 `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 通过（Ruby 3.1.2）；
  `node tooling/scripts/records.mjs findings --id <ID>` 五行可读。Swift 与 Windows `cargo` 测试本机未运行，以托管 CI 为准。
- 候选/发布：仅文档，无新候选。
- 剩余限制：五项都缺实机证据，归老板；未改 SHIP_PLAN §6 门行。
