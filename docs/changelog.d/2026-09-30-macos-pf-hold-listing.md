## 2026-09-30 · macOS helper 未记录 PF 引用在无回答查询下保留

- 归属：SHIP_PLAN §2 item 10（装上会坏：PF 屏障引用残留）；影响 macOS helper（`tooling/scripts/core-helper/KillSwitchPF.swift`）。
- 来源：基线 `a1e333e6` → 本分支；分支 `cursor/fix-macos-pf-hold-listing-8a8e`；PR 待建（目标 main）。
- 缺陷修复：`holdPFEnableReference` 的 hold 路径用 `pfEnableReferenceListed` 判断未记录 token 是否还在；pfctl 非 0 退出或以退出 0 只打印 `DIOCGETSTARTERS` 警告时返回 false，于是 `unrecordedPFEnableReference` 被清掉，该 token 此后无路径释放（R643-F1）。改后 hold 路径改用只认完整列表的 `pfEnableReferenceListing`（新命名函数 `unrecordedPFEnableReferenceHeld`，`listReferences` 可注入）：无回答的查询抛错并保留 token 给下一次检查，而不是清掉它。`settlePFEnableAcquire` 同类：在调用 `pfEnableToken` 解析前先过 `pfReferenceSnapshot` 门，无回答的输出抛错并保留 acquire（此前直接按“没拿到 token”清掉待定获取）。
- 新增/优化：无。
- 工程与测试：`KillSwitchTests.runSelfTests` 新增 `unansweredListingKeepsUnrecordedToken` 纯检查（staged 完整列表含 token → true；完整空列表 → false；`DIOCGETSTARTERS` 警告 exit 0 → throw；`/dev/pf` 拒绝 exit 1 → throw），随 `--self-test` 跑；`tooling/scripts/build-core-helper.sh` 编译与 `--self-test` / `--lifecycle-self-test` 由 macOS CI 在本 PR 精确 head 上验证（Linux 无 Swift 工具链，本地未跑）。
- 版本：helper `4.52.0` → `4.52.1`（行为修复，无协议变更；版本史注释已加）；`CONTRACT.sha256` 按 build manifest 顺序静态重算（管线已用主线已记录值反向验证一致；静态 hash 不代表编译/自测通过，待 CI）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：同条件里的 `pfEnabled()`（`-s info` 无回答读作 false）仍是旧语义，未随本次改动；`heldPFEnableReference` 对已记录 token 的同类“无回答读作不在”仍在（超出 R643-F1 处方范围）；未实机验证。
