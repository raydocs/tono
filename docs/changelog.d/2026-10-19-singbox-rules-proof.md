## 2026-10-19 · Windows sing-box 绑家宽后国内直连装不上

- 归属：G2（客户 0.0.77 测试反馈）；Windows 桌面 sing-box 直连层。
- 来源：`origin/main` `c64d4aebb` →（修复提交见 PR）；分支 `claude/win-direct-rule-proof`；[#1685](https://github.com/raydocs/tono/pull/1685)，修 [#1684](https://github.com/raydocs/tono/issues/1684)；未合 main。
- 缺陷修复：客户绑了家宽时，Windows 换好直连运行时后读回 Clash `/rules`，编号 8「AI 进程走家宽」的 19 个进程名被 `tono-core` 预测成前 3 个，比对失败、回到全隧道，主界面显示「国内直连未开，微信也走隧道」。改后 `inbound` / `network` / `port` / `process_name` 按 sing-box alpha.9 的 `String()` 输出完整列表，截断只留给 `domain` / `domain_suffix` / `ip_cidr`（带 `...`）和 `process_path_regex`（不带）。见 `docs/findings.d/WIN-SINGBOX-RULES-PROOF-TRUNCATION.md`。
- 新增/优化：无。校验仍逐条精确匹配；失败仍回到已证明的全隧道。
- 工程与测试：新增 `alpha9_rules_match_a_live_core_with_home_and_wechat_udp`，参照文件是真实 alpha.9（`132b38e9`）读回的 20 条 `/rules`。`tooling/scripts/sing-box/clash_rules.py`（`capture` / `check`）；`sing-box alpha.9 check` 在重建的 linux 核心上回放参照文件。`windows-ci.yml` 路径加入参照文件。
- 验证：本机（诊断用）以 go1.27.2 编出 alpha.9 darwin-arm64，`clash_rules.py check` 20 条一致；`node --test tooling/scripts/tests/ci-gate-changes.test.mjs` 8 passed。`tono-core` 测试与 alpha.9 linux 回放由托管 CI 跑，结果见 PR 验证评论。Windows 实机未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：修复后的 Windows 实机直连（微信真实走 DIRECT）未验证；界面「国内直连未开」文案仍像一个没打开的开关，未改。
