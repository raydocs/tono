## 2026-10-02 · Windows：替换 sing-box 进程后，应用缓存的旧 fake-IP 不再指向别的网站
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。Windows App（sing-box 配置编译）、`tono-core`、sing-box 模板。
- 来源：[#1258](https://github.com/raydocs/tono/issues/1258)，分支 `fix/win-fakeip-rotate`，[#1333](https://github.com/raydocs/tono/pull/1333)。未合 main。
- 缺陷修复：sing-box 的 fake-IP 表只在进程内存里，地址从段的开头按顺序分配（alpha.9 `dns/transport/fakeip/store.go`）。Windows 上可选 DIRECT 是在 Connected 之后替换 sing-box 进程来生效的，新进程从同一段的开头重新分配，应用还缓存着的旧地址就对应到新进程最先解析的另一个域名：浏览器拿着原域名的 SNI 连到别的站点，出现证书错误（HSTS 站点是不可跳过的错误页），持续到 DNS 缓存过期（系统 30 秒，浏览器更久）。每次带 DIRECT 策略的 Connect 都会发生，替换回完整隧道时再发生一次。现在每份编译出的文档轮流使用 `198.18.16.0/20` 里的一个 /22，模板里新增一条规则拒绝目的地址落在整个池内的纯 IP 连接：旧地址在新进程里不属于它的段，立即被拒绝（RST），应用重新解析后恢复。
- 新增/优化：无。
- 工程与测试：`tono-core` 新增一条回归（相邻两份文档的 fake-IP 段不相交、都在池内，且池的拒绝规则排在 home/DIRECT/出口规则之前）；`RuntimeInput` 新增必填的 `fake_ip_slot`；两处按下标断言的既有测试随规则位置和段的变化同步。Service 的文档准入和 `/rules` 证明不需要改：准入不限定 fake-IP 段，`/rules` 的期望字符串由同一份文档生成。
- 验证：见 PR。本机没有连接、没有原生构建；`tono-core` 测试和 pinned sing-box 的 `check` 由 hosted CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机验证（`needs-hardware`）。旧地址仍会失败一次，只是从「连到别的站点」变成「立即拒绝」。每个进程可用的 fake-IP 从 4094 个降到 1022 个，用完后从头复用。App 重启后不知道正在运行的进程用的是哪一段，起点取自启动时间，有四分之一的概率与被替换的进程同段。macOS 的 `/core/sync` 重启有同样的问题，另开 PR。[决策 047](../decisions/047-2026-10-02-windows-fakeip-rotation.md)。
