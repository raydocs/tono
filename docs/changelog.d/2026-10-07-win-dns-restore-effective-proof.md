## 2026-10-07 · Windows DNS 恢复证明改读实际生效的解析器列表（BRICK-W7）
- 归属：SHIP_PLAN §2 第 10 项（0.0.75 修复批，所有者 2026-10-07）；Windows Service DNS 引擎（`apps/windows/service/src/core/dns/engine.rs`）。
- 来源：origin/main `de62eb2a5` → 分支 `claude/win-dns-restore-effective-proof-20261007`；PR [#1449](https://github.com/raydocs/tono/pull/1449)；未合 main。
- 缺陷修复：恢复证明的「实时」一半（`engine::any_loopback`）过去只读回恢复自己刚写的注册表 `NameServer`/`ProfileNameServer`，
  DNS Client 实际仍用 `198.18.0.2` 时也可能判为已证明并解除屏障 → 现在注册表读回保留为附加检查，证明本身改读每个活动适配器经
  `GetAdaptersAddresses`（`FirstDnsServerAddress`）得到的实际 DNS 服务器列表，按地址族沿用注册表的判定：任一位置有 `198.18.0.2`，
  或某族列表全是 Tono 值（含旧版 `127.0.0.1`/`::1`），即判「仍指向 Tono」，在降级出口之前拒绝；用户自己的本地解析器加公共后备
  （如 `127.0.0.1, 1.1.1.1`）不算（评审轮 `fcc0e36e` 的 major 已修）。实际列表读失败或未读到是错误，门面层照旧记为未证明，绝不当成已证明。
  卸载的自动（DHCP）回退走同一函数，同样更严。
- 新增/优化：无。
- 工程与测试：回归 `core::dns::engine::native_apply::tests::restore_proof_reads_the_effective_resolver_not_the_restored_registry`
  （注册表=保存的原值、实际列表仍为 TUN 解析器 → 必须拒绝；未读到 → 错误；正向对照 → 证明成立）。
- 验证：本机未运行 `cargo test`（所有者规则，MacBook 不跑 Rust），只由 PR 上的 ci-gate（Windows CI「Test native DNS apply orchestration」）证明。
- 候选/发布：无新包，仅源码。
- 剩余限制：不加「期望服务器必须出现」的门（恢复模式的精确性由注册表读回负责，DHCP 可能换序或加服务器，强加会让 Disconnect 永久被拒）；
  未实机验证（移动宽带、静态 DNS 适配器）。
