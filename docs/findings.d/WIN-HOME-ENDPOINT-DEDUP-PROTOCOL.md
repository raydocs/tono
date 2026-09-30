| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HOME-ENDPOINT-DEDUP-PROTOCOL | Windows 住宅端点去重忽略协议，住宅 TCP 与 HY2 出口共用 IP、端口时漏掉 TCP 的 WFP 许可，住宅助手连接被阻断 | in-PR | 待开 | 中·推导 | 已按 IP、端口、协议去重并统一连接阶段与切换端点构造；单元测试未运行，真实 WFP 许可需实机；needs-hardware |

回归：`home_proxy_permits_keep_same_address_with_different_protocols`。仅源码，未合 main，无新候选。
