## 2026-10-01 · 套件注册检查要求完整路径词元

- 归属：工程与测试。不是 G1–G4，不改客户路由或发布脚本。
- 来源：`origin/main` `b341164b` → 本分支；[#953](https://github.com/raydocs/tono/pull/953)；未合 main。
- 缺陷修复：`test-suite-reachability.sh` 用固定字符串搜索。`test-wired.sh.skip` 含有 `test-wired.sh` 时检查退出 0。现在路径前后不能再接路径字符。`../../` 前缀仍然算接线。
- 新增/优化：无。
- 工程与测试：`tooling/scripts/tests/suite-reachability.test.mjs` 增加一条。修复前该条期望退出码 1，实际是 0。原有大输入 SIGPIPE 用例仍通过。
- 验证：`node --test tooling/scripts/tests/suite-reachability.test.mjs` 2 tests OK。对当前仓库跑脚本仍退出 1，失败名单与改前相同（通配符和未接线的 py/rb，不是这次引入的）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`node --test "tooling/scripts/tests/*.test.mjs"` 会跑到这些 mjs，但脚本不把通配符当成逐文件引用，所以对 main 仍报它们未接线。脚本本身不在 workflow 里。
