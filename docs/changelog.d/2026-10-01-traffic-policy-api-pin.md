## 2026-10-01 · 流量策略发布只把管理员令牌发给生产 API

- 归属：ops 计划，发布工具。不改 Worker，不改客户策略。
- 来源：`origin/main`；分支 `cursor/traffic-policy-api-pin-2c38`；PR #908。仅源码，未合 main。
- 缺陷修复：`--api` 不再接受任意源站。令牌只发给 `https://api.afk.ccwu.cc`，并且在读取钥匙串之前拒绝其他地址。关联 TRAFFIC-POLICY-API-PIN。
- 新增/优化：无。
- 工程与测试：`test_an_unpinned_api_origin_is_refused_before_the_token_is_read`。修复前 stderr 是读策略文件失败，没有拒绝令牌发送。
- 验证：本机 `python3 -m unittest tooling.scripts.tests.publish_traffic_policy_test`，修复前 FAIL，修复后 OK。
- 候选/发布：无新包。
- 剩余限制：预览 Worker 不能再用 `--api` 携带这把生产令牌。签名和发布逻辑未改。
