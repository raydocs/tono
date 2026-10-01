## 2026-09-30 · 签名策略保留既有助手域名保护

- 归属：G1（已连接=能用）；macOS 配置管线、Windows tono-core 策略准入与控制面 traffic-policy。
- 来源：main `378c165d` → 分支 `codex2/ai-direct-suffix-guard`；PR #797；未合 main。
- 缺陷修复：永久直连保护名单停留在 Claude 及其依赖，未覆盖产品已经送往住宅出口的其他助手域名；签名策略可能让这些服务的 DNS/流量走物理出口。macOS 与 Windows 在显式保护名单之外追加各自既有住宅路由名单，控制面以独立 `assistantHomeSuffixes` 补齐；显式名单是 `test-policy-signing-contract.sh` 校验的跨平台契约，保持原样；保留 Tono 自身域名及全部旧保护项。关联 [AI-DIRECT-SUFFIX-GUARD-GAPS](../findings.d/AI-DIRECT-SUFFIX-GUARD-GAPS.md)。
- 新增/优化：无。沿用既有后缀相等、父级和子级重叠拒绝；名单包含原有 Meta、社交与 Gmail/认证住宅路由，不增加提供商。
- 工程与测试：扩展 macOS `testSignatureDoesNotRelaxProtectedAssistantHosts` 一条 XCTest；Windows 新增 `trusted_policy_cannot_direct_other_assistant_suffixes` 一条回归；控制面在既有 `worker.test.ts` 新增一条签名策略回归，检查助手后缀重叠被拒绝、无关签名后缀仍准入。
- 验证：本机 Linux、Node `v20.19.2`；只读 Python 集合核对通过：两端既有名单一致（80 项），控制面保护集合精确匹配（加 Tono 共 82 项），全部 39 项旧保护保留。本地既有 Oxc 转译实际源码的离线检查退出码 0：HEAD 验证器的缺口经真实 Ed25519 签名复核，改后拒绝 163 项相等/子级/父级重叠，无关签名后缀仍准入；两份编辑的 TS 文件转译通过，`git diff --check` 通过。控制面 vitest 全量通过；`test-policy-signing-contract.sh` 5/5；Linux 上 `cargo test -p tono-core --lib policy::` 19/19 通过。本机无 Swift/Xcode，未编译或执行 macOS 回归，已逐行复核 diff，留待 hosted CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware；真实 DNS/出口路径未验收，未查看线上策略。已存策略如含新增保护项，会被现有读取校验拒绝，需清理后重发。失败/停止时的标准释放路径与严格杀开关未改；fail-open 后的 AI 阻断仍由独立 PR #738 交付，本次不新增阻断层。
