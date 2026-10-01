## 2026-09-30 · Windows replacement sign-in clears predecessor failover
- 归属：SHIP_PLAN §2 item 10；Windows 账户/连接可靠性。
- 来源：基线 `3853f5ec`；分支 `hunt/sol-r3acct-account-heal`，PR 待开；仅源码。
- 缺陷修复：旧账户故障转移后直接换邮箱登录，清理旧 healer 状态；新账户不再因同名服务器及同住宅端点继承旧备用目标。
- 新增/优化：无；与成功 sign-out 的现有 reset 一致，不改认证、AI 阻断、严格模式及释放顺序。
- 工程与测试：一个实际 adopt_sign_in_response 的窄回归，随后重建新账户相同住宅端点并运行 Session::stick_to_preferred。
- 验证：源码路径和现有其他 reset 位置复核；git diff --check、findings 解析通过。完整 Windows Tauri 测试及真实连接本机未运行，由 CI/实机验证；未声称本地先失败后通过。
- 候选/发布：仅源码，无新候选、部署或发布。
- 剩余限制：needs-hardware，实际连接验收尚未执行；本地无完整 Windows Tauri 环境。
