## 2026-10-13 · Windows sing-box DIRECT 准入绑定签名流量策略（#1280 剩余缺口）

- 归属：SHIP_PLAN §2 第 10 项（加固类）。Windows Service + App，可选 DIRECT。不是客户发布。
- 来源：基线 `origin/main`（#1619 已合）；分支 `claude/win-direct-policy-binding`；决定 [110](../decisions/110-2026-10-13-sing-box-direct-admission-shape-limits.md) 更新；发现 `WIN-SING-BOX-DIRECT-SIGNED-POLICY-BINDING`。
- 缺陷修复：通过 App 身份门的 `ReplaceSingBoxRuntime` 请求此前只要形状合格，就能把策略未列出的域名/地址送往 DIRECT。现在协议 22 的请求带签名策略原文和签名；Service 用内置公钥和与客户端相同的签名字节（`tono-traffic-policy-v1\n` + json，嵌入 revision 须等于信封 revision）验证，只放行策略列出的精确域名与端口、媒体 /32 与端口、后缀；进程路径规则要求策略列出原生应用。没有策略、验签失败或 revision 被改标，则拒绝这次 DIRECT 替换；App 把拒绝当作跳过，连接留在出口上，不断网。
- 新增/优化：`PROTOCOL_REVISION` 21 → 22，`MIN_SERVICE_REVISION_FOR_SING_BOX_DIRECT_POLICY`。App 在 Service 低于 22、或手里没有与捕获的 revision/摘要一致的签名响应时不安装 DIRECT 叠加层。全隧道回滚文档不含 DIRECT 规则，不带策略。看门狗重启与 `StartClash` 仍走只看形状的复核；mihomo 不变。Service 新增 `ed25519-dalek`、`base64` 依赖（`standalone`/`client` 特性）；`ALWAYS_ADDRESS_FREE_WEB_SUFFIXES` 移到 `direct_domains.rs` 供 Service 共用。
- 工程与测试修正：Service 单元测试覆盖未列出的域名/端口、无策略、媒体地址、后缀与进程规则，以及错误公钥、未签名/被改、revision 被改标；App 测试覆盖签名响应选择与编译器输出对策略的匹配。
- 验证：本机不能编译（rustc 1.97.1，要求 1.98）；Windows 托管 CI 是测试主机。红灯与绿灯运行号见 PR 的 `## Verification`。
- 发布与部署：仅源码，无新候选。
- 剩余限制：策略不含进程名，进程规则只绑定「策略授权原生应用」加正则形状；Service 没有 revision 下限，更旧但有效签名的策略可被持有者重放；mihomo 仍只看形状；未经 Windows 实机验证。
