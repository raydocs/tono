| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-GRANT-FLUSH-QUEUE | 目录同步的 flush 在保险库长时间停滞时超时但仍留在写队列，累积填满 64 槽后令牌轮换被拒 | in-PR | [#1056](https://github.com/raydocs/tono/issues/1056) · 本 PR | 低·推导（P2，长时间保险库停滞） | 修复为两次写入之间的 flush 共用一个屏障；64 个槽仍由写入和屏障共享，停滞期间交错的 flush / 写入 / flush 仍各占槽，上限不变；待实机 |
