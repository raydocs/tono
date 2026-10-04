# 运维后台收敛为一套

接续所有者 2026-10-04“升级，然后 ops1 和 2 就留一个”的指令。归属运维计划 §6；基线 `c271fe13`，`raydocs/seadevil`，[#1377](https://github.com/raydocs/tono/pull/1377) draft。**源码只保留 ops-console 一个 UI；未合并、未部署，不声称线上旧入口已经退役。**选择见[决定 056](../decisions/056-2026-10-04-single-ops-console.md)。

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

## 检查与已知限制

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
