| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-PENDING-BLOCKS-OTHER-USER | 用户 A 的更新 Prepare 没走到 Install 就留下挂起记录；`State::pending()` 不看 `expires_at`，用户 B 的释放、Connect 和更新 Disconnect 永远被拒，重启也不解 | in-PR | [#1293](https://github.com/raydocs/tono/issues/1293) 第 3 项 / [#1620](https://github.com/raydocs/tono/pull/1620) | 中·推导（P3，读码，未复现） | 超过 48 小时回执有效期且未消费、无存活执行器的记录归档并停止挡人（决定 119，provisional）；有效期内仍挡其他用户；已消费记录不变；待实机 |
