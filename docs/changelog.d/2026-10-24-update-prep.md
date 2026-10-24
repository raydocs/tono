## 2026-10-24 · 更新文案与离线更新源准备（不发布）

- 归属：T7 更新准备。不在 SHIP_PLAN 的客户发布门里。影响 macOS 更新提示、Windows 更新对话框和托盘。
- 来源：基线 `322f48c6fcb13b26279fed22ae19f79dcc2522bb` → 分支 `fix/t7-update-prep`。未合 main。
- 缺陷修复：macOS 更新失败不再弹出 helper 英文原句，按钮改为「现在更新 / 稍后」。Windows 安装失败显示人话，原句收进技术详情；网络失败可以再试，签名、水位和 Service 拒绝仍停住。检查更新不再把「上一次还没对完账」说成网络问题。托盘在窗口隐藏时仍能发现新版本，并给出「现在更新 / 稍后」。
- 新增/优化：`docs/reports/update-prep-2026-10-24/` 是无私钥、无网络、无上传的候选 feed。签名是占位符。不是客户源。
- 工程与测试：node 测试覆盖 macOS 文案、隐藏窗口轮询和 dry-run 校验。Windows vitest 覆盖对话框、托盘和文案分类。
- 验证：见该 PR 的验证评论。xcodebuild 未在这台 MacBook 上跑。没有真机，没有安装包。
- 候选/发布：无新包。客户 `public/appcast.xml` 与 `public/windows/latest.json` 未改。不签名，不上传，不部署。
- 剩余限制：feed 回滚只挡住还没升级的机器。已升级的机器要靠更高 build / 更高版本的好源码。G1/G2/G3 勾选未动。

## 2026-10-24 · 续记 · 审查修订：放行后的收尾文案，以及 Windows 拒绝分类

- 归属：同一 T7 更新准备，仍不发布。
- 来源：接在 `68781241ae5249fc0a3638b24f509f0c829580f1` 之后。交叉审查 PR #1744 的阻塞项。
- 缺陷修复：macOS 在断开已核实、保护标志已清掉之后，更新记录没收好不再说「网络保护还在」。改为普通网络已经恢复、记录没有收好。Windows 拒绝文案不再说网络保护没有变化。`release replay/downgrade refused` 按水位拒绝停住。`rollback not proven` 和自动恢复停住算需要处理，检查失败的句子不再指向不存在的「现在更新」。
- 新增/优化：无。
- 工程与测试：node 文案测试禁止「保护还在」，并要求 `catalogKeys` 覆盖 `Copy` 里每一句 `String(localized:)`。XCTest 在核实断开后让 retire 返回仍 pending，断言弹出的句子不声称保护还开。vitest 用 Service 原文覆盖降级拒绝和回滚未证实。
- 验证：本机 node 测试与 Windows vitest。xcodebuild 未跑。没有真机。
- 候选/发布：无新包。客户源未改。
- 剩余限制：Windows 网络失败重试会再次清代理并断开；托盘「现在更新」开主窗口、窗口隐藏时的 24 小时检查，都要装机才能看。

