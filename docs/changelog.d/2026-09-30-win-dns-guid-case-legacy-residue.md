## 2026-09-30 · Windows DNS 恢复证明按不区分大小写比较网卡 GUID
- 归属：SHIP_PLAN §2 item 10（断开/解除不得卡住）；Windows Service `dns/mod.rs`，发现 WIN-DNS-GUID-CASE、WIN-DNS-LEGACY-V6-RESIDUE。
- 来源：基线 `5d46b896` → 分支 `codex/win-dns-restore-guid-case`（本分支 PR），未合 main。GLM-5.3 发现，Codex gpt-6.1-sol（effort max）实现，审阅后提交。
- 缺陷修复：`registry_values_match`、`registry_restore_matches`、`restore_is_proven`、`adapters_owing_live_proof` 仍用 `==` 比较 `interface_guid`，而合并/选择路径早已用 `eq_ignore_ascii_case`。用户原本 DNS 是本地解析器（127.0.0.1 / AdGuard / Acrylic）且快照与实时读取的 GUID 大小写不同时，网卡失去实时证明豁免，`live_loopback` 为真，断开/解除被无限拒绝；仍在场的网卡也可能被当作已消失。现在这四处与已有三处统一走 `same_adapter_guid`（ASCII 不区分大小写）；四个 DNS 值仍精确比较。
- 新增/优化：无。
- 工程与测试：新增 `restored_local_dns_accepts_guid_case_drift`（大写快照 GUID / 小写实时 GUID、原值 127.0.0.1：豁免成立、恢复可证明；缺失或矛盾的实时证据仍拒绝；同网卡真实 DNS 漂移仍拒绝）。改前该回归失败。
- 验证：Linux box，rustc 1.98.1，`cargo test --offline --locked --features standalone,client,test --lib` 339 passed / 0 failed（dns 68 passed）。Windows 原生 DNS/WFP 未验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：报告 #12（快照缺失/新网卡检查只认 198.18.0.2）本 PR 有意不改，理由见 WIN-DNS-LEGACY-V6-RESIDUE：把 `::1` 纳入会拒绝的检查可能把用户真实的本地解析器挡在拦截后面（断网 P0），只扩大修复又会把合法本地/静态 DNS 改成 DHCP。需真机（静杰批次）验证。
