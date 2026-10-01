## 2026-10-01 · sing-box web-direct 的客户端查询先拿假 IP

- 归属：SHIP_PLAN G1。影响 macOS App 的 sing-box 产品配置。该路径默认关闭。
- 来源：基线 `origin/main` `c2626f53`。对照钉住的 sing-box `v1.15.0-alpha.3` `93fff595`。[#958](https://github.com/raydocs/tono/pull/958)。未合 main。
- 缺陷修复：web-direct 的域名和后缀，客户端 A 查询在 hosts / 中国 DNS 之前改走 `Tono-FakeIP`。连接因此带上域名，已有的 web-direct 规则（含 UDP）能命中。拨号仍用中国 DNS 或 pin 的 hosts。不打开 `reverse_mapping`。助手域名规则仍排在 web-direct 前面。关联 #817。
- 新增/优化：无。`wechat.com` 这类只属于微信的后缀仍由中国 DNS 回答真 IP。
- 工程与测试：`testWebDirectClientQueriesAreFakeIPBeforeRealResolvers`。本机不跑 `xcodebuild`，交给 CI。
- 验证：读了该提交的 `dns/router.go` `matchDNS`、`route/route.go` `prepareMatchMetadata`、`docs/configuration/dns/index.md` 的 `reverse_mapping`。未在 Mac 上连网。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需要实机看 web-direct 的 TCP/UDP 是否走直接出站，以及助手域名是否仍不直连。假 IP 表不落盘，进程重启后旧假 IP 会查不到，这和原本其余域名的假 IP 一样。
