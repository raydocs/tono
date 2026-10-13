| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-EXECUTOR-EARLY-EXIT | 更新执行器在消费之后，`open_service` / 抑制 SCM 恢复 / 停 Service 任一失败经 `?` 直接退出，跳过 Uncertain 标记、网络放开和 SCM 恢复动作的还原 | in-PR | [#1293](https://github.com/raydocs/tono/issues/1293) 第 5 项 / PR 待填 | 中·推导（P3，读码，未复现） | 抑制/停止失败改为结果错误走原有结果路径；打开失败走 `settle_unopenable_service`（网络未落定不计恢复次数，由 Service 启动/看门狗重试）；待实机注入 SCM 故障验证 |
