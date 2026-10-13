## 2026-10-13 · macOS 退出登录留下的钥匙串失败、账号残留与紧急重置（#1303）
- 归属：`docs/SHIP_PLAN.md` §2 item 10（G4 冻结期内的 macOS 生命周期收尾；不属于「装上会坏/更新会坏/连不上」，冻结期合并由主会话决定）；Issue #1303（R5 生命周期排查）；macOS App（`TonoAPIClient`、`AccountSession`）与 root helper（`--emergency-reset`）。
- 来源：基线 origin/main 20266ba2f；分支 `claude/keychain-signout`；PR 见 #1303 的链接；尚未合 main。
- 缺陷修复：(1) 退出登录时钥匙串删除失败原来被忽略，下次启动 `hasRestorableSession()` 会还原同一账号；现在删除失败会重试一次，仍失败则写入「已退出」墓碑（沿用既有的 refresh-token 抑制记录，启动时已被 `currentRefreshToken` 遵守），本进程同时停用该令牌，错误写日志；下一次登录替换令牌并清除墓碑。(2) `clearAccount()` 现在清除 `lastTrafficPolicyRevision`、`lastCatalogFailureMessage`、`lastTrafficPolicyFailureMessage`、`lastConnectFailureAt`（流量策略本身是全局的，不动）。(3) `--emergency-reset` 在 AI 服务层（/etc/resolver 黑洞解析与黑洞路由）未被证明已清除时保留 helper、重新引导 daemon、打印残留项并以非零退出，与 DNS 恢复失败相同（决定 121，provisional）。
- 新增/优化：无。
- 工程与测试：`testSignOutWhoseKeychainDeleteFailsStaysSignedOutAcrossClientRelaunch`、`testClearAccountDropsThePreviousAccountsDiagnosticResidue`（XCTest）；helper 自测 `emergency-reset-keeps-helper-while-selective-layer-remains`。helper 协议版本 4.52.53 → 4.52.54。
- 验证：见 PR 的 Verification 一节（红/绿运行号、Codex 审查回执）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：墓碑写入与钥匙串删除同时失败时，重启仍可能恢复（本进程内已停用）；实机未验证。
