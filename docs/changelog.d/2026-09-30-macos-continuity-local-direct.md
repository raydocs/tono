## 2026-09-30 · Continuity 的 DIRECT 不再无条件覆盖公网
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1，macOS 7424 审计 F5 / M7424-continuity-public-direct。
- 来源：#687 head `0d0842a4` 上堆叠分支 `fix/macos-continuity-local-direct-20260930`；未合 main，必须先合 #687。
- 缺陷修复：删除 sharingd/rapportd/Sidecar/identityservicesd 的全目的 process-path DIRECT 例外，避免没有 PF 授权时把 Apple 公网 TCP 送出健康 TUN 后丢包。本地、链路本地、ULA、组播和 mDNS 原有路由不变；公网服从同一 managed policy 和出口，不扩大 root/PF 许可。
- 新增/优化：无；只消除 Core 路由与 PF 放行不一致，不关闭保护或追加未经授权的公网通路。
- 工程与测试：一个生产 buildSingBoxRuntime directPlan=nil 回归，同时验证本地 CIDR 保留及早于公网 IPv6 reject，红候选 `6e888499`；原安全回归移除过时进程例外断言，改为不得仅凭进程身份授权 DIRECT。
- 验证：MacBook `git diff --check` exit 0；hosted red/green 与独立 Codex high diff 审查待完成。没有 native 本地运行/编译、PF/TUN 操作。
- 候选/发布：仅源码，无新包/客户发布；7424 不含本修复。
- 剩余限制：配置问题已确认，但 Clipboard 实机恢复未验证；不证明本次 kernel panic 根因。
