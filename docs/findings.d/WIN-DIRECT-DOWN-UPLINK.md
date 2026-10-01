| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-DOWN-UPLINK | 连接前捕获的 DIRECT 物理网卡忽略“是否已启动”，会绑到仍留着默认路由的断开网卡 | in-PR | #879 | 中·推导 | 需默认路由表里仍有 OperStatus 非 Up 的硬件行，且它排在活着的 Wi-Fi 前面。needs-hardware |

`usable_physical_uplinks` 只收 `is_up == true`。`detect_physical_interface_windows` 把 `hardware_uplink_alias` 的启动位丢掉，返回第一个硬件别名。`stages.rs` 只把发现失败当成跳过 DIRECT。回归：`direct_bind_skips_a_down_hardware_alias`。
