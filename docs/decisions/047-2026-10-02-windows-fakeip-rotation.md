## 2026-10-02 · Windows：替换 sing-box 进程后旧 fake-IP 怎么处理

- Status: provisional
- Chosen: 每份文档换一个 /22（都在 `198.18.16.0/20` 内），并拒绝目的地址在池内的纯 IP 连接。[#1258](https://github.com/raydocs/tono/issues/1258) 列的另外两个选项不选：打开 `cache_file` 的 `store_fakeip` 会把访问过的域名写到磁盘，Service 和 macOS helper 的准入也都要求 `cache_file.enabled == false`；在公布 Connected 之前就应用 DIRECT 会让 Connect 最多多等 20 秒的 DIRECT 解析。
- Why stricter: 不落盘，不放宽任何准入。旧地址由「连到另一个域名」变成「被拒绝」，没有新增可达的目的地；拒绝规则排在 home、DIRECT 和出口规则之前，目的地是域名的连接不匹配它。
- Applied in: [#1333](https://github.com/raydocs/tono/pull/1333)。
