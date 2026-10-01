## 2026-10-01 · Windows sing-box 的 DIRECT 换进程并回读规则

- 归属：SHIP_PLAN G1。Windows 连接后的可选 DIRECT。不是客户发布。
- 来源：叠在第四二进制分支上。服务协议 19（当时 main 是 18）。不关闭 #203。
- 缺陷修复：无。协议 18 仍跳过 sing-box DIRECT，避免 mihomo 重载括号把流量留在 Blocked。
- 新增/优化：协议 19 用换进程代替 `PUT /configs`。先用 alpha.9 的 `/rules` 字符串证明 AI 后缀不走物理网卡且规则里有 `process_path_regex`，再安装 Committed 许可。许可摘要以服务回执为准。对不上或装不上就换回全隧道文档；这次失败不把 DIRECT 规则写回去。隧道仍证明不了才放行普通网络，AI 仍拦。不把 Blocked 当作这次的结果。
- 工程与测试修正：`tono-core` 增加一条 alpha.9 规则字符串测试。协议测试确认 18 不能换进程、19 可以。`cargo test` 未在本机执行（rustc 1.83 不能编译 edition 2024）。
- 验证：未在本机编译。Windows CI 是编译门。2026-10-01 续记：`windows / service` 因 `anyhow!` 宏未导入而编译失败，改为 `anyhow::anyhow!`。
- 发布与部署：仅源码，无新候选。
- 剩余限制：真实 Windows 上还没跑通过程替换和 `/rules` 回读。换进程期间 Service 调用内部会先收回隧道许可，调用返回前必须重新锁上或放行；返回时不应停在 Blocked。
