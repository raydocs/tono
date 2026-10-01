# R3-C8-grok 控制面迁移与 D1 清空/恢复（2026-10-01）

Fixer: Grok 4.7。范围：`services/control-plane/migrations/*`、`tooling/scripts/wipe-d1-in-order.mjs`、`tooling/scripts/restore-control-plane-d1-preview.sh`。基线：`origin/main` `b341164b`。

Sol 的 W1-sol-cp 没有报告可对。`docs/agent-reports/W1_CODEX_STATUS.md` 写明 cloud agent `sol-cp`（bc-d5e5286f）没推出分支就停了；仓库里搜不到 `W1-sol-cp` 报告。已合的 Sol 控制面改动（月结快照、hy2 退役、账目冲销、安装包 range）都不在这三处文件上。本轮按文件清单自己查。

关注点：会丢数据或写坏数据的迁移（没有回填的 DROP/重建、不能重入、和读新列的代码顺序错、热路径缺索引导致超时、新约束拒绝已有行），以及清空/恢复打到生产库或顺序反了。

## 已修

| 项 | PR |
|---|---|
| C8-G-F1 清空和 preview 恢复只拒绝库名 `tono-control-plane` 与绑定 `DB`。Wrangler 4.131 用同一条 D1 API 接受 `database_id`。`wrangler.jsonc` 里的生产 id 不带两道门也会交给 `d1 execute`。`wrangler.preview.jsonc` 若库名已是 preview、id 仍是生产，恢复脚本的 `migrations apply` 会改到线上库。 | [#943](https://github.com/raydocs/tono/pull/943) |

没有对应的已开 issue。没有 `Fixes #N`。

## 未修的已证实缺陷

无。没有新 issue。创建 issue 没有碰到 403。

## 跳过的重叠

开 PR 前 `gh pr list --state open` 与 `wipe-d1` / `restore-control-plane-d1` 搜索都是空的。开着的控制面 PR（#918 诊断包、#903 集群时间、#890 指标节点名、#883 月结栅栏、#852 配额周期、#833 设备会话）不改 `migrations/`、清空脚本或恢复脚本。

## 驳回

| 假设 | 为什么不是缺陷 |
|---|---|
| `d1 execute` 不带 `--config` 会退回 `wrangler.jsonc` 里唯一的生产绑定 | Wrangler 4.131 `getDatabaseByNameOrBinding`：名字不在配置里就按字面名查 API，404 即失败，不改用 `d1_databases[0]`。preview 名 `tono-control-plane-ops-preview` 不在这份配置里。恢复脚本的导入目标是这个名字。 |
| 外键解析漏掉 `REFERENCES`，父表先于子表被清空 | 83 个迁移在 SQLite 3.45 上按文件名顺序全部执行成功。`parseReferences` 与 `PRAGMA foreign_key_list` 对比，漏报 0、多报 0。`planDrops` 里每个外键都是子表先于父表。`ALTER` 加上的 `sessions.device_id` 出现在 `sqlite_master.sql` 里。 |
| `0057` 重建 `ops_node_status` 丢掉列 | `INSERT SELECT` 带上了 `0051` 的 `candidate_since`。`0040` 与 `0057` 之间没有别的列。历史表上的索引不在被删的那张表上。 |
| `0017` 收紧路由研究快照，静默丢掉行 | JSON 上限从 4096 放宽到 8192，窗口等式没变。违反约束的行会让迁移失败，不是截断。 |
| `0070` 删掉四张表 | 文件写明这是早期复用编号留下的孤儿表，代码不读。有意丢弃，只留在更早的备份里。 |
| `0033` 删除过期会话 | 一次性保留期清理，不是写坏。 |
| `0077` 回填把目录修订号加两次，或触发器插不进 `device_actions` | 只更新 `retired_at IS NULL` 的行。`device_actions.id` 没有格式 CHECK，32 位 hex 能插入。 |
| `0035` 在没有家宽出口时不插入 `home_exit_catalog_names`，限制集变空，住宅节点名发给所有人 | `json_group_array` 是聚合函数。没有匹配行时仍返回一行，`COALESCE` 后是 `[]`，单例行在。目录代码只在限制集非空时过滤；空集表示没有需要藏的名字。 |
| `0092` 的 CHECK 拒绝已有设备 | 新列可空，CHECK 允许 NULL。同一套迁移能在空库上跑完。写入端只记 `macos` / `windows`，失败被吞掉，不挡登录。 |
| `0093` 的索引或视图用了还不存在的列 | 列在同一文件里先 `ALTER` 再索引、再视图。整文件能执行。视图没有 TypeScript 调用点。 |
| `connection_events.catalog_revision` 和诊断表的 `received_at` 缺索引，cron 会超时 | 确认计数是 cron 里的一条查询，失败被 `cronStep` 隔开。诊断表从这次迁移才开始有行；恢复演练时大约 20 个用户。没有超时证据，不改。 |
| `0016`–`0018` 前缀重复导致建表顺序错 | README 写明按文件名排序，且不要重编号。`0018_user_default_proxy` 排在创建 `user_home_bindings` 的 `0017_user_home_catalog_bindings` 之后。 |

## 验证

- Node 22 / Linux：`node --test tooling/scripts/tests/wipe-d1-in-order.test.mjs tooling/scripts/tests/restore-control-plane-d1-preview.test.mjs`，26 passed。生产 id 那条在修复前失败：stub 里的 `npx` 被调用，参数是 `d1 execute <生产 database_id>`。
- 另用一个不是生产 id 的 preview 配置跑恢复脚本：守卫放行，失败发生在随后的 R2 下载（stub 退出 99），不是误拒绝。
- 大写的生产 id 被清空脚本拒绝，没有调用 wrangler。
- 未对远程 D1 执行。未跑 `npm test`（控制面 TypeScript 没改）。

## 合并

[#943](https://github.com/raydocs/tono/pull/943) 等 `ci-gate` 绿了再开一次 auto-merge（merge commit）。本报告 PR 不开 auto-merge。
