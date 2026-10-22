## 2026-10-22 · Windows 系统 DNS 未验证告警
- 归属：SHIP_PLAN §2 item 10；WIN-DNS-RACE-MASKS-SYSTEM；decision 060 / 已合 #1397 的 DNS 切片，不包含缺上行恢复。
- 来源：基线 origin/main `a742adf21`；分支 `t3/system-dns-warning`，独立 draft PR，尚未合 main。
- 缺陷修复：健康 Tono NRPT 下系统查询 Err/超时不再静默；经现有 `resolver_policy_warning` 传递独立 `TONO_DNS_SYSTEM_UNVERIFIED`，不冒充 POLICY_CONFLICT，不写 `last_error`。
- 新增/优化：首页复用现有 DNS 告警卡，简短中英提示和检查 DNS / 诊断入口；旧/新外观使用同一告警。保留 verify_fake_ip 的 TUN-only 准入、Connected/Core/WFP；不改自动释放、重连、企业 NRPT、FSM、helper/安装器。
- 工程与测试：一个 native tokio 回归复用真实 Fixture/test_io，健康 Tono NRPT + 两次显式 query Err observer，无 sleep；同一回归覆盖 fresh success、disconnect/re-enable、同 PID 换 Core 代次时旧 observer 完成。Service 复用已有 Core 实例 identity / lifecycle snapshot_generation，App 复用 connect_generation；Service IPC 不新增字段，仅 App→前端增加可选 resolverPolicyWarning 展示投影。
- 验证：Mac 运行 `pnpm exec vitest run src/pages/tono/dashboard.test.tsx src/pages/tono/support.test.tsx`：`Test Files 2 passed (2); Tests 44 passed (44)`；`pnpm typecheck`：`unchecked indexed access errors 69 (baseline 79)`。单条首页行为回归验证 advisory 可见、Connected/保护指示保持、无断开/重试调用、advisory 清除。旧首页真实 RED 为缺失告警文本（前期缺少浏览器 fixture 的错误不算 RED）。
- 原生证据：测试先行 `8eea216d9`，hosted Windows RED [39871991551](https://github.com/raydocs/tono/actions/runs/39871991551)；结果和后续 GREEN 的精确 SHA / 原始日志在 PR 验证评论。未在 Mac 跑 native cargo/Swift/Xcode；不把编译失败、跳过或零测试当 RED/GREEN。
- 候选/发布：仅源码，无新候选、合并、部署、auto-merge 或 PR 监控。
- 剩余限制：生命周期高风险部分待父线程独立审查，不自批准；Win10/11 浏览器实际系统解析与安装后 UI/辅助功能仍待实机。30 秒现有 observer 周期不变，不提供自动 DNS 修复或企业策略改写。
