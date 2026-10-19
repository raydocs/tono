## 2026-10-19 · Windows sing-box 绑家宽后国内直连装不上

- 归属：G2（客户 0.0.77 测试反馈）；Windows 桌面 sing-box 直连层。
- 来源：`origin/main` `c64d4aebb` →（修复提交见 PR）；分支 `claude/win-direct-rule-proof`；[#1685](https://github.com/raydocs/tono/pull/1685)，修 [#1684](https://github.com/raydocs/tono/issues/1684)；未合 main。
- 缺陷修复：客户绑了家宽时，Windows 换好直连运行时后读回 Clash `/rules`，编号 8「AI 进程走家宽」的 19 个进程名被 `tono-core` 预测成前 3 个，比对失败、回到全隧道，主界面显示「国内直连未开，微信也走隧道」。改后 `inbound` / `network` / `port` / `process_name` 按 sing-box alpha.9 的 `String()` 输出完整列表，截断只留给 `domain` / `domain_suffix` / `ip_cidr`（带 `...`）和 `process_path_regex`（不带）。见 `docs/findings.d/WIN-SINGBOX-RULES-PROOF-TRUNCATION.md`。
- 新增/优化：无。校验仍逐条精确匹配；失败仍回到已证明的全隧道。
- 工程与测试：新增 `alpha9_rules_match_a_live_core_with_home_and_wechat_udp`，参照文件是真实 alpha.9（`132b38e9`）读回的 20 条 `/rules`。`tooling/scripts/sing-box/clash_rules.py`（`capture` / `check`）；`sing-box alpha.9 check` 在重建的 linux 核心上回放参照文件。`windows-ci.yml` 路径加入参照文件。
- 验证：本机（诊断用）以 go1.27.2 编出 alpha.9 darwin-arm64，`clash_rules.py check` 20 条一致；`node --test tooling/scripts/tests/ci-gate-changes.test.mjs` 8 passed。`tono-core` 测试与 alpha.9 linux 回放由托管 CI 跑，结果见 PR 验证评论。Windows 实机未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：修复后的 Windows 实机直连（微信真实走 DIRECT）未验证；界面「国内直连未开」文案仍像一个没打开的开关，未改。

## 2026-10-19 · 续记
- 红灯：只含测试的提交 `944415268` 上，`ci-gate`（run 39201370065）的 Windows `core` 在 `alpha9_rules_match_a_live_core_with_home_and_wechat_udp` 失败：预测的编号 8 是 `process_name=[Claude.exe claude.exe Claude Helper.exe]`，参照文件是全部 19 个进程名。同一轮里，`sing_box / check` 用重建的锁定 linux alpha.9 回放参照文件，结果是「/rules matches the fixture: 20 rules」。
- 独立审查（Codex gpt-6.1-sol xhigh，覆盖 `f8b511cc2`）结论是 approve-with-fixes，指出一个 P2：回放固定使用 29391 端口和参照文件里的密钥，上一次残留的核心可以替一个没能启动的核心应答，造成误报通过。改为每次回放取新的回环端口和随机密钥，读到规则后还要确认核心仍在运行。新增 `test_clash_rules.py`（一个测试），在 `sing-box alpha.9 check` 里运行；修复前的脚本上失败（`SystemExit not raised`），修复后通过。
