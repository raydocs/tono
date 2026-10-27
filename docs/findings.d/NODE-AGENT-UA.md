| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| NODE-AGENT-UA | node-agent 心跳仍带 urllib 默认 `Python-urllib` User-Agent，zone 浏览器完整性检查会回 CF 403/1010（与 CBS-HA-01 同因），节点不登记 | in-PR | perf/control-plane-agent-reliability | 低·推导 | 未对生产 zone 设置核对；已部署节点需重新安装 `tono_node_agent.py` 才生效 |
