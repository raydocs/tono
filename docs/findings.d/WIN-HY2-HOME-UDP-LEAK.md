| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HY2-HOME-UDP-LEAK | Windows 住宅规则只约束 TCP，HY2 出口没有对应助手 UDP 拒绝规则，助手 UDP 会绕过住宅线路暴露云出口身份 | in-PR | 待开 | 高·推导 | 已为住宅域名、CIDR、进程名和路径补 UDP REJECT；单元测试未运行，QUIC 回退需实机；sing-box 同类缺口保留，Windows 产品路径尚未调用；needs-hardware |

回归：`hysteria2_home_route_rejects_assistant_udp_before_match`。App 的 DIRECT 图校验与既有 fixture 同步识别新增住宅拒绝块；既有 HY2+DIRECT 校验仍要求全量 UDP REJECT，留待后续。仅源码，未合 main，无新候选。
