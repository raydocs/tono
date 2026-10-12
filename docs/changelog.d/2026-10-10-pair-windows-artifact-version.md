## 2026-10-10 · 成对候选 pair 作业跟随 Windows 候选版本（A24-PAIR-STALE-WINDOWS-ARTIFACT）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；Amp 待办 [A24](../ops/amp-backlog-2026-10-10.md) 的后续发现；
  `.github/workflows/desktop-update-candidate.yml`（只改 pair 作业）。
- 来源：基线 main 56b9a1d8 → 分支 `amp/a24-pair-artifact-version`；PR [#1505](https://github.com/raydocs/tono/pull/1505)；未合 main。
- 缺陷修复：pair 作业下载 `tono-windows-0.0.74-candidate-<sha>`，而 `windows-candidate.yml` 上传 `0.0.75`，
  成对无签名候选在 pair 作业失败、不产出清单 → pair 作业从同一 SHA 的 `apps/windows/app/package.json` 读版本
  （Windows 构建的 `verify-desktop-version.py --expected` 门锁定的同一个值，校验为 `N.N.N`），按它拼下载名。
- 新增/优化：无。权限、密钥、签名、attest、上传内容和发布步骤都不变；`windows-candidate.yml` 不改。
- 工程与测试：`windows-ci-paths.test.cjs` 的成对候选用例断言 pair 的 Windows 下载名不含写死的版本、版本步骤读
  `package.json` 且在下载前，代入版本后等于构建的上传名。
- 验证：Linux、Node 24.18.0，`apps/windows/app` 下 `node --test ../../../tooling/scripts/tests/windows-ci-paths.test.cjs`
  → 14 过 0 失败；把工作流换回 main 版本时该用例失败（13 过 1 失败）。未派发成对候选工作流（按任务要求）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实际派发验证；构建上传名与 attest 下载名仍是字面 `0.0.75`（未改，已有测试守住它们与 `package.json` 一致）。
