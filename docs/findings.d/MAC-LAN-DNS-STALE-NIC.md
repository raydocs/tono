| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LAN-DNS-STALE-NIC | LAN DNS 阻断的接口范围停在 arm 当时的 en*；之后出现的网卡上 53/853 命中不限接口的 tono-lan | in-PR | [#894](https://github.com/raydocs/tono/issues/894) [#979](https://github.com/raydocs/tono/pull/979) | 中·推导 | 只在当前 en* 比已加载集合多出网卡时重载锚点，不 flush states，失败不释放；空列表保持原范围，不改成全局阻断；未实机 |
