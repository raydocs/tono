## 2026-09-29 · Agent 会话状态文件与 hooks
- 归属：工程工具（ops 计划外的 agent 工作流）；不影响任何客户端、Worker 或发布门。
- 来源：main c0e7758e → 分支 `chore/session-state-20260929`（本 PR）。
- 缺陷修复：无。
- 新增/优化：AGENTS.md 新增「Session state」一节：改源码前维护仓库根目录的 `SESSION_STATE.md`（已 gitignore，不入库），
  compact、subagent 启动或恢复会话后先读它。`.claude/settings.json` 新增 SessionStart hook（打印该文件）和 Stop hook
  `.claude/hooks/check_session_state.py`（文件缺失、缺 Objective/Tool receipts/Next 小节或 Next 为空时拦住一次；
  已因该 hook 继续时不再拦，避免死循环）。没有给 Edit/Write 加 PostToolUse。`.gitignore` 放行这两个 `.claude` 路径。
- 工程与测试：本地手测 hook 六种情况（Next 为空、`stop_hook_active`、文件缺失、缺小节、Next=DONE、SessionStart 输出），结果符合预期；无产品测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：hook 在 Claude Code 新会话加载 settings 后才生效；Codex/Gemini 只读 AGENTS.md 规则，没有 hook 强制。
