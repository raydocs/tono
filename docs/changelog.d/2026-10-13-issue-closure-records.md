## 2026-10-13 · 无剩余代码工作的 issue 按记录关闭
- 归属：记录整理（所有者 2026-10-13 同意「按记录关闭」）。不属于 SHIP_PLAN 门。
- 新增发现分片：`issue-4`（accepted-design：有损切换被 409 与迁移 0037 拦住，切换协议未排期）、`issue-5`（open：Tailscale 无计数器代际）、`REGLATE-MAC-MANIFEST`（accepted-design：两条发布线均含 #1159）、`issue-1255`（refuted：符合更新合约）、`issue-317`（open：生产开关是发布步骤）。
- RELEASE_LINES「Customer publish (G4)」加上 #317 的开关步骤：客户源上的客户端都能校验内嵌 revision 之后，打开 `TRAFFIC_POLICY_EMBED_REVISION` 并发一版策略核对。
- 关闭的 issue：#4、#5、#188（集成已合，#197/#186）、#317、#331（决策 086 接受剩余风险，H1-F5 记录）、#1240、#1255。
- 验证：`node tooling/scripts/records.mjs findings --id <ID>` 能读出每个新分片；origin/main 上核对了 `usage-metering.ts:60`、迁移 0037、`traffic-policy.ts:52`，以及 #1159 是 `release/macos`、`release/windows` 的祖先。无产品代码改动。
