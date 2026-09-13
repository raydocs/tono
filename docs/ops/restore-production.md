# 生产恢复流程（控制面）

这份是「生产库没了 / 坏了 / 被写坏了」时的操作清单。所有步骤只有老板能跑：需要 Cloudflare 账号里的 D1、R2、Workers 与 Access，wrangler 登录在 `tono` 账号（主检出与 spookfish 目录绑定了这个 profile；其他工作树落到默认账号，会报「不存在」）。

## 0. 一句话

备份只有 D1 一份：每天 03:17 UTC 一次（`control-plane-d1-backup.yml`），部署前手工再做一次。恢复演练（2026-09-10，`restore-drill-2026-09-10.md`）的数字：下载 1 秒，导入 28 秒（服务端 SQL 17 秒），迁移 3 秒，验证 22 秒，wrangler 总计约 1.5 分钟；含排查的端到端 18 分钟。**RPO 最多一天（夜间备份到出事之间的数据），RTO 按下面走顺了半小时以内。** 密钥、R2 两个桶、DNS / 路由 / Access 应用都不在备份里，丢了它们不是这份清单能救的，见 §1。

## 1. 备份里有什么、没有什么

| 有 | 没有 |
| --- | --- |
| D1 `tono-control-plane` 的整份 SQL 导出（表结构 + 数据 + `d1_migrations`），gzip 后约 6 MB，解压约 93 MB | Worker 的任何 secret（§2） |
| 账号、设备、会话、目录**密文**、遥测窗口、事故、账目、ops 投影 | R2 `tono-releases`（安装包、以及备份本身）和 `tono-diagnostics-logs`（原始日志段）——两个桶都没有任何备份（§3） |
| 对象：`tono-releases/backups/control-plane-d1/<UTC>T<时间>Z.sql.gz` + 旁文件 `.sha256` | DNS、Worker 路由、cron 触发器、ASSETS 绑定、Access 应用（§4） |
| 90 天生命周期（控制台里加在前缀 `backups/` 上，仓库无法配置，未确认生效） | 策略签名私钥（钥匙串 `tono-policy-signing`，只在运营者电脑上） |

导出小于 10 KiB 视为失败（脚本里的地板）。手工备份必须按脚本命名并传 `.sha256` 旁文件，否则恢复脚本会拒绝。

## 2. 密钥清单（只列名字；值在哪里：**未记录——待老板确认**）

API Worker `tono-control-plane-staging`（`wrangler.jsonc` 里声明为必需）：

| 名字 | 丢了会怎样 |
| --- | --- |
| `CATALOG_ENCRYPTION_KEY` | **恢复变成非恢复**：`managed_exit_catalog` 只存 `ciphertext + nonce`，没有这把钥匙第 48 修订读不出来，所有客户端拿不到出口列表。 |
| `JWT_SECRET` | 恢复回来的 370 行 `sessions` 全部作废，所有人被登出；换新钥匙即等于全员重新登录。 |
| `ADMIN_API_TOKEN` | hub 与脚本对管理接口的 Bearer 认证失效（`check-node-in-fleet.py`、`publish-managed-catalog.rb` 等）。 |
| `HOME_AGENT_TOKEN` | 出口 / 家宽 agent 的 `home/*` 上报（用量、名册确认）全部 401，计量断。 |
| `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` | tailnet 相关注册失效。 |
| `RESEND_API_KEY` | 邮件登录码发不出。 |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ACCESS_ADMIN_EMAILS` | `/ops2/`、`/ops/` 与 ops 接口无法验证 Access 断言；两个 Worker 都要。 |
| `OPS_COLLECTOR_TOKEN`（可选） | hub 的 `PUT /api/v1/ops-ingest/snapshot` 401，节点判定停在旧快照，20 分钟后 `collector_stale`。 |
| `ALERT_TELEGRAM_BOT_TOKEN`（`rollout-ops2.md` §3，两个 Worker） | 告警不投递。 |

Admin Worker `tono-admin-production`：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ACCESS_ADMIN_EMAILS`（与上面同值）。

变量（不是 secret，在 `wrangler.jsonc` 里）：`TRAFFIC_POLICY_PUBLIC_KEY`。它的**私钥**在运营者钥匙串 `tono-policy-signing`，重签分流策略要用，任何备份里都没有。

密钥只用 `wrangler secret put <NAME> --config wrangler.jsonc`（admin 用 `--config wrangler.admin.jsonc`）放回，不进仓库、不进夹具、不打进终端历史。

## 3. R2 两个桶

| 桶 | 绑定 | 里面是什么 | 现状 |
| --- | --- | --- | --- |
| `tono-releases` | `RELEASES` | 客户端安装包（`releases.afk.ccwu.cc` 下载的东西）+ `backups/control-plane-d1/` 下的 D1 备份 | **没有备份。** 这个桶丢了，恢复路径本身也丢了。 |
| `tono-diagnostics-logs` | `DIAGNOSTICS_LOGS` | 原始日志段 `logs/{uid}/{日期}/{session}-{seq}.jsonl.gz` | **没有备份。** D1 只保留索引 `diagnostics_log_objects`；只恢复 D1 会得到指向不存在对象的索引，30 天保留期的清扫会把它们当过期删掉。 |

