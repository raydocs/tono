## 2026-10-19 · 移动云与工信部备案站点改为国内直连

- 归属：G2（客户 0.0.77 测试反馈）；macOS 与 Windows 桌面的产品直连名单，控制面直连策略允许名单。
- 来源：`origin/main` `7bad5e7a4` → 分支 `fix/ecloud-direct`；未合 main。
- 缺陷修复：客户在稳定模式下打开 `ecloud.10086.cn`（移动云），流量走洛杉矶出口，页面打不开；改用 Clash 国内直连后能进登录页。
  这类站点从境外访问不通，必须直连。
- 新增/优化：`10086.cn`（移动云官网、控制台与中国移动登录）、`cmecloud.cn`（移动云资源与存储域名）、`miit.gov.cn`（工信部 ICP 备案，`beian.miit.gov.cn`）
  加入产品直连名单（任何进程，TCP 80/443）：macOS `productWebDirectSuffixes` 与 `managedWebDirectSuffixAllowlist`，
  Windows `ADDRESS_FREE_WEB_SUFFIXES`、`ALWAYS_ADDRESS_FREE_WEB_SUFFIXES` 与 `ALLOWED_WEB_DOMAIN_SUFFIXES`，
  控制面 `allowedWebSuffixes` 与 `allowedDirectSuffixes`。`gov.cn` 整体仍不直连。
- 工程与测试：`CoreRouteClassificationTests`、`tono-core` `policy` 测试、`worker-traffic-policy.test.ts` 加入新后缀；`gov.cn` 仍被拒。
- 验证：见 PR 验证评论。
- 候选/发布：客户端名单随下一次发版生效；控制面名单合并部署后，已发布的策略才能再引用这些后缀（本 PR 不改线上策略）。
- 剩余限制：移动云页面的完整域名链路未在境内实测（本机从境外访问 `ecloud.10086.cn` 不通，无法抓取）。
  若登录、备案或控制台还有其他域名走隧道，按客户日志再补。三层分流与 AI 家宽模式本来就默认直连，不受影响。
