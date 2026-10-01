| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-OBSERVE-HEAL | 更新证明在快照文件缺失时会把仍指向 `198.18.0.2` 的适配器改成 DHCP 并拆掉 NRPT，而 wanted 屏障还在，物理 DNS 仍被 WFP 拒绝 | in-PR | 待开 | 中·已确认 | 屏障已经放下时的孤儿自愈保留；未实机 |

`dns::observe_for_update` 被 `update.rs` 的 `protection()` 当作读证明调用。文件不在时它走 `ensure_snapshotless_dns_is_safe` → `OrphanHealScope::NoSession`。
