## 2026-10-26 · 控制平面：macOS 的 CORE_EXIT_UNREACHABLE 计入节点侧失败；ops-console 标签
- 归属：ops 任务「客户即探针」（PR #1758 续）；模块 `services/control-plane/src/ops/verdict-exit-fails.ts`、`services/ops-console/src/copy/customers.ts`。
- 来源：基线 main `0c0e6d7fb` → 分支 `fix/ops-exit-side-macos-code`；未合 main、未部署。
- 缺陷修复：macOS 客户端上传的节点侧失败 `code='CORE_EXIT_UNREACHABLE'`（`stage` 是界面阶段文案，`error` 是用户句子）不匹配 `EXIT_SIDE_SQL` 的任何条件，5 台 macOS 设备对节点判定没有投票 → 把该码加入 `code IN (…)`。按用户去重、跨节点投票逻辑不变。
- 新增/优化：ops-console `codeWord` 新增 `TONO_EXIT_UNREACHABLE`（Windows 0.0.81，PR #1759）与 `TONO_CORE_EXITED`（macOS 0.0.81，PR #1760）的中文解释。
- 工程与测试：`test/ops-exit-unreachable.test.ts` 新增「which failures count as exit-side」两个用例钉住三个码与纯文本条件；`ops-console/src/lib/customers.test.ts` 新增 0.0.81 码的解释用例。
- 验证：本机 `pnpm vitest run test/ops-exit-unreachable.test.ts test/ops-verdict.test.ts` 45 通过、`pnpm run typecheck`（ratchet 520/521）、`check:budgets` 通过；ops-console `customers.test.ts` 20 通过、typecheck 通过。
- 候选/发布：控制平面仍为 2026-10-18 部署，T6、PR #1757、#1758 与本条都未上线，由所有者运行 `tooling/scripts/deploy-control-plane-main.sh`。
- 剩余限制：macOS 的码仍混合「节点死」与「本机 TUN 坏」，依赖跨节点投票剔除；`TONO_SINGBOX_UNSUPPORTED_POLICY` 的编译期映射未做。
