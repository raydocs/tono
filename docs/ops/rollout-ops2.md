# 新后台（/ops2/）上线步骤

这份是把 `ops/platform` 分支推到生产的操作清单。所有步骤只有你能跑：需要 hub 的 SSH、Cloudflare 账号里的 D1 与 wrangler 登录、Telegram bot token。

## 0. 上线前的状态

- 分支 `ops/platform`（worktree `~/orca/workspaces/tono/spookfish`），未推送。
- Worker：`services/control-plane` 27 个测试文件 / 664 个测试、typecheck、`check:contract`、`check:budgets` 全绿；`src/index.ts` 4900 行并有只减不增的棘轮。
- 控制台：`services/ops-console` 130 个单测、148 个截图基线（本机跑全套请加 `--workers=4`）、首屏包体 172 KB gz；五个入口（今天 / 节点 + 节点详情 / 客户 + 客户 360 / 客户端 / 设置）全部就位，目录 YAML 编辑仍在 `/ops/`。
- 迁移 0039–0049 全部只增不改，每张新表的写入都有缺表守卫，所以 **先迁移后部署** 与 **先部署后迁移** 两种顺序都不会让客户端上传失败。

## 0.1 上线记录（2026-09-10）

五次部署，`main` 依次为 `a6693fd`（迁移 0034–0049 + 新后台）、`6f7f3c2`（影子期三处判定修正）、`7417e7b`（延迟告警、上/下架执行、公开脉搏、客户判定统一、节点资料写接口）、`54c1f74`（节点页读引擎、资料可编辑、设置三个编辑器、壳层刷新与翻页）、`ddf4143`（客户写动作、判定只认点名过的机器）。外部看门狗用 `GET /api/v1/system/pulse`。生产上手工删过一条 UUID 假节点的 `ops_node_status` 行（来源是 macOS 客户端按设备 id 上报，#123 已修）。

第六次 `012c1fe`（跟进记录、事故关闭方式、早报、节点负载曲线、白名单，迁移 0050）：第一次跑在应用迁移的 D1 请求上碰到 Cloudflare API 瞬时错误，脚本按设计在部署 Worker 之前停下，生产库无任何部分写入；原样重跑即成功。**部署脚本失败时先用 `d1 migrations list` 确认状态再重跑，不要手工补 SQL。**

第七次 `80dd137`（迁移 0051 `candidate_since`；迟滞按分钟：劣化 600 秒开 / 900 秒关，高负载 900/900；客户路径慢连续 3 个窗口；早报归组并标出反复开关）。上线前一夜 `node-degraded` 在 Fuji 开了 10 次、最短 59 秒——判定每分钟跑一次，按次数计的迟滞等于两分钟。

第八次 `b173c29`（迁移 0052：每设备一行状态，客户状态从设备汇总；`connection_events.attempt_id` 去重）。

第九次 `aa240b8`（PR #128；迁移 0053 账目 / 月结 / 汇率，0054 `users.wechat_id`，0055 白名单行上的微信号/联系方式/备注）：收入、退款、补偿只记人民币，支出缺省美元；每日 `fx` 步骤从 frankfurter 拉汇率——没有当天汇率时非人民币条目会 409 `FX_RATE_MISSING`，这是设计而不是故障，等下一个 tick。开户早于客户注册时，微信号等先落在 `signup_allowlist`，首次登录自动带到 `users`。部署前备份 `backups/control-plane-d1/20260910T085207Z.sql.gz`。

### 客户开通漏斗

开通了但还没用起来的人现在出现在 `GET customers/funnel`：白名单未注册是 `invited`（带着开通时记下的微信号），注册未装客户端 / 装了未上报 / 上报过未连上分别是 `registered`、`device_added`、`reported`。他们不再只活在旧后台的白名单页，也不会在客户列表里被标成「未上报」——从未连上过的判定是「还没用起来」。已经连上过的人只计入 `connected`，不出现在卡住名单里。

