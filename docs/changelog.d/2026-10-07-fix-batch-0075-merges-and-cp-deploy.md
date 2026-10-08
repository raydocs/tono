## 2026-10-07 · 0.0.75 修复批次合入、控制面部署与 main 批次评审
- 归属：SHIP_PLAN §2 item 10（所有者 2026-10-07「都修复完了发新版」：先修完可代码修复的 open finding，再从 main 出新候选）；平台 Windows / macOS / 控制面 / home-agent。
- 来源：基线 main `f2cb79522`（#1436）→ 本批次 16 个 PR 加 1 个修正 PR 全部以 merge commit 合入 main，终点 `e0179bd55`（含修正轮共 17 个 PR）。
  Windows：#1438 BRICK-W3（`ced46edb3`）、#1437 R681-release-gate-writes（`5f4ae256e`）、#1443 BRICK-W6 + issue #815（`b69f9b104`）、
  #1450 R4-WIN-MU-RECONNECT-FLAG / #1291（`8637e182f`，决策 075 provisional）、#1449 BRICK-W7（`c7e4cad61`）、#1448 BRICK-W10（`e5b5eda10`）、
  #1451 WIN-SINGBOX-FAKEIP-SERVICE-RESTART / #1258（`17afefd2a`）。
  控制面：#1435 issue #789（`de62eb2a5`，决策 072 provisional）、#1442 H17-G-F2（`3e64707e6`；H17-C-F2 经核实已由 #525 修复，账本改 fixed）、#1441 issue #816（`142c8ca67`）。
  home-agent：#1439 HOME-AGENT-PEER-RETENTION-CAP（`489a4d677`）。
  macOS（Codex 实现）：#1444 BRICK-M1 部分（`a14f6e03e`，helper 4.52.42）、#1446 issue #901（`2ea8b6112`，决策 074 provisional）、#1447 MAC-WEB-PINS-SUFFIX-STALE 边界记录（`765e71884`，仅文档）、
  #1440 R1426 resize（`ee22990a5`）、#1445 MAC-QUIT-AI-HOLD（`53676e913`，决策 073 provisional，helper 4.52.43）；
  修正轮 #1452 R1446-grok-F1 / MAC-KEYCHAIN-LOGIN-ROLLBACK（`e0179bd55`，2026-10-08 01:35Z）：Keychain 恢复以「已采用」标记为前提，
  拒绝标记写入与删除同时失败时不再让旧 refresh token 在下次启动被恢复；旧版本升级后需重新登录，PF 不自动释放。
- 缺陷修复：各 PR 自带 changelog 条目与 findings 分片（状态 in-PR → 本条合入后视为 fixed(main)），本条只记合入与部署事实，不重复。
- 新增/优化：无。
- 工程与测试：每个 PR 一条窄回归，Rust/Swift 仅由 hosted CI 证明（MacBook 不跑 cargo/xcodebuild）。GitHub `services / ops-console-e2e` 分片两次在「Install Playwright」步骤挂起约 4 小时（run 37665567402 / 37665567926），取消后以 `gh run rerun --failed` 补跑，结果与原 run 一致。
- 验证：
  - 每个 PR：ci-gate 在精确 head 绿；jev-route 评审 PASSED（停止规则：仅 major+ 阻塞，minor 一轮；仍开放的 minor 记在各 PR 剩余限制或 findings 分片），回执贴在 PR 评论。
  - main 批次评审 `6df213029...142c8ca67`：决策 `a3f11ab3` triple/high PASSED，1 minor（R681 残留，已记 `docs/findings.d/R681-release-gate-writes.md`）。
  - main 批次评审 `142c8ca67...53676e913`：决策 `c7ed2f9b` triple/high BLOCKED，1 major（grok:F1，Codex 复核确认：#1446 的拒绝标记写入与 Keychain 删除同时失败时旧 token 可被恢复）+ 5 minor（均为已记录限制）。major 由 #1452 修正。
  - 续评审 `53676e913...e0179bd55`（`--continue c7ed2f9b`）：决策 `fcf80837` triple/high PASSED（opus↔codex 互验，grok 由 codex 验证；confirmed 11，refuted 0）：10 项为 c7ed2f9b 已记录限制的重报（R1445-codex-F1、WIN-SINGBOX-FAKEIP-SERVICE-RESTART、BRICK-W10、R1443-codex-F1、BRICK-W7 残留），1 项新 minor grok:F1（`docs/findings.d/R1452-grok-F1.md`，open，低）。停止规则满足（仅 major+ 阻塞；minor 一轮后记开放）。
  - main 推送 CI：macOS CI `ee22990a5`、`53676e913` success，`e0179bd55` run 37713691305 success；Windows CI `17afefd2a` success。
- 候选/发布：控制面从 main@`142c8ca67` 部署（2026-10-07 ~22:50Z，`npm run deploy`）：API Worker 版本 `6ecf9d78-edd9-4e38-b435-f2e12a299dd2`、admin Worker `d3320660-11c6-44ca-b7ef-3eb49f9ca2b9`，`/api/v1/system/version` buildSha `142c8ca67…`。部署前 D1 导出 `2026-10-07T224416Z.sql.gz`（6,318,035 B，SHA-256 `2b5e9ceb554e79dde635f9986629c572ecd0c7809d5b3f4f2b0830f426e1b732`），与 `.sha256` 旁文件一起上传 `tono-releases/backups/control-plane-d1/`。桌面端：本条无新包；候选 7504 另见其记录。
- 剩余限制：未修（所有者决定项或需实机）：R4-WIN-MU-RESTORE-FOLD、R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN、WIN-DNS-RACE-MASKS-SYSTEM、WIN-MISSING-UPLINK-GRACE、WIN-UPDATE-CONNECTING-CLEANUP、WIN-RESUME-RECEIPT-RACE、BRICK-W8、MAC-WAKE-GATE-RACE、MAC-HELPER-HANG-WATCHDOG、MAC-CONTINUITY-ONLINK-PF、MAC-WEB-PINS-SUFFIX-STALE（运行逻辑未改）、EXIT-AGENT-TIMER-BOOT、H11-F2、D7、H1-F5。本批次任何改动均未在实机运行；决策 072–075 为 provisional，所有者可否决。
