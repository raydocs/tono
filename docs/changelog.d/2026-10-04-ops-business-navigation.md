## 2026-10-04 · 运维控制台业务入口和事故优先工作台
- 归属：运维计划 `docs/ops/plan-2026-09-11.md`；ops2，不推进客户 SHIP_PLAN 门。
- 来源：基线 `a97c963e` → 实现 `a4f9a818`，`raydocs/seadevil`；[#1377](https://github.com/raydocs/tono/pull/1377) draft，尚未合 main。
- 缺陷修复：OPS-TODAY-FIRST-ACTION；事故/待办先于质量图，手机不再隐藏质量趋势；1024px 处理区单列。
- 新增/优化：五个业务分组、14个可见入口；侧栏/手机更多/全局搜索共享清单，页头显示归属，支持业务别名与手机搜索；保留旧链接和原角色门，不改 API/写动作，不移除 ops1。
- 工程与测试：沿用现有组件、DTO和文案/体积规则；未增加 UI 单测或 Playwright 用例；现有设置验收改为定位业务导航，并限定告警正文标题，保留深链/默认页检查；未重生成基线。形成 [aiproxy 对照与后续路线](../ops/console-improvement-2026-10-04.md)，外部源码固定 5b03e26b，未复制代码。
- 验证：MacBook 工作树，typecheck/lint 通过；相关7文件31测试、全量44文件345测试通过；构建/预算首屏202.0KB、全量311.3KB gzip，0文件超400行；ego-browser 桌面/手机、跳转/后退/搜索/焦点及 empty/error 核验，报告附夹具截图。Worker及全站Playwright未运行。
- 候选/发布：仅源码，无新候选，无生产部署；UI PR不自动合并。
- 剩余限制：后续对象工作区、按需查询、报表和完整操作闭环尚未实现；依赖审计报告的两项问题另行评估，不改锁文件；未证明线上真实告警或旧入口退役条件。

- 2026-10-04 续记：#1377 为 draft；CI 已启动，尚未完成。全站旧截图基线未同步，不能声称 ci-gate 通过；合并前按 UI 验收结果处理必要的基线变化。

- 2026-10-04 CI 续修：run [37196358993](https://github.com/raydocs/tono/actions/runs/37196358993)（head `6bde6e77`）控制面、合同、迁移、代理和页面分片2/4成功；分片1/3仅账目浅深两例失败，页头h1与正文h2同名触发严格定位歧义。现有账目标题断言限定 main 正文，仍检查真实标题、40笔及后续动作；不改产品源码、快照阈值或跳过行为。修后 typecheck 通过；本机定向账目两例因缺少 Playwright Chromium 1243 无法启动，未执行到业务断言，不安装浏览器或换宿主规避。修后 CI 待验证。

- 2026-10-04 CI 通过：run [37196915052](https://github.com/raydocs/tono/actions/runs/37196915052) 的实际 head `cfc45609e7ed958e08b68f6fef9ac7ead3165ebe`，`ci-gate` success；控制面/合同/迁移/代理全部成功，页面四分片89/89/79/88通过（共345），9条深色文档采集按既有规则跳过。行为检查使用现有 `--ignore-snapshots`，不代表macOS像素基线通过；UI PR仍draft、不自动合并、未部署。上述失败和本机未能启动的记录保留。

- 2026-10-04 单后台续批（所有者新指令“升级，然后 ops1 和 2 就留一个”）：收敛到 ops-console；旧 /ops 与根书签 302＋hash 迁移，新 canonical 仍 /ops2/。迁入只读用量页的 24h/7d/90d、机器累计/速率/峰值和客户账期/小时用量后删除约8427行旧 UI，停止专用构建，清理旧 generated assets；共享 lib/API 类型及既有 helper 测试仍保留，React仅作兼容测试的 dev dependency。决定056，详细[收敛与验收](../ops/console-consolidation-2026-10-04.md)。
- 缺陷/续修：OPS2-ASSET-ACCESS-GATE 统一 /ops2 Worker 资产校验/CSP；草稿迁移回归 OPS-LEGACY-ROOT-BOOKMARK、OPS-LEGACY-TRAFFIC-WINDOW 经审查复现后修正，根书签及对象返回原窗口已做浏览器验证。均 in-PR、未合 main/未部署；没有管理 API 鉴权放宽或私有数据泄漏证据。
- 本批验证：控制面全套44文件1000测试通过；后续路由续修的窄回归4通过、类型/合同/预算绿；控制台44文件345测试、类型/lint/构建预算绿（204.5KB/317.1KB gzip，0超400行）；无新 UI 单测、Playwright用例或基线重生成。初次固定五页清单断言与错误态等待文案失败均已如实记录，不跳过检查。独立审查指定模型条件未满足，门禁仍未完成；PR继续draft，不启用auto-merge，生产退役证据未齐，仅源码无新候选/部署。

- 2026-10-05 退役续接：`50a94765` 的 ci-gate run37217958463 已绿；按 trusted main 策略决定df8c4f2d运行跨厂商全diff审查937f6bab，Opus5.5/high、GPT6.1-sol/high finder成功（交叉verifier medium），结果PASSED/0阻断。四条minor合并为三个根因后续修：旧客户/节点搜索范围提示、隐私模式原值匹配但展示脱敏、不可应用私人筛选不留URL。已跑before/after真实React/jsdom复现与既有345测试/类型/lint/build；无新增UI测试。新findings仍in-PR，续修最终审查/CI待核；两条非当前故障suggestion记录在限制。
- 所有者确认使用/事故条件已完成并选择邮件、Telegram后补（决定057）；不捏造历史事故证明。只读核查此前无告警规则/投递；在tono profile导出/上传D1备份 `2026-10-05T17:47:51Z.sql.gz` 与校验旁文件、校验OK后，按明确任务窄配严重事故邮件规则（延迟/冷却900秒），并排队一条当前真实严重事故，system审计注明D1操作来源；初始投递pending，随后只读确认 `sent/attempts1/HTTP200/2026-10-05 17:53:02 UTC`，未宣称收件箱收到。未读/打印/新增第三方密钥，无假事故。生产仍57c1c64c，主维护检出冲突未动，浏览器Access需登录；仅源码/邮件配置，无新客户候选或Worker部署。

- 2026-10-05 续修复审2edd381f：0 major，一条确认minor指出初次原邮箱搜索不符现有隐私口径。最终恢复邮箱mask匹配、允许已知微信/ID搜索且显示脱敏，加入明确说明；真实prior Git源码before privateEmailRows1/noticefalse，after0/noticetrue，privacy off邮箱与privacy on微信/ID各命中1，maskedtrue；现有345测试/类型/lint/预算绿。非此PR的主维护冲突已由他人解决，生产API已由其他任务更新107ce6d9、preview/生产0093已应用；本任务仅实读，不领取其部署/迁移功劳。本PR最终审查及CI继续核验。
