| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMA-RESOLVER-OWNERSHIP | macOS selective cleanup deletes foreign AI resolver files and recovery overwrites originals | in-PR | [#1062](https://github.com/raydocs/tono/issues/1062) | 中·已确认 | P2 custom resolver prerequisite. Persist original bytes/uid/gid/mode or absence before installation; cleanup requires a trusted receipt. Native CI/hardware pending; legacy files without receipts remain foreign and cannot recover already-lost originals. |

Baseline `9947450e`: `SelectiveFailOpen.swift:214` removed every allowlisted regular resolver; apply replaced the same paths without backup. New receipts are root-owned/no-follow, fsynced and bounded. Resolver payloads may be product/user-owned; only fixed allowlisted paths in a trusted directory opt into foreign-file I/O. Other privileged I/O retains its root-only defaults. Native failures and >1 MiB files remain best-effort, and never keep general PF active.
