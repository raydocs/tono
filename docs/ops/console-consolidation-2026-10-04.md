# 运维后台收敛为一套

接续所有者 2026-10-04“升级，然后 ops1 和 2 就留一个”的指令。归属运维计划 §6；基线 `c271fe13`，`raydocs/seadevil`，[#1377](https://github.com/raydocs/tono/pull/1377)。**2026-10-05 已合并 main@933436cb 并部署 API/Admin 两 Worker；只构建 ops-console，旧生成产物已移除。**精确 CI、审查、备份、邮件去重与生产核对见[上线记录](../changelog.d/2026-10-05-ops1-retirement-deploy.md)；登录后的页面验收仍未做。选择见[决定 056](../decisions/056-2026-10-04-single-ops-console.md)。下文保留初次草稿/续修各阶段的原始失败与当时状态，不把它们改成从未失败。

## 实现边界

- 唯一实现：`services/ops-console/`，canonical 保留 `/ops2/`，沿用现有链接、夹具、预算和发布路径，不创造 ops3。
- 删除旧 React 入口、六页及其私有组件/样式/主题初始化/专用 Vite 配置，约 8427 行旧 UI 源码。专属于被删组件/帮助函数的测试随代码删除；共享 lib 的既有测试仍运行，不跳过业务检查。
- `admin:dev/build` 成为新控制台的兼容命令；部署脚本只构建一次控制台。新 build 成功后清除且只清除 ignored `public/ops/` 旧产物，发布资产、共享代码和证据不删。
- `admin/src/lib/`、API 类型/兼容 fixture 和现有 helper 测试仍有消费者，暂保留原路径；它们不构成第二个 UI。Worker 的 React/ReactDOM 移到 devDependencies，仅供这些兼容测试，版本不变。
- 新只读用量页复用既有 `metrics` / `usage-hours` 和原累计计数器计算函数，保留 24h/7d/90d、区间字节、当前有效速率、峰值排行、客户账期累计和小时增量。指标只请求 `netIn,netOut`；不新增 API、迁移、写操作或计量口径。
- 窗口切换时旧窗口不显示在新标题下；同窗口刷新沿用既有陈旧数据策略/时间戳。未知值及计数器重置保留 null。小时零值来自现有记账接口，不由前端填零。
- `/ops2/` 及资产纳入 `/ops/` 已有的 Worker Access admin 校验、UI CSP 与 no-store 入口响应；管理 API 的同源写检查、Access、角色、确认和回执不改。不涉及 PF/WFP、目录身份或 hy2。

## 旧链接对应

旧根 `/`、`/ops`、`/ops/`、`/ops/index.html` 和路径式页面入口使用同一 302 规则。浏览器继承原 fragment；一次性的 `legacy=ops1` 标记在 React 启动前被清除并改写成现代链接。未知/退休旧 assets 不再加载旧 UI。fixture dev server 复用相同重定向函数，便于检验真实 302 与 fragment 继承；它不提供生产 Access 证据。

| 旧 hash | 新入口 |
|---|---|
| dashboard | today |
| failures | today；有 user/node 时进入对应对象 |
| monitor | nodes；保留节点对象及 q 搜索 |
| users | customers；保留客户对象及 q 搜索（邮箱、微信、客户 ID） |
| traffic | traffic；保留时间范围 |
| control / servers / nodes / catalog（旧别名） | settings/catalog；focus=policy 对应 settings/policy |
| users?focus=homes（无对象） | settings/homeinventory |

客户/节点 ID 只解码一次再作为编码路径段写入，加号与百分号不丢。带对象的 traffic 链接进入详情，并保留原 range/from 上下文与“返回原窗口用量”入口；明确告知对象详情使用自己的时间范围，不假装详情已经应用 90 天。不能等价迁移的旧 focus/q 产生通用提示，不把原始邮箱/搜索内容直接回显在提示中。现代 `/ops2/#/nodes` 不走旧 nodes 别名。

## 初批检查与已知限制（2026-10-04 当时状态）

MacBook，本工作树；本轮日志保留于 `/tmp/tono-ops-consolidation/`：

- 最窄 Worker 回归：4 passed / 203 skipped（定向选择，不是跳过完整套件）；其中唯一新增 `it` 验证 `/ops2/` 匿名 401、非 admin 403，符合角色/403 测试预算。完整控制面随后运行：44 文件 / 1000 测试通过，覆盖率门通过；根书签/窗口续修后再跑相同四项与类型/合同/预算。
- 控制面类型通过，棘轮 520/521、兼容库 76/99；合同纯度与 ops/index 预算通过。控制台类型通过，棘轮 197/219；lint 通过。
- 控制台现有全套：44 文件 / 345 测试通过。首次因“固定五页”的旧清单断言失败，现按新增只读用量页同步为六页，保留原覆盖；无新 UI 单测、Playwright 用例或截图阈值变化。
- 构建与预算：首屏 204.5 KB / 400 KB gzip，全量 317.1 KB / 600 KB；0 个源文件超 400 行。`public/ops/` 实测不存在，仅有现代 UI 产物。
- 新 90 天图在手机上暴露了共享时间轴只到 7 天步长的标签挤压；补充 14/30/90 天步长，既有 chart-scale 9 项窄测试通过，最终全套与构建复跑绿。首次窄命令写错测试路径，输出 No test files found，纠正后实际执行，不当作产品失败或通过。
- ego-browser 同一任务空间 16：旧根客户书签、旧 /ops 流量→节点对象→返回 90 天窗口、百分号/加号、旧客户 q 搜索仅匹配一行；空窗口没有图且明确不表示零，接口错误四块失败而非假零。390px 宽与 scrollWidth 均 390，320px 均 320，无横向溢出；桌面/手机人工截图如下。首次错误态等待使用了错误文案而超时，随后读取实际页面确认“这块没有读到”及无图，不把超时当产品失败或通过。
- 独立只读审查实际复现两项 P2（根书签缺标记、对象流量窗口丢失），已修并由真实浏览器验证。CLI 启动回执请求 gpt-6.1-sol/high，但结果报告指定模型条件未满足，保守记**指定模型独立审查门禁未完成**；不据此合并/部署，不把启动标签或审查者自报当通过。
- CI 状态以 PR 的实际 head 为准；前批 `cfc45609` 的绿不代表本次收敛通过。像素基线未重生成，Linux 行为检查不等于 macOS 像素比较。
- 未验证生产 Access、真实事故处理、Telegram 真实告警或两周日常使用证据；未改变采集器或告警协议，未执行生产 D1 写/部署。生产切换须完成这些退役条件及全局审查/CI/备份门禁。对象工作区、服务端分页、报表目录和更多操作闭环仍是下一批，不冒称已交付。

截图是合成夹具，不含生产数据：[桌面](evidence/2026-10-04-console-consolidation/traffic-desktop.png)、[手机](evidence/2026-10-04-console-consolidation/traffic-phone.png)。

## 2026-10-05 · 退役续接

- 精确源码 `50a94765a49685e159a7df7dae174bfe962f31e8` 的 [ci-gate run 37217958463](https://github.com/raydocs/tono/actions/runs/37217958463) 已成功（2026-10-04 16:55:34 UTC）；四个行为 E2E shard 及相关服务/macOS jobs 成功。不是 macOS 像素基线验证；后续提交须读取其自己的 CI。
- 从更新后的 main `a97c963e` 独立检出按 main 策略路由，决定 `df8c4f2d` 为 `dual_cross_family`。只读全 diff 审查 run `937f6bab-87c8-4de9-83db-436abc447294`：Opus 5.5/high 和 GPT-6.1-sol/high finder 都成功、无替换；交叉 verifier 实际 medium。结果 `PASSED`，0 major 或以上阻断。该正式审查替代前轮指定模型未完成的审查记录；不改写前轮状态。
- 本地验证后修正四条确认 minor（三个根因）：客户/节点旧 q 的搜索字段范围变窄时给通用提示；隐私模式搜索原值但展示仍脱敏；不可迁移筛选只留下 `legacyFilter=1` 而非私人原值。续修最终现有44文件/345测试、类型197/219、lint通过，构建首屏204.6KB/全量317.0KB gzip，预算通过。Node/Vite 加真实 React/jsdom 运行 before 为 `oldSearchWarning:false, privateFilterRetainsEmail:true, privacySearchRows:0`，after 为 `true,false,1`、`privacyDisplayMasked:true`。初次 SSR/CJS 工具缝失败，改为真实 DOM 挂载后实际复现，不改产品适配测试环境。未新增 UI 测试文件或 Playwright 用例。
- 角色组合问题被反驳：当前 viewer/operator/owner 均同时有 nodes.read 和 customers.read，不存在审查假设的单权限角色。两条 suggestion 留作工程限制：普通用量榜→对象跳转没有额外的显式返回窗口上下文（浏览器后退可用；旧对象深链另有返回入口）；未来若增加无扩展名的顶层静态资源，应收窄现代页面重定向正则。不是当前资产故障。
- 所有者在本会话确认两周日常使用/真实事故完成，并指定先邮件、Telegram 后补，见[决定 057](../decisions/057-2026-10-05-ops-retirement-email-alerts.md)。这是 owner 确认，尚无可引用的事故日期/笔录；不制造历史证据。生产只读核查当时规则和投递均为空，942 条事故中无 ack；这些数据不能单独证明 UI 使用情况。
- 邮件复用现有 Resend 配置（只检查 secret 名称存在，不读取/打印值）。在维护者的 `tono` profile 中先导出并上传 D1：`backups/control-plane-d1/2026-10-05T17:47:51Z.sql.gz` 与 `.sha256`，压缩大小 6,388,109 bytes，SHA-256 `b691557923abfb5f14fd12523487dc2f705b5f6805b7eae6463a75108b988a53`，本地 checksum 检查 OK。之后按本任务配置 `ops-email-owner-20261005`：enabled、email、severe、open、delay/cooldown 各 900 秒；收件人由 owner 提供，不进仓库。窄写入规则、两条注明 D1 操作来源的 system 审计，以及一条当前真实 severe/open 事故的初始 outbox；没有新建假事故。实读规则正确，投递初始 `pending/attempts=0`；后续只读确认 `sent/attempts=1/response_code=200/sent_at=2026-10-05 17:53:02 UTC/error=null`。这是 Resend 接受投递的回执，不是收件箱签收。
- 生产 Worker 仍为 `57c1c64cf4241bd6a961ff29b15720bbf2a4b162`，未部署此 PR。维护检出存在他人的 AGENTS/BUILD_AND_TEST 冲突，未修改或清除；浏览器 space 17 停在 Cloudflare Access 登录页并已实际 handOff，未进入私有 UI。尚未合并/部署，续修 delta 审查、最新 head CI、main 合批审查及可用的干净维护检出仍须满足。

### 续修复审与隐私规则校准

- `cecf5cc1` 续修审查 run `2edd381f-ee5c-4c6b-b2a7-abed9668db5e`（两 finder high）完成：0 major 阻断，确认一个新 minor：初次原邮箱子串搜索不符 CommandPalette 既有隐私规则。该草稿未部署，未把前一轮“隐私邮箱应按原值匹配”的假设当作最终产品要求。
- 最终选择更保守的既有口径：隐私模式邮箱仍按显示的掩码匹配，微信原值及客户 ID 可搜且结果展示仍脱敏；显式说明完整邮箱搜索需先关闭隐私。新 finding 的原实验仍保留，后续修正记录在同一片段。实际 prior Git `cecf5cc1` 源码通过 Vite 注入到真实 React/jsdom 挂载：before `privateEmailRows:1,privacyScopeNotice:false`；最终 after `privateEmailRows:0,privacyScopeNotice:true,visibleEmailRows:1,idRows:1,wechatRows:1,privacyDisplayMasked:true`，所有断言通过。没有硬编码业务结果、放宽测试或新添 UI 测试文件。
- 最终既有控制台 44 文件/345 测试、类型197/219、lint通过；构建预算绿。最终修正需要其自己的审查和 CI，不拿 `cecf5cc1` 的状态充数。
- 继续实读发现维护检出的冲突已由其他任务解决，成为干净 `main@107ce6d9`；本任务没有修改那些变化。生产 API 也已由其他任务更新到 `107ce6d961419a83fc15756e3d17914fe2ebf92e`，不是本 PR 的部署。生产/preview 迁移均实读“无待应用”，0093 在 preview 于17:38:43、生产于17:46:31 UTC 已应用；本任务仅只读查询，未执行迁移或恢复。之前的 57c1c64c/冲突描述是当时观察，不当作当前 blocker。
