| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-FAILED-ARM-AI-HOLD | A failed Windows WFP install removes the secondary AI hold left by prior recovery before proving a replacement barrier | fixed(eddd99ce) | [#976](https://github.com/raydocs/tono/pull/976) | 低·已确认（P2，Linux 回归） | Requires a pre-existing recovery hold and a subsequent failed install; real WFP/NRPT behavior remains untested. |

The existing hold is now removed only after WFP installation succeeds. Failed or ambiguous installs preserve it; successful installs still clear the sinkhole for tunnel DNS.
