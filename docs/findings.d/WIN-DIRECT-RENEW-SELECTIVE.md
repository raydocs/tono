| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RENEW-SELECTIVE | DIRECT 续租失败把整机打成 Blocked，普通网络被切断；非严格模式应选择性放行并继续拦截助手 | in-PR | #926 Fixes #907 | 高·已确认 | 进行中的重载括号（Pending/Bracket）仍收成 Blocked。严格 Kill Switch 仍保持 Blocked。needs-hardware |

续租校验失败不再调用 `transition_direct_to_blocked`。应用侧改走 `tono_release_kill_switch_applying_narrow`。已提交租约在看门狗里过期时，非严格模式 `disarm_unlocked(true)`。提交失败日志改为 Blocked，不再写“回到全隧道”。回归：`a_direct_renewal_failure_releases_unless_the_kill_switch_is_strict`、`mismatched_renewal_does_not_block_the_network`、`a_lost_committed_direct_lease_releases_unless_the_kill_switch_is_strict`。
