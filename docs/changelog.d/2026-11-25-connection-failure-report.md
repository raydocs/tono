## 2026-11-25 · macOS 诊断：登录与更新失败带上逐路径原因
- 归属：macOS 客户端，仅源码，无新候选；不是 G4 发布，也不改 SHIP_PLAN。
- 背景：两名用户（0.0.85、0.0.77）装不上更新，登录页「复制诊断」只有版本号和 `Auth stage: sign-in`，更新失败的逐路径原因只写 os_log，客户无处可发。
- 新增/优化：新增 `ConnectionFailureReport`（`Services/Diagnostics`），只记封闭词表的路径标签（`system_dns`/`direct`/`pinned`/`relay`）和失败类（`dns`/`connect`/`tls`/`timeout`/`other`/`skipped`），不含地址、主机、URL、错误原文、账号。登录页复制内容追加 macOS 版本、Protection 状态（armed 无隧道/有隧道/未 armed）和最近一次控制面各路径失败及距今分钟；更新元数据与更新包失败的弹窗在原句后追加 `Paths: …` 行，并记入同一报告。
- 测试：新增 `ConnectionFailureReportTests`（标签与类的白名单、IP/邮箱不外泄、skipped 与 userFacing 文案）；更新 `MacUsabilityRenderTests` 复制诊断用例（固定行用空报告，另断言报告行追加）。
- 未运行：本机不跑 xcodebuild，由托管 CI 验证；红测（旧代码失败）未在本机运行；未做真机验证。Windows 端诊断未检查。
- 未解决：两名用户的真实根因仍未证实，需要其平台、系统版本、弹窗原文和 traffic-audit.jsonl。
