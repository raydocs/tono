## 2026-10-01 · TCP 调优不再把未生效的 drop-in 当成已调好

- 归属：ops 计划，退出节点 TCP 调优。不改客户路径。
- 来源：`origin/main`；分支 `cursor/tcp-tune-readback-2c38`；PR #910。仅源码，未合 main。
- 缺陷修复：drop-in 文本与目标一致时，仍读回内核值。未生效就重新应用，应用后仍不对则失败，不再打印 already tuned。关联 TCP-TUNE-FALSE-SUCCESS。
- 新增/优化：无。
- 工程与测试：`test_a_matching_dropin_is_not_success_when_sysctl_did_not_apply`。修复前退出码 0 且输出 already tuned。
- 验证：本机 `python3 -m unittest tooling.scripts.tests.tune_tono_tcp_test`，修复前 FAIL，修复后 OK。
- 候选/发布：无新包。
- 剩余限制：未在退出节点上执行真实 sysctl。
