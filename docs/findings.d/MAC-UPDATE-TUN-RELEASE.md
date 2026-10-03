| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-TUN-RELEASE | 原生更新尚未 suspend 监控时隧道丢失会走 Restore internet，放开 PF 并挡住之后的保护重连，助手流量变直连 | fixed(8ff1103e) | #891 | 中·推导 | 需要「更新已标记 pending」和「连续两次看不到 utun」同时成立。未在真机上复现。needs-hardware |
