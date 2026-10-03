| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-REPO-ROOT | provision-tono-node 把 tooling/ 当成仓库根，仓库里其他目录的私钥路径能通过「必须在仓库外」检查 | fixed(e2900c35) | [#842](https://github.com/raydocs/tono/pull/842) | 低·推导 | 改为脚本上两级的 git 根；目录模式仍要求 owner-only。未在真实 VPS 上跑 provision |
