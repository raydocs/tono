# Tono 运维控制台（`/ops2/`）

Vite + React 19 + Tailwind v4 + shadcn/ui。构建产物写进 `../control-plane/public/ops2`，由 admin Worker 提供。
这是唯一 UI 实现；旧 `/`、`/ops/` 入口只做兼容重定向和 hash 迁移，不再构建旧页面。
源码收敛、生产切换及其门禁状态见 [退役记录](../../docs/ops/console-consolidation-2026-10-04.md)。

## 页面

| 路由 | 回答什么 | 状态 |
|---|---|---|
| `#/today` | 现在有什么坏了？我要做什么？ | 已建：判定句、进行中 / 最近恢复 / 待办、事故抽屉（`?incident=`，可寻址） |
| `#/nodes`、`#/nodes?node=` | 机器健不健康、忙不忙、值不值？ | 已建：六个头条数字 + 全机队负载（24 小时 / 7 天）+ 按健康筛选、可搜索的节点表；`?node=` 仍开抽屉（⌘K） |
| `#/nodes/:name` | 这台机器怎么了、该不该留？ | 已建：六个头条数字 + 机器负载四图 + 按运营商的连接质量 + 去程 / 回程两块 + 在用、报错、连接、任务，资料在侧栏 |
| `#/customers` | 谁在用？谁还没用起来？用了多少？ | 已建：计数句 + 平台筛选 + 六个头条数字（在线、7 天内来过、24 小时有失败、本期流量、额度快用完、7 天内到期）+ 到期分布与流量最多 + 开通漏斗 + 十列表格（微信号跟着邮箱走，名单上还没注册的人也是一行）；手机上表在前 |
| `#/customers/:id` | 去了哪里？连不上为什么？ | 已建：整页 360，从"现在"到折叠的账务；时间线上有按天的成功 / 失败柱图，默认只展开最近两天；流量去向先列前 12 个 |
| `#/clients` | 各平台在跑什么版本？该发什么？ | 已建：平台 × 版本档矩阵（每格点进客户列表）+ 每平台发布表与三个写动作 |
| `#/traffic` | 机器区间流量与客户本期用量是多少？ | 已建：24 小时 / 7 天 / 90 天，机器有效速率与累计、峰值排行、客户本期累计和小时增量；缺测不填零 |
| `#/settings` | 目录、分流、资产、告警 | 已建：九节，入口统一在全局业务导航 |
| `#/settings/homeinventory` | 家宽线路能不能分给客户？ | 已建：六个头条数字（在用 / 闲置 / 失联 / 停用 / 探测通过率）+ 按状态筛选的线路表，失联和闲置排前 |
| `#/settings/homelines` | 家宽线路什么时候续、花多少、用了多少？ | 已建：六个头条数字 + 按线路的本期用量 + 快到期清单 + 按情况筛选的线路表（套餐用量对着额度） |

页面上的类型直接来自 Worker 的合同：tsconfig 的 `@contract` 指向
`../control-plane/src/ops/contract.ts`，不生成代码、不复制类型；字段改了含义，先断在 `npm run typecheck`。

## 跑起来

```bash
npm install
npm run dev:fixtures   # 用夹具数据起本地服务，http://localhost:5174/ops2/
npm run dev            # 打真实 /api/v1/ops/*，需要已登录的 Cloudflare Access 会话
```

## 夹具

节点夹具由 `node scripts/generate-fixtures.mjs` 生成，客户、开通漏斗与事故夹具由 `node scripts/generate-ops-fixtures.mjs` 生成。
两者都带 `clock` 字段，时间戳整体平移到"现在"（`hourAt` 平移后还会吸回整点，否则 7×24 热力条会横跨八天）。
`dev:fixtures` 下用 `?fixtures=` 选数据集，页面会把这个参数转给夹具中间件：

| 参数 | 看到什么 |
|---|---|
| 无 | 42 台节点、20 位客户（3 位开通了还没连上过）、名单上 2 位还没注册、2 个进行中事故、macOS 与 Windows 各一条在跑的版本 |
| `?fixtures=dense` | 50 台节点、60 位客户、24 个事故、五个平台 21 条发布记录，超长中文名，压版式 |
| `?fixtures=empty` | 一台都没有、一位客户都没有、没有进行中的事故（但留了两条恢复记录）、一个客户端都没发过 |
| `?fixtures=error` | 接口返回 500 |

今天页的四个写动作（认领 / 静默 / 标记已处理 / 备注）和客户端页的三个（发布 / 撤回 / 设最低支持版本）
真的会改中间件里的那份数据，动作之后页面重新拉取。
`?session=` 给出一份独立的可写副本，截图用例和写用例因此能共用一个 dev server。

