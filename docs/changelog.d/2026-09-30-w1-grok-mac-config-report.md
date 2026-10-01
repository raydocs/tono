## 2026-09-30 · W1 macOS 配置狩猎报告
- 归属：SHIP_PLAN §2 item 10 的狩猎记录，不是客户发布。
- 来源：基线 `50bbbbf0` → 分支 `hunt/grok-maccfg-report-89a9`（#875），未合 main。
- 缺陷修复：无。已核实的路由缺口在 #867，不在本 PR。
- 新增/优化：无。
- 工程与测试：新增 `docs/agent-reports/W1-grok-mac-config.md`（M9–M12 结论、假阳性和 PR 状态）。无产品测试。
- 验证：文档。未跑 XCTest，未部署。
- 候选/发布：仅文档，无新候选。
- 剩余限制：#867 的 `needs-hardware` 标签因令牌 403 没有打上。该修复 PR 的 auto-merge 曾打开，复查时已关，未再打开。本报告 PR 不开启 auto-merge。

## 2026-10-01 · 续记
- 归属：同一狩猎记录。对照基线 `17580a26`。
- 来源：仍是 #875，未合 main。
- 缺陷修复：无（本 PR 只更新报告）。DNS 缓存批次在 #886，待更新时隧道丢失在 #891。
- 新增/优化：无。
- 工程与测试：报告补上这两条、登录钥匙串未修项，以及 sing-box 中国直连不回落的决定。不改 `docs/DECISIONS.md`。
- 验证：文档。未跑 XCTest。#886 与 #891 的 auto-merge 各开一次（MERGE）。两处 `needs-hardware` 均 403，未再试。#867 当前 auto-merge 为 MERGE（raydocs，00:33 UTC），本回合没有切换。本报告 PR 仍然不开启 auto-merge。
- 候选/发布：仅文档，无新候选。
