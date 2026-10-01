| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SELECTIVE-RELEASE-RETRY | Automatic selective release retries operational failures as plain release, dropping the requested AI hold | in-PR | [#983](https://github.com/raydocs/tono/pull/983) | 高·已确认 | P2: recovery trigger plus transient release failure; Linux helper regression only, native Windows/device evidence outstanding; existing best-effort AI-layer limits remain |

The App retry discarded the selective release flavor. Retain it for operational and transport failures; use the legacy null payload only after the Service explicitly refuses JSON deserialization. Both current flavors perform the same DNS/Core/WFP release steps, and the secondary hold cannot fail the Service release. Strict-mode decisions and explicit Restore/Disconnect remain unchanged. Ownership: SHIP_PLAN §2 item 10.
