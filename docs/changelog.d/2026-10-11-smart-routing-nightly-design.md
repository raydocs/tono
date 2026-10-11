## 2026-10-11 · 下一版智能分流 nightly 与 Home DNS 防护设计提案
- 归属：SHIP_PLAN G1/G2 的下一版设计准备；不进入 0.0.75 G4 冻结候选，不关闭发布门。
- 来源：源码参照 [main a8b0be2d5701dbabdb644699547398bdefb99a26](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；分支 `docs/home-strict-smart-routing-nightly`，本 PR 未合 main。该源码不冒充 owner 的已确认稳定包。
- 缺陷修复：无产品修复；引用既有 #1145 / #1280 和 DNS findings，不重复创建或宣称关闭。
- 新增/优化：[完整设计提案](../reports/smart-routing-nightly-2026-10-11.md)：同一 App 可选测试模式、独立 nightly 分发，保留宽 Home 名单与本机 → 云节点 → Home 的两跳链；提出 Home DNS 完整链路、默认直连、特权准入、故障隔离及审查要求。
- 工程与测试：只新增文档；包含区别错误实现的设备验收矩阵、G0/负对照、Claude 审查问题、一周试用和回退边界。未编写 harness，未改变源码/协议/策略/CI。
- 验证：在 Linux orb 核对准确 main 的相关源码及现有 Issue；本 PR 的本地链接、文档限定范围和 whitespace 检查见 PR 验证回执。产品测试、网络抓包、Mac/Windows 设备验收、故障实验均未执行；无既有 CI 结果被冒充本设计的行为证明。
- 候选/发布：仅设计文档，无新候选、签名/公证或发布；不触发 workflow，不改 Sparkle / windows-updates / 生产策略。A13 保持暂停，不并入 #1504/#1569 的代码或未经证明的能力。
- 剩余限制：默认 DIRECT 下独立严格 Home 防线、浏览器/缓存/IP 绕行约束、有效 DNS 准入、稳定包身份、DUT/带外恢复、云名单和可安装回退候选尚待明确。设计审阅不等于实现、实验或生产批准；后续阶段需相应准入。

### 2026-10-11 续记 · Cloud 可换，assigned Home 保持
- Owner 补充：云第一跳故障/节点供应商额度耗尽时，手动切 Cloud 仍保持 assigned Home 与完整链 DNS；自动选节点仅为后续设想，本轮不实现。
- 源码与要求分开：现有按用户 Home 绑定与 Cloud 选择是独立配置；绑定/凭据相同不证明实际公网 IP 不变，egressIpv4 元数据及运维额度估算不冒充数据面固定身份/供应商执行证据。补固定/粘性身份前提、切换窗口验收与 Claude 审查入口，不承诺平台风控通过、无缝会话或副作用请求自动重放。
- 交付/验证：继续 [Draft PR #1571](https://github.com/raydocs/tono/pull/1571)，仍只有上述两份文档；续记的准确 head、本地文档校验和 CI 状态以 PR 回执为准。无产品/设备/网络测试，无 nightly 包、自动切换或发布；家宽连续性机制及切换证据仍待明确。
