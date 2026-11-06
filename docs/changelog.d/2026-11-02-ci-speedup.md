## 2026-11-02 · CI：缩短 PR 门墙钟

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。不改产品、签名或发布工作流。必选检查名仍是 `ci-gate`，path filter + `workflow_call` 结构不变。
- 来源：main `372a4cc6c` → 分支 `cursor/ci-speedup-00f4`。未合 main。
- 缺陷修复：无。
- 新增/优化：
  - `ci-gate` 的 `changes` 改为 `fetch-depth: 1`。`ci-gate-changes.mjs` 本就会对缺失的 base SHA 做 `--depth=1` fetch；全量历史没有读者。
  - `windows-ci` 的 `app` / `app-rust` 用 `pnpm/action-setup`（`packageManager` 的 11.26.0）+ `setup-node` `cache: pnpm`。原先 `npm install -g pnpm@11.3.0` 既不缓存 store，也不是冻结的 pin。
  - `macos / unit-tests` 打开 `-parallel-testing-enabled YES`（最多 4 个 worker），并关掉 `COMPILER_INDEX_STORE_ENABLE`。不拆 matrix：每条腿会再编一次 Debug，再占一个 `macos-26` 名额。
  - `screenshots-nightly` 在同一 SHA 已有成功 run 时跳过（只对 `schedule`；dispatch / 重录基线照跑；API 失败 fail-closed）。
  - `services-ci` 的 e2e 和 nightly 的 Playwright 作业按 `package-lock.json` 缓存浏览器；命中后 Linux 仍装 OS deps。没有 `restore-keys`。
  - `dependency-audit`、`sing-box-alpha9-check`、`ops-console-baseline-reminder` 加 per-ref concurrency。被 `ci-gate` 调用的 sing-box 工作流对 `workflow_call` / `merge_group` 不取消，与其他成员一致。
- 工程与测试：为 shallow clone、pnpm cache、parallel xcodebuild、nightly skip、Playwright cache、concurrency 各加了守护断言。
- 验证：Linux `node --test` 跑 `ci-gate-changes`（9/9）、`windows-ci-paths`（15/15，临时装 js-yaml）、`macos-ci-skip-duplicate`、`screenshot-nightly-split`、`screenshots-nightly-skip`。`actionlint` v1.7.8 对整个 `.github/workflows` 通过。托管 CI 待本 PR。未执行：Windows `cargo test`、`xcodebuild`（本机无对应工具链）。
- 候选/发布：无新包。
- 剩余限制：
  - 未改 rust-cache：2026-10-13 已用 `Swatinem/rust-cache` 且 `cache-workspace-crates: true`；只缓存依赖时 Tauri 重编到 11 分钟。
  - 未把 Tauri 套件改成 nextest：每个测试一个进程会重载 Tauri harness，而现在的 `cargo test` 已在进程内并行。
  - `windows-ci` ~466 行的 `cargo test` 不是重复：生命周期套件带 `test` feature，原生 DNS 编排必须不带它。
  - 未改 e2e 分片，也未打开 `fail-fast`（e2e 分片是同一套 spec；Android emulator 的 system/tunnel/ui 是不同测试，关 fail-fast 才看得到各片信号）。
  - 审计里 `changes` P90 排队约 55 分钟：仓库 ruleset 没有 merge queue 规则（只有必选 `ci-gate` + merge commit）；`changes` 跑在 `ubuntu-24.04` 且无 `needs`，不是 macOS runner 并发上限。更像是样本里叠了并行 agent dispatch / 账户并发打满后的极端值。macOS 排队仍然存在：一次 macOS PR 会占最多 4 个 `macos-26` 名额。
  - 审计「3,077 min/month rerun waste」按要求忽略（从单次 rerun 外推）。

### 续记 2026-11-06 · 第二轮（测量后再改）

