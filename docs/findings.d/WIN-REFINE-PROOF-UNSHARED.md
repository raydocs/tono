| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-REFINE-PROOF-UNSHARED | Windows 恢复时 refine 已用 TCP 证明端点却没记入证明缓存，隧道前证明又拨同一端点 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·推导 | 后台循环已有证明时 refine 仍会再探一次（缓存检查未统一）；TCP 证明仍不当作连接可用证明；回归未在本机运行 |
