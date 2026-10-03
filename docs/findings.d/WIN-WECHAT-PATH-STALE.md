| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WECHAT-PATH-STALE | 新连接清掉可选 DIRECT 标志，却留下上一场的签名路径正则；全隧道会话在路径变化后每两分钟受保护重连 | fixed(c2626f53) | #900 | 中·已确认 | 重连仍走既有受保护路径，不放行流量。needs-hardware |

`state.rs` 写明 `applied_wechat_path_regexes == None` 表示覆盖层未激活。`attempt_inner` 重置 `optional_direct_active` 时没有清这个字段。`signed_wechat_paths_require_reconnect` 看到 `Some` 且路径不同就重连；#757 之后不允许原地恢复。覆盖层没再提交时，新会话仍拿着旧 `Some`，差异一直在。回归：`a_new_attempt_drops_signed_app_paths_so_a_full_tunnel_does_not_reconnect`。
