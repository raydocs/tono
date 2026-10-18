# 2026-10-18 · EXIT_IDENTITY_PROPAGATING 现在怎么解开

这名 Windows 用户退出再登录之后仍然是 `ApiError::ExitIdentityPropagating`（HTTP 503 `EXIT_IDENTITY_PROPAGATING`）。这是当前生产目录门的预期结果，不是客户端没刷新。

本代理没有对生产执行任何命令。下面的命令交给运维在自己的环境里跑。

## 为什么退出再登录没有用

`POST /api/v1/auth/logout` 只撤销这台设备上的会话。`device_exit_credentials` 是 `INSERT OR IGNORE`，`created_at` 停在第一次写入。再登录用的是同一张出口身份。目录要每个已发布出口都满足 `status = 'active'` 且 `last_roster_at > created_at` 才发 200。有一个不满足，就一直 503。设备是 2026-10-16 23:25 加的，已经超过名册的大约一分钟周期，所以不是「还在传播」。

名册是出口来拉的。`tono-exit-agent` 只有 Xray 和 hy2 对账整轮成功才 `POST /api/v1/home/roster-ack`。对账失败不会推进 `last_roster_at`。控制面没有推送。

## 哪个出口没确认

仓库里看不出名字。生产目录 YAML 是加密的。没确认的是：已发布目录里的每个基名（` · hy2` 折回同一节点），只要它没有一条 `exit_nodes` 满足 `status = 'active'` 且 `last_roster_at` 大于这张设备凭据的 `created_at`。没有行、不是 `active`、`last_roster_at = 0`，或确认时间早于这张凭据，都算。当前生产是「全部都要确认」，所以每一个这样的名字都在挡。一个就够让目录 503。

在 `services/control-plane`、wrangler profile `tono` 下只读：

```bash
npx wrangler d1 execute tono-control-plane --remote --json --command \
"SELECT u.email, u.id AS user_id, d.id AS device_id, d.name AS device_name, d.status AS device_status, d.created_at AS device_created_at, c.created_at AS credential_created_at, datetime(c.created_at,'unixepoch') AS credential_utc, c.client_uuid FROM users u JOIN devices d ON d.user_id = u.id LEFT JOIN device_exit_credentials c ON c.device_id = d.id WHERE d.status IN ('pending','active') ORDER BY c.created_at DESC LIMIT 50"
```

对上桌面里那台 2026-10-16 23:25 的设备（先核对时区；不要假设一定是 UTC）。记下 `credential_created_at` 和 `user_id`。

```bash
npx wrangler d1 execute tono-control-plane --remote --json --command \
"SELECT id, name, status, last_roster_at, datetime(last_roster_at,'unixepoch') AS acked_utc FROM exit_nodes ORDER BY last_roster_at"
```

```bash
npx wrangler d1 execute tono-control-plane --remote --json --command \
"SELECT phase FROM exit_credential_rollout WHERE singleton_id = 1"
```

```bash
npx wrangler d1 execute tono-control-plane --remote --json --command \
"SELECT user_id, created_at, retired_at, datetime(created_at,'unixepoch') AS created_utc FROM exit_credentials WHERE user_id = 'USER_ID'"
```

已发布名字用已登录的 Access 会话读明文目录，不要解密 D1：

- `GET https://api.afk.ccwu.cc/api/v1/ops/exit-catalog`（`settings.read`）
- 或 `GET https://api.afk.ccwu.cc/api/v1/admin/exit-catalog`

把目录里的代理 `name` 用基名比较（去掉结尾的 ` · hy2`）。挡路的就是：这个基名在 `exit_nodes` 里没有 `active` 且 `last_roster_at` 大于上面的 `credential_created_at`。家宽若有同名 `exit_nodes` 行，同一条规则。

## 现在就能做的操作

优先对每一个挡路的节点做身份同步。运维台节点页按钮是「身份同步」。等价请求（Access 会话要有 `nodes.jobs`，节点名必须逐字相同）：

```bash
curl -sS -X POST "https://api.afk.ccwu.cc/api/v1/ops/nodes/NODE_NAME/jobs" \
  -H "content-type: application/json" \
  -H "cf-access-jwt-assertion: ACCESS_JWT" \
  -d '{"type":"identity_sync","confirmName":"NODE_NAME"}'
```

Hub 会 SSH 到那台机器执行 `systemctl start tono-exit-agent.service`。只有进程退出码 0 且随后的 roster-ack 把 `last_roster_at` 推到凭据 `created_at` 之后，这名用户的下一次目录才会 200。回执若是 `identity_sync unit start failed`，到那台机器上看 `journalctl -u tono-exit-agent.service`。对账中途失败不会确认。

人已经在那台机器上时：

```bash
sudo systemctl start tono-exit-agent.service
```

然后再读一次 `last_roster_at`。

节点已经死了、禁用了，或代理起不来因而不可能确认：身份同步不会推进 `last_roster_at`。当前生产要等它确认，或者把它从已发布目录拿掉。运维台是「下架」（`nodes.retire`）：

```bash
curl -sS -X POST "https://api.afk.ccwu.cc/api/v1/ops/nodes/NODE_NAME/jobs" \
  -H "content-type: application/json" \
  -H "cf-access-jwt-assertion: ACCESS_JWT" \
  -d '{"type":"catalog_retire","confirmName":"NODE_NAME"}'
```

不要禁用这个用户。不要轮换或删除 `device_exit_credentials`：新的 `created_at` 会让每个出口重新确认，卡住的时间更长。

源码改动在 [#1674](https://github.com/raydocs/tono/pull/1674)（决策 129）。它部署之前，生产仍是「全部出口都要确认」。部署之后，只要有一个健康出口的 `last_roster_at` 已经大于这张凭据，目录会只下发那些已确认的出口，死节点不再挡。一个都没确认过的话，部署后也还是 503，直到有一台健康出口完成一轮名册。

## 代理本身不是 127.0.0.1:10090 的来源

Windows 产品路径不打开 WinINet 系统代理（P0-9，`apply_proxy_after_start` 是空操作）。仓库里没有端口 10090。那条 `ProxyEnable=1`、`ProxyServer=127.0.0.1:10090` 不是当前 Tono 写下的。控制面客户端已经 `.no_proxy()`。失效代理的检测和「清理失效代理」在另一条改动里。
