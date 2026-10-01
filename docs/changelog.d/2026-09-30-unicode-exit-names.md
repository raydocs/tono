## 2026-09-30 · 没有英文字母的出口名不再被当成同一座城市
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。Windows 出口选择。不改 WFP、DNS、路由或 TUN。
- 来源：`main` `ee6e028e` 上的 `cursor/unicode-exit-names-a706`（`59fe6555`）；PR #771；未合 main。
- 缺陷修复：出口名比较会去掉非 ASCII，用来对齐 `Buffalo · Niagara` 和 `Buffalo - Niagara`。两个纯中文名都会折成空串，于是 `东京` 和 `大阪` 被当成同一出口，失败后的下一座城市跳不走。空的折叠结果不再算匹配。带国旗的旧线路名仍和去掉国旗的线路名相同。
- 新增/优化：无。
- 工程与测试：`catalog_sync` 一条回归：两个中文名不等，且从 `东京` 能换到 `大阪`。
- 验证：本机 rustc 1.83 不能编 Windows 工程（需要更新的 toolchain）。折叠函数单独用 rustc 复现了 `东京`/`大阪` 都折成空串且判为相同。`cargo test` 未跑，交给 hosted CI。
- 候选/发布：仅源码，无新包。
- 剩余限制：国旗前缀仍被忽略，所以 `🇺🇸 Alpha` 和 `🇯🇵 Alpha` 仍是同一个 ASCII 身份。这是旧线路名要保留的行为。
