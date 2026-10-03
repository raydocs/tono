| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-CLI-EXCEPTION-INVENTORY | Xray CLI 超时或文件系统异常越过部分库存保存，后续吊销漏掉已安装客户端 | fixed(1933f85f) | [#1009](https://github.com/raydocs/tono/pull/1009) | 中·已确认（P1，回归） | #838 的普通 Refusal 修复正确，但未覆盖实际 subprocess/文件系统异常；未知库存仍未知，不 ACK、不推进用量；未部署或真实节点验证 |

On baseline `08aac566`, a successful add followed by `subprocess.TimeoutExpired` leaves only the old `installedClients`. Supported Xray builds without a listing command then miss those labels when the next authenticated roster revokes them. The regression also models an add applied before its CLI times out: that uncertain roster-issued label must remain a removal candidate.

Mutation invocation exceptions now aggregate as failures, retain conservative managed candidates, and permit later revocations. Counter invocation exceptions carry the reconciled inventory through the existing refusal persistence path. Shared-legacy removal failures retain their candidate. Unknown initial inventory stays unknown; no failed round acknowledges convergence or changes usage. Exception messages omit command arguments and credentials.
