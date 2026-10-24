| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-STRICT-EMERGENCY-BREAK-GLASS | 锁忙或记录无法保存时 root 应急恢复仍被 strict 意图拒绝，初始化还可能重装阻断 | in-PR | fix/t4-macos | 高·已确认（P1，授权策略回归） | 待托管 root 故障测试和真机 PF；manual break-glass 不保证其他进程不会随后 re-arm |

证据：`tooling/scripts/core-helper/ReleaseWorker.swift:1188-1220`、
`KillSwitchManager.swift:217-236,1257-1273`、`main.swift:1454-1484,1497-1506,1669-1671`。
默认 runtime（包括自动移除和 GUI 请求）不绕 strict。仅两条 root CLI 显式选择 emergency authority。
详细边界及 RED 见 [T4 记录](../reports/T4_MACOS_2026-10-24.md)。
