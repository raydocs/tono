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
