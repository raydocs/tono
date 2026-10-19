## 2026-10-19 · 0.0.78 双端客户测试 RC（alpha.12 内核 + 国内直连修复）
- 归属：owner明确要求把sing-box alpha.12与#1684修复放进同一个新包，并把已合或可合的未发布PR一起收进0.0.78；手动客户测试候选，不授权正式feeds推广。
- 来源：分支`release/desktop-0.0.78-test-20261019`，基于0.0.77冻结[647cf263](https://github.com/raydocs/tono/commit/647cf2633956e6bd9f6eda7af51cab7a1cdbed57)之后的main。最终冻结SHA/run/包摘要产生后续记，不提前声称构建或验签成功。
- 收录（均已合main，本准备提交只做版本与记录）：
  - [#1685](https://github.com/raydocs/tono/pull/1685) `5e2866edb`：Windows可选DIRECT的`/rules`证明按alpha.9实际`String()`打印完整`process_name`/`inbound`/`network`/`port`列表；客户"国内直连未开、微信走隧道"（#1684）的根因修复，CI真实核心重放`/rules`。
  - [#1686](https://github.com/raydocs/tono/pull/1686) `95fe1ca18`：双端sing-box由`v1.15.0-alpha.9`升至`v1.15.0-alpha.12`（`25b0d5ea`），三目标candidate/manifest与全部准入摘要同步；独立Codex审查approve，owner决定先进本RC再实机。
  - [#1605](https://github.com/raydocs/tono/pull/1605) `17a588f53`：Windows Service精确DNS恢复失败后走限定DHCP回退（WIN-NRPT-KEPT-AFTER-EMERGENCY-DISARM）。
  - [#1674](https://github.com/raydocs/tono/pull/1674) `c39a9c17d`：未确认的出口不再挡住已确认目录（EXIT-IDENTITY-UNHEALTHY-BLOCKS）。
  - [#1675](https://github.com/raydocs/tono/pull/1675) `6ae39607e`：失效的本机系统代理不再挡住线路（STALE-LOOPBACK-PROXY）。
  - [#1680](https://github.com/raydocs/tono/pull/1680) `b985c99a6`、[#1676](https://github.com/raydocs/tono/pull/1676) `e3066d0d9`：Windows Rust与plugin-core JS依赖补丁。
- 不收录：#1679（CI失败）、#1643（HOLD/block）、#1504（审查FAIL）、#1668（draft，标注不发布）、#1672/#1673（iOS/Android，不属于桌面包）、#1677/#1678（服务端，不随客户端发布）。#1071不关闭。
- 新增/优化：双端0.0.78，Mac build79，共同releaseSequence拟7801；新prerelease命名空间，不覆盖0.0.77/0.0.76或旧资产。Mac除内核外无App代码变化。
- 工程与测试：同步六处版本、候选guard/artifact/manifest、中英发布说明与RELEASE_LINES/UPDATE文档；三个finding标源码fixed、待实机。不放宽任何ref、签名、摘要、固定DNS或特权准入。
- 验证：各收录PR的准确head CI与审查见各自PR，不是本版本准备提交的新结果。设备DNS/PF/WFP、alpha.12的hy2分片与Windows DNS watcher行为、国内直连实机、升级回退、睡眠/换网未执行。
- 候选/发布：拟由release线签名构建、Mac公证/DMG、Windows updater验签与provenance核验后分发手动RC。无生产Worker部署、R2镜像、Sparkle/windows-updates/v1 latest改动。
- 剩余限制：同0.0.77——普通DIRECT仅公网IPv4 TCP80/443，UDP/QUIC/IPv6/LAN不支持；Mac限Apple芯片/macOS26.3+；Windows限x64 Win10 22H2/Win11，无Authenticode发布者签名；旧版先恢复网络退出再装。

### 准备提交本地验证
- `python3 tooling/scripts/verify-desktop-version.py --expected 0.0.78` → 六处版本一致、PASS；`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` → exit0（含旧0.0.77/build78包身份拒绝，synthetic unsigned fixtures）。
- Red check：版本准备不要求新增native Red；未执行原生产品CI、签名/公证/下载，待准确提交和实际构建结果。
