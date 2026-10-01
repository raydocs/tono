## 2026-09-30 · Windows 已证明的 DNS 恢复不再因删不掉快照而拒绝放行
- 归属：SHIP_PLAN §2 item 10（不断网）；Windows Service DNS / WFP 解除。发现 R3-O1。
- 来源：基线 `ff81118a` → 分支 `cursor/win-dns-snapshot-retire-f0e7`（本分支 PR），未合 main。
- 缺陷修复：`restore_protected` 在注册表与实时证明都通过、NRPT/DoH 也恢复之后，删除 `protected-dns.json` 失败会直接返回错误。解除杀开关把这个错误当成「恢复未证明」，WFP 保持拦截。文件被杀毒软件或 ACL 锁住时，每次重试都在同一步失败，机器停在已恢复 DNS、网络仍被拦住的状态。现在删除失败会先改名隔离；隔离也失败则恢复仍然成功，并在 `last_error` 写入 `TONO_DNS_SNAPSHOT_RETAINED`。证明失败（仍指向 Tono DNS，或 NRPT 恢复失败）仍保留快照并拒绝放行。
- 新增/优化：无。严格杀开关的失败证明路径不放宽。健康检查把该标记当作警告，避免把一次成功的恢复记成隧道故障。
- 工程与测试：`a_locked_snapshot_does_not_fail_a_proven_restore`。
- 验证：本机 `rustc 1.83.0` 编不过 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 `windows-2025` CI 的 `cargo test --locked --features standalone,client,test` 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：支持页的警告标记列表未改（避免做成界面改动）；该说明可能仍出现在「上次错误」里。未在实机上用被锁住的快照文件复现。快照留下时，下次连接会继续用里面记下的原始 DNS。
