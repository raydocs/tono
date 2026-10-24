## 2026-10-24 · T2 iOS 账户、目录准备与请求重放
- 归属：SHIP_PLAN §2 item 10“连不上且无下一手”缺陷修复；iOS 预发布客户端，不改变客户 G1/G2/G3/G4 门。
- 来源：`322f48c6f` → `50b332d61`；分支 `fix/t2-ios-account` / [PR #1745](https://github.com/raydocs/tono/pull/1745)；尚未合 main。
- 缺陷修复：运行中没有 admitted catalog 时重试/切模式先刷新，刷新失败明确报告，禁止假报“已保存”；账户限制不登出或删除 VPN 配置；POST HTTP 写出后响应丢失或收到无结构 5xx 时不换路径重放。GET 和写前失败仍可回退。
- 新增/优化：中英账户限制提示，以及 T6 合同的 DEVICE_REAUTH_REQUIRED / USER_DISABLED 人话提示（不自动连接/登出）；旧 401 的保守保留策略见 [decision 135](../decisions/135-2026-10-24-ios-legacy-account-errors.md)。两条 API 路径共用既有 Network.framework TLS/HTTP1 交换，在首次 HTTP write 前记歧义，不关闭证书检查，不调整超时。
- 工程与测试：新增 `check-account-copy.py` 并接入 iOS CI，基线原文件实际失败 `PLAN_EXPIRED would use generic raw-code rendering`，当前五个账户码中英文 lint 与 `plutil -lint` 通过。提取 RouteApply.withCatalog 原行为后先运行回归，再修改行为。`ada2fe694` 的 [RED run 40083275707](https://github.com/raydocs/tono/actions/runs/40083275707/job/120841004218)：143 tests / 15 assertion failures；不是编译错误。POST 4 次写入（期望 1）、运行中错报 saved、PLAN_EXPIRED 被刷新为 INVALID_REFRESH_TOKEN 均真实失败。
- 验证：GREEN 源码 `50b332d61` 的 [run 40083408024](https://github.com/raydocs/tono/actions/runs/40083408024) Linux TonoKit 测试实际 `Executed 143 tests, with 0 failures (0 unexpected)`；同 job 后续 sing-box harness 在 `ipinfo.io` DNS 路径断言失败，**完整 workflow 不绿**，[基线 main 322f48c6f 对照 run 40083584910](https://github.com/raydocs/tono/actions/runs/40083584910) 同样在 ipinfo.io DNS 两项断言失败（132 tests / 0 failures 后发生），已证实不是本 PR 引入。Apple build 结果待记录。`git diff --check` 通过。已有账户隔离 9 项/catalog 身份 5 项在 RED checkout 也全部通过，不重复宣称本轮修复。
- 已修复复核：`b9d4df340`（#1672，已在基线）已实现账户 epoch/缓存 owner 与运行 catalog digest；本轮只补记 findings 状态及验证，不重写实现。
- 候选/发布：仅源码，无新候选；不触及 feed、migration、签名、部署脚本，不部署、不发布、不合并。
- 剩余限制：本机仅确认 Xcode 26.6；缺 pinned Libbox.xcframework、可用磁盘约 5.2 GiB，未做本地 xcodebuild app 测试；未安装运行时或工具链。真机隧道、真实 TLS/网络响应丢失、新旧服务端套餐错误联验未执行。CI fixture/单测不证明这些场景。

- 2026-10-24 续记：T2 决策改编号 135，避免与 T6 的 133、T8 的 134 冲突；同步将该决策的子节改为三级标题，满足每份决策只有一个二级标题的 records 契约；`node --test tooling/scripts/tests/records.test.mjs` 3/3 通过，decisions/changelog 读取脚本与 `git diff --check` 通过。不改产品行为。

- 2026-10-24 B1 续修：账户拒绝先关闭 On Demand 并请求停隧道，保留账户和NE配置；不清inputs、不调用serviceClose。账户停止收据带source/accountEpoch/at；保存或读回失败仍stop并明确要求系统VPN手动关闭，不声称已恢复。兼容T6最终403 ACCOUNT_EXPIRED/QUOTA_EXCEEDED与历史别名。新增AccountNetworkReleaseTests；RED/GREEN与原生编译结果在PR验证评论逐项记录。依赖#1741先合，以免扩展将主动停止再记为CORE_STOPPED。真实NE停止、On Demand持久化及移动网络仍未验证。
- B1 RED 证据：`b38ce2f7a` / [run40085931165 job120848944236](https://github.com/raydocs/tono/actions/runs/40085931165/job/120848944236)，147 tests / 13 assertion failures；账户拒绝事件数组实际 `[]`，期望 `[disarm, stop]`，隧道/On Demand 仍开。修复同时将账户失败的source/accountEpoch持久化至既有failure文件（旧字段保持兼容），避免仅留字符串而丢失归因。
- B1 初次 GREEN：`9e23c1204` / [run40086218181 job120849588201](https://github.com/raydocs/tono/actions/runs/40086218181/job/120849588201)，148 tests / 0 failures，AccountNetworkReleaseTests 5项通过；后续同job仍在已复现的基线ipinfo.io DNS harness失败。续补：持久化失败的提示用独立alert呈现，不依赖NE已断开；新增旧failure文件解码兼容测试，新登录清理旧账户停止提示。
