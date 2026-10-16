## 2026-10-12 · 运维台：失败聚类细节行给城市留够宽，补一条客户端服务没在跑的中文句子
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `origin/main`（0c515a4c4）→ 分支 `fix/ops-cluster-meta-room`；未合 main。
- 缺陷修复：
  - 生产「今天」页（桌面块宽 688 px，网格解析为 `24.5px 196px 297px 66px 56px`、列间距 12 px）真实行 `验证流量 · windows 0.0.75 · Los Angeles · Marina` 的细节需要约 302 px，只有 297 px：城市被截成「Los Angel…」，站点却完整。fixture 里的版本更短（1.8.1）、阶段只有两个字，测试一直没碰到。`src/styles/today-clusters.css`：`.cluster-list` 列间距 12 → 10 px，细节里的两处「·」（`.cluster-seg + .cluster-seg::before`、`.cluster-node-site::before`）左右边距 6 → 5 px，细节格约 309 px，城市和站点都完整；其余不动。
  - `TONO_SERVICE_NOT_RUNNING`（Windows 客户端 “Tono Service is not ready”）没有中文句子，聚类行的句子显示原码，客户页「最近失败」格显示被截断的「TONO_SERVICE_NOT_…」。`src/copy/customers.ts` 的 `codeWord` 加 `客户端的后台服务没在跑`；聚类的 `clusterCode` 合并了这张表，`explainCode` / `codeSentence` 读同一张表，三处一起生效。
- 新增/优化：同一张表里补了 Windows 客户端会上报、两张表都没覆盖的连接/恢复类错误码的短句：`TONO_SERVICE_BUSY`、`TONO_SERVICE_TOO_OLD`、`TONO_BFE_NOT_RUNNING`、`TONO_WFP_ENGINE_WEDGED`、`TONO_WFP_LOCK_UNVERIFIED`、`TONO_PROTECTION_UNCONFIRMED`、`TONO_PROTECTION_HELD_BY_ANOTHER_USER`、`TONO_REMOTE_SESSION_CONNECT_REFUSED`、`TONO_RELEASE_RECONCILING`、`TONO_RELEASE_IN_PROGRESS`、`TONO_RELEASE_UNFINISHED`、`TONO_RELEASE_RECORD_CORRUPT`、`TONO_STALE_GENERATION`、`TONO_RELAYS_UNREACHABLE`、`TONO_BROWSER_DNS_PREFLIGHT`、`TONO_RESTORE_PARTIAL`、`TONO_RESTORE_UNKNOWN`、`TONO_RESTORE_BUSY`、`TONO_SIGN_IN_NOT_SAVED`。更新、journal、sing-box 配置校验、DNS 警告类（`TONO_DNS_UNVERIFIED` 等不是失败）和 `TONO_DIAG_*`（诊断上传）保持原码。
- 工程与测试：dense fixture 加第 10 条（`fc-10`，与生产一致：`verifyingTraffic`、`windows 0.0.75`、`Los Angeles · Marina`、1 人 / 1 台、open、normal、`TONO_NODE_OR_CORE_UNREACHABLE`），既有两处 dense 行数断言 9 → 10；`e2e/today.spec.ts` 新增一例在 1440 断言这一行的城市和站点都完整（`scrollWidth ≤ clientWidth`），旧 CSS 上该例失败（城市需要 72 px，只有 60 px）；`diagnostics.test.ts` 断言 `clusterCode('TONO_SERVICE_NOT_RUNNING')` 是句子，`customers.test.ts` 断言 `explainCode` 同样（旧代码上两例失败）。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx vitest run`、`npx eslint src e2e`、`npm run build`、Playwright（today、today-phone、states、customers，`--ignore-snapshots`）见交付报告。
  今天页的截图基线可能因列间距 12 → 10 px 和 dense 多一行而轻微变化，本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：阶段与错误码在服务端是自由文本，未覆盖的值按原文显示。
