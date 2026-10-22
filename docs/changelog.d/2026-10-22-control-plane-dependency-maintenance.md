## 2026-10-22 · control-plane 依赖维护（#1677）
- 归属：docs/ops/plan-2026-09-11.md 运维服务工程维护；不改变桌面发布门。
- 来源：Dependabot PR #1677，已检查源码提交 `24e05f8da00e4ef5e9d7e205b73e0b4747cb43dc`；尚未合并。
- 缺陷修复：无新增客户缺陷修复声明。
- 新增/优化：更新 control-plane package.json 与 lockfile 的依赖，不修改业务逻辑。
- 工程与测试：依赖范围由主线程检查；原 head ci-gate SUCCESS。追加本记录后必须等待新 head 的 ci-gate，不能沿用旧 head 当新验证。
- 验证：测试输出见 PR verification comment；无行为新增，Red check 不适用。Not run：本机重复测试、生产部署和真实服务检查。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：不将 CI 通过视为完整代码审查或生产验收。
