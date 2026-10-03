| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-X-FORGET | pfctl -X 非 0 退出后仍忘记 enable token | fixed(810fbfd4) | [#895](https://github.com/raydocs/tono/issues/895) [#979](https://github.com/raydocs/tono/pull/979) | 低·推导 | 非 0 且随后的完整列表仍含该 token 时保留记录；列表里已经没有则忘记；未实机 |
