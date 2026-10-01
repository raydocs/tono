## 2026-09-30 · 更新证明在屏障仍在时不再改 DNS
- 归属：SHIP_PLAN §2 第 10 项。Windows Service `core/dns/mod.rs`。
- 来源：基线 origin/main `50bbbbf0`。分支 `hunt/grok-winsvc-update-observe-dns-d3c7`。未合 main。
- 缺陷修复：`observe_for_update` 只在杀开关 `wanted == false` 时才对缺失的 `protected-dns.json` 做 DHCP/NRPT 自愈。屏障仍在时只读状态，不把正在使用的隧道 DNS 换成会被 WFP 丢掉的物理解析器。发现 WIN-UPD-OBSERVE-HEAL。
- 新增/优化：无。
- 工程与测试：`dns/tests.rs` 一条 `#[tokio::test]`（`update_observe_heals_snapshotless_dns_only_when_the_barrier_is_down`）。
- 验证：Linux `cargo test --features test --lib update_observe_heals_snapshotless_dns_only_when_the_barrier_is_down`。未实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：屏障已放下、快照丢失、适配器仍指向 `198.18.0.2` 时仍会自愈到 DHCP。这是原来的 Connect 孤儿恢复。
