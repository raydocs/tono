| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-INSTALLER-REBOOT-READINESS | Windows 服务修复已排队到重启替换，但重新启动的旧二进制低于新协议 revision floor 时，严格 readiness 报安装失败而非返回 3010 | in-PR | #776 | 低·推导（读码，未实机复现） | 修复：仅 RebootRequired 验证 predecessor IPC 存活，即时发布保留严格 readiness；此分支无现有窄测试 seam，按任务例外未新增测试；Windows CI 与跨 revision 实机待验 |

来源：main `64af499a` → 分支 `codex2/win-installer-hangs`；PR #776；未合 main。复用 `wait_for_previous_service_liveness`，仍拒绝启动后不能回答 IPC 的旧服务，不改 App/NSIS 的 3010 处理。