建议的补法（未做）：给 `tono-releases` 的安装包与 `backups/` 各做一份异地副本（另一账号的桶或本机 `rclone`），至少每周一次；日志段可以不备（30 天即过期）。在没做之前，把「安装包源文件在哪台机器上」记进这一节：**未记录——待老板确认**。

## 4. DNS / 路由 / cron / ASSETS / Access

恢复 D1 只是把数据放回去；一个没有路由的 Worker 什么也不服务。全部从 `wrangler.jsonc` 与 `wrangler.admin.jsonc` 来：

| 项 | API Worker `tono-control-plane-staging` | Admin Worker `tono-admin-production` |
| --- | --- | --- |
| 自定义域 | `api.afk.ccwu.cc`、`releases.afk.ccwu.cc` | `admin.afk.ccwu.cc` |
| 区域路由 | — | `quality.afk.ccwu.cc/*`、`ops.afk.ccwu.cc/*`（zone `afk.ccwu.cc`） |
| cron | `*/5 * * * *` | — |
| ASSETS | `./public`，`run_worker_first: true`（`/ops/`、`/ops2/` 静态包在里面） | `./public`，同上 |
| D1 | `DB` → `tono-control-plane`（`caf9b9fb-b4d5-498d-a1ad-7d5cdbb4237c`） | 同一个库 |
| R2 | `DIAGNOSTICS_LOGS`、`RELEASES` | — |
| 服务绑定 | — | `API` → `tono-control-plane-staging` |

自定义域与区域路由随 `wrangler deploy` 一起建（zone 必须还在这个账号）。Access：`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` 指向的自托管应用要存在，覆盖 `admin.afk.ccwu.cc`，允许 `ACCESS_ADMIN_EMAILS` 里的邮箱；应用不在，`/ops2/` 打不开。Access 应用的配置（策略、会话时长）**未记录——待老板确认**。

## 5. 两条恢复路径

先决条件（两条都一样）：

1. 在主检出（`~/Downloads/GitHub/tono`，`main`，干净、与 `origin/main` 一致）操作；wrangler 是 `tono` profile。
2. 选对象：`tono-releases/backups/control-plane-d1/` 下最近一份 **早于出事时刻** 的 `.sql.gz`，且旁文件 `.sha256` 在。
3. 先把对象拿回本地并校验，任何路径都不要跳过这一步：

```sh
cd services/control-plane
npx wrangler r2 object get tono-releases/backups/control-plane-d1/<stamp>.sql.gz --file /tmp/restore.sql.gz --remote
npx wrangler r2 object get tono-releases/backups/control-plane-d1/<stamp>.sql.gz.sha256 --file /tmp/restore.sql.gz.sha256 --remote
shasum -a 256 /tmp/restore.sql.gz   # 必须等于旁文件里的值
gunzip -c /tmp/restore.sql.gz > /tmp/restore.sql
grep -c 'CREATE TABLE' /tmp/restore.sql   # 09-10 那份是 77
```

4. 决定路径：库还在、只是数据坏了 → (b) 原地清空；库没了、或 D1 本身不可用 → (a) 新库。

### (a) 新建 D1，改 `database_id`，重新部署两个 Worker

```sh
cd services/control-plane
npx wrangler d1 create tono-control-plane          # 记下新的 database_id
# 把 wrangler.jsonc 与 wrangler.admin.jsonc 里的 database_id 都改成新值，提交到 main（PR，CI 绿）
npx wrangler d1 execute tono-control-plane --remote -y --file /tmp/restore.sql        # 不带 --config
npx wrangler d1 migrations apply tono-control-plane --remote --config wrangler.jsonc  # 备份之后合并的迁移会在这里补上
```

然后在主检出跑 `tooling/scripts/deploy-control-plane-main.sh`（它会再跑一次 `migrations list / apply`，再依次部署 API 与 admin 两个 Worker，带 `BUILD_SHA`）。旧库不要立刻删：留到 §6 验证通过后一周。

注意：旧库还在时不要用同一个名字建新库；用别的名字并同步改两个配置里的 `database_name`，或先在控制台把旧库改名。

### (b) 原地清空再导入（`database_id` 不变，不用重新部署）

D1 不能关外键、不允许 `integrity_check`、不允许动 `_cf_KV`，所以清空只能按依赖顺序：先触发器、再索引、再子表先于父表。`tooling/scripts/wipe-d1-in-order.mjs` 就是干这个的；对生产名它默认拒绝，需要两道门都在：

```sh
# 先看计划，不执行：
TONO_ALLOW_PRODUCTION_WIPE=1 node tooling/scripts/wipe-d1-in-order.mjs --plan --from-database tono-control-plane --i-mean-production
# 真做：
TONO_ALLOW_PRODUCTION_WIPE=1 node tooling/scripts/wipe-d1-in-order.mjs --apply --database tono-control-plane --i-mean-production
```

