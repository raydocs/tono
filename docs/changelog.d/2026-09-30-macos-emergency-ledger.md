## 2026-09-30 · 坏账本不再挡住紧急恢复
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）。macOS helper。
- 来源：基线 main `d2363002`；分支 `cursor/macos-emergency-ledger-581a`。尚未合 main。不改 #691，也不包含 #701。
- 缺陷修复：`--emergency-disarm` 在更新账本读不出时仍释放 PF，并尽量恢复 DNS。账本文件不改、不删。`--emergency-reset` 在不能移除安装时同样先释放网络，不删安装。DNS 恢复失败不再跳过 PF 释放。待定更新的 disconnect 失败时也释放 PF。
- 新增/优化：无。首次正常开机自动改掉 `/etc/pf.conf` 的 `load anchor from` 并在 Core 已停时释放，是 #701，不在本分支复制。
- 工程与测试：helper `4.52.4` → `4.52.5`。`--self-test` 断言坏账本在没有严格杀开关时仍要释放。`CONTRACT.sha256` 重算。
- 验证：Linux 无 Swift、无 PF。未编译、未跑 self-test。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不 bootout 其他进程，不在 DNS 验证通过之前才允许放行，也不写“以后禁止启动”的标记（这些是 #691 里被挡住的做法）。`KillSwitchManager` 初始化仍会先按旧逻辑尝试恢复再 disarm，中间有一段窗口。未实机。版本行与 #701、#695、#708、#710 冲突。
