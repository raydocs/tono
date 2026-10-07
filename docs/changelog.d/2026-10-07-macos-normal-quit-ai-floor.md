## 2026-10-07 · macOS 普通 Quit 的选择性 AI 恢复层
- 归属：SHIP_PLAN §2 item 10；MAC-QUIT-AI-HOLD；decision 073 provisional。
- 来源：main f2cb79522 → 先叠 BRICK-M1 #1444 e0bca2fd；Quit [#1445](https://github.com/raydocs/tono/pull/1445)，未合 main。
- 缺陷修复：普通 Quit 不再等同显式 Disconnect：Core/DNS 证明后使用独立认证 helper 请求，在保护锁中仅对武装/既有 retain-ai 意图保留窄层。显式 Restore 与 Quit 重叠时，在现有 disconnect queue 的最终释放处读取实时选择；已完成 Restore 后的 Quit 不重建层。
- 新增/优化：认证的窄层意图读取，首页和未登录账户 gate 展示可移除提示，不把 best-effort AI floor 称为全保护；helper 4.52.42 → 4.52.43。
- 工程与测试：新增 QuitAIHoldTests 七条窄 XCTest，覆盖 DNS 等待中 Restore 优先、Quit 等待 IPC 时后加入的 Restore 队尾必须排空、DNS 无证明不释放、真实更新 pending 保持所有权/认证无 pending 后退休过期本地闸门、下次启动观察/移除与嵌入 helper 的实际只读意图策略。未运行旧源码红测，不声称红→绿。
- 验证：本机 `git diff --check`；MacBook 未执行 XCTest、helper 原生构建/自测、PF/DNS/安装；hosted ci-gate 与独立 Codex high / Jev 待验。
- 候选/发布：仅源码，无新包、tag、客户发布或设备安装。
- 剩余限制：decision 为 provisional；原有 AI 安装 best effort，不保证外部 AI 网络隔离；不可读/失联 helper 不作已释放判定；更新执行器拥有的网络不竞争。真实退出、崩溃恢复、PF/DNS 与签名候选验证留 G1/G2。

- 2026-10-07 一轮续修：Jev0f535770 PASSED（所有已核验项为 minor，非原生验收）。修复新队尾未排空、过期更新闸门和无 AppState 的旧 helper/Core 兜底；同步 BRICK #1444 的保守守卫续修后静态重算 protocol43 CONTRACT。上述四个评审 ID 记 in-PR，同根因不重复计数。gate 窄层仍沿用黄昏视觉/“turn off protection”按钮的 suggestion 保留为呈现限制，未改登录页面结构。新精确 head 原生 CI 与增量 review 待验。

- 2026-10-07 续审：精确源码 c20b0f6b / Jev91f6ecd9 PASSED，实际 gpt-6.1-sol/high + Opus，无 major；过期更新闸门、早期 fallback 复核关闭。新查询期间 generation 改变可让 Quit 先于后续 Restore 退出，是旧队尾问题的新入口，两个对应分片 R1445-opus-F2/R1445-codex-F1 改 open，按一轮止损不再修。gate 呈现与连接后窄层 UI 标志未复位的 suggestion 留 PR 限制。当前只补记录，runtime/test/CONTRACT 与已审 c20b0f6b 相同；native CI/G1/G2 未验不写通过。

- 2026-10-07 main 集成续交付：#1444/#1446/#1447/#1440 已先合入 main ee22990a5；将原 #1445 最终树（92674f99，含 merge c20b0f6b 中的 Quit 修复）完整展平为可重放提交再 rebase，避免普通 rebase 丢掉 merge 内修复。唯一手工冲突为 Localizable.xcstrings 的同位置新增文案，保留 Keychain 恢复记录错误与 AI 窄层提示；不改既有条目。Helper 保持 main4.52.42+0.0.1=4.52.43。逐文件 blob/三方 JSON 合并证明后，复用 Jev91f6ecd9 精确源码覆盖和各已合入 PR 的覆盖；无新增高风险冲突语义，不重新审整个批次。新 head 的 hosted ci-gate 尚待验，不复用旧绿灯，不执行合并/候选构建。
