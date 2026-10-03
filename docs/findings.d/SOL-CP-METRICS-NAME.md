| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-METRICS-NAME | 合法节点名 constructor 与对象原型冲突，指标查询返回 500 | fixed(e69db58d) | hunt/sol-cp-metrics-node-names | P2·已复现 | 不改变节点命名及指标查询合同 |

Metrics series now use a dictionary without inherited properties. One regression records `constructor`, `toString` and `__proto__`, queries their points and checks JSON serialization. Before the fix, the query throws `series[name].push is not a function`.
