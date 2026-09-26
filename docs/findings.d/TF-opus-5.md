| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| TF-opus-5 | 停用出口节点后再轮换其令牌，旧令牌哈希丢失，agent 得到 401、保留旧名册而不撤除 | fixed(779b4876) | [#600](https://github.com/raydocs/tono/issues/600)，[#638](https://github.com/raydocs/tono/pull/638) | 中·已确认 | 停用（active→disabled）时在同一 UPDATE 存下令牌哈希到 `revoked_token_hash`，轮换不动它；只在停用状态下换来 403，不认证任何请求；本改动部署前已停用的节点没有存档哈希；需部署 Worker |