日常运营不再需要打开 `/ops/`：事故、节点上下线、目录发布、分流规则、家宽库存、客户开通与处置都在 `/ops2/`。还留在旧后台的只有节点 24 小时曲线、质量原文折叠、注册白名单页（见 `docs/ops/parity-audit.md` 第三波）。

## 0.2 恢复演练结论（2026-09-10，详见 `docs/ops/restore-drill-2026-09-10.md`）

今天的备份 `backups/control-plane-d1/20260910T085207Z.sql.gz` 能恢复、恢复后能当数据用（20 用户 / 27 设备 / 7533 遥测窗口，`quick_check` ok，外键零违例），导入 28 秒，全流程 wrangler 时间约 1.5 分钟。五条要记住的：

1. 手工备份要按脚本命名（`%Y-%m-%dT%H:%M:%SZ.sql.gz`）并传 `.sha256` 旁文件，否则 `restore-control-plane-d1-preview.sh` 会拒绝；今天的旁文件已补传。
2. **D1 不能关外键、不允许 `integrity_check`**：清空一个已有库要先删触发器、索引，再按依赖顺序（子表先）删表；完整性用 `PRAGMA quick_check` + `PRAGMA foreign_key_check`。仓库里还没有按依赖顺序的清库脚本——这是生产恢复的硬缺口（部门 E）。
3. `d1 migrations apply` 需要 `--config`（本地 gitignored 的 `wrangler.preview.jsonc`），`d1 execute/export` 不带。
4. 生产库的 `d1_migrations` 里有五条仓库里不存在的 0026–0030（早期编号被复用），对应的 `diagnostics_failure_index` 等四张表没有代码读写；从空库按 migrations 重建与从 dump 恢复会得到不同的库。要么补文件要么加一条迁移删表，让两条路径收敛。
5. D1 之外没有备份：Worker 密钥（尤其 `CATALOG_ENCRYPTION_KEY` 与 `JWT_SECRET`）、R2 两个桶、DNS / 路由 / Access 应用、策略签名私钥都在恢复清单之外，且没有生产恢复流程。

## 1. 在 preview D1 上演练迁移

**已于 2026-09-10 做过一次**：备份 `backups/control-plane-d1/2026-09-10T00:07:11Z.sql.gz` 灌进 `tono-control-plane-ops-preview`（新建，id `12c01ca6-d170-4fcf-9ee1-062256562c46`），`migrations apply` 一次通过，26 张新表齐全，20 个用户 / 7482 个遥测窗口完好。

两个要知道的事实：

1. **生产库的迁移记录停在 0033。** `0034`–`0038`（设备出口凭证、审计加固、计量切换、回收重试）从来没在生产上应用过，只有 `revocation_jobs_pending` 这个索引名先存在。部署脚本会把 0034–0049 共 16 个一起应用；演练证明它们在生产数据上能干净跑完。其中 0035 加了 `sessions_require_eligible_device` 触发器、0037 加了阻止未配对计量切换的触发器——这是主干代码本来就期望的状态。
2. **本地跑 `wrangler d1 export … --config wrangler.jsonc` 会报认证错误**（wrangler 4.129 的 profile 解析在带 `--config` 时落到默认账号），去掉 `--config` 就正常；夜间工作流用 API token，不受影响。手工备份时按 `tooling/scripts/backup-control-plane-d1.sh` 的步骤但不带 `--config`。

重做演练（每次部署前）：

```sh
cd services/control-plane
npx wrangler d1 export tono-control-plane --remote --output /tmp/prod.sql
npx wrangler d1 execute tono-control-plane-ops-preview --remote --file /tmp/prod.sql -y --config wrangler.preview.jsonc
npx wrangler d1 migrations apply tono-control-plane-ops-preview --remote --config wrangler.preview.jsonc
```

`wrangler.preview.jsonc` 是本地文件（已 gitignore），只绑定 preview 库。

## 2. 合并与部署

1. 开 PR：`ops/platform` → `main`。PR 描述用 `docs/ops/rollout-ops2.md` 的第 0 节。
2. 合并后在 `main` 上跑既有脚本：`tooling/scripts/deploy-control-plane-main.sh`。脚本会先应用生产 D1 迁移，再构建旧控制台与新控制台（`console:build`），最后部署两个 Worker。
3. 部署后核对：

