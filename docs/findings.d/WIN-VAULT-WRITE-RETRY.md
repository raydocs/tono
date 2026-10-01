| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-VAULT-WRITE-RETRY | Windows vault writer discards a failed token write, so sign-in durability retries never persist it and relaunch loses the session | in-PR | [#843](https://github.com/raydocs/tono/pull/843) | 中·已确认 | P1; native Credential Manager behavior awaits Windows CI/device verification |

A transient vault failure affects the actual ordered writer, not only its acknowledgement. Flush now retries each key’s latest failed mutation once through that same writer. Successful newer writes/deletes supersede older pending values. Durable marker admission remains required.
