| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CBS-HA-01 | Home agent sends the default `Python-urllib` User-Agent, which the zone's browser-integrity check answers with CF 403/1010 | in-PR | [#1233](https://github.com/raydocs/tono/issues/1233) | 低·推导（P3，潜在） | The home agent is not deployed; the zone setting was not checked against production |

`fetch_inventory`, `post_reports` and `acknowledge_metering` (`services/home-agent/report_example.py`) built requests without a User-Agent. The exit agent already sends an explicit one for this reason. All three now send `tono-home-agent/1.0` in the same shape as the exit agent's.
