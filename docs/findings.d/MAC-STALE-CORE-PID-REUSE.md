| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-STALE-CORE-PID-REUSE | 清理僵尸 core 时 SIGKILL 前不再核对 proc_pidpath 和 uid | fixed(810fbfd4) | [#897](https://github.com/raydocs/tono/issues/897) [#979](https://github.com/raydocs/tono/pull/979) | 低·推导 | 每次发信号前重新核对路径和 uid；进程已消失则停止；未实机 |
