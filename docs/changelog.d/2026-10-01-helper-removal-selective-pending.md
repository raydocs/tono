## 2026-10-01 · macOS helper：卸载清理在 AI 拦截层未撤掉时保留 helper
- 归属：macOS helper（G4 冻结外的 R5 bug hunt 修复）；协议 4.52.35 → 4.52.36。
- 来源：origin/main `4bb0ba4a` → 分支 `claude/r5-mac-removal-selective-pending`。
- 缺陷修复：
  - MAC-REMOVAL-SELECTIVE-PENDING：#1283 让撤不掉的 AI 拦截层（`/etc/resolver` 汇点文件、Anthropic 黑洞路由）保持「releasing」，由 helper 启动和看门狗重试。但 Tono.app 被删时，紧急释放只看 DNS 和 Core，结果是 `.released` 就删掉 helper 安装，没有东西再重试，`/etc/resolver` 里的 AI 汇点文件在卸载后一直留着（路由重启后消失）。现在卸载清理在撤除仍挂起时保留安装，空闲检查 10 秒后重试，撤完再删。
- 新增/优化：无。`--emergency-disarm`、`--emergency-reset` 不变。
- 工程与测试：`--update-self-test` 加 `removal-keeps-helper-while-selective-removal-pending`。
- 验证：本机不运行 Swift；CONTRACT 用 build-core-helper.sh 的同一清单和规则重算（先在 main 上复现 `07bee54b…`）。Swift 自测由托管 macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：撤除永久失败（例如回执损坏）时 helper 每 10 秒重试一次并保持安装，PF 已放开、普通网络可用；`--emergency-reset` 仍按管理员要求删除安装。未实机验证（needs-hardware）。
