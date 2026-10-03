| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PERF-CONNECT-4 | sing-box 冷 DoH 比 mihomo 多一次 Reality 握手；macOS 发出器的指纹和 fake-ip 段仍和 Windows 不一致 | fixed(a56733a8) | 本 PR | 中·实测 | 首包探测仍是应用层；基准用的是上游 tarball |

rebase 到已合入的 #729 之后再读模板。Windows 发出器拒绝非 chrome，写出 `utls.fingerprint=chrome`。A 查询从 TUN/DNS/Mixed 进 fake-ip，规则上有 `rewrite_ttl: 30`。AAAA 直接 NOERROR。DoH 是 `https`，`alpn: [h2]`，并带 `Tono-DoH-Backup`（`8.8.8.8`）。#728 在开关文件不存在时返回关闭。先前写的「只有一个 DoH、TTL 写不出 30」这两条已经在 main 上，不再算缺口。

回环上 stock alpha.9（revision `132b38e9`）VLESS：fake-ip 0.5 ms / 0 次握手，首包 42.8 ms / 1 次握手，同名缓存 0.6 ms / 0 次，下一个名字 43.3 ms / 0 次新握手。冷的第一次真实解析是 129.5 ms / 2 次握手，mihomo 同一条是 1 次。

仍开放的缺口：

- 冷 DoH 多一次 Reality 握手。复用之后是 0 次。
- 模板把 `cache_file` 关掉。进程内 DNS 缓存仍然有效。没有 LRU/stale 开关。
- #736 把 mihomo 的 `/delay` 挪到数据面成功之后。sing-box 发出器本身没有探测；开关打开之后，应用层还没有同样的「不要跟第一次握手抢」的保证。
- macOS `ConfigPipeline+SingBoxProduct.swift` 不在已合入的 #727–#730 里。它允许 firefox/safari 等指纹，fake-ip 段是 `198.19.0.0/16`。Windows 模板要求 chrome，段是 `198.18.16.0/20`。

基准用的是上游 tarball，不是认证过的 Tono 构建。提交相同，编译标签更宽。
