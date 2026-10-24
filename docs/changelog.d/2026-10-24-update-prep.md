## 2026-10-24 · 更新文案与离线更新源准备（不发布）

- 归属：T7 更新准备。不在 SHIP_PLAN 的客户发布门里。影响 macOS 更新提示、Windows 更新对话框和托盘。
- 来源：基线 `322f48c6fcb13b26279fed22ae19f79dcc2522bb` → 分支 `fix/t7-update-prep`。未合 main。
- 缺陷修复：macOS 更新失败不再弹出 helper 英文原句，按钮改为「现在更新 / 稍后」。Windows 安装失败显示人话，原句收进技术详情；网络失败可以再试，签名、水位和 Service 拒绝仍停住。检查更新不再把「上一次还没对完账」说成网络问题。托盘在窗口隐藏时仍能发现新版本，并给出「现在更新 / 稍后」。
- 新增/优化：`docs/reports/update-prep-2026-10-24/` 是无私钥、无网络、无上传的候选 feed。签名是占位符。不是客户源。
- 工程与测试：node 测试覆盖 macOS 文案、隐藏窗口轮询和 dry-run 校验。Windows vitest 覆盖对话框、托盘和文案分类。
- 验证：见该 PR 的验证评论。xcodebuild 未在这台 MacBook 上跑。没有真机，没有安装包。
- 候选/发布：无新包。客户 `public/appcast.xml` 与 `public/windows/latest.json` 未改。不签名，不上传，不部署。
- 剩余限制：feed 回滚只挡住还没升级的机器。已升级的机器要靠更高 build / 更高版本的好源码。G1/G2/G3 勾选未动。
