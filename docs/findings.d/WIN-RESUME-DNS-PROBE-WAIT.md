| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESUME-DNS-PROBE-WAIT | Windows 重启后接管已证明的同属主 Core 时，loopback:53 预检对该 Core 占着的端口重试 30 次（约 2.9 秒），而准入只看 resume 状态 | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·推导 | 只修预检；首档 2 秒另由 #1395 修复（WIN-RESUME-FIRST-RUNG），双采样竞态（WIN-RESUME-RECEIPT-RACE）仍 open；净收益是它超出 join 中其它分支的部分，未实测；回归未在本机运行 |

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
