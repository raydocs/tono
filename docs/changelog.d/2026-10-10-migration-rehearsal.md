## 2026-10-10 · 控制面迁移本地演练脚本
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) §2 第 1 条（迁移只增、上生产前 preview 演练）；
  [Amp 待办](../ops/amp-backlog-2026-10-10.md) §9「迁移 0096 / 0097 / 0099 / 0100 先在 preview 演练」。不是 ship gate。
- 来源：基线 main `3d973f95` → 分支 `amp/ops-migration-rehearsal`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - `tooling/scripts/rehearse-control-plane-migrations.sh`：只跑本地 D1（`--local`、临时 `--persist-to`），不连
    Cloudflare。① 静态检查生产高水位（默认 `0095`，部署记录 `2026-10-10-control-plane-deploy-11441941`）之后的迁移只增；
    ② 空库 `wrangler d1 migrations apply DB --local`；③ 另一个本地库只迁到高水位，灌 `preview/seed.mjs` 合成种子
    （无生产数据），再迁到底，核对高水位时的每张表、每列、行数都在；④ 两个终态表 / 列一致；⑤ 打印 §2 第 1 条的
    preview 命令给所有者跑（本脚本不跑）。参数里出现 `--remote`、`--env`、`tono-control-plane` 或 preview 库名即拒绝；
    每次 wrangler 调用再查一遍且必须带 `--local`；preview 配置的 `database_id` 等于生产 id 时拒绝打印。
  - `tooling/scripts/check-migrations-additive.mjs`：去掉注释和字符串后找 `DROP`、`RENAME`、`ADD COLUMN … NOT NULL`
    无 `DEFAULT`，按文件:行报告；另有 `snapshot`（`node:sqlite` 只读打开本地库）与 `compare` 子命令。
  - `docs/ops/rollout-ops2.md` §1 写明本地演练一步；`services-ci.yml` 路径过滤加入两个脚本。
- 工程与测试：`tooling/scripts/tests/check-migrations-additive.test.mjs` 一条：高水位以下的 DROP 不报，注释 / 字符串里的
  DROP、RENAME 不报，待迁文件里的 RENAME COLUMN、无 DEFAULT 的 NOT NULL 加列、DROP INDEX 各报一行，退出 1。
- 验证：本机 Linux、Node 24、wrangler 4.148：脚本全程通过——待迁 0096、0097、0099、0100 只增；空库 89 个迁移全部应用；
  种子库 0095 时 21 张表有行（users 3、devices 2 …），迁后行数不变，`users` 多 `internal_account`、`hy2_auto_switch`；
  两终态 99 张表结构一致。`--remote` / `tono-control-plane` 参数退出 1。`node --test` 新测试 1 通过。
  历史上 0070、0078 的 DROP 在 `--high-water 0060` 时被正确报出。未执行：preview 演练本身（等所有者）。
- 候选/发布：仅工具，无新包；未部署。
- 剩余限制：高水位靠脚本常量，部署后要手动上调；CI 只跑静态检查的测试，不跑完整本地演练（约 40 秒，需 wrangler）。
  0078 那类「删触发器再建」会被判为不只增而失败，这类迁移需人工审查后再演练。
