| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TCP-PROOF-SERIAL | Windows 未保护时的隧道前 TCP 证明（最多 2.5 秒）在 run_stages 之前串行执行，没有与只读准备并行 | open | 待开 | 低·推导 | 修法须只与无保护副作用的预取重叠，并在 PrepareCoreStart 之前完成（Prepare 可能停弱证明 Core 并改 WFP）；收益只是可重叠部分，不保证一个 RTT |

记录于 #1386。R4-WIN-PROTECTED-TCP-PREFLIGHT（fixed 6ab2d67c）是保护中误做 TCP 预检，不是这项串行。
