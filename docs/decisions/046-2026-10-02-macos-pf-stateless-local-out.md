## 2026-10-02 · macOS：回环、私网、链路本地的出站 PF 放行要不要从 `keep state` 改成 `no state`

- Status: provisional
- Chosen: 改。`tono-loopback`、`tono-lan`、`tono-linklocal` 的出站放行改成 `no state`；入站放行、mDNS、DHCP、NDP、隧道、控制面和出口的规则不动。不选 `flags any keep state`：中途建的状态缺少窗口缩放信息，`man pf.conf` 说明这种状态可能让连接卡住。[决策 028](028-2026-09-30-continuity-tun-exclude-only.md) 当时不改状态位，理由是规则没在 Mac 上解析过；现在 hosted macOS CI 的 `privileged-tests` 解析并在内核加载渲染出的规则。
- Why stricter: 允许的目的地址集合不变，这些规则只按接口或目的地址匹配，回程方向没有丢弃规则。多放行的只有发往回环、私网、链路本地地址的非 SYN TCP 包。局域网 DNS 丢弃规则（`tono-lan-dns`）排在这些放行之前，逐包生效；`if-bound` 要防的「状态跟着流换到物理网卡」在没有状态时不存在。没有隧道时私网和链路本地的规则仍不渲染。
- Applied in: [#1331](https://github.com/raydocs/tono/pull/1331)。
