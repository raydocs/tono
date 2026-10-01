| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CONNECT-BENCH-ZERO-HANDSHAKE | `--check` 把正数握手上限当纯上界，0 次 Reality 握手仍报通过 | in-PR | 待开 | 中·已确认 | 毫秒字段仍是上界；mihomo 冷 DoH 的 1 次仍落在上限 2 以内。不是客户运行时缺陷 |

回环基准的稳定信号是握手次数。`vless/tono-fixed/handshakes` 上限是 1，`dns_handshakes` 上限是 2。旧比较只拒绝 `None` 和大于上限的值，所以 HTTP 200 且 0 次握手会通过。2026-09-30 的成功运行 `36755690366` 里，mihomo 冷 DoH 是 1 次、sing-box 是 2 次，所以上限不能改成必须相等。
