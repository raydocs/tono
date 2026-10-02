| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-FAKEIP-REPLACE | Windows 替换 sing-box 进程（DIRECT 生效、回退到完整隧道）后 fake-IP 表清空并从同一段开头重新分配，应用缓存的旧地址对应到别的域名，出现证书错误直到 DNS 缓存过期 | in-PR | [#1258](https://github.com/raydocs/tono/issues/1258) / [#1333](https://github.com/raydocs/tono/pull/1333) | 中·推导 | 旧地址仍失败一次（立即拒绝）；每进程 1022 个地址；App 重启后四分之一概率同段；macOS `/core/sync` 同类问题在 [#1334](https://github.com/raydocs/tono/pull/1334)；需要实机 |

依据：sing-box `v1.15.0-alpha.9` `dns/transport/fakeip/store.go`（没有 cache file 时用内存表，`Start` 把 `inet4Current` 置为段首，`Create` 逐个递增）；`route/route.go` `prepareMatchMetadata`（目的地址在本进程的段内但没有记录时返回 `missing fakeip record`，有记录时把目的地换成记录里的域名）；`route/rule/rule_item_cidr.go`（目的地是域名时 `ip_cidr` 不匹配，所以池的拒绝规则不影响正常的 fake-IP 连接）。没有在实机上抓到证书错误，所以定为「推导」。
