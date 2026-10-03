| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4UPD-WIN-CAPTURE-FAILURE-RELEASE | Native Windows update token capture refusal exits before selective failure cleanup and strands bootstrap Blocked | fixed(42fffd3d) | [#1082](https://github.com/raydocs/tono/issues/1082); branch `hunt/sol-r4fwa-capture-refusal` | 低·已确认（P2，Linux 回归） | Real Store capture boundary regression failed before/passed after. Native token/SCM/WFP and executor completion behavior require Windows CI/hardware; no installation authority is granted on refusal. |
