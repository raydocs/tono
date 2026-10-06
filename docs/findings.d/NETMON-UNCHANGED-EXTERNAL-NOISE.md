| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| NETMON-UNCHANGED-EXTERNAL-NOISE | Windows Service 把 DNS 自写窗口外的回调批次一律发布为网络变化，即使观察到的接口和路由都没变，App 随即做数据面证明和 pin 刷新 | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·已确认 | 一个去抖批次内完成且所有观察字段相同的换网不再发布，死隧道靠 30 秒出口探测发现；观察含 IPv4 地址与 IPv6 默认路由，不含 IPv6 地址；IPv6 默认路由读不全时外部批次照旧发布，这类机器得不到降噪；噪声降幅未实机统计；回归未在本机运行 |

Codex 核验 CONFIRMED（按合并批次计，不是每个原始回调一条）；源码不能认定是哪类 OS 事件造成现场噪声。

独立审查（Codex `gpt-6.1-sol` high，`a97c963e...5d8b648f`）报一个 major：旧代码吞掉 IPv6 读取失败，过滤后 IPv4 不变、IPv6 读不出的外部批次会被当成未变，真实的 IPv6 变化丢失。已修：观察记 `ipv6_unreadable`，IPv6 默认路由行的 `GetIfEntry2` 失败也算读不全，外部批次遇到它照旧发布；DNS 自写窗口内语义不变。

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
