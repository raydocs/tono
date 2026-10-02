## 2026-10-02 · macOS：回环、私网、链路本地的出站 PF 放行要不要从 `keep state` 改成 `no state`

- Status: provisional
- Chosen: 改。`tono-loopback`、`tono-lan`、`tono-linklocal` 的出站放行改成 `no state`；入站放行、mDNS、DHCP、NDP、隧道、控制面和出口的规则不动。不选 `flags any keep state`：中途建的状态缺少窗口缩放信息，`man pf.conf` 说明这种状态可能让连接卡住。[决策 028](028-2026-09-30-continuity-tun-exclude-only.md) 当时不改状态位，理由是规则没在 Mac 上解析过；现在 hosted macOS CI 的 `privileged-tests` 解析并在内核加载渲染出的规则。
- Why stricter: 允许的目的地址集合不变，这些规则只按接口或目的地址匹配，回程方向没有丢弃规则。多放行的是发往回环、私网、链路本地地址、原先过不了 `flags S/SA` 的完整 TCP 包（ACK/数据、FIN、RST、SYN+ACK）。TCP 分片是另一类：PF 匹配分片时跳过所有带端口或带 TCP 标志位的规则，原来有状态的放行（隐含 `flags S/SA`）因此不匹配分片，分片落到末尾丢弃；无状态的放行会按地址匹配它并绕过 53/853 端口丢弃。所以在这些放行之前加两条 `block … proto tcp … fragment`（`tono-lan-fragment`，不限网卡），发往私网、链路本地、ULA、IPv6 组播的出站 TCP 分片仍然丢弃，和改动前一致；回环上的 TCP 分片现在放行（不出本机，也不经过局域网 DNS 丢弃规则）。局域网 DNS 丢弃规则（`tono-lan-dns`）排在这些放行之前，对到达规则匹配的完整包生效。两个既有例外不是这次引入、也没有被这次关掉：入站建立的状态先于规则匹配（局域网主机从 53 端口发起的流，本机的回包不过 DNS 丢弃规则）；UDP 分片本来就按地址匹配有状态的局域网放行。`if-bound` 要防的「状态跟着流换到物理网卡」在没有状态时不存在。没有隧道时私网和链路本地的规则仍不渲染。
- Applied in: [#1331](https://github.com/raydocs/tono/pull/1331)。
