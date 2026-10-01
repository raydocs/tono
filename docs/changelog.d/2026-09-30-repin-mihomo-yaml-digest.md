## 2026-09-30 · 重钉 mihomo YAML 摘要（#732 拨号默认值）

- 归属：工程与测试修正。Windows CI 在 main `939177f4` 上红，挡住后续 PR。不改连接行为，不属 SHIP_PLAN 发布门，也不改 helper。
- 来源：基线 `939177f4`；分支 `cursor/repin-mihomo-yaml-digest-2004`；PR #752（目标 main，未合）。
- 缺陷修复：无产品行为变更。#729 的字节钉 `5565d505…` 写在 #732 之前。#732（`f2cc3d81`，合入 `4fed2d30`）给拥有的运行时加上 `tcp-concurrent: true`、`dns.ipv6: false`，以及目录省略时的 `client-fingerprint: chrome`。两边各自 CI 是绿的，合到 main 后摘要变成 `2a0e26f4…`。
- 新增/优化：无。
- 工程与测试：`live_mihomo_yaml_stays_byte_for_byte_on_its_own_fake_ip_range` 改钉新摘要，并在常量上注明这三处来自 #732。断言仍是整份 YAML 的 SHA-256，没有放宽。
- 验证：对照 #729 头 `f3ad3631` 的 `config.rs` 与当前 `build_owned_runtime` 输出，统一 diff 只有上述三行（指纹出现在三个 Reality 节点上）。`git log -S` 这三处只在 `f2cc3d81`；`4fed2d30..939177f4` 没有再改 `config.rs`。Linux rustc 1.98.1 上 `cargo test --locked -p tono-core`：lib 280 通过（含该钉），`browser_dns` 10、`policy_contract` 1、`update_contract` 1、`update_journal_atomic` 3、doc-tests 0。Windows 实机未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无。