```sh
curl -s https://api.afk.ccwu.cc/api/v1/system/version
# 浏览器打开 https://admin.afk.ccwu.cc/ops2/ ，右上角 数据源 胶囊应显示时间；/ops/ 旧后台不受影响
```

## 3. 新密钥与变量（两个 Worker 都要）

```sh
npx wrangler secret put ALERT_TELEGRAM_BOT_TOKEN --config wrangler.jsonc
npx wrangler secret put ALERT_TELEGRAM_BOT_TOKEN --config wrangler.admin.jsonc
```

变量（可选，缺省即用默认）：`ALERT_WEBHOOK_ALLOWED_HOSTS`（默认 `api.telegram.org,open.feishu.cn,hooks.slack.com`）、`OPS_TRAFFIC_PARSE`（设为 `0` 可关掉日志段解析）。

## 4. 回填与影子期

- 部署后第一个 cron tick 起，`flattenBacklog` 每 5 分钟回填 200 个遥测窗口，30 天数据约一天内补完；客户页的连接时间线会逐步出现。
- 判定引擎会立刻开始写 `ops_node_status` 和 `ops_incidents`。**告警规则默认没有**，所以不会推送。建议观察 48 小时，在 `/ops2/#/today` 对照旧控制台的故障页，再建第一条规则：

```sh
curl -X POST https://admin.afk.ccwu.cc/api/v1/ops/alert-rules -H 'content-type: application/json' \
  -d '{"name":"严重事故→Telegram","minSeverity":"severe","delaySeconds":900,"cooldownSeconds":3600,"channel":"webhook","template":"telegram","target":"<chat_id>","secretRef":"ALERT_TELEGRAM_BOT_TOKEN"}'
```

- 死人开关：收集器快照超过 20 分钟未更新会生成 `fleet` 主体的严重事故；验证方法是临时把 `operations_live_snapshot.updated_at` 往前拨 3000 秒，再看今天页。
- 延迟告警在延迟到期后仍会发送；上/下架任务由 Worker 自己执行。

## 5. hub 上的任务执行器

```sh
scp ops-panel/collect.py ops-panel/jobs.py tono-199.30.91.172:/opt/tono-ops/
scp ops-panel/systemd/tono-ops-jobs.* tono-199.30.91.172:/etc/systemd/system/
ssh tono-199.30.91.172 'cd /opt/tono-ops && python3 collect.py --jobs --max 1; systemctl daemon-reload; systemctl enable --now tono-ops-jobs.timer'
```

先只在后台对一台节点入队 `xray_dial_errors`（只读类型），看结果回传与 `ops_audit`；一周后再放开 `xray_restart` / `identity_sync`。

## 6. 客户端（阶段 1.5）

- **macOS 已做**（`apps/macos`）：窗口带 `platform: macos`；`connectOk` 带连接时的出口延迟 `delayMs`；连接失败时立即 `POST /api/v1/telemetry/failures`（阶段、代码、错误、核心最后一条报错、路径延迟），与"保护状态快照"同一开关，没选中节点时不发；失败后 5 分钟补发一个窗口。没有改成 3 分钟节奏：账号每小时 6 次的心跳预算装不下，Worker 给失败上报单开了限额（`RATE_LIMIT_FAILURE_*`，默认 60/12/60）。
- **Windows 待做**：同样四项，等 pteropod 那棵树的 0.0.72 客户端改动提交后再做，避免和它冲突。
- 日志段上传默认开与 `bytesByRoute` 属于阶段 3.5，Worker 已能接收 `bytesByRoute`。

## 7. 回滚

- Worker：`npx wrangler rollback --config wrangler.jsonc` 与 `--config wrangler.admin.jsonc`。
- 新表是投影，可以清空重建：`DELETE FROM connection_events; DELETE FROM ops_flatten_cursor;` 后 cron 会重新回填。
- `/ops2/` 是路径，不影响 `/ops/`；出问题时直接不打开它即可。
