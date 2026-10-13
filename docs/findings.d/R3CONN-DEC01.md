| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3CONN-DEC01 | 补充 DNS 冲突会有意停止 Core 并结束会话，不保留进行中的连接 | accepted-design | [#1057](https://github.com/raydocs/tono/issues/1057)，决定 122（provisional） | 低·设计（P2 design） | 保留现有拆会话行为（较严一侧）；是否改为「保持连接并提示」仍是所有者可推翻的产品决定。结束态为决定 031 的选择性释放（普通流量放开，AI 服务继续挡）。 |
