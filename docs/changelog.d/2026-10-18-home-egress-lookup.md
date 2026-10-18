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
