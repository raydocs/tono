## 2026-10-01 · Sparkle 下载地址不再接受主机覆盖
- 归属：SHIP_PLAN §2 第 10 项。发布工具，不改客户端路由。
- 来源：main `4453e258`。分支 `cursor/appcast-pin-enclosure-host-d3c7`。[#935](https://github.com/raydocs/tono/pull/935)。未合 main。
- 缺陷修复：`publish-macos-appcast.mjs` 的 `--expected-host` 会把围栏地址从 `releases.afk.ccwu.cc` 换成调用方给的主机，并把同一个值套到发布页链接上。现在下载主机和 `/download/` 前缀写死，发布页主机写死为 `github.com`。关联 REL-APPCAST-HOST。
- 新增/优化：无。
- 工程与测试：`expected-host cannot move the download URL off the release host`。
- 验证：`node --test tooling/scripts/tests/publish-macos-appcast.test.mjs`，27 passed。修复前该测试因恶意外围主机被接受而失败。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未跑真实发布，未改 Worker。
