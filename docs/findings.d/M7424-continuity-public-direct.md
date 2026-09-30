| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M7424-continuity-public-direct | Continuity Apple 进程全目的 DIRECT 在 directPlan=nil/无匹配 PF 公网许可时绕开健康 TUN 后被 PF 丢弃 | fixed (bf163df0) | [#688](https://github.com/raydocs/tono/pull/688) | 中·已确认 | 7424 审计 F5。续修删除 process-wide DIRECT，保留本地/链路本地/组播和 mDNS 直连；公网按原有 managed policy/TUN 路由，未扩大 PF 许可。生产runtime JSON回归改前实际失败；准确4caf8258 CI36684847625四jobs通过，routing源码独立Codex high无发现；未证明客户某次 Clipboard 失败由此引起，未做实机剪贴板验收 |
