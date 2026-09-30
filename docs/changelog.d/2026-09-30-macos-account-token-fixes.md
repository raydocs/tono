## 2026-09-30 · macOS 旧令牌拒绝不再挂起新会话，Retry 保留未落盘凭据
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1；macOS 账户 API 鉴权与账户恢复。
- 来源：main `80f4b4d0` → 分支 `codex2/mac-account-token-fixes`；PR 待开；未合 main。
- 缺陷修复：同一账户续期后，迟到的旧 bearer 401 曾再次续期；带旧 bearer 的决定性重放在传输重试后又遇 401，会撤回健康会话的出口并挂起账户。`TonoAPIClient.swift` 在报告会话判定、解析拒绝原因前检查 bearer 是否仍为当前值；初次拒绝沿用现有恢复重放，决定性重放至多追加一次最新 bearer 重放，复用新令牌或等待已有续期，不用旧 401 再发起续期。四处 unauthorized 恢复共用同一检查，只有仍为当前值的 bearer 才触发续期；已无令牌且无待完成续期时照旧续期；追加重放再次被续期超越则按取消结束。首次登录成功但 refresh token 写入钥匙串失败后，`AccountSession+Auth.swift` 的 restore 改读 API 客户端的 `hasRestorableSession`，先重试持久化内存凭据，写入仍失败也继续保留该会话。关联 [MAC-STALE-BEARER-401-SUSPENDS](../findings.d/MAC-STALE-BEARER-401-SUSPENDS.md)、[MAC-RETRY-IGNORES-UNPERSISTED-TOKEN](../findings.d/MAC-RETRY-IGNORES-UNPERSISTED-TOKEN.md)。
- 新增/优化：无。不改 PF、DNS、路由或标准释放路径；不新建 AI 阻断层，健康连接时的 AI 服务阻断保持不变。
- 工程与测试：`AccountSessionRequestTests.swift` 新增一个窄 XCTest，组合迟到 A/401（`USER_DISABLED`）、决定性 B 重放的截断 200 / 传输重试和合法 B→C 续期，检查旧拒绝复用 C、不额外续期且账户不挂起。Retry 未新增测试：现有钥匙串接缝只能注入读取，不能低成本模拟写失败；restore 先执行特权运行时清理，采用本任务允许的廉价接缝例外。
- 验证：当前分支 worktree 的 `git diff --check` 通过，两条 finding 经 `node tooling/scripts/records.mjs findings --id <ID>` 正确读取；逐行复核 Swift 类型、可选值、`try` / `await` 和取消分支。本环境为 Linux，无 Swift / Xcode，XCTest 与 `xcodebuild` 未执行；Windows 未触及、未编译。新增 XCTest 需 hosted macOS CI 执行，本条不声称 CI 已通过。无网络路径改动，不要求 `needs-hardware`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：竞态结论来自源码推导，未在客户设备复现；同会话旧 bearer 的 403 / 2xx 判定未纳入本次修复。restore 在检查内存凭据前仍会读取设备锚点，锚点读取失败仍可阻止恢复；内存凭据不能跨进程重启保留。
