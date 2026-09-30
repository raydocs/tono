## 2026-09-30 · macOS 登录不再被设备清单读取阻断
- 归属：SHIP_PLAN §2 item 10；macOS 账户登录。
- 来源：b9c50b60 → 本地分支 `fix/macos-login-audit-20260930`；PR 待开，未合 main。
- 缺陷修复：邮箱验证成功并获发有效会话后，独立 `/devices` 暂时 503 原会将云出口登录推入错误门；现先完成云出口登录，再后台读取设备清单。见 `MAC-LOGIN-INVENTORY`。
- 新增/优化：无；Home 分支原设备读取顺序不变，账户拒绝、离线授权及保护门控不放宽。
- 工程与测试：新增一个从 `verifyEmailCode` 到 Worker 响应及设备读取失败的 XCTest 回归。
- 验证：`git diff --check` 通过；工作树的 Git 公共目录在只读沙盒外，`git add` 无法创建 `index.lock`；子代理沙盒内 GitHub DNS / `gh` auth 检查失败，未能提交/推送分支或调度托管 macos-ci；本机按项目规定不运行 Swift/XCTest。
- 候选/发布：仅源码，无新候选或发布。
- 剩余限制：无客户日志或实机复现；托管回归、PR 及审查结果待记录。

### 2026-09-30 主线程接管 Git / 托管验证
- 子代理 Git 公共目录和 remote 访问被沙盒限制，不等于 maintainer 凭据失效；主线程 gh/Git 已正常使用。主线程独立核对 authResult/production caller、Ready 后的 inventory 异步错误和 session-verdict 路径，再提交指定文件。
- 红回归单独位于 b9c50b60 上的 `test/macos-login-inventory-red-20260930`，只添加 XCTest，不回退 worker 实现；红/绿尚待 hosted 结果，不能声称已经 red。

### 合入与验证收据
- PR #689已合main `ca1dd8ac`。改前仅加测试 `25350e10` 的[CI36682380427](https://github.com/raydocs/tono/actions/runs/36682380427) 实际449 tests/1现有skip/1 failure；唯一失败是新 `testVerifiedEmailSignInDoesNotDependOnDeviceInventoryRead`：`.error("Inventory temporarily unavailable")` != `.ready`。原始日志保留，非静态推断red。
- 改后准确头 `c09417d7` 的[CI36682656707](https://github.com/raydocs/tono/actions/runs/36682656707) 四jobs成功。独立Codex high审查 `b9c50b60...c09417d7` 无发现，验证Worker eligibility、账户/设备裁决、取消和revision门控均保留；范围见[#689评论](https://github.com/raydocs/tono/pull/689#issuecomment-5906562438)。这不证明所有登录故障已消除；具体用户失败阶段未提供。
