# D1 / D3 / D5 旧 WIP 对账（2026-09-14）

结论：**三条分支不能整体吸收，也不能整体当作未完成功能。** D1 后端、D3 的 R2 校验与后台门控、D5 生成与呈现已通过 [#140](https://github.com/raydocs/tono/pull/140) 合入。明确可吸收的剩余是 D1 当前月锁定后的冲正提示，已单列 [#191](https://github.com/raydocs/tono/issues/191)。D3 数据库驱动公开 feed 仍未合入，必须与客户发布路径的决策分开；本报告不授权启用它。

## 基线与证据方法

- 审查固定到 `origin/main` [a605306a](https://github.com/raydocs/tono/commit/a605306a1d41b93035338bd44e58635b5659e7df)，不是旧 `ops/platform` 或报告里的线上 SHA。
- 完整拉取历史后检查远端分支、提交祖先关系、逐文件差异、PR 状态与正文、当前实现及已有测试源码；没有运行产品测试、浏览器或生产 API。本次仅修改文档，按仓库规则不运行测试。历史 PR 验收描述不是本次重验，更不是当前生产状态证明。
- 原始任务见 [组织计划 D 部门](../ops/org-plan-2026-09-10.md) 与 [剩余计划 §1.3–1.5](../ops/plan-2026-09-11.md)。[对抗报告](../archive/ops/adversarial-review-2026-09-10.md) 的 finding #2/#3/#6/#8/#9 等是**报告内编号**，不能当成同号 GitHub Issue。
- #140 状态 MERGED，合并于 2026-09-10T20:47:07Z，合并提交 [2cef4eac](https://github.com/raydocs/tono/commit/2cef4eac2aa835447da8adda2f26db4b40126574)。其标题写“第十四次部署”、正文写 preview 演练；[runbook](../ops/rollout-ops2.md) 部署记录止于第十三次，不能据标题补写一次已验证的生产部署。

| 旧分支 / 已公开快照 | 排除共有 D4 后的本题差异 | 对应当前实现 |
|---|---|---|
| `dept/d-d1`：[cf347d3e](https://github.com/raydocs/tono/commit/cf347d3e) → [d95bd974](https://github.com/raydocs/tono/commit/d95bd97464314f810f9714d25129b38137c72333) | 14 文件，445 增 / 57 删 | [dfff6853](https://github.com/raydocs/tono/commit/dfff6853cd35b85da755ba866de7e49fa2f94170)，以及 D2 整合 [20572827](https://github.com/raydocs/tono/commit/205728272e07879394e4bfc381b01c28e9065976) |
| `dept/d-d3`：[18cc8a7b](https://github.com/raydocs/tono/commit/18cc8a7b) → [c3341418](https://github.com/raydocs/tono/commit/c3341418ae13e658377718f6b0a8ce6d7003f51c) | 26 文件，1541 增 / 191 删（含旧截图） | [4c90bed5](https://github.com/raydocs/tono/commit/4c90bed5012e5dd163419f485d9e4c1b8fa6eb68)，不含公开 feed 改写 |
| `dept/d-d5`：[1eefe244](https://github.com/raydocs/tono/commit/1eefe244) → [b7d8eaf8](https://github.com/raydocs/tono/commit/b7d8eaf8c59e9a2c420f04c4a3fe3e01f990b2f4) | 13 文件，1739 增 / 29 删 | [a4eef1b5](https://github.com/raydocs/tono/commit/a4eef1b5fa65c21507f58899a74a37702aee4aae) |

三条 WIP tip 都不在 main 祖先链；上表三个实现提交都在。这是替代实现/吸收，不是原分支原样合并。三条分支共有的 [f459f198](https://github.com/raydocs/tono/commit/f459f1981438d5120511ca12743e8683fd2986da) 与已合 [467a6167](https://github.com/raydocs/tono/commit/467a6167f686d92c94a5d3e962858e57d8e75c5f) 仅两个文档不同，产品代码一致；D4 已由 [#133](https://github.com/raydocs/tono/pull/133) 交付，[#134](https://github.com/raydocs/tono/pull/134) 补滚动 24h 等。不要把 `main...WIP` 中这批变化重新实施。共有 DTO 地基是 [#131](https://github.com/raydocs/tono/pull/131)。

## D1：后端完成，前端锁月/冲正提示仍需吸收

下列路径省略 `services/` 前缀。

| 项目 | 分类与证据 | 处置 |
|---|---|---|
| 0069、关月冻结客户/节点明细、`frozenPartial` | **已合入**。`control-plane/migrations/0069_ops_month_close_snapshot.sql`；`src/ops/ledger.ts::encodeMonthSnapshot/loadMonthSummary`；`handlers/ledger.ts::postMonthClose`。当前超限存 `partial: true`，旧 WIP 存 NULL | 保留 main，不重放迁移；也不要覆盖 D2 的 reconciliation 快照 |
| CSV 原币合计符号、负金额与公式单元格 | **已合入/实现已替代**。`ledger.ts::ledgerCsv/csvCell`；`ops-ledger.test.ts` 已有 CSV 与冻结行断言 | 不恢复旧 CSV 实现；测试存在不等于本次跑过 |
| fixture 冲正 `amountMinor` 不变、`cnyMinor` 反向、目标月锁定拒绝 | **已合入**。`ops-console/fixtures/routes/ledger.ts::reverse` | 不恢复整份旧 fixture |
| fixture 冻结快照、前端本地 DTO 的 frozen 字段 | **未原样吸收，价值待具体用例证明**。WIP 存完整 `Frozen`；当前 fixture 仅存关闭者/时间并动态组装，且有 D2 对账样例 | 如需冻结 UI 场景，按现行 DTO 与样例局部补，不把旧空 reconciliation 换回来；未证明生产冻结退化 |
| 当前月锁定后“只能冲正”与仍可点击的冲正按钮 | **仍有价值待吸收**，#191。main 的 `copy/ledger.ts::closeBody/lockedNote` 仍承诺只能冲正；`LedgerTable.tsx::ActionCell` 只因 `reversedBy` 禁用冲正 | 提取 WIP 的 `closeBodyCurrent/lockedNoteCurrent/reverseLocked` 意图，不照搬整文件 |
| 后端月锁拒绝的专门提示 | **仍有价值待吸收**，#191。WIP `reverseRefused` / `MONTH_CLOSED` 映射未在 main；当前 `write.run` 只接普通拒绝 | 过去月份也可能因当前目标月锁定而失败，提示必须说清是哪一个月 |
| 旧报告“转交 B”开户拒绝后残留 | **已在 main 报告中留存；与 #187 范围重叠**。不是新的 D1 功能 | 由 #187 onboarding/log-window owner 核对，不在账目补丁修开户 |

**锁月的关键合同**：`postLedgerReverse` 用 `utcMonthString(now())`，再 `requireOpenMonth`；它不是往原账月份写。已有 `ops-ledger.test.ts` 分别覆盖“过去月锁定仍可冲正进当前月”和“当前月锁定拒绝冲正”。这证明后端保护意图，不能证明前端话术正确。

**不要盲搬 WIP 时区判断**：前端 `lib/ledger.ts::monthOf` 使用本地年月；Denver 2026-09-30 18:30 MDT 已是 UTC 10 月 1 日。WIP 的 `month === monthOf(nowSec())` 仍不足以证明后端目标月已锁。吸收时应明确 UTC 目标月、目标月锁信息未知与会话期间新锁的拒绝路径。

[#186](https://github.com/raydocs/tono/pull/186) 固定审查头 [0f3b9f35](https://github.com/raydocs/tono/commit/0f3b9f35b76b7cdc67fbee5fda171a52e8bf5c64) 没有以上四个新话术或 `currentLocked`。其 [06f0a739](https://github.com/raydocs/tono/commit/06f0a739) 修 entries 未就绪时假计数，`0f3b9f35` 修无有效摘要仍可锁月，**都不是本问题的重复修复**。#191 必须保留这两项保护并服从 Batch 8 所有权。

## D3：校验与后台门控完成，公开更新源改写没有合入

| 项目 | 分类与证据 | 处置 |
|---|---|---|
| R2 对象、大小、SHA-256、`verified_at/object_etag` | **已合入**，`control-plane/src/ops/releases-verify.ts`、`releases.ts`、0068；现行拒绝为 409 `RELEASE_UNVERIFIED` + reason | 不恢复 WIP 的多种 422 错误码或强制完整注册字段；main 允许未完成的草稿 |
| 大小/校验/签名呈现、未接更新器与未校验禁止发布 | **已合入**，`ops-console/src/lib/releases.ts::publishBlockReason`、`pages/clients/ReleaseTable.tsx` | 已有功能，不列作待开发；与 #186 Clients 样式工作重叠 |
| Sparkle/minisign 签名 | **已合入形状检查；密码学真实性证据不足**。`assertSignatureShape` 验编码/长度，不证明公钥校验成功 | 不把 `signed` UI 字段升级为原生更新验收，也不据此关闭 #26 |
| `releases-public.ts` 从 `client_releases` 渲染公开 feed 与对应 feed tests | **未合入，保留为设计候选**。该文件不在 main 历史；WIP 同时改发布 host 与 API host。main `index.ts` 仍将 `/appcast.xml`、`/macos/appcast.xml`、`/windows/latest.json` 映射到 ASSETS | 不宣称后台 publish/withdraw 已直接改变客户 feed。是否切换源尚需明确产品授权，不能由对账自动实施 |
| `releases-channels.ts` 注释称 Worker 从 DB 渲染 feed | **过时描述**，与 `index.ts` 真实路径不符；`wired=true` 只可证明客户端有更新通道 | 后续若改文档/话术应区分“客户端有 updater”和“后台行驱动公开 feed”；本次没有改源 |
| 旧 WIP 校验/test 加强片段 | **可参考，不能整套搬回**。WIP 只信 `checksums.sha256` 或实际读取；main 还优先接受 `customMetadata.sha256`，并有 300 MB fallback 上限 | 上传者/元数据可信边界与对象替换场景未做此次端到端验证；不把旧实现默认当成更正确的修复 |
| 六张旧 Clients PNG、旧 vite fixture 接线 | **已过时/与 #183、#186 验收重叠** | 不能用它们直接消除当前截图失败，也不能覆盖现有 fixture 路由 |

公开 feed 切换既不是 #26/#181 的 installer/journal 修复，也不是 G1–G3 通过的证据；当前 `SHIP_PLAN` 的更新源禁发边界仍有效。没有观察生产桶、真实客户端更新或线上源一致性，不能把“不在 main”推断为“一定该启用”。

## D5：生成器与呈现已有，旧算法不是待修清单

| 项目 | 分类与证据 | 处置 |
|---|---|---|
| 八类候选、≤3 条、主体去重、收益/置信度/入口 | **已合入**。当前 `control-plane/src/ops/weekly-picks.ts`；`worthwhile.ts::weeklyWorthwhile` 已委托，不是空 stub；`handlers/followups.ts` 注入 digest | 不按陈旧文件头的“D5 尚未做”重做；`ops-followups.test.ts` 已有 idle-node digest 回归 |
| `Worthwhile` 组件、copy、隐私遮罩与导航 | **已合入**，`ops-console/src/pages/worthwhile/Worthwhile.tsx`、`lib/worthwhile.ts` | main 已有 #180 的新布局，不恢复旧行布局；#186 承接后续视觉所有权 |
| 旧本月闲置、14 天续费、耗尽早于周期末即入选 | **已过时的规则方案**。当前依 §1.5：7 天闲置、7 天内续费且 30 天零使用、预计 7 天内耗尽 | 窗口差异不是遗漏功能，不恢复旧 SQL |
| 旧 ¥200/小时、¥60/客户、置信度乘权与 urgency | **已被现行排序替代**。当前 cny 分÷100÷10 折小时，客户×2 折小时，然后 deadline/id，按主体去重 | 无产品授权不回退到 WIP 评分；第 3 日边界也以当前“已过 3 号”实现为准 |
| WIP 大量生成器/预算/呈现测试 | **测试思路仍有价值，旧期望多处过时** | 仅为具体风险提取一条窄回归；当前已有 idle-node 检查不能当作全候选/SQL 预算通过证明 |
| 上游失败与空结果语义 | **与 #182 相邻，不是同一已证实缺陷**。#182 是 Today 客户/机队读取失败导致 chores/Digest 少计；WIP/main 的生成器异常处理还不同 | 不把 #182 扩成重写所有 D5 生成器；若单独验证后端局部失败，再确定是否追加范围 |

## 指定 Issue / PR 的逐项去重

| 跟踪项 | 与 D1/D3/D5 的关系；建议 |
|---|---|
| [#4](https://github.com/raydocs/tono/issues/4) | legacy→named metering 边界协议；D1 账目冻结不补丢失计量。**不重复，不关闭** |
| [#5](https://github.com/raydocs/tono/issues/5) | home-agent 计数代际证明；D5 home-line 候选不实现 reporter epoch。**不重复，不关闭** |
| [#26](https://github.com/raydocs/tono/issues/26) | Windows 安装交接身份、持久阶段、真机证明；D3 release 注册/校验不替代。**不重复** |
| [#171](https://github.com/raydocs/tono/issues/171) | 双端 hot-switch 收敛；[#174](https://github.com/raydocs/tono/pull/174) 已合代码，原生证据另论。**与三条 WIP 无关，不据此关闭** |
| [#181](https://github.com/raydocs/tono/issues/181) | journal scratch writer；[#184](https://github.com/raydocs/tono/pull/184) 已合代码，不是 D3 feed。**与三条 WIP 无关，不据此关闭** |
| [#182](https://github.com/raydocs/tono/issues/182) | Today partial readiness；可能与 D5 Digest 改动碰文件，**不重复实现、不用已有 picks 功能宣布解决** |
| [#183](https://github.com/raydocs/tono/issues/183) | Mac 18 个旧像素失败；D3 历史截图与其 Clients 区域重叠，**继续由像素验收任务处理** |
| [#186](https://github.com/raydocs/tono/pull/186) | Clients/Settings/Ledger/Today 视觉整合、Ledger readiness；D1 提示残留未覆盖，**先协调 #191，别覆盖该 PR** |
| [#187](https://github.com/raydocs/tono/pull/187) | receipts/SLO/客户分页/节点身份/开户与日志加固；共享 ledger copy/fixture/页面、followups fixture、合同与 `index.ts`，**不是 D3/D5 尚未实现的证明**。已有 [#188](https://github.com/raydocs/tono/issues/188) 跟踪 Batch 8 冻结和 0072 冲突，不另开重复 blocker |

## 处置清单与交付边界

- **建议将旧任务记为完成**：D1 后端快照/CSV/fixture 冲正、D3 R2 校验及后台门控、D5 生成与呈现；引用 #140 和上表实现 SHA。不是关闭本表任何 GitHub Issue 的授权。
- **建议吸收**：#191 的 D1 当前月锁定/冲正话术及 refusal 处理意图；在 #186 owner 允许的窗口完成，重新处理 UTC 边界并保留 readiness 修复。
- **建议保留待决**：D3 DB→公开 feed 方案、D1 fixture 冻结场景、针对现行 D5 规则的窄预算/边界检查。它们不等于可直接 cherry-pick 的合格实现。
- **建议废弃重放**：公共 D4 提交、旧 0068/0069 迁移、旧 D2 空对账 fixture、旧 D5 权重/窗口/导航、旧截图全量覆盖。这里“废弃”指不采用旧补丁，不删除远端分支或证据。
- **冲突风险**：三条 WIP 都落后于整合历史；D1 与 #186/#187 同改 Ledger/copy/fixture，D3 与 #186 Clients 和 #187 `index.ts` 重叠，D5 与 #182/视觉线程共用 Digest。合同、fixture、迁移必须以 main 和正在审查的 PR 为基准。
- 本次只提交对账报告及计划入口指针，创建 #191 记录明确独立残留；没有修改业务代码、更新源、数据库、PR 状态或远端旧分支，没有部署、自动合并或设备验收。
