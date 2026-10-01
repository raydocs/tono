| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5BE-EXIT-TOKEN-ROTATE-401 | Rotating an active exit node's token answers the old token with 401, so the agent fails the round before reconcile and the clients already installed in Xray (revoked ones included) keep serving until the new token is deployed | open | [#1296](https://github.com/raydocs/tono/issues/1296) | 低·推导 (P3) | Owner decision: 403 withdraws every client until redeploy; 401 leaves last-installed clients serving. Needs an operator rotation; disable-then-rotate is covered by TF-opus-5 (#638) |
