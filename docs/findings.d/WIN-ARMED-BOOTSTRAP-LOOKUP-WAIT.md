| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-ARMED-BOOTSTRAP-LOOKUP-WAIT | Windows 保护中重入时 bootstrap 查询走尚未就绪的受保护解析器，在 PreparingService 耗满 2 秒预算 | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·推导 | 保护中 300 ms 后才返回的真实地址被丢弃（编译内置与已学 pins 仍在）；是否常耗满 2 秒、是否为 join 最慢分支需实机观察；回归未在本机运行 |

Codex 核验 PARTIAL：hosts 或缓存可返回真地址，「永远不能贡献」不成立，所以取短预算而不是保护中跳过查询。

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
