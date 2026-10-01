## 2026-10-01 · macOS helper：卸载清理在 Core 杀不掉时保留 helper
- 归属：macOS helper（G4 冻结外的 issue 修复）；协议 4.52.33 → 4.52.34。
- 来源：origin/main `7e423077` → 分支 `claude/fix-1251-removal-stale-core`（Fixes #1251）。
- 缺陷修复：
  - #1251：#763 之后，扛过 SIGKILL 的 Core 不再让紧急释放中止；Tono.app 被删时 helper 照常放开 PF、恢复 DNS 后就删掉自身安装，那个 Core 可能还在跑，没有任何东西再去停它或等它的 TUN 消失。现在紧急释放多返回一种结果「Core 仍在运行」，卸载清理遇到它时保留安装，由空闲检查（或 launchd 重启）重试停止。DNS 未恢复的结果优先，行为同 #1222。
- 新增/优化：无。`--emergency-disarm` 仍放开 PF；`--emergency-reset` 仍按管理员要求删除安装并提示残留进程。
- 工程与测试：`--update-self-test` 加 `removal-keeps-helper-while-stale-core-survives`。
- 验证：本机不运行 Swift；CONTRACT 用 build-core-helper.sh 的同一清单和规则重算。Swift 自测由托管 macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：卡在不可中断 I/O 的进程通常到重启才消失，期间 helper 每次检查都会重试；未实机验证（needs-hardware）。
