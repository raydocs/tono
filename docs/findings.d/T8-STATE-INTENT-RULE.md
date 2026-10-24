| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T8-STATE-INTENT-RULE | 四端没有统一的状态意图契约：用户断开可被更晚的隧道失败盖掉，套餐或额度暂停被当成失败，回滚失败不更新与成功相同的基线 | in-PR | [#1746](https://github.com/raydocs/tono/pull/1746) | 中·源码推导 | 本变更只加决策 134、共享夹具和四端契约测试。已有探针对不上的行是 expected-failure，没有探针的行是 todo。IOS-1672-STATE-AUTHORITY 保持 open。不改 T1–T5 的产品实现。封存的 Libbox 收据未改。 |

账户码引用 PR 1738（head `429e23427`，契约首提交 `3205b5c76`）的 `docs/control-plane-error-contract.md`，本分支不复制该文件。决策号是 134；133 是该 PR 的套餐暂停决策，本线程没有占用。T2、T3 仍需编排者转交该契约。T4 负责 macOS 的 429 和新码文案，T5 负责 Windows。
