## 2026-10-23 · macOS 新登录只清理已证实无保护的孤儿 AI Home 会话
- 归属：SHIP_PLAN G1 连接准入；五模型审计 F2，决定 130/131 的保护与默认回退边界。
- 来源：基线 `ca40f3baadd28dd792c12c6d2bc5b647cfec20a0`；分支 `fix/macos-orphan-routing-20261023`，[#1730](https://github.com/raydocs/tono/pull/1730)，未合 main。精确 FIX head 与 review/CI 结果在 PR 回执单列。
- 缺陷修复：`MAC-ORPHAN-AIHOME-ADMISSION`。过去 record-only 状态跳过 helper 对账，AppState 内存仍保留 AI Home，新的无家宽账户因此无法进入 Stable。新登录在 durable auth 后、runtime admission 前，对当前空闲会话完成两项新鲜 helper 观察；只有 accepted broad false 与 selective false 同时成立，才同时清内存和磁盘。
- 新增/优化：新认证用途与同账户恢复分开；身份呈现、取消、保护代次、连接/断开、Core 与原生更新状态守卫。activation 已先接受同一 release 的分支也核对 selective 状态，不因提前返回遗留孤儿记录。
- 保留行为：仍 held、未知、拒绝、读取失败、被新操作超越时保留原会话；Check again 与同账户重新认证不清捕获模式；saved preference、strict intent、静态启动清理、路由/PF/helper 均不变。此修复不授权新账号替换仍 held 的 AI 保护。
- 工程与测试：一条 `AccountSessionRequestTests.testFreshAuthenticationRetiresOnlyAProvenOrphanAIHomeMode`，使用真实 auth lifecycle、durable credential adopt、AppState/coordinator 与 admission；仅替代 auth/catalog/helper I/O。种盘在 AppState 构造前；无墙钟竞态/表驱动；覆盖保留、代次/账户/取消竞争、同账户恢复、record-only 新账户及同 release 已先接受路径。
- RED 说明：`3860634bece3819a09c6f3299da051808af6d8d6` 保留旧认证/清理行为，仅增加未使用的 callback/签名以使同一测试编译；已派发 `macos-ci` run `39940302697`。预期旧行为在实际 admission 的 `ai-home != stable` 断言失败，初次提交时尚未读到运行结果，未称已 RED（结果见以下续记）。
- 工程续记：初始 RED run `39939707619` 被主动取消；静态复核发现 fixture 把已有 `selectiveAIRecoveryPending` 错写成不存在的字段，两侧同样修正后重派。该次不是行为 RED，也不是产品缺陷。
- 验证：本机只执行精确差异、测试 blob 一致性和记录格式静态检查；XCTest/build 由 hosted macOS CI 执行，未在 MacBook 运行原生构建。初次提交时 FIX GREEN、独立高风险审查均待 PR 回执，不以静态检查替代（结果见以下续记）。
- 候选/发布：仅源码，无新候选、签名包、生产部署或客户更新源推进。
- 剩余限制：安装机的新登录/重启/真正 AI hold 与无 Home 账户组合未验；两次 helper 读取不是新的跨进程原子 epoch，不声称防住任意外部 root 修改；macOS 自动换城仍关闭。

### 2026-10-23 · hosted 行为 RED/GREEN 与独立审查续记
- Red check：旧行为源码 `3860634bece3819a09c6f3299da051808af6d8d6`，macos-ci [39940302697](https://github.com/raydocs/tono/actions/runs/39940302697)；新测试在 `AccountSessionRequestTests.swift:2919` 实际报 `Optional("ai-home")` 不等于 `Optional("stable")`。共 758 tests、1 skipped、1 failure；唯一失败为该回归，不是编译、夹具或超时。
- Ran：FIX `90ea664b2628bd49c13c9d981d07af64291b15b7` 的 ci-gate [39940438304](https://github.com/raydocs/tono/actions/runs/39940438304) 成功；新回归 0.447 s 通过，758 tests、1 skipped、0 failures；helper、policy、privileged、build 与 runtime contract 检查均通过。RED/FIX 完整测试 blob `70acb43009f51387fae6e99e15c9c750a0f94bad` 相同。
- 独立审查：Sol/xhigh，same model/fresh context，R1 覆盖 `ca40f3baa...90ea664b2`，六项不变量和真实 TonoApp 接线均核对；无 actionable finding，`VERDICT: approve`。审查仅是源码/静态证据，运行结果由根线程另读原始日志确认。
- 本续记仅修改 finding/changelog；未重写以上运行结果为新的源码 SHA。最终文档 head 的 CI、复用的源码审查覆盖、无待解决 review thread 和 merge 门禁由 PR 最终回执记录。
- Not run：本机 Swift/native 构建、安装机新登录/账户切换/冷启动、真实 helper/PF/selective hold 故障注入、签名候选及客户交付；真实或未知 AI hold 仍不自动降级。
