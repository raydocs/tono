| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SCM-RETIREMENT-FAILURE-RELEASE | SCM Stop 已停止 Core，但 owner 记账写失败跳过非严格 WFP 释放 | fixed(e925181a) | hunt/sol-r4dns-scm-retire-release | 中·已确认 | P1；Linux 回归先失败后通过，原生 SCM / DNS / WFP 待 Windows 实机验收 |

`server/mod.rs::stop_ipc_server_inner` 已保留 DNS 恢复证明、Core 停止证明及更新/修复门。Owner 运行意图的退休写失败只作诊断，随后执行原有 `release_after_service_stop`：保留严格模式二次检查及自动 AI 层；成功释放的 wanted:false tombstone 阻止下一次 Service 将残留意图当作可运行状态。未放宽 DNS 证明或 Core 停止条件。
