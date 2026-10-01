| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-CLEARS-ERROR | 健康检查成功且没有 advisory 时清掉任意 errorMessage，目录被拒的提示跟着消失 | in-PR | #863 | 低·推导 | 只清恢复文案和本监控仍在显示的分类失败 |

健康拍的流量探测换成 `raceHealthTrafficProbes`，测试可以不打真实 TLS。
