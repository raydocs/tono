## 2026-10-06 · main 合批记录与合并回归评审（e28ca45c…bca5fa9a）
- 归属：`docs/SHIP_PLAN.md` 0.0.75；AGENTS「Finish the work」第 1 条（每批合并后的合并回归评审、记录已评审区间）。仅记录，无源码改动。
- 来源：上一段已评审区间止于冻结 `e28ca45ce80acce1081f11643f6748f640b9d328`（[0.0.75 收尾记录](2026-10-06-release-0075-closeout.md)）。本批到
  `bca5fa9a8e6f1db322e19dbd2a1e0a49d9d2f9b4`，九个 merge commit：

  | PR | 内容 | main merge |
  | --- | --- | --- |
  | [#1404](https://github.com/raydocs/tono/pull/1404) | 0.0.75 候选回执（文档） | `ba639f6a0` |
  | [#1415](https://github.com/raydocs/tono/pull/1415) | 共享后台 `PUT exit-catalog` 的客户端准入检查 | `c7d775176` |
  | [#1417](https://github.com/raydocs/tono/pull/1417) | Windows 新外观整栈（含 #1375、#1393、#1406–#1414、#1416） | `5a77c6b68` |
  | [#1418](https://github.com/raydocs/tono/pull/1418) | Windows 连接提速 | `f26c57bd1` |
  | [#1405](https://github.com/raydocs/tono/pull/1405) | macOS 新外观 | `4c98c8c1c` |
  | [#1419](https://github.com/raydocs/tono/pull/1419) | 控制面依赖 | `e76232924` |
  | [#1420](https://github.com/raydocs/tono/pull/1420) | ops-console 依赖 | `70af58a73` |
  | [#1421](https://github.com/raydocs/tono/pull/1421) | Windows 依赖与四份 Cargo.lock | `aaa0c1da1` |
  | [#1422](https://github.com/raydocs/tono/pull/1422) | Windows 新外观细节打磨 | `bca5fa9a8` |

  本批新增的 18 个 changelog 分片的来源行原先写于开 PR 时（「未合 main」「draft」），现逐个改为合入的 main SHA 与 PR 号。
  UI 类 PR（#1417、#1405、#1422）按老板 2026-10-06「能合并的全都合并到 main」的授权合入，不是按 AGENTS 的自动合并条件。
- 缺陷修复：无新修复。43 条 finding 的状态从 `in-PR` 改为 `fixed(<main SHA>)`，SHA 取第一个包含该修复的 main merge：#1405 的 16 条、
  #1393 的 13 条与 #1408 的 2 条（`5a77c6b6`，随 #1417 整栈进入 main）、IHOME-12（`bca5fa9a`，#1422）、#1418 的 4 条、C3-PC-F2（`c7d77517`，#1415）、
  #1376 的 4 条（`92e004f6`，原行只写了分支名）、#1378 的 2 条（`f4d8d401`）。「真机未验」「未部署」等剩余限制原样保留；只删掉已不成立的
  「未合 main」「默认关闭的草稿」字样（含 IHOME 分片正文里的「Not fixed on main」）。#1405 的 M1–M8 八行里「尚待 hosted CI」改为合并 head `6889f36e` 的
  ci-gate 已过，「合并 head 的原生 PNG 人工审阅与真机未验」保留。`WIN-LOG-UPLOAD-PROBE-LINES` 仍为 `in-PR`（对应 issue #1191，未合）。
- 新增/优化：dependabot 的旧 PR 收尾：#1381、#1382 在 #1419/#1420 合入后由 dependabot 自行关闭；#1403、#1384 与新开的 #1423（只剩 vitest 5）
  手动关闭并留言指向取代它们的 PR。仍压着的版本：`vitest` 5（等 `@cloudflare/vitest-pool-workers` 支持）、`typescript` 7（等 `typescript-eslint`）、
  `minisign-verify` 0.3（等 `tauri-plugin-updater` 一起动）。
- 工程与测试：九个 merge 的 `git show --remerge-diff --exit-code -- apps services tooling .github` 均为空，没有冲突解决。区间内 Worker 源码只有
  `services/control-plane/src/catalog-yaml.ts` 与 `src/ops/shared-admin/catalog.ts`（#1415），无迁移；`.github` 只有 `macos-ci.yml` 两行（#1405）；
  `HelperProtocolVersion.swift` 未变。
- 评审（jev-route，区间 `e28ca45ce...bca5fa9a8`，深度 triple）：
  - 整段一次跑（`da2405ff`）：差异 7.3 MB（截图证据与 lockfile），Opus 与 Codex 报 `Prompt is too long` 失败，只有 Grok 4.7 完成，Codex 核验。
    结论 INCOMPLETE，1 条 minor（grok:F1：合入后记录与 finding 状态未更新），即上面的状态清理。
  - 按路径分两片重跑 Opus 5.5 + Codex `gpt-6.1-sol`（high）：Windows 片 `44d8c34f`（`apps/windows/app` 的 `src`、`src-tauri`、`package.json`，不含测试、CSS、
    词条与生成类型）PASSED，无发现；macOS 与服务片 `0db2e40e`（`apps/macos`、两个服务的 `src`/`test`/`package.json`、`.github`）PASSED，无发现。
  - 三方都没有读的：Windows 的 `*.test.tsx`、`*.css`、`locales`、生成的 i18n 类型在两片之外，Opus 与 Codex 没有读（各 PR 自己的评审读过）；
    lockfile 与 `docs/screenshots` 没有任何一方逐行读。评审方无网络，Tauri 2.11→2.12 / wry 0.57 / tao 0.37 的上游变更说明（权限标识、窗口 API）没有核对。
- 本 PR 的评审（jev-route `92938a11`，Opus 5.5 + Codex，PASSED，无拦截项）后的一轮修复：opus:F1 / codex:F1 第一版清理把 M1–M8 的「当前 head PNG 人工审阅」限制一并删了，已恢复；
  opus:F2 / codex:F2 IHOME 分片正文仍写「Not fixed on main」「not merged」，与状态格矛盾，已改；并补做 grok:F1 点名的 changelog 来源行。
- 验证：main 自动 CI：Windows CI [37523933629](https://github.com/raydocs/tono/actions/runs/37523933629) 在 `bca5fa9a8` success；
  macOS CI [37520153661](https://github.com/raydocs/tono/actions/runs/37520153661) 在 `4c98c8c1c` success（其后无 `apps/macos` 改动）；
  Services CI [37523452599](https://github.com/raydocs/tono/actions/runs/37523452599) 在 `70af58a73` success（其后无服务改动）。`e76232924`、`aaa0c1da1` 上的同名 run 被后一次 push 取消，不计通过。
  `node tooling/scripts/records.mjs findings --status in-PR` 只剩 `WIN-LOG-UPLOAD-PROBE-LINES` 一行。
- 候选/发布：无。生产 Worker 仍是 `574debe1`，#1415 与 #1419 尚未部署；冻结源码 `e28ca45c` 与 7501 候选不含本批。客户更新源未动。
- 剩余限制：本批没有任何真机验证（Windows/WebView2 上的 Tauri 2.12 窗口行为与新外观、macOS 签名包）；留给下一轮 0.0.75 候选的设备验收。
  评审中 Opus 提示：若生产现有目录里有不满足 #1415 新检查的条目（如 hy2 缺 sni 或 port），之后整份 PUT 会被拒绝（只拒绝发布，不放宽保护）；部署前未查生产目录。

### 2026-10-06 续记 · 尾段评审（bca5fa9a…94817af4）与控制面部署
- 归属：AGENTS「Finish the work」第 1 条（已评审区间）与第 2 条（部署）；运维计划 §2 项 7（部署前导出）。不推进客户 SHIP_PLAN，客户更新源未动。
- 来源：上一段止于 `bca5fa9a8`。尾段到 `94817af4f896c0b0f629506471a877a89a6dcc3a`，两个 merge commit：[#1425](https://github.com/raydocs/tono/pull/1425)
  Windows 二级页标题字重（`f6ce4cca8`）、[#1427](https://github.com/raydocs/tono/pull/1427) 上面这份合批记录（`94817af4f`）。尾段只有两处 CSS 与文档，
  `services/` 无改动。
- 评审（jev-route `6d72c5af`，区间 `bca5fa9a8...94817af4f`，Opus 5.5 + Codex `gpt-6.1-sol`，互相核验）：PASSED，1 条 minor（opus:F1 与 codex:F1 是同一条）：
  [Windows 细节打磨记录](2026-10-06-windows-ui-polish.md)第二轮续记的来源行仍写「未合 main」，本 PR 改为 `f6ce4cca8`（#1425）。
  评审方没有 shell，列为缺失上下文的三项事后在 MacBook 上手动核对：`git show --remerge-diff` 对 `f6ce4cca8`、`94817af4f` 均为空；
  `c7d77517`、`5a77c6b6`、`f26c57bd`、`4c98c8c1`、`bca5fa9a`、`92e004f6`、`f4d8d401` 都是 `origin/main` 的祖先；`f6ce4cca8` 的第二父是 #1425 的
  head `afa2c70e2`，即 PR 评审（`2045f1b9`、`dfb70314`）读过的 head。
- 已评审区间：`e28ca45ce...bca5fa9a8`（上文）加 `bca5fa9a8...94817af4f`，现止于 `94817af4f`。
- 备份：部署前 `tooling/scripts/backup-control-plane-d1.sh --keep-local` 上传 R2 `backups/control-plane-d1/2026-10-06T20:51:27Z.sql.gz` 与 `.sha256`，
  6331680 字节，SHA-256 `1032f5ae5185f20f617b1628ea1852d8c9ccfbb24282dcdd669a735b22f0087a`，本地 `shasum -a 256` 一致。没有生产恢复、临时写入或密钥变更。
- 部署：维护者检出 `git pull --ff-only` 到 `main@94817af4f`（干净、与 origin/main 相等、`tono` profile），`npm run deploy` 退出 0，wrangler 4.148.0
  （#1419 升级后的版本）。脚本实跑：typecheck 通过、44 个文件 / 1002 个 Worker 测试通过、策略签名契约、控制台构建、release-center check 通过；
  两次迁移检查均「No migrations to apply」。API Worker version `561a77e6-af76-45a7-b943-ac71203fe090`（20:53:49 UTC，100%，tag `main-94817af4f896`），
  Admin `c31d9002-bf2a-436b-b716-30578a433dfe`（20:53:58 UTC，100%，同 tag）。相对上一个生产版本 `574debe1`，Worker 源码变化只有 #1415（共享后台
  `PUT exit-catalog` 与 relist 的客户端准入检查）；#1419 只动开发依赖与 lockfile。
- 生产核对：`/api/v1/system/version` 返回完整 `94817af4f896c0b0f629506471a877a89a6dcc3a`；`/api/v1/system/pulse` 为 `ok:true`、`cronAgeSec:197`、同一 SHA；
  匿名 `/ops2/` 仍为 401。
- 候选/发布：无客户端包、客户发布或更新源变更。
- 剩余限制：生产现有目录没有对照 #1415 的新检查核对（`managed_exit_catalog` 在 D1 里是密文，本会话没有后台令牌）。新检查只在后台整份 PUT 与
  relist 时执行，不在客户端取目录的路径上；若现有条目不满足（如 hy2 缺 `sni` 或 `port`），下一次发布目录会收到 400 `INVALID_CATALOG` 并列出条目，
  已发布的目录与保护不受影响。Access 登录后的后台页面没有人工看过。回滚：分别 `npx wrangler rollback` 到 API
  `94eae10a-97b0-474c-b3e5-e73cf004efc6` 与 Admin `b9f5153d-21fc-433b-bf2f-784ba5b8e920`（均为 `main-574debe1cc5e`）；两个要一起回。