`test/ops-fixtures.test.ts` 拿 Worker 自己的 `assert*` 检查器把十二个夹具文件逐条过一遍——平移前后各一次，
因为平移是对时间戳做算术，把 `asOfSec` 算成小数或 0 的那种错，单看哪一半都发现不了。
同一个文件还断言版本分布矩阵的每一格和客户页按同样规则筛出来的人数相等：一格说 5 位、点进去只有 4 行，
就是"高丢包 2 / 高丢包 8"隔了一页又出现一次。

`VITE_FAKE_NOW`（秒、毫秒或 ISO 串）会把 `src/lib/clock.ts` 的时钟冻住，服务端和页面同时生效——所有相对时间都从这里取，截图基线才稳得住。

## 截图

```bash
npm run test:e2e           # 比对基线
npm run test:e2e:update    # 重新拍基线
```

只跑 chromium，明/暗两套，1440×900 @2x，时区 `Asia/Shanghai`，关动效，像素差容忍 0.2%。
`today-phone.spec.ts`、`nodes-phone.spec.ts`、`clients-phone.spec.ts` 另外在 390×844 下跑——今天页是从
Telegram 告警点进来的那一页，横向不许出现滚动条。
基线在 `e2e/__screenshots__/{light,dark}/`。改了版式就要连基线一起提交。
`docs/screenshots/{nodes,today,customers,customer-detail,clients}-{light,dark}.png` 是给人看的快照，由 `e2e/docs.spec.ts` 写出。

## 三条 lint

`tools/eslint-rules/`，每条都有 `test/lint-rules.test.ts` 里的夹具证明它会响。

| 规则 | 管什么 |
|---|---|
| `no-implementation-note-copy` | 中文只能写在 `src/copy/`（测试文件除外）；那一层里不许出现 桶 / 差分 / payload / revision / schema / DTO / TODO / placeholder / undefined / NaN |
| `no-number-without-freshness` | `src/pages/`、`src/app/` 里不许 `.toFixed(`、`.toLocaleString(` 和裸数字模板插值；格式化只在 `src/components/ops/` 和 `src/lib/display.ts` 做 |
| `no-severity-literal` | 状态色令牌、十六进制色、`hsl(` 只能出现在 `src/styles/` 和 `StatusWord.tsx` / `QuotaGauge.tsx`；`tone-*` 类名和 `--tone-*` 变量不受限 |

## 体积预算

`npm run build` 跑完 `vite build` 会接着跑 `scripts/check-budgets.mjs`，超了就让构建失败：

- 首屏 JS ≤ 400 KB gzip（入口 chunk + HTML 预加载的部分）
- 全部 JS ≤ 600 KB gzip
- `src/**` 单文件 ≤ 400 行

页面按路由用 `React.lazy` 拆包。文案按页拆成 `src/copy/{shell,customers,today,clients}.ts`，
`copy.ts` 只负责拼起来；令牌与版式从 `src/styles/globals.css` 里分出 `tokens.css`——两处都是为了不撞 400 行。

## 硬规则

- 缺数据永远是 `—` 加来源词，不是 `0`，也不是绿色（`components/ops/Value.tsx`）。
  没测过的 `Measured` 由 `lib/sources.ts` 的 `shown()` 统一变成 `—`：`asOfSec` 为空时，`false` 也不许显示成"没连"。
- 一个数字只有一个定义：计数和列表调用同一个函数（`lib/selectors.ts`、`lib/customers.ts`、`lib/incidents.ts`），
  三个 `*.test.ts` 都断言 `计数 === 列表长度`。事故的影响人数只算没有父事故的那些，否则一台节点的故障会被数两遍。
- 颜色只出现在状态词、严重度色条、额度条和主动作上。待办一律 rem 紫，且从不进事故列表。
- 动作按不动的时候必须说明原因（`components/ops/Action.tsx` 的 `reason`），灰掉但不解释的按钮会让人反复刷新页面。
- 放数字的块用 `components/ops/Panel.tsx`，给 `source` 和 `asOfSec`；超过 `staleAfterSec` 它自己写"可能不是最新"。
  图表只用 `components/ops` 里的：一眼看的趋势用 `TimeSeries`/`Sparkline`，要报数的用 `LineChart`/`Bars`（整刻度、
  逐列读数、键盘可达），缺测断线不补 0。系列色在 `styles/charts.css`，本身就是结论的系列（失败、错误）用 tone。

## 验收

```bash
npm run typecheck && npm run lint && npm test && npm run build && npx playwright test
```
