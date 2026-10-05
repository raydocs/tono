| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| NETMON-UNCHANGED-EXTERNAL-NOISE | Windows Service 把 DNS 自写窗口外的回调批次一律发布为网络变化，即使观察到的接口和路由都没变，App 随即做数据面证明和 pin 刷新 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·已确认 | 一个去抖批次内完成且所有观察字段相同的换网不再发布，死隧道靠 30 秒出口探测发现；观察含 IPv4 地址与 IPv6 默认路由，不含 IPv6 地址；噪声降幅未实机统计；回归未在本机运行 |

Codex 核验 CONFIRMED（按合并批次计，不是每个原始回调一条）；源码不能认定是哪类 OS 事件造成现场噪声。
