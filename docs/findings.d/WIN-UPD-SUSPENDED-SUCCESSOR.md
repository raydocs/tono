| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-SUSPENDED-SUCCESSOR | 更新执行器在 Resume 之前被 abort 或外部结束时，恢复把从未运行的挂起进程当成成功，服务保持停止 | fixed(b17ddc32) | [#847](https://github.com/raydocs/tono/issues/847)，[#858](https://github.com/raydocs/tono/pull/858) | 中·推导 | 已由 #858 合入：恢复前唤醒身份匹配的后继；非严格下 Service 起不来走既有应急释放，严格仍阻断。#887 是重复实现，自动合并已关。未实机 |
