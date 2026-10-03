| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CATALOG-VANISHED-EXIT-BLOCKS | Windows 非严格会话的所选出口被目录同步移除后只停 Core，健康 Blocked WFP 持续全阻断，用户选另一个节点前没有互联网 | fixed(6eb225df) | #791 | 高·推导 | needs-hardware；Windows-only Rust 未编译、未运行，hosted Windows CI 待跑；释放拒绝沿用既有路径；释放后的窄 AI 阻断由独立 #738 提供，未在本基线 |

来源：main `378c165d` → 分支 `codex2/win-catalog-exit-removed-release`；PR #791；未合 main。读码复核 `catalog_sync.rs` → `selected_node_vanished` → `tono_stop_core(false)` → Service 的 `transition_after_stop(false)`；后者收窄到 Blocked，而看门狗将安装正确的 Blocked 视为健康，不会因 Core 已停止而放行。

修复按所有者 2026-09-30 决定：非严格会话使用 Disconnect/普通失败共用的 `release_explicit_with_guard` 协调释放（DNS → Core → WFP），严格杀开关保持停 Core、等待选择并阻断。分离工作任务直接持有可转交的独占 guard，保留原有代际检查；`invalidate_connection(releases)` 记录相应释放意图。`catalog_requires_choice` 与不自动重连保留，不新建 AI 层，不削弱正常连接时的 AI 服务阻断。

回归：`switch.rs` 的 `vanished_exit_releases_only_without_strict_kill_switch`。本环境不能构建 Windows-only Rust，未编译、未运行回归，也未运行 Xcode/Swift；hosted Windows CI 待跑。已逐行复核类型、锁与异步边界，`git diff --check` 通过；记录读取工具能识别本条目。当前 Windows App 没有严格偏好，沿用 `strict_kill_switch_explicit(None)`；实机须验证非严格普通互联网恢复和严格继续阻断。释放被拒仍按既有协调路径处理；独立 [#738](https://github.com/raydocs/tono/pull/738) 的窄 AI 阻断尚未合入本基线。
