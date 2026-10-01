## 2026-09-30 · 已结束诊断会话不被开始报告回退
- 归属：control-plane 自动会话诊断。
- 来源：origin/main `71bd69d8` → `hunt/sol-cp-diagnostic-session-terminal`，本 PR；尚未合 main。
- 缺陷修复：延迟开始报告覆盖已结束时间/字节/结果 → UPSERT 保留终态，仅仍未结束会话或传入结束报告可更新。关联 SOL-CP-SESSION-REWIND。
- 新增/优化：无；账户隔离和已结束报告的更正仍允许。
- 工程与测试：新增一条真实 API 终态后收到开始报告回归，原代码失败，修复后通过。
- 验证：Linux / Node24；diagnostics-clusters 完整文件及 typecheck 结果在 PR。未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不定义两个终态报告的排序；不改其他诊断行。
