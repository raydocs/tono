## 2026-09-30 · 控制面：登出撤销并发刷新的后继会话
- 归属：控制面会话鉴权（[ops 计划](../ops/plan-2026-09-11.md)）；`services/control-plane`，不涉及客户端网络行为。
- 来源：main `378c165d` → 分支 `codex2/cp-logout-refresh-race`；PR #800；未合 main。
- 缺陷修复：CP-LOGOUT-REFRESH-RACE。登出鉴权与撤销提交之间发生刷新时，只撤销原会话会留下有效后继凭据。
  改为在原 D1 batch 内沿现有 `successor_id` 撤销轮换链，穿过已撤销的中间会话；可选 refresh hash 同样作为本用户的链起点。
  独立会话保留，其他账户不受影响；无需迁移，刷新已有的条件撤销继续覆盖登出先提交的顺序。
- 新增/优化：无。
- 工程与测试：`test/worker.test.ts` 新增一个 `it`，覆盖登出鉴权后、撤销提交前发生刷新与宽限重放，最新 access/refresh 均失效，同用户独立会话仍可用。
- 验证：本 Linux 工作树（HEAD `378c165d` + 本次 diff），Node `v20.19.2`；`npx --no-install tsc --noEmit`、`git diff --check` 通过。
  Python SQLite 使用源码 SQL 复现旧撤销遗漏；修后检查通过：刷新先提交、登出先提交且无可选 token、可选 hash 的后继链、跨账户隔离、循环终止。
  指定回归的 Vitest 未实际执行：默认配置缓存写入报 `EROFS`；改用 `--configLoader runner` 后 Workers pool 监听 `127.0.0.1` 报 `EPERM`，待 hosted CI 执行。
  已逐行复核源码与测试 diff；本环境无 Xcode/Windows 工具链，相应检查由 hosted CI 按路径执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Worker Vitest 仍待 hosted CI；已知 H17-G-F5（同设备独立旧会话仍有效）不在本次轮换链修复范围内。
