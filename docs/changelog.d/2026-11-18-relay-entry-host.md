## 2026-11-18 · 中继入口域名 static.bicon.dev
- 归属：登录/控制面中继路径；macOS 客户端、控制面路由、中继 nginx。
- 缺陷修复：某客户网络按 TLS SNI 复位 `api.afk.ccwu.cc`（两台中继 TCP 通、握手被 reset），导致「连不上任何一台中继」。中继现在也放行 SNI `static.bicon.dev`（她的网络用 `static.reveslc.com` 实测握手通过，返回 530 是当时 Worker 没挂这个域名；该域名在另一个 Cloudflare 账号，所以入口改用生产账号里的 bicon.dev），Worker 增加同名自定义域，macOS 中继路径用它做 SNI/Host。其他路径不变；`releases.afk.ccwu.cc` 不变。
- 验证：控制面 vitest 1109 通过；中继配置 python 测试通过；macOS 新测试 `testTheRelayPathDialsWithTheEntryHostNotTheBlockedAPIHost` 交 CI。
- 剩余限制：新域名同样可能被封；旧版客户端不会用新域名；更新下载（releases）仍用旧域名。
