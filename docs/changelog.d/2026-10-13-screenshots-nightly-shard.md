## 2026-10-13 · 截图 nightly：控制台像素对比分成四片

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。沿用 D9-A：像素对比不进 PR 门。只改 `screenshots-nightly.yml` 和它的守护测试。
- 来源：main `86fe66dca` → 分支 `cursor/screenshots-nightly-shard-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：`ops-console-screenshots` 用与 `services-ci.yml` 相同的 `--shard=N/4`，跑在 `macos-26` 上，不加 `--ignore-snapshots`。`fail-fast: false`。差异产物按分片命名，避免互相覆盖。重录基线仍是单独的 `ops-console-rerecord`（`update_baselines` 才跑），一条命令、一份产物。macOS 整窗截图两步仍串行（英文约 277 秒、中文约 80 秒），不再拆，避免为较短的步骤再占一台机器重编一次。
- 工程与测试：`screenshot-nightly-split.test.mjs` 改为要求 nightly 的比较行是 `--shard=${{ matrix.shard }}/4`，且文件里没有 `--ignore-snapshots`。重录步骤的 `if` 仍是 `${{ inputs.update_baselines }}`。
- 验证：本地 `node --test tooling/scripts/tests/screenshot-nightly-split.test.mjs`。改前墙钟见 [run 38339472847](https://github.com/raydocs/tono/actions/runs/38339472847)：整次 18.0 分钟，其中「Screenshot baselines compared」1017 秒。改后分片耗时待 dispatch。
- 候选/发布：无新包。
- 剩余限制：比较从 1 台 `macos-26` 变成 4 台，加上整窗截图共 5 台，发生在每天 18:23 UTC。必选检查名不变（nightly 不是 `ci-gate`）。本 PR 的 ci-gate 会因测试文件落在 `tooling/scripts/**` 而跑 macOS CI，那是路径过滤，不是 nightly 本身。
