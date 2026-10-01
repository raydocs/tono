## 2026-10-01 · 并发的系统代理清理不再提前报成功
- 归属：SHIP_PLAN G1。影响 Windows App 的 `core/sysopt`。
- 来源：基线 `origin/main` `4453e258` → 本分支。未合 main。
- 缺陷修复：一次 `clear_owned_sysproxy` / `reset_sysproxy` 还在写注册表时，第二次调用直接返回 `Ok`。更新准备、退出时的受控停止、所有者丢失后的三次重试都会把这当成「代理已关」。现在后到的调用等到前一次结束，再自己做一次清理；前一次失败不会被记成成功。
- 新增/优化：无。仍然只清名下属于本安装回环监听的代理；别人的代理不动。
- 工程与测试：`a_second_clear_waits_for_the_first_and_then_runs`。本机不跑 Windows `cargo test`，交给 CI。
- 验证：未在本机执行 `cargo test`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有在 Windows 上对真实 WinINET 做并发清理。守卫停在 Pending 时的忙等不在这次里。
