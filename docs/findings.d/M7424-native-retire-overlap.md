| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M7424-native-retire-overlap | 旧 native Disconnect 在 suspension 等待期间被完成的 retire 超越，恢复后仍可把已释放显示改成保护未确认 | open | [#686](https://github.com/raydocs/tono/pull/686) 独立复核附注 | 低·推导 | 283330d4 独立 review 无 major，保留此 minor。generation 在 suspension 后采样，旧请求可误认新代际；不会据此宣称保护在线，不释放/退休证据。按 owner 一轮 minor 修正 stop rule 保留，需后续对 native suspend/retire 所有权统一 fencing；未实机/并发回归 |