- 来源：将 `cursor/ci-speedup-00f4` rebase 到 `origin/main`（含桌面 0.0.82），第一轮 7 个提交保留。
- 基线（`gh`，每个工作流最近约 15 次已完成且未取消的 run；失败后的成功重跑未计入。p50/p90。`ci-gate` 无 PR 时不会跑，样本来自历史 PR / 成员工作流的 push 与 dispatch）：

  | 作业（PR / 同类事件） | n | 墙钟 p50/p90 | 排队 p50/p90 | 准备 p50 | 测试/构建 p50 |
  |---|---:|---|---|---|---|
  | windows / app-rust | 12 | 8m20s / 10m29s | 2s / 5s | 2m30s | 5m37s |
  | macos / unit-tests | 8 | 6m54s / 7m59s | 3s / 4s | 23s | 6m23s |
  | services / control-plane | 11 | 5m08s / 5m28s | 2s / 3s | 30s | 4m26s |
  | services / e2e 分片 | 11×4 | ~5m / ~5m20s | 2s / 2s | 74–83s | ~3m30s |
  | windows / service | 12 | 5m01s / 5m34s | 2s / 4s | 39s | 4m15s |
  | macos / build | 8 | 4m42s / 5m08s | 2s / 12s | 24s | 3m54s |
  | macos / policy-tests | 9 | 3m41s / 6m20s | 3s / 8s | 23s | 3m13s |
  | windows / coverage | 12 | 1m30s / 1m45s | 2s / 3s | 64s | 24s |
  | macos / privileged-tests | 8 | 51s / 55s | 2s / 11s | 18s | 26s |
  | macos helper（push）排队 | 2 | — | 2s / **9m56s** | 18s | 1m40s |

  计费：GitHub 对 macOS 约 10×、Windows 约 2× Linux。一条典型 PR 的 p50 墙钟由 `app-rust`（~8m20s）决定；同一次 PR 的粗算计费约 **280 Linux-equivalent min**（4 个 `macos-26` 作业占大头）。Actions cache 用量约 2.78GB / 10GB（6 条；最大 `windows-app-rust` 1.78GB）。

- 新增/优化（只改数据支撑的项；第一轮全部保留）：
  - **concurrency**：组改为 `workflow + PR 号`（无 PR 时用 ref）。`cancel-in-progress` 仅 `pull_request`。不再取消 main / tag / release / `merge_group` / `workflow_call`。`connect-bench` 补上同一规则。`android-ci` 从无条件取消改为仅 PR。
  - **timeout-minutes**：所有 `.github/workflows` 里带 `runs-on` 的作业都有超时（原先缺：macos `build`/`unit-tests`/`policy-tests`/`privileged-tests`，windows `core`/`app`/`app-rust`/`service`，services 五个作业，以及若干发布/资格作业）。
  - **预编译工具**：`cargo-llvm-cov@0.9.1` 与 `cargo-audit@0.22.2` 走已 pin 的 `taiki-e/install-action`，不再 `cargo install` 源码编译。coverage 作业 12/12 次准备（64–73s）长于测试（24s）。`dependency-audit` 用 `pnpm/action-setup@11.26.0`；`release-qualification` 的前端作业对齐同一 pnpm pin + `cache: pnpm`。
  - **setup-node `cache: npm`**：control-plane / ops-contract / migrations / e2e 按 lockfile 哈希缓存 npm 目录。e2e 四分片每次准备 74–83s（含 `npm ci`）。没有给同一棵树再加 `actions/cache`。
  - **制品**：macOS XCTest 的 xcresult / render 附件只在失败时上传。
- 未改（有测量、故意不动）：
  - 未把 `privileged-tests` 并进 `helper`：PR 上 macOS 排队 p90 仅 4–12s，并进去会把 ~30s 的 root 自测加到 `unit-tests` 前面（关键路径 ~9 min → 更长）。push/dispatch 上 helper 排队 p90 ~10 min 是账户 macOS 槽位，不是这个作业自己的准备过长。
  - 未把 `windows-core.yml` 从 `macos-26` 挪到 Linux：`build-mihomo-adaptive.sh` 是 zsh，且用 `/usr/bin/shasum`。
  - 未撤第一轮 Playwright 浏览器缓存（10GB 预算里目前没有它；合入后按 lockfile 哈希写入，无 `restore-keys`）。
  - 未再给 app-rust 加缓存或拆分：准备 2m30s 主要是 rust-cache 恢复，测试 5m37s，拆机器会再付一次 Windows 准备。
  - 未动 e2e 分片数 / fail-fast、rust-cache 范围、Tauri nextest、docs-only 的 `ci-gate` 聚合（已存在）。
- 工程与测试：concurrency / timeout / npm cache / 预编译工具 / 失败才上传 xcresult 的断言。
- 验证：见本条目第一轮的 Linux `node --test`；第二轮补跑同一批。托管 `ci-gate` 仍待 PR（无 `pull_request` 事件时 gate 不跑）。
- 候选/发布：无新包。
- 对比（第二轮预期 vs 上表暖缓存基线；合入后用同类暖缓存 p50/p90 复核，不用加缓存后的第一次冷跑）：

  | 项 | 墙钟 | 计费 |
  |---|---|---|
  | PR 关键路径（app-rust） | 基线 8m20s / 10m29s；本轮不改这条作业 | 不变 |
  | windows / coverage | 准备 64s→预期 ~15s（预编译）；墙钟 ~1m30s→~50s | 每次 PR 少约 1 Linux min |
  | services / e2e 分片 | 准备 74–83s；npm cache 命中后预期少 ~20–40s/片 | 4 片 × ~0.5 min |
  | main 上的 macos-ci | 不再被后一次 push 取消 | 避免整轮 macOS 10× 计费作废 |
  | 挂死作业 | 现在会在 timeout 杀掉 | 上限封顶 |
