| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TCP-PROOF-SERIAL | Windows 未保护时的隧道前 TCP 证明（最多 2.5 秒）在 run_stages 之前串行执行，没有与只读准备并行 | fixed(f26c57bd) | [#1418](https://github.com/raydocs/tono/pull/1418) | 低·推导 | 只重叠已学 pins 读取、bootstrap 查询和 sing-box 镜像哈希三项只读准备，且都在 PrepareCoreStart 之前完成；收益只是可重叠部分（约 40–190 ms 推导），不保证一个 RTT；证明很快失败时失败上报要等 bootstrap 查询（未保护预算 2 秒）和镜像哈希结束；回归 `reads_before_prepare_share_the_readiness_wait` 未在本机运行 |

记录于 #1386。R4-WIN-PROTECTED-TCP-PREFLIGHT（fixed 6ab2d67c）是保护中误做 TCP 预检，不是这项串行。

2026-10-06：#1418 修复，见 [changelog](../changelog.d/2026-10-06-windows-connect-speed.md)。守 Codex 核验给的边界（只与无保护副作用的预取重叠，Prepare 之前完成）；物理上行探测、端口分配和 loopback:53 证明仍在 Prepare 之后。
