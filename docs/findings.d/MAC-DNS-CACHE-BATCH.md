| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-CACHE-BATCH | 系统 DNS 把 MoreComing 清零的第一批公网地址当成最终答案并拆掉查询，缓存里的 www.gstatic.com 会挡住随后的假 IP，连接在 PF 已武装后失败并保持断网 | in-PR | 待开 | 中·推导 | 未在真机确认 networksetup 改 DNS 后 mDNSResponder 是否仍先交缓存。超时仍失败关闭。needs-hardware |
