| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-UNPROTECTED-AI-HOLD | A failed native update newly installed the AI hold for a user who was Unprotected or had just chosen Restore internet | in-PR | [#1293](https://github.com/raydocs/tono/issues/1293) 第 4 项；[#1642](https://github.com/raydocs/tono/pull/1642)；[决策 125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md) | 低·推导（P3，源码路径） | 更新失败路径（Service 的 Prepare 失败、执行器启动失败、待定更新 Disconnect、更新执行器的紧急放行）只在保护曾武装或更早的自动放行留下拦截时才保留；其余 `*_applying_narrow` 调用方（健康失败、连接失败、sing-box DIRECT）不变；#1293 其余五项未动 |

无任何武装且上次放行是明确「恢复网络」（或从未保护）时不再新装。
