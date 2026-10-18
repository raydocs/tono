## 2026-10-18 · 家宽库存：通过线路本身查出口 IP，9 家免费定位库并列
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 控制台（家宽库存）；`services/control-plane`、`services/ops-console`。不是出货门。
- 来源：`origin/main` `6ae39607e` → 分支 `feat/home-exit-egress-lookup`；未合 main。
- 缺陷修复：无。起因：手填的 `egress_ipv4` 与实际出口对不上；同一个 decodo 地址（48.45.90.215）ipinfo 说纽约、ip-api / ipwho.is 说休斯敦，
  之前只能在本机逐条 curl 去对。
- 新增/优化：
  - Worker 新接口 `POST /api/v1/ops/home-exits/{id}/egress`：用 `cloudflare:sockets` 按 RFC 1928/1929 拨这条 SOCKS5 线路（D1 里存的账号密码只交给隧道），
    经隧道以 HTTP/1.0 问 `api.ipify.org`（失败于回显时再问 `checkip.amazonaws.com`）看到的地址，再并发问 9 家免费定位库：
    ipinfo、ip-api、ipwho.is、ipapi.is、ipapi.co、freeipapi、geojs、db-ip、country.is。每家答复原样保存；
    按州/省投票给出多数地点与「各家说法不一」标记，不取平均。目录类线路不拨隧道，直接查已存地址；没有地址的回 409 `HOME_EGRESS_UNKNOWN`。
  - 查到 IPv4 后写回 `home_exits.egress_ipv4`（只用于显示，目录不读它，所以不升目录版本；`updated_at` 不变，与探针一致）。
  - `GET /api/v1/ops/home-exits/egress`：每条线路最近一次结果。新表 `home_exit_egress`（迁移 `0102`），每条线路一行、每次覆盖、不留历史。
  - 权限：GET 归 `settings.read`，POST 归 `settings.publish`。审计记 `home.egress`（只记 IP 或失败阶段，不记凭证）。
  - 控制台家宽库存加「出口」列：出口 IP + 多数地点 + 票数，说法不一时标黄，隧道失败写明阶段（连不上 / 账号密码不对 / 线路不肯转发 / 回显没答复 / 超时）。
    点开是逐家答复的抽屉，带「重新查」。从没查过的 SOCKS5 线路在打开页面时自动排队逐条查一次；没有定时轮询。
  - 保留：凭证仍然只写不读，任何响应、错误文本和审计都不带口令。
- 工程与测试：
  - `test/home-egress.test.ts`：假 SOCKS5 服务端校验握手、凭证与 CONNECT 目标，结果入库、写回出口地址、响应里没有口令；凭证被拒记为 `auth` 阶段且不问任何定位库；投票与分歧标记。
  - `src/pages/settings/home/Egress.test.tsx`：分歧时出口格标黄并显示票数；凭证被拒时显示阶段说明。
  - 夹具：`fixtures/routes/home-egress.ts` 造结果（末段为奇数的地址给两家不同意见，ipapi.co 固定 429）。
- 验证：见 PR 验证评论（control-plane 与 ops-console 的 typecheck、lint、vitest、构建预算）。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：免费额度按 Worker 出口 IP 共享，ipapi.co 等常回 429，会显示为该家「没答复」；回显走明文 HTTP（隧道里没有 TLS），
  线路若篡改回显只会影响它自己的结果。这条改动碰到线路凭证，合入前要过一轮 Codex 审查。

2026-10-18 续（Codex 审查 `4e087cccf` 后）：4 major + 3 minor 全部修掉。
- 口令不再可能被反射：隧道错误只用固定句子，回显只留解析出的状态码；未知异常一律换成「lookup failed」。
- 定位库响应限 64 KB（超出即取消流），非 2xx 不读正文，字段截到 120 字；隧道读缓冲限 5 KB。
- 超时时关闭本次打开的所有 socket，并不再拨第二个回显。
- 定位库请求 `redirect: 'manual'`，3xx 记为该家失败。
- 线路在查询过程中被改（主机 / 端口 / 账号 / 口令）时，两处写入都不生效，回 409 `HOME_EXIT_CHANGED`；查询期间操作员手填的出口地址不被覆盖。
- SOCKS5：只接受自己提供的认证方法，校验认证回复 VER=1、CONNECT 回复 VER=5 / RSV=0。IPv6 用 URL 解析器做完整校验。
- 新增 3 个回归（恶意回显带口令、超时关 socket、线路被改时丢弃），首个测试加了不跟随重定向的断言；
  红检查：在修复前的提交上，这 4 个断言都失败（口令出现在响应里；`closes: 0`；该拒绝时成功了；跟随了重定向）。
- 控制台：两种拒绝码显示中文说明。UI 经 Fable 四轮审查通过（9.5）。
