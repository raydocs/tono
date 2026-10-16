## 2026-10-13 · 在役出口节点轮换令牌后，旧令牌得到 403 撤除而不是 401
- 归属：ops 计划（control plane / exit-agent）；`services/control-plane`、`services/exit-agent`。
- 来源：Issue #1296，发现 `R5BE-EXIT-TOKEN-ROTATE-401`；决定 [123](../decisions/123-2026-10-13-superseded-exit-token-is-withdrawn.md)（provisional）；分支 `claude/exit-token`；尚未合 main。
- 缺陷修复：在役节点轮换令牌后，仍持旧令牌的 agent 得到 401，被当作「控制面不可达」，保留旧名册继续服务，已撤销的设备在新令牌部署前仍可使用该出口。改后：轮换时把被替换的哈希存入 `revoked_token_hash`（停用时已在用的列，无迁移），旧令牌得到 `403 EXIT_NODE_DISABLED`（消息「Exit node token was superseded by a rotation」），agent 撤除全部客户端直到部署新令牌；该哈希不认证任何请求。exit-agent 在撤除后（含撤除失败和 hy2-only 路径）的拒绝信息里附上控制面原话，运维能分清「被停用」与「令牌被替换」。
- 新增/优化：无。
- 工程与测试：Worker 测试 `tells an active node whose token was rotated to withdraw until the new token arrives`（并把两处旧的 401 断言改为 403）；exit-agent 测试 `test_a_superseded_token_withdraws_every_client_and_says_why`、`test_hy2_only_mode_and_a_failed_withdrawal_still_say_the_token_was_superseded`（Codex 复核后补）。
- 验证：见 PR 的 Verification 一节；独立 Codex 审查（凭据/认证改动）见 PR 评论。
- 候选/发布：仅源码，无新候选；需部署 Worker，exit-agent 需随下次 agent 发布。
- 剩余限制：每个节点只保存一个被替换的哈希（沿用 `revoked_token_hash`）；被覆盖的更早令牌仍得到 401（与改动前相同，不更差）：A→B→C 连续轮换、A→B 后停用/退役、停用后轮换再启用再轮换。轮换后到新令牌部署前，该节点客户会断开（决定 123 的代价）。
