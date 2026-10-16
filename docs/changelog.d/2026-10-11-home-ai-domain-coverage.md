## 2026-10-11 · 补齐并扩大 owner 指定的 Home 域名，视频保留云出口例外
- 归属：SHIP_PLAN G1/G2 下一版路由覆盖；不进入 0.0.75 G4 冻结候选，不恢复 A13 / #1504，不实现 #1571 默认 DIRECT 实验模式。
- 来源：基线 [main a8b0be2d5701dbabdb644699547398bdefb99a26](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；分支 `fix/home-ai-domain-coverage`，准确提交/PR 与验证回执见交付 PR；未合 main。
- 缺陷修复：owner 原清单和截图对应的 51 个具体目标中，17 个已有覆盖，34 个缺失；先补至 118 项。随后 owner 明确扩大 Google/GitHub、Reddit/TikTok（视频也算 Home），两端再补 48 项至 166 项；保留全部原条目，不将未匹中流量改为 DIRECT。
- 新增/优化：除原来的具体 AI 主机，加入 google.com/googleapis.com/github.com、GitHub 内容/静态资源以及 Reddit/TikTok 的专属网站、媒体/CDN。相关父域的普通搜索、API、下载也走 Home，是明确的产品选择而非 AI 应用识别。21 个 YouTube/Pornhub 站点、媒体/API 后缀固定云出口，先于 Google 父域、Home 进程及 DIRECT；UDP 拒绝而非新增可能直连回退的 UDP 路由。
- 来源与界限：专属媒体域名取自 [v2fly/domain-list-community c6adacf29](https://github.com/v2fly/domain-list-community/tree/c6adacf29cc4fb05e04651fcf03e00989ef9f797/data) 的 reddit/tiktok/youtube/pornhub 表，手工选择有界条目并沿用本项目后缀合同；不整体加入 fastly.net/akamaized.net/edgesuite.net/ibyteimg.com/bytedance.com，也不导入整个 Google 或 ByteDance 分类。不是所有未来 CDN、未知域名、裸 IP 或第三方加密解析都已全覆盖的证明。
- 工程与测试：四个 Mac/Windows sing-box 与兼容 YAML 编译路径同步；两端 DIRECT 禁止集包含 Home 和云视频，Windows 精确控制器图证明加入视频前缀且保留完整顺序/数量检查。扩展既有公开运行时回归，检查 Home 媒体及 YouTube Google 子域的云优先级。Windows 云出口/TUN/DNS 探针改为不进 Home 的 gstatic generate_204，仍验证 DNS、TLS 和确切 HTTP 204，不改预算/恢复语义；无新接口、协议版本、进程匹配或 PF/WFP 改动。
- CI 定点修正：[初版 3a58807f8](https://github.com/raydocs/tono/commit/3a58807f83d1e4059a166e48bc497fc0f19801f9) 的 Windows Core 347 通过、1 失败；既有 UDP 转发安全测试误把提前 REJECT 当作放行。区分拒绝与转发并保留转发限制，现有 Home/视频回归另明确断言视频 UDP 目标必须为 REJECT；不改产品代码来迎合测试。新 head 的原生复验以 PR 回执为准。
- 验证：Linux orb 的源码覆盖/两端一致性、签名策略合同与 diff 检查见准确 head PR 回执；原生测试由正常 PR CI 在指定宿主运行，具体通过/失败/pending 以回执为准。未执行设备、抓包、DNS 泄露或第三方账户实验，不将配置测试当作端到端安全证明。
- 候选/发布：仅源码，无新候选、nightly、合并、部署或客户发布；保持 #1571 设计 PR 独立与 A13 暂停。
- 剩余限制：已有 Claude/ChatGPT/Codex/Cursor/VS Code/Grok 等进程名和安装路径匹配，但不等于不可伪造身份或任意客户端全覆盖；共享 node/python 不整体捕获。截图目录应使用路径匹配而非 PROCESS-NAME；clau.de 已有，IPv4 /23 已被 /21 覆盖，IPv6 仍禁用。未添加泛化 openai 关键词或 HTTPS URL-REGEX，不能按加密 URL 的查询参数识别流量。gstatic/cloudflare 等共享父域不进 Home；不承诺网站免风控。路由名单不背书第三方域名归属，也不新增 Home 第二跳 DNS 或持续无泄露保证。独立路由审核、设备/DNS/节点切换及一周试用仍待安排；本轮不产出 nightly。

### 2026-10-16 · 延续现有 Draft，修复政策测试冲突并对齐无 Home 的云视频行为
- 归属与来源：后续桌面版本的 SHIP_PLAN G1/G2，继续 #1572 / `fix/home-ai-domain-coverage`；并入 [main 345774bc](https://github.com/raydocs/tono/commit/345774bc9b163f5c16af47c37adbc036b0bd11ca)，不移入 #1504/#1605/#1643 的暂停代码。
- 工程与测试修正：[旧 head 的 macOS policy-tests](https://github.com/raydocs/tono/actions/runs/38169430412/job/114559261115) 确实在“shared infrastructure googleapis.com must not be pinned to the residential hop”失败。按已确认的 Google/GitHub 扩域合同补独立 Home 正例，保留未批准共享父域负例，增加 YouTube Google 子域先于 Home/进程且 UDP REJECT 的断言；没有跳过测试或撤掉 DIRECT 拒收。
- 跨端一致性：Windows 两个编译器现在与 Mac 一样，即使没有 Home 绑定或 DIRECT 计划，也保留云视频 TCP/UDP 拒绝前缀；HY2 的普通 UDP 能力不被全局关闭。扩展既有无 Home/HY2 回归，不增加第二套测试框架或新文件。其余 Home/DIRECT、DNS、恢复、PF/WFP 许可均不改。
- 本轮首个原生结果：[head 2a25defc 的 Windows Core](https://github.com/raydocs/tono/actions/runs/38977429262/job/117230385562) 因遗漏更新既有 `emits_exactly_the_contract_rules` 的四行旧预期失败：115 passed / 1 failed / 249 未执行，lint skipped，不是完整通过。续修沿用完整云路由精确预期，保留 loopback、视频 TCP/UDP、末尾拒绝/MATCH 的顺序与数量；没有削弱为 contains 或改产品代码。原 macOS `Multi-exit policy` step 在此 head 已成功，其余 CI 结果及新 head 复验另记。
- 独立审查续修：[WIN-CLOUD-VIDEO-PROCESS-DIRECT](../findings.d/WIN-CLOUD-VIDEO-PROCESS-DIRECT.md) 为新增合同未覆盖 Windows Service 无地址进程 DIRECT 准入的 Major（源码推导，非已捕获设备泄漏）。两引擎现有共享 guard 补云视频前置非 DIRECT TCP pins；扩展一个既有准入回归，完整图通过，保留 Home/签名 native-app 授权但缺一视频 pin 或将保护后移均拒收。具体目标身份仍由编译器/精确 readback 负责，不扩大 gate 证明范围；无新协议、DNS/PF/WFP 许可或放行。原生复验和准确修复 head 的独立补核尚待完成。
- 验证状态：本轮 portable 检查、准确提交原生 CI 及独立高风险审查的实际结果记录在 PR 回执；旧 head 的绿灯不沿用。Linux orb 无 Swift/Rust，不运行原生测试、不安装工具链；设备抓包、第二跳解析与换云连续性未执行。
- 客户版边界：0.0.76 RC、版本、签名候选和正式 feeds 均不动；仅源码 Draft，无合并、构建发布或客户推送。#1571 的 Core 故障、未分类流量及 Home DNS 产品取舍仍需 owner 确认；#1071 helper upgrade AI hold 和 #1605 DNS 恢复风险不由本 PR 宣称解决。
