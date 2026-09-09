# Tono 运维控制台（`/ops2/`）

Vite + React 19 + Tailwind v4 + shadcn/ui。构建产物写进 `../control-plane/public/ops2`，由 admin Worker 提供。

## 跑起来

```bash
npm install
npm run dev:fixtures   # 用夹具数据起本地服务，http://localhost:5174/ops2/
npm run dev            # 打真实 /api/v1/ops/*，需要已登录的 Cloudflare Access 会话
```

## 夹具

`fixtures/*.json` 由 `node scripts/generate-fixtures.mjs` 生成，时间戳按 `clock` 字段整体平移到"现在"。
`dev:fixtures` 下用 `?fixtures=` 选数据集，页面会把这个参数转给夹具中间件：

| 参数 | 看到什么 |
|---|---|
| 无 | 42 台节点，常规状态 |
| `?fixtures=dense` | 50 台，超长中文名，压版式 |
| `?fixtures=empty` | 一台都没有 |
| `?fixtures=error` | 接口返回 500 |

`VITE_FAKE_NOW`（秒、毫秒或 ISO 串）会把 `src/lib/clock.ts` 的时钟冻住，服务端和页面同时生效——所有相对时间都从这里取，截图基线才稳得住。

## 截图

```bash
npm run test:e2e           # 比对基线
npm run test:e2e:update    # 重新拍基线
```

只跑 chromium，明/暗两套，1440×900 @2x，时区 `Asia/Shanghai`，关动效，像素差容忍 0.2%。
基线在 `e2e/__screenshots__/{light,dark}/`。改了版式就要连基线一起提交。
`docs/screenshots/nodes-{light,dark}.png` 是给人看的节点页快照。

## 三条 lint

`tools/eslint-rules/`，每条都有 `test/lint-rules.test.ts` 里的夹具证明它会响。

| 规则 | 管什么 |
|---|---|
| `no-implementation-note-copy` | 中文只能写在 `src/copy/copy.ts`（测试文件除外）；copy.ts 里不许出现 桶 / 差分 / payload / revision / schema / DTO / TODO / placeholder / undefined / NaN |
| `no-number-without-freshness` | `src/pages/`、`src/app/` 里不许 `.toFixed(`、`.toLocaleString(` 和裸数字模板插值；格式化只在 `src/components/ops/` 和 `src/lib/display.ts` 做 |
| `no-severity-literal` | 状态色令牌、十六进制色、`hsl(` 只能出现在 `src/styles/` 和 `StatusWord.tsx` / `QuotaGauge.tsx`；`tone-*` 类名和 `--tone-*` 变量不受限 |

## 体积预算

`npm run build` 跑完 `vite build` 会接着跑 `scripts/check-budgets.mjs`，超了就让构建失败：

- 首屏 JS ≤ 400 KB gzip（入口 chunk + HTML 预加载的部分）
- 全部 JS ≤ 600 KB gzip
- `src/**` 单文件 ≤ 400 行

页面按路由用 `React.lazy` 拆包，Recharts 和 Motion 都在 节点 那个 chunk 里，不会拖累别的页。

## 硬规则

- 缺数据永远是 `—` 加来源词，不是 `0`，也不是绿色（`components/ops/Value.tsx`）。
- 一个数字只有一个定义：计数和列表调用 `lib/selectors.ts` 同一个函数，`selectors.test.ts` 断言两者相等。
- 颜色只出现在状态词、额度条和主动作上。

## 验收

```bash
npm run typecheck && npm run lint && npm test && npm run build && npx playwright test
```
