## 2026-09-30 · 清扫不删除刚续期的日志授权
- 归属：control-plane ops 原始诊断日志授权/审计。
- 来源：origin/main `b341164b` → `hunt/sol-cp-log-window-renewal-fence`，本 PR；尚未合 main。
- 缺陷修复：SELECT 过期授权后操作员续期，旧清扫仍删除新授权并误记关闭 → DELETE 原子复验过期条件；后继审计只随实际删除写入。关联 SOL-CP-LOG-RENEW-SWEEP。
- 新增/优化：无；过期边界、用户/设备授权限制保持。
- 工程与测试：一条双授权屏障回归，真实 PUT 续期后保留新授权，只删除/审计仍过期授权；原代码失败。
- 验证：Linux / Node24；完整 ops-api 文件及 typecheck 结果在 PR；未部署或访问生产数据。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不修复历史错误关闭审计；不改变授权期限。
