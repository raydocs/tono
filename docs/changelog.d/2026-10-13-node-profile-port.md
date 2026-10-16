## 2026-10-13 · 节点档案的 port 真正保存（迁移 0101）
- 归属：ops 计划（control plane）；`services/control-plane`。
- 来源：Issue #1058 的 `SOL-CP-PROFILE-PORT`；分支 `claude/profile-port`；尚未合 main；含迁移 0101，需要走部署脚本。
- 缺陷修复：`PATCH nodes/{name}/profile` 校验了 `port` 却丢弃它，控制台表单每次保存后端口都显示为空，而节点详情的 `facts.port` 早已读 `ops_node_profiles.port`。新增可空列 `ops_node_profiles.port`（1–65535，CHECK），PATCH 写入；省略键保持原值，`null` 清除。
- 新增/优化：无。
- 工程与测试：`PATCH nodes/{name}/profile keeps the documented port, leaves it on other edits and clears it on null`。迁移本地演练 `tooling/scripts/rehearse-control-plane-migrations.sh` 通过（新库、按 0095 水位带种子库升级、两者表结构一致、全部加法）。
- 验证：见 PR 的 Verification 一节；迁移的独立 Codex 审查见 PR 评论。
- 候选/发布：仅源码，无新候选；上线前需 preview 演练与 D1 导出（owner 的部署流程）。
- 剩余限制：已有档案行的 port 为 NULL（未记录），与控制台原先显示一致。
