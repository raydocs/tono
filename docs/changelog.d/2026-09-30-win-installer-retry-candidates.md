## 2026-09-30 · Windows 安装器回滚后保留自动重试候选
- 归属：SHIP_PLAN §2 item 10；Windows 安装器（`apps/windows/service/src/bin/install_service.rs`），P3 安装体验；不涉及运行时网络行为，无需 `needs-hardware`。
- 来源：main `846705c7` → 分支 `codex2/win-installer-retry-candidates`；PR #801；未合 main。
- 缺陷修复：协调发布遇临时文件锁，旧 Service/core/App 恢复成功后共用清理删除 `tono-core.exe.next` 与 `Tono.exe.next`；NSIS 自动重试同一命令却不重新暂存，锁解除后仍因候选缺失失败。改后只在访问拒绝/共享冲突/锁冲突（Windows 错误 5/32/33）且回滚与旧 Service 恢复成功时保留这两个候选，清理冗余恢复副本；提交成功与事务准备失败仍删除候选，已还原旧字节的回滚遇摘要校验错误、非锁类错误或旧 Service 恢复失败时也删除。旧字节无法收敛时原有恢复证据保留逻辑不变。关联 `WIN-INSTALLER-ROLLBACK-DELETES-CANDIDATES`。
- 新增/优化：无。
- 工程与测试：同模块新增一个 `#[test] installer_retry_keeps_candidates_only_after_a_recovered_file_lock`，覆盖错误上下文包裹的文件锁、访问拒绝、锁冲突，以及恢复失败、哈希校验失败、磁盘满的删除决定；默认提交清理与原生更新执行器调用不变。
- 验证：本工作树逐行复核 Rust 类型、借用与调用路径；`git diff --check` 通过。确认每次 `--replace-runtime` 重新检查路径与 core 编译期摘要，App 重新测量摘要，`prepare` 再复核候选摘要。本环境无 Windows/cargo 与 Xcode，Windows Rust 编译及测试未执行；由 hosted Windows CI 的 `cargo test --locked --features standalone,client,test` 执行，尚无本修复的 CI 结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机验证临时锁解除后的 NSIS 自动重试；错误 5 也可能来自持续 ACL 拒绝，仍受 NSIS 原有重试次数限制。准备阶段的临时失败仍删除候选，本次不扩大修复范围。
