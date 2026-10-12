## 2026-10-12 · 运维台：手机上节点名不再被截成「Los Ang…」
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：叠在 `feat/ops-maturity-r1`（c90390bd）之上 → 分支 `feat/ops-node-phone-names`；未合 main，合入顺序：先 `feat/ops-maturity-r1`。
- 缺陷修复：生产有六台节点都叫「Los Angeles · …」，手机（390 px）上节点列表名称列只剩约 37 px（状态列和流量列各占一大截，流量的进度条与数字并排且不换行），每一台都被截成「Los Ang…」，分不出是哪台。
- 新增/优化（仅 ≤640 px，桌面不变）：
  - `src/lib/node-name.ts` 的 `splitNodeName`：按最后一个不在全角括号（）里的「 · 」拆成城市和站点，没有分隔符就整个当站点。
  - 节点列表名称格分两行：上面一行灰色小字是城市，下面一行是站点，站点最多两行、可在任意位置折行，不再用省略号截断；链接与整行点击行为不变，行可以高于 44 px。
  - 手机上状态列、流量列收到内容宽度，流量的进度条放在数字上面，把宽度让给名称列（名称列从 37 px 变为约 157 px）。
  - 今天页的「同组事件」成员标题在手机上同样改为最多两行折行。节点详情的标题和今天页事件卡片的主体本来就换行，未改。
- 工程与测试：`src/lib/node-name.test.ts` 一例（四种夹具形态、无分隔符、首尾空格）；`e2e/nodes-phone.spec.ts` 一例（两台 Los Angeles 节点的站点名完整、不以省略号结尾、页面无横向滚动）。
- 验证（本机，`services/ops-console`）：typecheck、vitest、eslint、build、Playwright（`nodes-phone` 与 `nodes`，`--ignore-snapshots`）结果见交付报告。
  手机列表截图基线 `nodes-phone/nodes.png`（名称列变宽、两行名称、流量列改为上下排列）会变，本提交没有重录，需要在 CI 里重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：名称里没有「 · 」的节点仍是一行；站点名超过两行时仍会在第二行末尾截断。