脚本会打印库名与将要删的表数，按每批 10 条 `--command` 执行，第一批失败就停（退出码 4），结束后重读 `sqlite_master`，只剩 `_cf_KV` 与 `sqlite_sequence` 才算清空（否则退出码 3）。清空期间两个 Worker 还在线：**先在控制台把 API Worker 的 cron 触发器停掉**（不停的话，5 分钟内的那一轮会在空库上报错，只是日志），客户端在这几分钟内会收到 5xx / 空目录，属于预期。

```sh
cd services/control-plane
npx wrangler d1 execute tono-control-plane --remote -y --file /tmp/restore.sql        # 不带 --config
npx wrangler d1 migrations apply tono-control-plane --remote --config wrangler.jsonc
```

导入约 30 秒（09-10 演练：28 秒、721,917 行）。`d1 execute` 出错时**先** `d1 migrations list`，不要手工补 SQL，也不要重复导入（会撞主键）；重复导入前先再跑一次清空。

## 6. 恢复后的验证（两条路径都要，按顺序）

```sh
cd services/control-plane
npx wrangler d1 execute tono-control-plane --remote --json --command "PRAGMA quick_check"        # 期望 ok
npx wrangler d1 execute tono-control-plane --remote --json --command "PRAGMA foreign_key_check"  # 期望空数组
npx wrangler d1 migrations list tono-control-plane --remote --config wrangler.jsonc                # 期望「No migrations to apply」
npx wrangler d1 execute tono-control-plane --remote --json --command \
  "SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM devices) devices, (SELECT count(*) FROM telemetry_windows) windows, (SELECT count(*) FROM ops_incidents WHERE status<>'resolved') open_incidents, (SELECT revision FROM managed_exit_catalog) catalog_revision"
```

数字对照 dump 里的 `INSERT` 行数（09-10：20 用户 / 27 设备 / 7533 窗口 / 11 个未关事故 / 目录修订 48）。然后线上：

1. `curl -s https://api.afk.ccwu.cc/api/v1/system/version` —— `buildSha` 是你刚部署（或本来就在线）的提交。
2. `curl -s https://api.afk.ccwu.cc/api/v1/system/pulse` —— `ok` 为真且 `cronAgeSec < 900`；cron 是 5 分钟一次，恢复后第一轮跑完前这个值会偏大，等两轮。
3. `https://admin.afk.ccwu.cc/api/v1/ops/system/health`（Access 登录后）—— 每个来源有时间，没有 `stale`。
4. 浏览器 `https://admin.afk.ccwu.cc/ops2/`，忽略缓存重载，五个入口各开一次：今天 / 节点 / 客户 / 客户端 / 设置；节点页应显示真实节点而不是「无数据」。
5. 一台客户端登出再登入（路径 (a) 或换了 `JWT_SECRET` 时所有客户端都要），能拿到目录并连上一个节点——这一步证明 `CATALOG_ENCRYPTION_KEY` 是对的。
6. 让 hub 跑一次采集（`collect.py`），10 分钟后今天页没有 `collector_stale`。

## 7. 不能恢复的东西，以及要告诉客户的话

- **会话**：换了 `JWT_SECRET` 或走路径 (a) 却没放回旧钥匙，所有人要重新登录；备份到出事之间新登录的设备也要重新登录（它们的 `sessions` 行不在 dump 里）。
- **目录密文**：没有原来的 `CATALOG_ENCRYPTION_KEY`，目录读不出，只能用 `publish-managed-catalog.rb` 重新发布一版（需要 `ADMIN_API_TOKEN` 与节点凭证源）。
- **备份到出事之间的数据**：那段时间的开户、账目录入、事故处置、遥测都没有；客户看到的是「最近一天的连接记录不见了」。账目按 `docs/ops/billing-model-proposal.md` 的规则手工补录。
- **原始日志段**：索引恢复了，对象没有；360 页里对应时段的「原始日志」会打不开，属于预期。
- 对客户：一句话——「服务端做过一次数据恢复，需要重新登录一次；连接记录会从现在重新开始记」。不解释密钥。

## 8. 演练频率与谁做

- 每季度一次 preview 演练（`d1-backups.md` 的清单，用 `restore-control-plane-d1-preview.sh`，它现在会先按依赖顺序清空 preview 再导入，再 `migrations apply`）；每次部署前的手工备份也要按脚本命名并传旁文件。
- 每次改了 `wrangler*.jsonc` 的绑定 / 路由 / 密钥清单，同步改本文 §2 与 §4。
- 老板做；总监会话只准备命令、不碰生产库（会话里的 `wrangler d1 * --remote` 对生产名是禁止项）。
- 下次真做之前要补的三件：R2 两桶的副本（§3）、密钥的存放位置（§2）、Access 应用的配置记录（§4）。
