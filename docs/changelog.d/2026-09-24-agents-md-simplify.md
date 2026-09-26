## 2026-09-24 · Agent 规则精简与老板自动化决定落地

- **归属/来源**：ops 任务（文档卫生），非产品行为；基线 origin/main
  [059a2ea2](https://github.com/raydocs/tono/commit/059a2ea2)，分支 `docs/agents-md-simplify-20260924`。
- **缺陷修复**：无。
- **新增/优化**：`AGENTS.md` 重写为 70 行：保留保护面/目录不变量、单一窄回归、同 PR 更新本页、
  MacBook 不跑原生构建；把老板 2026-09-24 的三条决定写成「条件即批准」（合并、部署与客户发布、
  产品取舍），其余重复内容改为链接。新增 [DECISIONS](../DECISIONS.md)（模板 + 三条 `owner` 决定）与
  仓库根 `.jev-route.json`（Windows Service/WFP、kill switch/PF/DNS/NRPT、客户更新源计为受保护路径）。
  两个节点/运维 skill 去掉「先取得批准」的停顿和已失效的 0012 迁移部署段。SHIP_PLAN、RELEASE_LINES、
  BUILD_AND_TEST、CONTRIBUTING、docs/README 与三份 ops 文档中找到的冲突句同步改写（审查又找到的残留见续记）；
  SHIP_PLAN §6 勾选行未改。
- **工程与测试**：无代码、工作流或配置行为改动（`.jev-route.json` 只影响审查路由）。
- **验证**：文档变更，未运行产品测试。`route.mjs review --paths apps/windows/service/src/core/manager.rs --dry-run`
  报 `protected_area: true`（无该文件时为 `false`）；计划 §4 的 grep 结果贴在 PR 正文。
- **候选/发布**：无新包，仅文档。
- **剩余限制**：macOS「CI 产物 → release → appcast」组合发布路径仍未端到端跑过（RELEASE_LINES 已注明）；
  gh token 能否自批 GitHub environment 部署未实测。
- **2026-09-24 续记（审查返工，jev-route f4512463 三方审查）**：AGENTS.md 仍为 70 行。审查命令改为从最新
  `origin/main` 检出跑 `route.mjs review --git origin/<base>...<head>`，决策号、槽位与核实结果贴 PR 评论；
  定义合并批次（`main` 上含直推在内、上次记录区间或线上 `buildSha` 之后的全部提交）并记录审查区间；
  合并顺序以 PR 正文为准（含 `## Merge order`）；合并方检查本页是否更新；受损凭据可立即停用。
  恢复 `StartClash`/升级进程清扫改名规则与 macOS 全量测试条件；目录描述改回「按设备的出口目录 + 签名流量策略」。
  客户发布步骤、两个 Windows environment（`windows-release`、`windows-update-channel`，自批未实测、只限 G4、
  每次记录）与回滚语义移到 [RELEASE_LINES](../RELEASE_LINES.md#customer-publish-g4)；macOS 链补签名文件、
  `generate-release-center.mjs`、提交 `public/`、prerelease 与标签 SHA 核对；已验证路径限 Mac Studio，
  sudo 一步归老板。BUILD_AND_TEST 区分候选签名与客户发布。加节点的仓库内后备路径在审计报齐目录以外各处之前不
  `--append`；provisioning skill 恢复 Xcode 依赖、删除集合规则统一。继续清理 SHIP_PLAN（§2.2 不改行仅限 G1–G3、
  §2.3 已冻结 0.0.73、§2.9、§3.5 改为 DECISIONS 暂定条目、谁/审合发、G4.3 指向发布步骤、G4.4 回滚、依赖图）、
  docs/README、运维计划 §2.5 与任务表「谁」、rollout-ops2、restore-production（生产迁移只经部署脚本）、
  services/exit-agent 与 preview README、REVIEW_ROUNDS 中残留的停顿与矛盾。`.jev-route.json` 另加
  `ProtectedSystemResolver`、`protected_probe`。等待另一厂商核实的 Opus 单方发现（发布门勾选者与 SHA 绑定、
  路由配置来源、部署前备份与 preview 演练、保护执行代码覆盖、密钥范围、G4 顺序）本次未改文字。
- **2026-09-24 续记 2（Opus 单方发现经 Codex 核实后）**：O-F1、O-F8 驳回，不改。已改：发布只用老板 G1–G3 证据所列候选
  （源码 SHA、版本/build、包哈希），换候选需新证据（回滚重建除外，DECISIONS 暂定条目）；路由从最新 `origin/main`
  检出跑、策略不取 PR 自身，改 `.jev-route.json` 的 PR 一律 dual_cross_family；每次生产部署前导出 D1、迁移先在
  preview 演练；Tono 自管密钥可用 CSPRNG 值（任务点名、先协调使用方），第三方凭据不得编造（DECISIONS 暂定条目）；
  G4 按 SHIP_PLAN §5 顺序（先 G4.2 老板内部设备，G4.3 前核对后台发布行 `verifiedAt`）；`.jev-route.json` 加五个保护执行
  路径（dry-run 均为 `protected_area: true`，dashboard 对照为 false）；BUILD_AND_TEST 增加「PR 需要哪个工作流」表、
  docs-only 定义与无工作流覆盖路径改走 dual_cross_family。
- **2026-09-25 续记（合并 main、按所有者决定合入）**：并入 main 的记录规则（#631：条目写 `docs/changelog.d/`、发现写 `docs/findings.d/`，
  INTERNAL_CHANGELOG.md 为冻结历史），本条目因此从冻结文件移到本分片；RELEASE_LINES G4 与 CONTRIBUTING 的记录位置同步改为分片。
  双厂商审查（jev-route 8a83b3bd）的 minor 一并处理：补回「不为让本地默认命令能跑而装工具链、同步构建缓存、删活动 worktree 或留存证据」
  与「产品身份是 Tono」两句；docs-only 定义排除 `.agents/`、`.claude/` 和路由配置。

