| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-LEGACY-ROOT-BOOKMARK | 收敛草稿的根地址书签跳转未携带迁移标记，旧 users hash 被现代 parser 当成今天页并丢客户对象 | fixed(933436cb) | [#1377](https://github.com/raydocs/tono/pull/1377) | 低·已复现 | 审查复现后将根入口并入共享重定向函数；本地真实 302＋浏览器确认 customer id 的加号/百分号保留。修正已合 main/部署，最终双厂商high finder审查通过；生产登录书签验收未做。 |
