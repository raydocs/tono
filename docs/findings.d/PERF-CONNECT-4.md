| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PERF-CONNECT-4 | sing-box 发出器已有 chrome uTLS 和 fake-ip，但 fake-ip TTL、第二个 DoH 和首包探测还不齐 | in-PR | 本 PR；对照 #727–#730 | 中·实测 | 不改那些 PR 的文件；alpha.9 没有 fake-ip TTL 字段 |

只读 #729 的模板和 `runtime.rs`，没有改它们。Windows 发出器拒绝非 chrome 的指纹，写出 `utls.fingerprint=chrome`。A 查询从 TUN/DNS/Mixed 进 fake-ip，AAAA 直接 NOERROR，DoH 是 `https`（不是 h3）并 `detour` 到出口。#728 在开关文件不存在时返回关闭。

回环上 stock alpha.9（revision `132b38e9`）VLESS：fake-ip 0.5 ms / 0 次握手，首包 42.8 ms / 1 次握手，同名缓存 0.6 ms / 0 次，下一个名字 43.3 ms / 0 次新握手。连接有复用。冷的第一次真实解析是 129.5 ms / 2 次握手，mihomo 同一条是 1 次。

缺口，留给 #727–#730，本 PR 不动那些文件：

- alpha.9 的 fake-ip 只有 `inet4_range`，应答 TTL 记成 600。mihomo 侧把 TTL 收到 30 秒，是为了断线后系统缓存没刷掉时机器还能恢复。这边写不出 30。
- 模板只有 `1.1.1.1` 一个 DoH。mihomo 留着第二个 `8.8.8.8`，一个挂了另一个还能答。
- 模板把 `cache_file` 关掉。进程内 DNS 缓存仍然有效（日志里是 cached）。没有 LRU/stale 开关。
- #736 把 mihomo 的 `/delay` 挪到数据面成功之后。sing-box 发出器本身没有探测；开关打开之后，应用层还没有同样的「不要跟第一次握手抢」的保证。
- macOS `ConfigPipeline+SingBoxProduct.swift` 不在 #727–#730 的文件里。它允许 firefox/safari 等指纹，fake-ip 段是 `198.19.0.0/16`。Windows 模板要求 chrome，段是 `198.18.16.0/20`。

基准用的是上游 tarball，不是认证过的 Tono 构建。提交相同，编译标签更宽。
