| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-OWNER-RELEASE-NONE | Windows owner-only Disconnect can release filters while the supervised Core survives a missing or corrupt active-owner record | fixed(a864a9ca) | [#873](https://github.com/raydocs/tono/pull/873) | 中·已确认 | P1; helper persistence regression runs on Linux; live Windows route/WFP behavior needs hardware |

Absent ownership is not proof of process termination. After the existing policy-owner and lifecycle admission, stop the independently supervised Core and retire any runnable desired state before releasing filters. Already idle desired state adds no disk write. Readable different-owner records remain refused.
