## 2026-09-30 · macOS：更新回执里的未知字段拒绝，不再剥掉后接受

- 归属：SHIP_PLAN G3（更新账本形状）；Issue #601 的 CR-01。helper `UpdateStorage.swift`，协议 4.52.6 → 4.52.7。不改 PF、DNS、路由。
- 来源：基线 `origin/main` `cbb4f56a`；分支 `cursor/receipt-exact-shape-5636`。
- 缺陷修复：账本信封上不认识的键仍可忽略。`attempt.receipt` 里多出来的键以前被 `knownFieldsMatch` 剥掉，再拿重编码的回执去校验，于是未知字段被接受并在下次保存时删除。Windows 回执是 `deny_unknown_fields`。改后：回执对象带有本构建不认识的键时，匹配失败，`load` 报账本损坏并保留磁盘上的原文。
- 新增/优化：无。
- 工程与测试：`UpdateTests` 增加 `ledger-refuses-an-unknown-field-inside-the-receipt`。信封上的 `futureFact` 仍由原有用例接受。`CONTRACT.sha256` 按 `build-core-helper.sh` 同一管道重算。
- 验证：本机无 `swiftc`，helper `--self-test` 未跑。macOS CI 在本 PR head 上跑 `build-core-helper.sh`（含 `--self-test`）。
- 候选/发布：仅源码，无新候选。协议号变化会让已安装的 helper 在下次启动时要求管理员授权替换。
- 剩余限制：#601 里其余条目已在 main（#625、#649、#653）。本条不覆盖 Windows 回执，那边已经拒绝未知字段。
