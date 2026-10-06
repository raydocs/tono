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

  这些 PR 各自的 changelog 来源行写于开 PR 时（「未合 main」「draft」），保留为当时状态；合入结果以本表为准。
  UI 类 PR（#1417、#1405、#1422）按老板 2026-10-06「能合并的全都合并到 main」的授权合入，不是按 AGENTS 的自动合并条件。
- 缺陷修复：无新修复。43 条 finding 的状态从 `in-PR` 改为 `fixed(<main SHA>)`，SHA 取第一个包含该修复的 main merge：#1405 的 16 条、
  #1393 的 13 条与 #1408 的 2 条（`5a77c6b6`，随 #1417 整栈进入 main）、IHOME-12（`bca5fa9a`，#1422）、#1418 的 4 条、C3-PC-F2（`c7d77517`，#1415）、
  #1376 的 4 条（`92e004f6`，原行只写了分支名）、#1378 的 2 条（`f4d8d401`）。「真机未验」「未部署」等剩余限制原样保留；只删掉已不成立的
  「未合 main」「默认关闭的草稿」字样，#1405 各行的「尚待 hosted CI」改为合并 head `6889f36e` 的 ci-gate 已过。`WIN-LOG-UPLOAD-PROBE-LINES` 仍为 `in-PR`（对应 issue #1191，未合）。
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
- 验证：main 自动 CI：Windows CI [37523933629](https://github.com/raydocs/tono/actions/runs/37523933629) 在 `bca5fa9a8` success；
  macOS CI [37520153661](https://github.com/raydocs/tono/actions/runs/37520153661) 在 `4c98c8c1c` success（其后无 `apps/macos` 改动）；
  Services CI [37523452599](https://github.com/raydocs/tono/actions/runs/37523452599) 在 `70af58a73` success（其后无服务改动）。`e76232924`、`aaa0c1da1` 上的同名 run 被后一次 push 取消，不计通过。
  `node tooling/scripts/records.mjs findings --status in-PR` 只剩 `WIN-LOG-UPLOAD-PROBE-LINES` 一行。
- 候选/发布：无。生产 Worker 仍是 `574debe1`，#1415 与 #1419 尚未部署；冻结源码 `e28ca45c` 与 7501 候选不含本批。客户更新源未动。
- 剩余限制：本批没有任何真机验证（Windows/WebView2 上的 Tauri 2.12 窗口行为与新外观、macOS 签名包）；留给下一轮 0.0.75 候选的设备验收。
  评审中 Opus 提示：若生产现有目录里有不满足 #1415 新检查的条目（如 hy2 缺 sni 或 port），之后整份 PUT 会被拒绝（只拒绝发布，不放宽保护）；部署前未查生产目录。
