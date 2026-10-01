## 2026-10-01 · 连接基准拒绝 0 次握手

- 归属：SHIP_PLAN 客户连接路径的回环基准门。不是 G4，不改 TUN / PF / WFP / 路由 / DNS。
- 来源：`origin/main` `b341164b` → 本分支；PR 待开；未合 main。
- 缺陷修复：`bench.py --check` 原先只把握手次数当上界。正数上限下 0 次握手仍退出 0。现在 0 次记为回归；1 次仍可通过上限 2（mihomo 冷 DoH）。毫秒字段仍是上界。
- 新增/优化：无。
- 工程与测试：`tooling/perf/connect-bench/test_check.py`。修复前该测试失败（失败列表为空）。`connect-bench.yml` 在完整基准之前跑它。
- 验证：`python3 tooling/perf/connect-bench/test_check.py` 退出码 0（1 test OK）。完整 `bench.py --check` 未跑：要下载 mihomo 与 sing-box。`cargo test` 与 XCTest 未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未改基线数字。hy2 没有 `handshakes` 上限，0 次仍不检查。本地 `.cache` 里已解压的二进制不重新哈希。
