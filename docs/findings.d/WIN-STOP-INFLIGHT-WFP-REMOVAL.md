| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STOP-INFLIGHT-WFP-REMOVAL | SCM Stop 的 60 s 窗口结束后丢弃运行时，另一任务里仍在 WFP 移除的释放被中止，非严格机器保持阻断直到下次 Service 启动 | in-PR | [#1284](https://github.com/raydocs/tono/issues/1284) | 低·推导（P2，需 DNS+WFP 同时近超时） | 修复为 Stop 后有界等待在途移除（决定 117）；待实机；DNS 阶段仍未结束时的释放不在此修复内 |
