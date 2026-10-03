| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1259 | Windows 启动对账失败后的回退，退休 owner 或证明 DNS 失败时只记日志，不再重试放行，非严格模式机器一直被全断 | fixed(7a1a3a5a) | [#1259](https://github.com/raydocs/tono/issues/1259) | 中·推导 | DNS 只做一次尽力恢复，失败时快照留作证据，不再自动重试；WFP 删除失败交给看门狗每拍重试。严格模式仍保持拦截。需实机验证 |

Codex 独立审查（gpt-6.1-sol high）发现，代码阅读确认。非严格模式下 `retire_unverified_on_service_start` 失败时改为放行普通流量并保留 AI 拦截，错误仍返回给调用方，使其跳过 desired Core 恢复。
