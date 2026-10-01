| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPGRADE-FIFO-OPEN | 静默升级在 bundle 签名校验之后对用户路径做阻塞 open；无写端 FIFO 会占住更新锁和唯一的 accept 线程 | in-PR | [#928](https://github.com/raydocs/tono/issues/928) [#979](https://github.com/raydocs/tono/pull/979) | 中·推导 | 复制改从非阻塞 fd 完成，且复制期间不持更新锁；`--version` 探测仍可能卡住；未实机 |
