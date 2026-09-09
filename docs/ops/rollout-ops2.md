# 新后台（/ops2/）上线步骤

这份是把 `ops/platform` 分支推到生产的操作清单。所有步骤只有你能跑：需要 hub 的 SSH、Cloudflare 账号里的 D1 与 wrangler 登录、Telegram bot token。

## 0. 上线前的状态

- 分支 `ops/platform`（worktree `~/orca/workspaces/tono/spookfish`），未推送。
- Worker：`services/control-plane` 27 个测试文件 / 664 个测试、typecheck、`check:contract`、`check:budgets` 全绿；`src/index.ts` 4900 行并有只减不增的棘轮。
- 控制台：`services/ops-console` 130 个单测、148 个截图基线（本机跑全套请加 `--workers=4`）、首屏包体约 150 KB gz；五个入口（今天 / 节点 + 节点详情 / 客户 + 客户 360 / 客户端 / 设置）全部就位，目录 YAML 编辑仍在 `/ops/`。
- 迁移 0039–0049 全部只增不改，每张新表的写入都有缺表守卫，所以 **先迁移后部署** 与 **先部署后迁移** 两种顺序都不会让客户端上传失败。

## 1. 在 preview D1 上演练迁移

```sh
cd services/control-plane
npx wrangler d1 migrations list tono-control-plane-ops-preview --remote
npx wrangler d1 migrations apply tono-control-plane-ops-preview --remote
```

预期：0039–0049 依次应用；随后 `npx wrangler d1 execute tono-control-plane-ops-preview --remote --command "SELECT name FROM sqlite_master WHERE name LIKE 'ops_%' OR name LIKE 'connection_%' ORDER BY 1"` 能看到全部新表。

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

## 5. hub 上的任务执行器

```sh
scp ops-panel/collect.py ops-panel/jobs.py tono-199.30.91.172:/opt/tono-ops/
scp ops-panel/systemd/tono-ops-jobs.* tono-199.30.91.172:/etc/systemd/system/
ssh tono-199.30.91.172 'cd /opt/tono-ops && python3 collect.py --jobs --max 1; systemctl daemon-reload; systemctl enable --now tono-ops-jobs.timer'
```

先只在后台对一台节点入队 `xray_dial_errors`（只读类型），看结果回传与 `ops_audit`；一周后再放开 `xray_restart` / `identity_sync`。

## 6. 客户端（阶段 1.5，尚未开始）

失败即报、失败后 3 分钟节奏、`platform`、连接时的 `delayMs`、日志段上传默认开——等 pteropod 那棵树的 0.0.72 客户端改动提交后再做，避免和它冲突。服务端已经准备好接收（`POST /api/v1/telemetry/failures`）。

## 7. 回滚

- Worker：`npx wrangler rollback --config wrangler.jsonc` 与 `--config wrangler.admin.jsonc`。
- 新表是投影，可以清空重建：`DELETE FROM connection_events; DELETE FROM ops_flatten_cursor;` 后 cron 会重新回填。
- `/ops2/` 是路径，不影响 `/ops/`；出问题时直接不打开它即可。
