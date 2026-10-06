| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CORE-SYNC-DOUBLE-SNAPSHOT | Helper sync 在停旧 Core 后再次复制用户配置，第二次拒绝可使有效旧连接已被终止 | fixed(92e004f6) | [#1376](https://github.com/raydocs/tono/pull/1376) | 中·推导 | sync 仅在停旧之前复制、验证所有权/hash/owned-runtime/原生 parser；之后从那份 root-owned 快照启动，仍复核 Core 映像和睡眠门，不回退旧策略。真实 Core 生命周期自测补 `sync-runs-approved-snapshot`，并保留失败预校验不影响旧进程的检查；Helper 4.52.41。MacBook 未编译/运行，自测和设备替换待 hosted CI/实机。 |
