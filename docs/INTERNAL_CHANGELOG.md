# Tono 内部更新记录

这份总账回答「内部这次更新了什么、修了什么、验证到哪里、哪个包包含它」。
它是变更入口，不取代 [SHIP_PLAN](SHIP_PLAN.md)、[运维计划](ops/plan-2026-09-11.md)
或各项原始验收记录。源码修复、合入 main、生成候选、实机通过、客户发布是不同状态。

## 维护规则（所有者要求，2026-09-23）

- 每次内部代码、配置、构建/测试工具或发布验收状态的有效交付，在同一个 PR 更新本页。
  新一轮记录放在旧记录前面；同一轮后续结果加带日期的续记，不覆盖原来的失败或未知。
- 分开写 **缺陷修复**、**新增/优化**、**工程与测试修正**。同一根因的续修、移植、测试和
  cherry-pick 不重复算新 bug；编译失败、fixture 错误不冒充客户运行时故障。
- 写清准确源码、分支/PR、归属门或 ops 任务；通过、失败、跳过、未执行和沿用证据分开。
  命令、主机、实际 CI checkout 与日志链接可引用已有详细报告，不复制多套验收事实。
- 内部包必须记版本、源码、标签/下载入口、包摘要、签名状态及包含/不包含的后续修复。
  没有新包就明确「仅源码，无新候选」；同版本号不表示相同字节。
- 纯咨询、只读审查无新成果、无行为影响的排版/拼写改动不制造空条目。文档整理不重跑
  产品测试，不改写旧证据为新 SHA 的测试结果，不记密钥、账号或原始诊断数据。
- 更新记录不是 merge、签名、部署、设备操作或推进客户更新源的授权。

### 后续条目模板

```text
## YYYY-MM-DD · 内部更新名称
- 归属：G1/G2/G3/G4 或已有 ops 任务；影响平台/模块。
- 来源：基线 → 实现源码 SHA（链接）；分支、PR；是否已合 main。
- 缺陷修复：原失败场景 → 改后行为；关联 Issue/回归或详细记录。
- 新增/优化：新增能力、保留行为与自行选择的边界；没有则写无。
- 工程与测试：编译/fixture/CI 修正，与产品缺陷分开。
- 验证：准确源码/checkout、主机、命令、决定性输出或证据链接；列未执行/沿用项。
- 候选/发布：无新包，或标签、包源码、下载入口、SHA-256、签名及发布状态。
- 剩余限制：尚未解决的问题/Issue、实机或外部依赖；不能声称什么。
```

## 2026-09-24 · 控制面列车 #570 审查续修：设备出口身份只等本次下发的节点

- **归属/来源**：G1–G3 控制面（#323 退役共享凭据的续修）；`services/control-plane`。来源：列车 PR #570 审查发现
  TC-anthropic-1（P1）与 TC-anthropic-2（P2），均经 Opus 与 Codex 核实；分支 `fix/cp-a-20260924`，基于 8fc72696；未合 main。
- **缺陷修复**：
  - TC-anthropic-1：`exitClientUUID` 要求**所有** active 的 `exit_nodes` 行都 ACK 过设备凭据。新建或重新启用的节点
    `last_roster_at = 0`，于是只要有一个已登记、尚未上架的节点，所有共享凭据已退役（0077）的账户的全部设备都拿到
    503 `EXIT_IDENTITY_PROPAGATING`。改后：`publicManagedCatalog` 先做家宽与 hy2 过滤，再从**本次下发**的目录取节点名
    （` · hy2` 折回基名），只要求这些节点满足「有 active 的 `exit_nodes` 行且 `last_roster_at` 严格晚于凭据」。
    目录名与 `exit_nodes.name` 的对应沿用 fleet/上架已有的按名匹配。下发了但未 ACK 的节点仍然挡住；未上架的节点不参与；
    退役账户仍不回落共享凭据；下发目录里没有任何就绪节点时照旧 fail-closed。下发了但**没有 `exit_nodes` 行**的节点按
    未就绪处理：它没有令牌，无法 ACK，没有任何证据表明它装上了设备凭据。
- **新增/优化**：无。
- **工程与测试**：
  - 新增 `it`（`holds a retired account only on exit nodes its catalog serves`）：退役账户，目录内节点已 ACK，另有一个
    未上架、`last_roster_at = 0` 的 active 节点，返回 200 并含设备 UUID；把该节点上架后返回 503。未改源码时先跑红：
    `expected 503 to be 200`（第一次取目录）。
  - TC-anthropic-2：#323 的用例删光出口后只断言响应里没有旧 UUID，503 也能过。现断言 503 `EXIT_IDENTITY_PROPAGATING`，
    再登记 `Tono-Exit` 并以晚于凭据一秒的 `observedAt` ACK，断言 200 且含幸存设备的 UUID。
  - fixture 修正：夹具出口名是 `Test exit-*`，与目录名对不上。`same-second`、`retires shared legacy …`（两组时钟偏移）、
    `serves an exit identity roster …` 三个用例把 `exit-default` 改名为目录里的节点名；`retires shared legacy …` 原来
    断言「未上架的 `Late Exit` 挡住目录」，这正是本次修掉的行为，改为先把它上架再断言 503。
- **验证**：MacBook 本机 worktree `services/control-plane`：`npx vitest run test/worker.test.ts` 188 个用例通过（基线 187）；
  `npx vitest run` 43 个文件 913 个用例通过；`npm run typecheck` 通过；`git diff --check` 通过。未部署，未碰远端 D1，无原生构建。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：
  - 部署前需只读核对：目录里每个节点基名都有 active 的 `exit_nodes` 行且已 ACK。审查指出生产现有未登记的托管节点；
    部署后，被下发该节点的退役账户会一直 503，直到节点登记并 ACK；dual 阶段未退役账户会改拿共享凭据（同 revision、
    不同 digest，涉及 H3-F1/#316 的客户端处理）。本机无法查 D1，未核对。
  - `device_only` 切换的预检与触发器仍看全部 active 出口，不看目录，未改。
  - 先过滤再发身份带来两处顺序变化：家宽路由错误（503 `CATALOG_UNAVAILABLE`）先于身份错误返回；过滤后没有任何节点的
    目录不再签发身份。
- **续修（2026-09-24，二轮审查 Grok A1 / Codex A-F1，同分支）**：
  - 缺陷修复（A1，P1，Opus 跨厂商核实成立）：上一版把已绑定用户自己的 catalog 家宽块（及其 ` · hy2` 孪生）也算进就绪集合；
    家宽是 `home_exits` 行，没有任何代码把它和 `exit_nodes` 的 ACK 关联，于是该用户永远不就绪：退役账户一直 503，dual 未退役
    账户改拿共享 UUID（同 revision、不同 digest）。8fc72696 上同一场景下发设备 UUID。改后：就绪集合排除家宽过滤器使用的同一组名字
    （`home_exit_catalog_names`，即 `homeRoutingForUser().restricted`，按原名与 hy2 基名两种方式匹配）；出口节点仍按严格规则
    （已登记、active、ACK 严格晚于凭据）。只剩家宽、没有出口节点的目录按零覆盖规则 fail-closed，因为家宽没有另一条 ACK 路径。
  - 缺陷修复（A-F1，P3）：只含 hy2 块、尾部注释带占位符的模板，对不收 hy2 的客户端过滤成空列表后，文件级 `includes` 仍触发签发。
    改为按过滤后的 proxies 列表判断：列表为空不签发（注释里的占位符原样保留）。
  - 测试：新增两个 `it`：`serves the device identity to a bound catalog-home user once the served exit nodes ack`（断言设备 UUID）
    与 `issues no exit identity when the served catalog filters down to no proxies`（退役账户 200、`proxies: []`）。
    修复前在 8ea01b3f 上分别红（YAML 含共享 UUID 而非设备 UUID；`expected 503 to be 200`），修复后绿。
  - 验证：MacBook 本机 worktree：`npx vitest run test/worker.test.ts test/ops-api.test.ts` 230 通过；`npx vitest run` 43 个文件
    915 通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
  - 剩余限制：家宽节点自身是否装上设备凭据仍不在门控内（与 8fc72696 前相同）；非 `filterHomeExits` 的带 userId 调用不排除家宽
    （当前没有这种调用方）。
- **续修（2026-09-24，三轮审查 A-R2-F1，P2，Grok 与 Codex 各自发现、Codex 内存复现，同分支）**：
  - 缺陷修复：`home_exits.proxy_name` 与 `exit_nodes.name` 分属两表、没有跨表唯一约束，发布也不拒重名块。上一版按家宽名排除
    就绪集合时，与出口节点同名的家宽（`Collision`、`Collision · hy2`，或历史上的 `X · hy2` 家宽）会把该出口一并豁免：
    出口缺行、disabled 或 ACK 为 0 时门控照样放行。改后：在同一条 `json_each` 就绪查询里，家宽块只有在原名与 hy2 基名都
    **没有任何** `exit_nodes` 行（不论状态）时才排除；有同名出口行的一律按出口严格规则判定，仍是一次读。
  - 有意保留（非缺陷）：dual 阶段未退役账户、下发目录只剩家宽时拿共享 UUID，是文档中的 dual 回落；退役账户与 `device_only` 仍 503。
  - 测试：`test/worker.test.ts` 新增一个 `it`（`keeps an unacked exit node in readiness when a bound catalog home shares its name`：
    退役账户，`Tono-Exit` 已 ACK，另登记 `Collision` 出口 ACK 为 0，并绑定同名 catalog 家宽）断言 503 `EXIT_IDENTITY_PROPAGATING`。
    修复前在 b6c0a817 上红（`expected 200 to be 503`，即下发了设备 UUID），修复后绿。
  - 验证：MacBook 本机 worktree：`npx vitest run test/worker.test.ts test/ops-api.test.ts` 231 通过；`npx vitest run` 43 个文件
    916 通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
  - 剩余限制：未加跨表重名拒绝（建家宽时拒与出口同名、登记出口时拒与家宽同名），门控已不依赖它。
  - 四轮（Codex 核实 a62703fe：B FIXED，A PARTIAL，A-R3-F1 P2）：出口行本身名为 `X · hy2`、只下发基名块 `X` 的同名家宽
    仍被豁免（上一条「fail-closed」的说法不成立）。现在家宽排除条件也比对「家宽名 + ` · hy2`」；命中即纳入就绪集合，
    按基名连接查不到出口行则记为未就绪。测试：在同一个 `it` 里把 `Collision` 出口改名为 `Collision · hy2` 再断言 503，
    修复前红（`expected 200 to be 503`）。验证：两个文件 231 通过、全量与 typecheck 见提交。

## 2026-09-24 · 控制面列车 #570 审查续修：开户轮换预检、家宽名 hy2 后缀

- **归属/来源**：控制面 ops 家宽线路（ops 任务，非客户 ship 门）；`services/control-plane`。来源：列车 PR #570
  审查发现 TC-OpenAI-1 / TC-Grok-1（均 P3，已跨厂商核实）；分支 `train/cp-20260924`，基于 26ba2b07 的一个续修提交；未合 main。
- **缺陷修复**：
  - TC-OpenAI-1：ops `POST users/onboard` 给已注册用户绑定一条待轮换的 socks5 家宽（`socks5_rotation_required_at` 已置）时，
    预检只看 `home_exits.status`；`signup_allowlist` 与 users 的 notes/contact/wechat 先写入，随后
    `upsertHomeBinding` 才抛 409 `SOCKS5_ROTATION_REQUIRED`，且没有审计行。改后：`homeExitId` 路径在第一条写入前调用
    `assertHomeExitBindable`；`line` 路径在贴入密码与库存密码相同（即不会触发轮换）时同样先调用它。两条路径都在写入前
    返回 409 `SOCKS5_ROTATION_REQUIRED`，不留部分写入。
  - TC-Grok-1：catalog 类家宽的 proxyName 可以以 ` · hy2` 结尾；未在 hy2 灰度内的客户端会被剥掉该块，而
    `routing.homeProxy` 仍指向它，客户端拒收整份目录。改后：shared-admin `home-exits` 创建与 PATCH、ops v1
    `home-lines` 创建，对 catalog 类且名字以 `HY2_NAME_SUFFIX` 结尾的一律 400 `VALIDATION_ERROR`。hy2 剥离逻辑不变，
    不为绑定名开例外。生产目前没有此类行（已查）。
- **新增/优化**：无。
- **工程与测试**：`test/ops-api.test.ts` 一个 `it`（onboard 两条路径均 409，notes 不变、allowlist 无行）；
  `test/worker.test.ts` 一个 `it`（创建、PATCH、v1 home-lines 创建均 400）。两者在未改源码上先跑红（`expected 'after' to be 'before'`、
  `expected 201 to be 400`），修复后绿。fixture 修正：既有用例 `keeps a retired home exit and its hy2 twin out of other accounts' catalogs`
  用 `Home Residential B · hy2` 建 catalog 家宽，正是现在被拒的输入，改为 `Home Residential B`（仍断言其 hy2 孪生块不下发给他人）。
- **验证**：MacBook 本机 worktree `services/control-plane`：两个改动测试文件 227 个用例通过；`npx vitest run` 43 个文件
  912 个用例通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：`line` 路径贴入新密码时由 `home-exits/assign` 完成轮换，预检不拦；socks5 类名字不受后缀限制（未改）。
  已有的 hy2 后缀 catalog 行（若将来出现）在 PATCH 任意字段时会被拒，需先改名。
- **续记（2026-09-24，复核 8fc72696：两条均 PARTIAL，P2）**：分支 `fix/cp-b-20260924`，基于 8fc72696；未合 main。
  - 缺陷修复：
    - TC-OpenAI-1：预检通过后，若同一用户被并发解绑（0080 触发器给该 socks5 家宽置轮换标记），onboard 仍先写
      `signup_allowlist` 与 notes/contact/wechat，`upsertHomeBinding` 复查后才 409，且没有 `user.onboard` 审计；
      解绑落在复查与绑定 INSERT 之间时由触发器中止，已提交的资料写入同样不回滚。改后：已注册用户的绑定
      （`homeExitId` 路径的 `upsertHomeBinding`、`line` 路径的 `home-exits/assign`）移到 allowlist 与资料写入之前；
      绑定被拒时这两项都未写入，绑定成功仍由 `home.assign` 审计。
    - TC-Grok-1：库里已有的 hy2 后缀 catalog 行仍可经 onboard `homeExitId` 与 `PUT users/{id}/home-binding`
      （按 id 或按名）绑定。改后：共享检查 `assertHomeExitBindable` 对该行套用同一 `assertCatalogHomeProxyName`，
      所有绑定路径返回 400 `VALIDATION_ERROR`（onboard 在任何写入前）。
  - 新增/优化：无。
  - 工程与测试：`test/ops-api.test.ts` 一个 `it`（包装 D1，在第一次可绑定检查返回后删除该用户绑定，模拟并发解绑；
    断言 409 `SOCKS5_ROTATION_REQUIRED`、notes 不变、allowlist 无行），测试辅助 `ops()` 加可选 env 参数；
    `test/worker.test.ts` 一个 `it`（直接插入已存的 `Home Stored · hy2` catalog 行，PUT 按 id、按名与 onboard 均 400，
    无绑定）。未改源码时先跑红（`expected 'after' to be 'before'`、`expected 201 to be 400`），修复后绿。
  - 验证：MacBook 本机 worktree `services/control-plane`：两个改动测试文件 229 个用例通过（ops-api 41、worker 188）；
    `npx vitest run` 43 个文件 914 个用例通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
  - 候选/发布：无新包，仅源码。
  - 剩余限制：绑定与 allowlist/资料写入仍是分开的语句，不是一个 D1 batch；绑定成功后若其后的账户分配 409，
    allowlist/资料已写而没有 `user.onboard` 行（改前即如此）。触发器在复查与 INSERT 之间中止时不映射为 409
    `SOCKS5_ROTATION_REQUIRED`（此时无其他写入）。已绑定到 hy2 后缀 catalog 行的用户，重存同一绑定也被拒，需先改名。
- **续修（2026-09-24，二轮审查 Codex B-F1，P2，8fc72696 前即存在）**：同分支。
  - 缺陷修复：用户已有绑定时，`upsertHomeBinding` 读到 `created_at` 后执行 `UPDATE user_home_bindings`；并发解绑落在两者之间时
    UPDATE 影响 0 行，旧代码不看 `meta.changes` 照常返回，onboard 随后写 allowlist、notes/contact/wechat 和 `home.assign`
    审计，返回 202 且 `binding: null`。改后：0 行时按「解绑先发生」处理：再跑 `assertHomeExitBindable`（socks5 家宽已被
    0080 触发器置轮换标记，返回 409 `SOCKS5_ROTATION_REQUIRED`，其后不再写任何东西）；复查通过（catalog 家宽）则走与
    读不到旧行时相同的 INSERT。修在共享函数里，`home-exits/assign` 同样受益。
  - 测试：`test/ops-api.test.ts` 新增一个 `it`（包装 D1，在读 `created_at` 之后删除绑定）；断言 409 `SOCKS5_ROTATION_REQUIRED`、
    notes 不变、allowlist 无行、无 `home.assign` 审计。修复前在 00190396 上红（`expected 202 to be 409`），修复后绿。
  - 验证：MacBook 本机 worktree：`npx vitest run test/worker.test.ts test/ops-api.test.ts` 230 通过；`npx vitest run` 43 个文件
    915 通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
  - 剩余限制：shared-admin `PUT users/{id}/home-binding` 有自己的一份读后 UPDATE，未改；同一窗口下 0 行后仍会 bump revision、
    写 `home.replace` 审计，再因读回的绑定为空而出错（按代码阅读，未测）。catalog 家宽在该窗口会被重新绑定（与解绑先发生的顺序一致）。
- **续修（2026-09-24，二轮审查 B-F1-PUT，P2，Codex 复现，同分支）**：
  - 缺陷修复：上条剩余限制所述的 `PUT users/{id}/home-binding` 已复现：读后 UPDATE 影响 0 行时读回 null，仍 bump revision、写
    `home.replace` 审计，随后 `publicHomeBinding(null)` 抛错，返回 500。改后：该路由不再自带读后 UPDATE/INSERT，改调已修好的
    `upsertHomeBinding`（其首行即 `assertHomeExitBindable`，故去掉路由里重复的一次调用），按返回的 `created` 决定 201/200 与
    `home.assign`/`home.replace`。并发解绑时 socks5 家宽在 bump revision 与审计之前返回 409 `SOCKS5_ROTATION_REQUIRED`，与 onboard 一致。
  - 测试：`test/ops-api.test.ts` 新增一个 `it`（`PUT users/{id}/home-binding refuses before revision and audit when an unbind lands before its update`，
    同样包装 D1 在读 `created_at` 后删除绑定）断言 409 `SOCKS5_ROTATION_REQUIRED`、目录 revision 不变、无 `home.*` 审计。
    修复前在 7ad62239 上红（`expected 500 to be 409`），修复后绿。
  - 验证：MacBook 本机 worktree：`npx vitest run test/worker.test.ts test/ops-api.test.ts` 231 通过；`npx vitest run` 43 个文件
    916 通过；`npm run typecheck` 通过。未部署，未碰远端 D1，无原生构建。
  - 剩余限制：绑定写入与其后的读回、revision、审计仍是分开的语句；绑定成功后若再有并发解绑，读回仍可能为空（窗口更小，未改）。

## 2026-09-24 · 控制面合并列车 train/cp-20260924

- **归属/来源**：G1–G3 控制面修复与 ops 任务的合并（各 PR 的条目见下方）；基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支 `train/cp-20260924`。按 PR 正文标记与
  `prreview-r3-control-plane.md` 顺序依次 `--no-ff` 合入 23 个 PR：#349 #369 #395 → #394 #400 #402 #441 →
  #406 #399 #381 → #451 → #404 #450 #447 → #326 #419 → #329 → #470 #486 #474 → #493 #495 → #323。
  #375 未合：exit-agent 记录顺序是 #389→#375→#384→#464，#389 在 fleet 组。
- **缺陷修复**：无新增修复。
- **新增/优化**：无。
- **工程与测试**：只做了已有记录的合并解法。#447 的 `retention.ts` 日志保留步骤改为调用 #450 的
  `sweepDiagnosticsLogs`，这样孤儿 pending 清理不会丢。#406/#419、#486/#474 的相邻 `it` 都保留，并补回 `});`。
  `publicTrafficPolicy` 先剥离内嵌 revision，再用 `admitStoredUnsignedEndpoints = true` 校验（#474 × #470/#486）。
  `relistFleetNode` 保留 #451 的 `assertExitIdentityActive` 与 #493 的 `const block`；#451 的上架测试条目补上
  Reality 字段。迁移号 0077–0082、0088、0090 各不相同，没有重编号。
- **验证**：本机 `services/control-plane`：`npx vitest run` 43 个文件 910 个用例通过，`npm run typecheck`、
  `check:budgets`、`check:contract` 通过；`test-policy-signing-contract.sh` 5/5 通过；
  `macos-candidate-workflow.test.rb` 通过；`git diff --check` 通过。未做原生构建，未部署，未碰远端 D1。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：部署前的只读检查见列车 PR 正文：#323、#326、#419、#470、#486、#493、#495；另有 0077/0078
  需在一次性远端 D1 上试跑、#329 必须先迁移，`TRAFFIC_POLICY_EMBED_REVISION` 保持关闭。
## 2026-09-24 · exit-agent `rmu` 改为位置参数 email（Xray 26）

- **归属**：ops 出口节点吊销与计量；`services/exit-agent/reconcile_and_report.py`。
- **来源**：`train/fleet-20260924`（PR #563）上的续修提交；未合 main。
- **缺陷修复**：Xray 26.3.27 的 `xray api rmu` 只接受 `-tag=<tag> <email>...`，旧代码传 `--email=` 每轮报
  `flag provided but not defined: -email`，agent 拒绝本轮，吊销不执行、计量停止（179.253.233.220 自 2026-09-18 05:00 起）。
  两处删除（shared-legacy 与逐标签）改走同一 helper `remove_inbound_user`，生成
  `api <cmd> --server=<addr> -tag=<tag> <email>`；`removeuser` 用同一形式。
  续修：Xray 26 `rmu` 删除失败也返回 0，旧判定（rc≠0 且无「not found」才算失败）会把 inbound tag 错误
  （`handler not found`、`Removed 0 user(s)`）当作已删并 ACK roster。现由 `removal_succeeded` 判定：输出含
  `User <该 email> not found` 算已删；否则须 rc=0 且 `Removed N user(s)` 中 N≥1；其余一律计入 failures、阻止 ACK。
  续修 2（Codex 核实 b3299814 为 PARTIAL）：判定改为整行匹配（v26.3.27 `inbound_user_remove.go` / `inbound_user_add.go`
  的原样输出），回显的 email 或 tag 不能再冒充总数行或逐用户行；出现 `failed to get handler` / `handler not found`
  时不认逐用户 not-found。同类既有缺陷：`adu` 在 RPC 错误后同样 rc=0 并打印 `Added 0 user(s) in total.`，旧代码记为新增、
  写入清单并可 ACK roster；现须整行 `Added N user(s) in total.`（N≥1），或该 email 的整行
  `proxy/vless: User <email> already exists.`（视为已在）。旧 `adduser`/`adi` 路径（Xray 26 不可达）保留原判定。
  续修 3（Codex 核实 42653897 为 PARTIAL）：含换行或其他不可打印字符的 email 回显后可拆出独立的整行成功文本，
  现在此类 email 的 `rmu`/`adu` 一律判为失败（不 ACK、不从清单删除）。旧 `removeuser` 恢复原判定
  （rc=0 或 stderr 含 not found 即已删），不再套用 Xray 26 的输出规则。
  续修 4（Codex 核实 163cb823：RR2 FIXED，RR1 PARTIAL）：不可打印 email 不再交给 subprocess（NUL 字节曾抛
  `ValueError` 并跳过其后所有删除），直接记为失败；`TONO_XRAY_INBOUND_TAG` 只允许字母、数字、`.`、`_`、`-`，
  否则本轮拒绝（tag 回显同样可伪造整行成功文本）。
  续修 5（Codex 核实 26dc5647：tag 与 NUL 已修，legacy 残留）：拒绝结果的 stderr 不再包含 email，否则旧
  `adduser`/`adi` 的「already exists」判定会把 `u:a\x00already exists` 读成已在并 ACK。
  续修 6（Codex 核实 4e3d6887：rmu/adu 已修，legacy 残留）：旧 `removeuser`/`adduser`/`adi` 不再在整段输出里找
  「not found」/「already exists」子串，只认一整行 `…User <该 email> not found.` / `already exists.`；否则按退出码。
  回显的 email 不能构成点名其自身的整行。舰队全部为 Xray 26.3.27，legacy 分支不可达，此项仅为防御。
- **新增/优化**：无。
- **工程与测试**：回归 `test_rmu_success_is_read_from_its_output_not_its_exit_code` 用节点实测的三段 rc=0 输出
  （用户不存在→已删，错误 tag→失败，`Removed 1`→已删），并断言 rmu argv 恰为
  `api rmu --server=<addr> -tag=<tag> <email>`、不含 `--email`（取代先前单独的 argv 测试）；另含两例回显伪造（均须失败），以及续修 3 的换行 email 伪造（rmu/adu 均须失败，在 42653897 上失败）和 `removeuser` rc=0 判已删；续修 4 的 NUL email 不进 Xray 且后续删除照常、换行 tag 被拒（在 163cb823 上失败）。
  新增 1 个 adu 回归：`Added 0` + RPC 错误 → 失败、reconcile 拒绝，不返回清单。fixture 修正：原有测试中按
  `--email=` 解析 rmu 参数的 mock/断言改为位置参数；成功删除的 rmu mock 由空输出改为打印 `Removed 1 user(s) in total.`；成功添加的 adu mock 改为打印
  `Added 1 user(s) in total.`，「已存在」mock 由 rc=1 `User already exists.` 改为 Xray 26 实际的 rc=0 逐用户行。
- **验证**：MacBook 工作树 `cd services/exit-agent && python3 -m pytest -q`：91 passed, 7 subtests passed（续修 3 后）。
  rmu 输出样本来自 179.253.233.220（Xray 26.3.27）实测；adu 的 RPC 错误与 already-exists 行按 v26.3.27 源码
  （`proxy/vless/validator.go`）构造，未在节点实测；修复本身未在节点上运行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：节点部署待做；`DeadlineExceeded` 等其余错误输出按失败处理，未逐一实测。旧 `adduser`/`adi` 分支仍用 `--email=`/`--uuid=`，Xray 26 提供 `adu` 时不会走到。

## 2026-09-24 · fleet 合并列车（exit-agent #389→#375→#384→#464，ops-panel #466→#368→#373→#367→#377）

- **归属**：ops 控制面 / 出口节点吊销与计量、hub 运维任务；`services/exit-agent`、`ops-panel`，#375 附带控制面 migration 0081。
- **来源**：origin/main 8dc79a5b → 分支 `train/fleet-20260924`，按记录顺序 `--no-ff` 合入 9 个 PR；各 PR 的缺陷与测试见下方各自条目。
- **缺陷修复**：无新增；只有合并时的组合处理（按 r4 审查记录 `r4-fleet-merge.log` 与 #464 PR 正文）：
  - `run_once` 经 `fetch_roster_or_discard_cache` 取 roster；#375 的 `except NodeDisabled` 在 #464 的 `except Exception` 之前，并先 `discard_roster_cache`，删除失败写进最终 Refusal，撤回照常执行。
  - #375 停用分支自行容错加载 state（#389 已把 state 加载移到吊销之后），state 不可用时仍撤回，只是不写回清单。
  - #384 的 `retire_override`（bool|None）替换旧字符串比较，也传给 #464 的 `run_outage_round`；#384 早期 `rmu shared-legacy` 失败改为计入 #389 的 failures，不再中断其余删除。
  - #384 的静态配置持久化挪到 reconcile 之后、state/source/待发报告检查之前（#389「吊销先于计量检查」），失败仍按 #384 延到计量后才拒绝；#464 的 `cache_error` 放在它之后。
  - `run_outage_round` 容错加载 state，先按缓存恢复客户端，再在 state 不可用时拒绝（与 #389 可达路径一致；#464 正文建议「state 不可用则不恢复」，此处按 r4 记录）。
  - ops-panel `collect.py`：#368 的 `ssh_password_argv` 与 #373 的 `public_ip`/`probe_target` 取并集；`tests/test_collect.py` 两个测试类都保留。#373 条目中两行仅含空格的行去掉尾随空白。
- **新增/优化**：无。
- **工程与测试**：无新测试；各 PR 自带测试全部保留。
- **验证**：MacBook 列车工作树 `python3 services/exit-agent/test_reconcile_and_report.py`（89 通过）；`python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`（29 通过）；home-agent 与 exit metering 配置脚本测试通过；`services/control-plane` `npm run typecheck` 通过、`npx vitest run` 892 通过。未连接真实节点、hub 或探针，未部署。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：部署前置——#368 需先在 hub 登记节点与探针 known_hosts；#377 需为自定 unit 的节点在 hub `nodes.secrets.json` 填 `serviceName`，并与 #466 同时或之后部署（hub 上 `jobs.py` 与 `collect.py` 一起更新）；#384 需先在真实 Xray 25.3.6/26.x 确认 vless `clients: []` 能通过 `run -test`。`state.json.roster` 为明文凭据。#375 与控制面 #451 的 `revokeExitToken` SQL 相邻，后合者手工保留两边。

## 2026-09-24 · H16/H17 审查轮与仓库清理记录

- **归属/来源**：G1–G3 审查与修复的可追溯性（工程流程与记录，非产品行为）；审查基线 main
  [bb2ed4e4](https://github.com/raydocs/tono/commit/bb2ed4e4)，本分支 `docs/records-20260924` 基于 origin/main
  [059a2ea2](https://github.com/raydocs/tono/commit/059a2ea2)。
- **缺陷修复**：无。
- **新增/优化**：[FINDINGS_LEDGER](FINDINGS_LEDGER.md) 登记 H16（界面真实性）与 H17（账户生命周期）的 15 条发现，
  均为 `open`；另 5 条由各自修复 PR 登记（#513、#515、#516、#518、#520）。H7-F7 剩余限制补上到期/超额不标记轮换；
  更新 ID 规则（H1–H19、席位后缀）与状态快照。新增
  [2026-09-24 审查轮记录](reports/REVIEW_ROUNDS_2026-09-24.md)：jev-route 决定、席位、交叉厂商核实矩阵
  （0 驳回、1 降级）、I1–I6 / A1–A6 覆盖摘要、未覆盖范围、修复进度，以及仓库清理（已删远端分支及其 tip SHA 可据此恢复）。
- **工程与测试**：无代码、配置或测试改动。
- **验证**：文档变更，未运行产品测试；`git diff --check` 通过；总账表格行列数用 awk 校验与表头一致；
  开放 PR 编号按 2026-09-24 `gh pr list` 实查。
- **候选/发布**：无新包，仅文档。
- **剩余限制**：H16/H17 条目全部是源码推导或阅读确认，回归草案均未运行；需实机的部分列在审查轮记录第 3 节。

## 2026-09-23 · 控制面：设备吊销同时退役账户共享 legacy exit 凭据

- **归属/来源**：控制面凭据生命周期（ops/控制面安全修复，非客户 ship 门）；影响
  `services/control-plane`。基线 main
  [244075f2](https://github.com/raydocs/tono/commit/244075f28794652c5f562e67b72fde0e4d7c3184)，
  分支 `fix/legacy-revoke-20260923`，Issue [#313](https://github.com/raydocs/tono/issues/313)；未合 main、未部署。
- **缺陷修复**：dual rollout 阶段，设备首次拉目录时逐设备凭据尚未被全部节点 ack，会回落到账户共享的
  `exit_credentials` UUID；吊销（DELETE、ops 动作、LRU 轮换、pending 过期）只删 `device_exit_credentials`，
  只要账户还有别的活设备，共享 UUID 就一直在全部节点 roster 上，被吊销设备照样能连。改后：新迁移
  `0077` 在任一设备从 pending/active 转为 revoked 时，在同一事务内永久退役该账户 legacy 凭据
  （`retired_at`），推进目录 revision，并给其余活设备排 `refresh_catalog`；roster 的 legacy UNION 排除已退役行；
  `exitClientUUID` 对已退役账户不再回落（设备侧等待自己的凭据就绪，未就绪返回 503
  `EXIT_IDENTITY_PROPAGATING`；无设备的 legacy 签发返回 409 `DEVICE_IDENTITY_REQUIRED`）。
  是退役而不是轮换：exit-agent 以 `u:<userId>` 标签管理 legacy client，同标签换 UUID 不会替换 Xray 已装的旧 UUID。
  审查后修正：（1）ops `POST users/onboard` 对已退役账户不再预签发 legacy（此前返回 409
  `DEVICE_IDENTITY_REQUIRED`，而 `signup_allowlist` 已写入，属部分写）；预签发移到第一条写入之前，
  失败不留部分写入，已退役账户按逐设备凭据正常完成开户（`exitIdentityIssued=true`）。
  （2）0077 一次性回填上线前的吊销：凡已有 revoked 设备、legacy 仍未退役的账户立即退役（`WHERE retired_at IS NULL`，幂等）。
  范围包含"已无活设备"的账户：roster 只在账户有设备且全部不活时隐藏 legacy，新设备一登录它就回来。
  （3）触发器改为每个一条语句、单行（远端 D1 迁移解析不了多行触发器体，见 0015/0021）：设备吊销只退役凭据，
  revision +1 与 `refresh_catalog` 挂在 `exit_credentials.retired_at` 由 NULL 变非 NULL 上，回填也会触发。
- **新增/优化**：无。
- **工程与测试**：`test/worker.test.ts` 一个 `it`
  （removes the shared legacy credential from the exit roster once any device of the account is revoked）；
  在旧代码上先跑红（roster 仍含被吊销设备拿到的 UUID），修复后绿。审查后同一 `it` 追加：吊销后
  ops onboard 该账户返回 202 且 `exitIdentityIssued=true`；在上一版源码上红（`expected 409 to be 202`）。
  回填没有 vitest 覆盖（测试库从空库迁移）：本机用 sqlite3 在 0001–0076 上造数据后应用 0077 手工核对：
  有 revoked 设备的账户被退役、纯活设备账户不动，revision 每账户 +1、存活设备排到 refresh，重跑回填不变。
- **验证**：MacBook 本机 worktree，`npx vitest run test/worker.test.ts -t …` 先红后绿；
  `npx vitest run`（control-plane 全部 43 文件 892 用例）通过；`npm run typecheck`、`check:budgets` 通过。CI 结果见 PR。
  远端 D1 未试跑（不碰远端）。
- **候选/发布**：无新包，仅源码；需要 D1 迁移 0077 + Worker 部署，均未执行。
- **剩余限制**：exit-agent 无需改动（现有 reconcile 会删除从 roster 消失的 `u:<userId>`，hy2 allowlist 按摘要重写）；
  部署顺序为先应用 0077 迁移、再部署 Worker。已退役账户的设备在每个 active 节点 ack 其逐设备凭据前拿到 503
  `EXIT_IDENTITY_PROPAGATING`；只要有一个 active 但不再拉 roster 的节点，这些设备会一直 503（以前被 legacy 回落掩盖）。
  LRU、到期、pending 过期都会触发退役，加上回填，dual 阶段的 legacy 回落会很快对大多数账户失效；
  每个账户首次退役推进一次全局 revision，部署后头几天运营预览/ drain 的 `CATALOG_CONFLICT` 会比平时多（自愈）。
  切断在节点下一次 roster 轮询后生效。生产 `exit_credential_rollout.phase` 未在本机确认；`device_only` 阶段 onboard
  对已注册用户仍 409（main 上既有行为，本 PR 未改，但现在不留部分写入）。

## 2026-09-23 · 控制面：hy2 条目只下发给声明支持 hy2 的客户端

- **归属**：hy2 灰度（SHIP_PLAN hy2 备用传输）；控制面 `services/control-plane`。只在设置了 `HY2_CATALOG_EMAILS` 时影响客户。
- **来源**：内部审查 H15-F8，Issue #494；分支 `fix/hy2-capability-gate-20260923`，基线 origin/main bb2ed4e4。提交时未合 main。无 migration。
- **缺陷修复**：`publicManagedCatalog` 的判断是「请求带 `X-Tono-Accept: hy2` **或** 邮箱在 `HY2_CATALOG_EMAILS` 里」。名单内账户用 0.0.72（不发该请求头）拉目录也会收到 ` · hy2` 块，而 0.0.72 两端遇到 `type: hysteria2` 就拒收整份目录。改后：必须请求头声明 hy2；名单设置时只在声明了 hy2 的客户端里再收窄，名单本身不再放行未声明的客户端。名单未设置时，带请求头的客户端照旧收到 hy2。
- **新增/优化**：无。
- **工程与测试**：改写原有的一个 Worker `it`（`test/worker.test.ts`，改名为 `serves hy2 catalog blocks only to clients that declare hy2, narrowed by the gray list`）。原用例把「名单内、无请求头也给 hy2」当作期望（正是本缺陷），现改为断言不给；「名单已设、未在名单、带请求头」改为不给；另加一条断言：名单未设、带请求头时给。`wrangler.jsonc` 注释同步新语义。
- **验证**：MacBook 本机 worktree：改写后的 `it` 在旧 `catalog.ts` 上失败（名单内无请求头的账户收到 ` · hy2`），修复后通过。`npx vitest run`（control-plane 全量）43 个文件、891 个测试通过；`npx tsc --noEmit` 通过。未部署，未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：生产是否设置了 `HY2_CATALOG_EMAILS`、生产目录是否已有 hy2 块，均未核实，需 owner 只读检查。名单已设时，未在名单里的 0.0.73 客户端不再收到 hy2（此前收到），这是有意的收窄。部署后若名单内账户的服务端 YAML 变化，按 `wrangler.jsonc` 注释需要 bump catalog revision。`docs/SHIP_PLAN.md` 第 5 条对名单语义的描述未在本 PR 修改。

## 2026-09-23 · 重新上架：不再发布缺 Reality 设置的目录条目

- **归属**：ops 任务（节点下架/上架流程）；控制面 `services/control-plane`。不属客户发布门，但影响所有客户端的目录更新。
- **来源**：内部审查 H15-F7，Issue #492；分支 `fix/relist-complete-entry-20260923`，基线 origin/main bb2ed4e4。提交时未合 main。无 migration。
- **缺陷修复**：控制台发起的 `catalog_relist` 任务不带条目（任务参数表为空），`relistFleetNode` 用 profile 的 IP 拼一个兜底条目，缺 `servername`、`reality-opts`、`flow`，照样发布并提升 revision；macOS 与 Windows 客户端都因一条不合格而拒收整份目录。改后：(1) 目录里没有该节点、也没有提供条目时，返回 422 `RELIST_NO_TEMPLATE`，不再猜测条目；(2) 提供的 VLESS 条目先按两端客户端的必需字段检查（`tls: true`、`servername`/`sni`、`reality-opts.public-key` 43 位 base64url、`reality-opts.short-id` 偶数位 hex ≤16，`flow`/`network` 有值时须为 `xtls-rprx-vision`/`tcp`），不完整返回 422 `CATALOG_ENTRY_INCOMPLETE` 并列出缺的字段。节点已在目录中时行为不变。
- **新增/优化**：无。
- **工程与测试**：一个 Worker `it`（`test/ops-jobs.test.ts` `relist refuses to publish an entry without the Reality settings clients require`）。fixture 修正：同文件 retire→drain→relist 用例原先靠兜底条目上架（正是本缺陷路径），改为直接用带 Reality 设置的完整条目调用 `relistFleetNode`。
- **验证**：MacBook 本机 worktree：新 `it` 在旧代码上失败（任务状态 `succeeded`，期望 `failed`）；修复后通过。`npx vitest run`（control-plane 全量）43 个文件、892 个测试通过；`npx tsc --noEmit` 通过。未部署，未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：下架不保存原条目，控制台上架已下架节点现在会被明确拒绝，需用目录发布工具重新发布完整条目（保存原条目是后续工作）。PUT `exit-catalog` 与下架路径仍只校验结构、名字和身份占位符，未套用 Reality 字段检查（发布工具生成完整条目；全量套用需改约 24 个测试 fixture）。生产 D1 是否已有兜底模板生成的条目未核实，需 owner 只读检查。

## 2026-09-23 · Worker/发布工具把策略 revision 写进被签名 json（H3-F5 服务端，默认关闭）

- **归属/来源**：G1 签名信任边界；影响控制面 `src/ops/shared-admin/traffic-policy.ts`、
  `src/traffic-policy.ts`、`src/env.ts`、共享编辑器解析 `admin/src/lib/traffic-policy.ts`，离线签名工具
  `tooling/scripts/publish-traffic-policy.mjs` 与 `test-policy-signing-contract.sh`。基线 main bb2ed4e4，
  分支 `fix/worker-policy-revision-20260923`；Issue #317；依赖客户端 #342、#472、#473 先发布普及；
  提交时未合 main。
- **缺陷修复**：策略 revision 在签名外，被重放的签名策略可任意声明 revision。新增开关
  `TRAFFIC_POLICY_EMBED_REVISION`（仅 `'true'` 生效，未在 wrangler.jsonc 设置即关闭）：开启后
  PUT 把即将分配的 revision（`expectedRevision + 1`）写入 canonical json，签名必须覆盖它，覆盖旧
  字节的签名以 `TRAFFIC_POLICY_SIGNATURE_INVALID` 拒绝；dry run 用传入的 `expectedRevision`（未传则
  用当前行 revision）绑定。读取路径不论开关：json 内若带 revision 必须等于行 revision，否则 503，
  校验前剥离该键。签名上下文与 D1 列不变，无 migration。
- **新增/优化**：发布工具在 dry run 前读取当前 revision 并随 dry run 与发布使用同一个
  `expectedRevision`，并在 dry run 绑定了 revision 时核对其为 `expectedRevision + 1`；共享编辑器
  解析忽略服务端 json 中的 `revision` 键（开启后编辑器仍能载入当前策略）。
- **工程与测试**：新增 Worker 回归 `binds the assigned revision inside the signed policy json once
  enabled`；签名契约脚本增加第 5 项：Worker 以 `revision` 键写入并在读取路径校验，且当 wrangler.jsonc
  开启该开关时要求 macOS、Windows `policy.rs` 与 `sing_box.rs` 源码均绑定该键。
- **验证**：本机新 `it` 在旧代码上失败（dry run json 无 revision：`expected undefined to be 1`），
  修复后通过；`npx vitest run` 全量 43 文件 892 用例通过；`npm run typecheck` 通过；ops-console
  `tsc --noEmit` 与 `vitest run src/lib/settings-publish` 通过；`test-policy-signing-contract.sh` 5/5，
  并临时开启开关确认在 macOS 未绑定时失败（已还原）；`node --check` 发布工具。未部署。
- **候选/发布**：无新包，仅源码；未部署 Worker，开关未开启。
- **剩余限制**：开启顺序：先合并并发布客户端（#342、#472、#473），待其普及后再在 wrangler.jsonc 开启
  开关并部署；契约检查只证明源码已绑定，不证明已普及。与 #470 在 `publicTrafficPolicy` 同一行
  有文本冲突，后合者需保留两处改动（剥离 revision 后以 `admitStoredUnsignedMedia = true` 调用）。

## 2026-09-23 · Worker 拒绝未签名策略中的 TCP 端点（H3-F6 后续）

- **归属/来源**：G1 保护不放宽（只有签名能扩大绕行面）；影响控制面
  `services/control-plane/src/traffic-policy.ts`。叠在 #470 分支
  `fix/worker-unsigned-media-20260923`（943395bd）上，分支 `fix/worker-unsigned-tcp-20260923`；
  Issue #485；提交时未合 main。
- **缺陷修复**：`canonicalTrafficPolicy` 对 `tcpEndpoints` 不看 `trusted`，未签名发布可把任意
  公网 IPv4:80/443 写入并下发。客户端已安全：macOS 未签名 TCP 地址白名单为空、全部丢弃；
  Windows tono-core 不读取 `tcpEndpoints`。改后与 #470 的 media 规则一致：未签名写入含 TCP 端点
  即 400 `VALIDATION_ERROR`，dry run 返回 `signatureRequired: true`；签名写入不变；读取路径对
  已存的未签名行继续放行（参数由 `admitStoredUnsignedMedia` 改名为
  `admitStoredUnsignedEndpoints`）。
- **新增/优化**：无。
- **工程与测试**：新增回归 `requires a signature before a TCP endpoint can leave the tunnel`；
  无既有测试需修正。
- **验证**：本机 `npx vitest run test/worker.test.ts -t "requires a signature before a TCP endpoint"`
  在旧代码上失败（未签名 PUT 返回 200，期望 400），修复后通过；`npx vitest run` 全量 43 文件 893
  用例通过；`tsc --noEmit` 通过。未部署。
- **候选/发布**：无新包，仅源码；未部署 Worker。
- **剩余限制**：须在 #470 之后合并；部署前需确认生产当前策略若含 `tcpEndpoints` 则为签名版本，
  否则下一次未签名发布会被拒（读取不受影响）；ops-console 未签名发布含 TCP 端点的策略会收到 400。

## 2026-09-23 · Worker 拒绝未签名策略中的 media 端点（H3-F6 Worker 侧）

- **归属/来源**：G1 保护不放宽（只有签名能扩大绕行面）；影响控制面
  `services/control-plane/src/traffic-policy.ts`。基线 main bb2ed4e4，分支
  `fix/worker-unsigned-media-20260923`；Issue #318（Windows 客户端侧为 #340）；提交时未合 main。
- **缺陷修复**：`canonicalTrafficPolicy` 对 `mediaEndpoints` 不看 `trusted`，未签名发布可把任意公网
  IPv4:443/8000 写入策略；macOS 未签名 media 白名单为空会丢弃，旧 Windows 会放行。改后：未签名
  写入（PUT）含 media 端点即 400 `VALIDATION_ERROR`（在全部逐项校验之后判断，畸形条目仍按原错误
  报告），dry run 相应返回 `signatureRequired: true`；签名写入不变。读取路径
  （`publicTrafficPolicy`）对本规则之前已存的未签名 media 行继续放行，避免全网策略拉取 503，
  客户端自行丢弃这些条目。
- **新增/优化**：无。
- **工程与测试**：新增回归 `requires a signature before a media endpoint can leave the tunnel`。
  测试契约修正：`validates, encrypts, versions, and serves the managed traffic policy`、
  `admits public IPv4 in the rest of 192.0.0.0/16 …`、`accepts the Feishu family …` 原以未签名
  方式发布含 media 的策略，改为先 dry run 再以测试密钥签名发布；无效条目循环保持未签名（逐项
  错误先于签名要求触发，断言仍有意义）。
- **验证**：本机 `npx vitest run test/worker.test.ts -t "requires a signature before a media endpoint"`
  在旧代码上失败（未签名 PUT 返回 200，期望 400），修复后通过；`npx vitest run` 全量 43 文件 892
  用例通过；`tsc --noEmit` 通过。未部署。
- **候选/发布**：无新包，仅源码；未部署 Worker。
- **剩余限制**：部署前需确认生产当前策略若含 media 端点则为签名版本，否则下一次未签名发布会被
  拒（读取不受影响）；`tcpEndpoints` 同样不看 `trusted`（macOS 未签名 TCP 白名单也为空），未在本
  PR 处理；ops-console 未签名发布含 media 的策略会收到 400。

## 2026-09-23 · 控制面 refresh 轮换的丢响应宽限（#314）

- **归属/来源**：G1 保护不因网络故障释放（hunt H3-F4）；影响控制面 Worker
  `/api/v1/auth/refresh` 与 D1 `sessions`。基线 main
  [244075f2](https://github.com/raydocs/tono/commit/244075f2)，分支
  `fix/refresh-replay-grace-20260923`，Issue #314；未合 main、未部署。
- **缺陷修复**：服务端已轮换 refresh、但响应丢失（大陆链路超时；客户端对超时的 POST
  不重试），客户端下次用旧 token 得到 401，两端都把它当成会话死亡，于是登出并释放
  PF/WFP。现在轮换会记录 `rotated_at` / `successor_id`。10 分钟内重放刚轮换的
  token 可以恢复一次：仅当后继仍有效、且自身从未轮换时，服务端替客户端再轮换一次后继，
  整条链仍只保留一个有效 session。窗口外、第二次重放、后继已被使用/登出/吊销时，
  仍返回 401。吊销旧 session 与插入后继放进同一个 D1 batch，后继 INSERT 以抢到吊销为条件，
  消除原来「旧 session 已吊销、后继插入失败」的部分提交。
- **新增/优化**：`tokens()` 与 refresh 逻辑移到 `src/sessions.ts`（`index.ts` 行数上限 4014，
  当前 3957）。新 migration `0079_session_rotation_successor.sql`。
- **工程与测试**：新增一个 Worker `it`
  （`honours one replay of a just-rotated refresh token whose response was lost`）。
  删除 lifecycle 用例中「立即重放必须 401」这一条断言：它把无宽限写成了契约，
  重放语义现在由新 `it` 覆盖。属于测试契约修正。
- **客户端**：核实后不改。两端都明确设计为只有权威的账户丢失（401）才释放
  （macOS `AccountSession+Telemetry.swift` "only auth sign-out disarms"；Windows
  `REPORT.md` restore-401 走 `release_explicit()`），网络错误保留保护。缺陷在于服务端
  产生了假 401。
- **验证**：本机（MacBook，worktree）新 `it` 在旧代码上失败（重放返回 401，期望 200），
  修复后通过；`services/control-plane` 下 `npx vitest run` 43 个文件、892 个用例全部通过；
  `npm run typecheck`、`check:contract`、`check:budgets` 通过。未对远端 D1 执行 migration，未部署。
- **候选/发布**：仅源码，无新候选。部署顺序：先对 D1 执行 0079 migration，再部署 Worker；
  否则 refresh 会因缺列失败。
- **剩余限制**：Windows 在异步写 Credential Manager 之前被终止、且超过 10 分钟后才启动，
  这种情况仍是真 401，需要客户端持久化改动，记录在 #314。宽限期内，持有已轮换旧 token
  的第三方可以顶掉尚未轮换的后继（合法客户端随后得到 401），这种暴露只限 10 分钟内一次。

## 2026-09-23 · 目录节点名只接受控制面与客户端解码一致的写法（H10-F1）

- **归属**：ops 控制面安全修复（住宅 home exit 只下发给绑定用户），非客户 ship gate；`services/control-plane`。
- **来源**：基线 main `be1c75d2` → 分支 `fix/catalog-name-plain-20260923`；Issue #418，内部审查
  H10-F1；提交时未合 main。与在审 #326 改同一过滤函数的相邻行，建议 #326 先合，本 PR 随后 rebase。
- **缺陷修复**：
  - **原问题**：按账户过滤 home exit 时，Worker 用行正则 `catalogProxyName` 读节点名；客户端用
    YAML 解析器。写入校验不要求两者一致，名字用转义、块标量、行尾注释、续行或与 `proxyName`
    不同的 Unicode 规范化形式写出时，过滤读到的名字不在限制名单里，已绑定的住宅节点块会下发
    给所有账户。
  - **修复**：Worker 没有 YAML 依赖，改为写入时 fail-closed。`PUT exit-catalog` 只接受名字是列表项
    第一个键、单行纯文本（plain 或无转义的引号）、无注释/锚点/标签/块标量、不续行、NFC、块内只有
    一个 `name` 键的条目（`catalogProxyPlainName` 读出的名字必须与 `catalogProxyName` 相同）。
    home exit 的 `proxyName` 写入时规范化为 NFC，与目录名的精确比较一致。
- **新增/优化**：无。
- **工程与测试**：`test/worker.test.ts` 新增一个 `it`：内部审查报告中的反例（转义、`\u` 转义、
  注释内 `{name: …}`、块标量、NFD）各 PUT 一次均 400，纯文本写法发布后未绑定账户拿不到该节点。
  旧代码上实际跑红（第一个反例 PUT 返回 200），修复后绿。
- **验证**：MacBook worktree `npx vitest run test/worker.test.ts -t "YAML parser would read differently"`
  红→绿；control-plane 全量 vitest 43 文件 892 项通过；`tsc --noEmit` 无错误。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；Worker 部署需 owner 执行。
- **剩余限制**：只在写入时校验，生产 D1 中现存目录不会被重新校验（无生产 D1 访问，未确认其写法；
  现有发布工具输出 plain 名字），建议部署后重新发布一次目录。未要求 home exit 登记时 `proxyName`
  必须出现在当前目录中。macOS 行解析器与 Windows 的其他差异（丢弃不完整条目等）不在本条。

## 2026-09-23 · 控制面：停用/退役的家宽出口及其 hy2 孪生节点不再对全员可见

- **归属/来源**：ops 控制面安全修复（H4-F2，[#322](https://github.com/raydocs/tono/issues/322)）；
  影响 `services/control-plane`（目录下发 + D1）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/home-exit-visibility-20260923`；提交时未合 main。
- **缺陷修复**：按用户过滤目录时，限制名单只收 `status='active' AND kind='catalog'`
  的家宽出口名（0035 触发器）。停用、退役（含 `assign replace:true` 自动退役旧出口）、
  删除或改名后，名字掉出名单，但运营发布的 YAML 仍含该块，于是这个私有住宅节点下发给
  所有账户，并替换成各自的 UUID。另外 `<名> · hy2` 孪生块按精确名匹配，从未被限制。
  改后行为：新增 migration `0078_home_exit_name_history.sql`，只追加不删除，记录所有曾属于
  catalog 型家宽出口的名字，不论当前状态；限制名单改为取这份历史。
  `filterCatalogYamlForUser` 按基名匹配，hy2 孪生块随本体一起限制或放行。只有当前绑定
  且 active 的家宽出口会对其绑定用户放行（沿用原逻辑）。
  审查后修正：（1）上一版先去 ` · hy2` 后缀再查名单，而名单里的名字本身没去后缀，家宽本体名就以
  ` · hy2` 结尾时会对其他账户可见（main 上是隐藏的）。现在先按原名精确匹配，只有原名不在名单里时才去后缀找本体名。
  （2）0078 的多语句触发器改为每个一条语句、单行（远端 D1 迁移解析不了多行触发器体，见 0015/0021）：
  `home_exits` 上的触发器只记录名字，发布集合由历史表的 INSERT/DELETE 触发器重建，
  因此运营有意删除历史行也会立即生效（上一版要等下一次 home_exits 写入）。
- **新增/优化**：无。
- **工程与测试**：一个 Worker `it`：
  `keeps a retired home exit and its hy2 twin out of other accounts' catalogs`
  （`test/worker.test.ts`）。在旧代码上有两处失败：hy2 孪生块在出口 active 时已对他人可见；
  注释掉该断言后，退役后本体对他人可见。0078 的触发器不用 `OR IGNORE`，因为外层 UPSERT
  的冲突策略会覆盖它（preview seed 的 `ON CONFLICT DO UPDATE` 会因此失败）。
  审查后同一 `it` 追加一个本体名为 `Home Residential B · hy2` 的家宽，断言其他账户看不到；
  在上一版源码上红（other 的目录含该名），修复后绿。触发器改写另用 sqlite3 在 0001–0078 上手工核对：
  新建、改名、socks5→catalog、删除家宽、手工删历史行后发布集合都符合预期。
- **验证**：MacBook 本机、worktree 基于 576d7087：`npx vitest run test/worker.test.ts -t "retired home exit"`
  修复前红、修复后绿；`npx vitest run`（control-plane 全量）43 个文件、892 个测试全部通过。
  审查后修正同样在本机：单测先红后绿，全量 43 文件 892 用例通过，`npm run typecheck` 通过；CI 结果见 PR。
  没有跑 D1 remote，也没有部署；单行触发器形式未在远端 D1 试跑。
- **候选/发布**：仅源码，无新候选；Worker 未部署，0078 未应用到生产 D1。
- **剩余限制**：roster 仍不按节点隔离（`/api/v1/home/exit-identities` 对每个节点下发全员身份），
  所以已解绑用户如果还记得节点参数，仍能连到住宅节点，留作后续。曾用作家宽出口的名字若改给
  共享节点，会对所有人隐藏（fail-closed），需要运营改名，或有意删除历史行。目录 PUT 不校验
  与家宽名冲突。

## 2026-09-23 · 控制面 cron：强制扫描有上限，每个清理步骤独立 try

- **归属/来源**：ops 平台 cron 健康（`/system/pulse` 的 `cronAgeSec` 依赖 cron 跑完）；
  控制面 Worker。内部审查 H13-F7，Issue #445。基线 main bb2ed4e4 → 分支
  `fix/enforce-cron-bound-20260923`；提交时未合 main。
- **缺陷修复**：`enforceAll` 每 5 分钟选出所有曾失去资格的用户（无 LIMIT），对每人执行
  `enforceUser`（3 次查询），早已强制过的用户也不例外；用户从不删除，集合只增不减。其后的
  保留期语句不在 try 里，一旦单次调用超过 D1 查询上限（约 330 个不合格用户），后续保留期、
  `snapshotUserUsageHours`、`runOpsCron` 全部不再运行。现在：
  - 只选仍持有 active/pending 设备或未吊销会话的不合格用户，每 tick 最多 25 人，其余下一
    tick 处理。新 migration `0090_sessions_user_live_index.sql` 为该查询加
    `sessions(user_id, revoked_at)` 索引。
  - 强制扫描、stale pending 扫描和每条保留期语句都包进独立的 `cronStep`（记录错误后继续）。
    为满足 `index.ts` 只减不增的行数限制，保留期语句原样移到新文件 `src/retention.ts`，
    语句与顺序不变。
- **新增/优化**：无。
- **工程与测试**：`test/worker.test.ts` 新增一个 `it`：先有 5 个已强制过的禁用用户，
  再加 40 个，cron 的 prepare 次数必须不变；随后一个刚被禁用、仍有设备的用户在下一 tick
  被吊销。旧代码失败为 `expected 205 to be 85`（多出 40 × 3，本机先红后绿）。已有用例
  「processes durable revocations before retention housekeeping can fail」原先断言 cron 在
  保留期失败时整体 reject；改为断言不再 reject，且失败步骤之后的会话保留期仍然执行（测试
  契约随行为修正）。
- **验证**：MacBook worktree：control-plane 全量 vitest 43 文件 892 测试通过，
  `tsc --noEmit`、`check:contract`、`check:budgets` 通过。migration 只在 vitest 本地 D1
  应用过。CI 结果以 PR 页为准。未部署。
- **候选/发布**：无新包，仅源码（Worker）。部署时先对 D1 应用 0090 再部署 Worker；
  未应用时查询仍可运行，只是会话查找没有索引。
- **剩余限制**：若有 25 个以上用户的 `enforceUser` 每次都失败，它们会一直占满每 tick 的
  名额；日志里会有逐人错误。D1 单次调用查询上限的实际值未在本账户核对。`runOpsCron`
  内部各步骤的预算不在本条范围。

## 2026-09-23 · 原始网络日志：索引没写成的 R2 对象也会被清理

- **归属**：ops 任务（诊断日志保留期）；控制面 `services/control-plane`。不属客户发布门。
- **来源**：内部审查 H14-F1，Issue #448；分支 `fix/raw-log-orphans-20260923`，基线 origin/main
  bb2ed4e4。提交时未合 main。新增 migration `0088_diagnostics_log_pending_objects.sql`
  （0077–0082 被在审 PR 占用，本轮按分配从 0088 起编号）。
- **缺陷修复**：上传先写 R2、后写 `diagnostics_log_objects` 索引，保留期清理只按索引删。
  索引插入失败或请求在两步之间被取消时，对象永远不会被删除（该桶存放未脱敏主机名，承诺
  保留 14 天）。改后：上传在写 R2 前，用同一条语句完成重放检查并把 key 记入
  `diagnostics_log_pending_objects`；索引行插入时由触发器清掉这条记录；定时清理把两天前仍未
  清掉、且没有索引行指向的 key 从 R2 删除，再删记录（R2 删除失败时保留记录，下一轮重试）。
  两天的界限来自 key 里的 UTC 日期：届时不会再有上传写同一个 key。跨 UTC 日的并发同序号
  上传，输家的对象也按同一路径清理。
- **新增/优化**：原索引保留期清理从 `src/index.ts` 原样移到 `sweepDiagnosticsLogs`
  （`src/telemetry/routes.ts`），与孤儿清理放在一起；行为不变。
- **工程与测试**：一个 Worker `it`（`test/worker.test.ts`
  `deletes a raw log object whose index row was never written`）：临时触发器让索引插入失败，
  上传得 503，时钟前推 3 天跑一次 `scheduled`，断言该用户前缀下没有 R2 对象。
- **验证**：MacBook 本机 worktree：该 `it` 在旧代码上失败（R2 仍有 1 个对象），修复后通过；
  `npx vitest run`（control-plane 全量）43 个文件、892 个测试通过；`npm run typecheck`、
  `npm run check:budgets` 通过；上传路径的 prepare 数仍为 10（`ingest-budgets` 上限未改）。
  未部署，未对 remote D1 执行 migration。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：migration 未部署前不生效；部署前已经孤立的对象没有记录，本改动删不到，
  建议 owner 在 Cloudflare 控制台给 `tono-diagnostics-logs` 的 `logs/` 前缀设 lifecycle
  规则（如 15 天）兜底（本 PR 未改任何远端配置）。清理每 5 分钟最多处理 50 条记录。

## 2026-09-23 · 客户活动小时每个窗口只计一次；无字节时月结客户标为待核对（H8-F4）

- **归属**：ops 任务（运维计划 §1.3 D1 月结汇总 / 客户 360 投影），非客户 ship gate；
  `services/control-plane`，D1 migration `0082`。
- **来源**：基线 main `18301fc5` → 分支 `fix/activity-hours-dedupe-20260923`；Issue #403，内部审查 H8-F4；
  提交时未合 main。
- **缺陷修复**：
  - **原问题 1**：`accrueActivityHours` 用 `+=` 累加，上传钩子和 cron `projectBacklog` 对同一个
    telemetry window 各执行一次，在线/连接分钟和窗口数翻倍（20 分钟变 40）。
  - **修复 1**：新表 `customer_activity_windows`（0082）按 window id 记标记；标记的
    `INSERT OR IGNORE` 与各小时 upsert 放在同一个 D1 batch，upsert 只在本次调用抢到标记时生效，
    哪一路先到就由哪一路计一次。cron 保留 35 天标记（长于 telemetry_windows 默认 30 天）。
    原来的分批 helper 已无调用方，一并删除。
  - **原问题 2**：`bytes_up/bytes_down` 恒为 0，月结不分摊 server/home_line 成本，客户行却按
    「无用量」给出确定毛利并在关账时冻结。
  - **修复 2**：`loadMonthSummary` 对「在某节点有连接分钟但无字节记录」的客户标 `pending: true`、
    `marginCnyMinor: null`（控制台已有待核对展示）。真实字节需要节点侧或客户端合同变更，
    本次不补写，留在 #403。
- **新增/优化**：无。`docs/ops/api-contract.md` 的 `GET months/{month}` 行补充缺测含义。
- **工程与测试**：`test/ops-ingest-hooks.test.ts` 新增一个 `it`（上传窗口 → 跑 `projectBacklog` → 分钟
  不变且该客户 `pending`）。旧代码上实际跑红（`expected 40 to be 20`），修复后绿。
- **验证**：MacBook worktree focused vitest（ingest-hooks / customers / ledger / cron 4 文件 51 项）、
  control-plane 全量 vitest 43 文件 892 项通过、`tsc --noEmit` 无错误。migration 只在 vitest 本地
  D1 上应用过，未在 preview/生产 D1 演练。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；上线需 owner 先应用 0082 再部署 Worker。
- **剩余限制**：
  - 成本仍无法按字节分摊，活跃客户在月结中会显示为待核对，直到有真实字节来源。
  - 生产中已翻倍的分钟不会回写；已关账月的冻结客户行不变。
  - 客户 360 的字节列仍显示 0。

## 2026-09-23 · 重新上架：出口令牌已吊销的节点不再能上架

- **归属**：ops 任务（节点下架/上架流程）；控制面 `services/control-plane`。不属客户发布门。
- **来源**：内部审查 H14-F2，Issue #449；分支 `fix/relist-revoked-exit-20260923`，基线
  origin/main bb2ed4e4。提交时未合 main。无 migration。与在审 #375 在 `revokeExitToken`
  的同一条 UPDATE 上文本相邻，后合并者需保留双方改动（#375 的 `revoked_token_hash` 赋值与
  本 PR 的目录 revision 条件）。
- **缺陷修复**：没有在线客户的节点下架时立即吊销出口令牌并置 `exit_nodes` 为 disabled，
  重新上架只恢复目录与 profile，节点回到所有账户的目录里却没有有效令牌；验收单按
  `last_roster_at` 判断「出口令牌」「身份同步」，15 分钟内仍显示通过。改后：
  (1) `bindingsOf` 对非 active 的出口节点不再认最近一次 roster，两项判为不通过；
  (2) 上架在入队（`relistGate`，不可 override）和执行（`relistFleetNode` 前置检查，并在目录
  CAS 写里加同一条件）两处拒绝，返回 409 `EXIT_TOKEN_REVOKED`，提示先启用出口节点、重新签发
  令牌并部署；(3) `finishDrainedRetires` 先读目录 revision，吊销 UPDATE 以该 revision 为条件，
  两次 cron 重叠时不会撤销期间已提交的上架。
- **新增/优化**：无。
- **工程与测试**：一个 Worker `it`（`test/ops-node-acceptance.test.ts` `a node whose exit token
  retirement revoked cannot be relisted, and a stale drain cannot revoke a relisted one`）。
  fixture 修正：`test/ops-jobs.test.ts` 的 retire→drain→relist 用例原先直接上架已吊销节点
  （正是本缺陷路径），改为上架前先把出口节点恢复为 active，对应运营的恢复步骤。
- **验证**：MacBook 本机 worktree：新 `it` 在旧代码上失败（验收阻塞项只有
  `binding.catalog`）；分别只回退吊销条件或上架拒绝时，也在对应断言处失败；修复后通过。
  `npx vitest run`（control-plane 全量）43 个文件、892 个测试通过；`npm run typecheck`、
  `npm run check:budgets` 通过。未部署，未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：恢复仍需三步手工操作（PATCH `exit-nodes/{id}` 为 active、POST
  `exit-nodes/{id}/token`、把新令牌部署到节点），上架流程只给出提示，不自动签发。
  下架路径本身（非 drain）的即时吊销没有加 revision 条件；上架侧的写条件覆盖了它与上架的交错。

## 2026-09-23 · 住宅 SOCKS5 凭据在持有人失去绑定后标记待轮换（H7-F7）

- **归属**：ops 任务（家宽线路 / 控制面）；`services/control-plane`，D1 migration `0080`。
- **来源**：基线 main → 分支 `fix/home-socks5-rotation-20260923`；Issue #379；关联 PR，提交时未合 main；内部审查 H7-F7（源码推导）。
- **缺陷修复**：socks5 型 home exit 的上游用户名/密码明文随绑定用户的目录下发。解绑、改绑、销户或停用用户只改绑定，不记录凭据已外发；同一凭据还能直接绑给下一个用户。前持有人设备上的缓存凭据对上游仍然有效。现在：`home_exits.socks5_rotation_required_at` 由触发器在绑定删除、绑定换到其他出口、绑定用户离开 `active` 时写入；给未持有该线路的用户绑定被标记的出口返回 `409 SOCKS5_ROTATION_REQUIRED`（API 检查加触发器兜底）；存入不同的上游密码（PATCH 或粘贴带新密码的线路）或改成非 socks5 才清除标记。前持有人的目录在解绑后已不再携带凭据（回归中断言）。
- **新增/优化**：home exit 列表返回 `socks5RotationRequired`。上游密码仍需运维在供应商侧手工修改。
- **工程与测试**：新增一个 Worker `it`（`refuses to hand an unbound user's socks5 credential to another user until it is rotated`）；旧代码上第二个用户绑定返回 201，断言 409 失败。审查后：0080 的五个触发器各改为单行（每个本就只有一条语句；仓库在 0015/0021 注明远端 D1 迁移解析不了多行触发器体），语义不变——本机用 sqlite3 分别应用新旧 0080，`sqlite_master` 里的触发器 SQL 去空白后逐字相同；全量 43 文件 892 用例、`npm run typecheck` 通过，CI 见 PR。单行形式未在远端 D1 试跑。
- **验证**：MacBook 本机（worktree，node_modules symlink 到主仓库）`npx vitest run test/worker.test.ts -t "until it is rotated"`：旧代码红（201≠409），修复后绿；`npx vitest run` 全量 43 文件 892 项通过；`npm run typecheck`、`check:budgets` 通过。未部署，未执行 `d1 --remote`，migration 未在生产 D1 应用。
- **候选/发布**：无新包，仅源码；Worker 部署和 migration 应用另行授权。
- **剩余限制**：不能自动轮换上游密码（外部住宅网关，home-agent 不接触）；推荐在上游限制来源 IP 为出口节点。未覆盖：无状态变化的权益到期、用户仍 active 时吊销单台设备。ops console 暂不显示该标记。

## 2026-09-23 · ops v1 home-lines 写入口沿用 shared-admin 的家宽出口约束

- **归属**：ops 任务（`docs/ops/plan-2026-09-11.md` 4.2 审查残留：开户/家宽写路径的前置校验）；
  控制面 `services/control-plane`，控制台家宽线路页。不属客户发布门。
- **来源**：内部审查 H8-F3，Issue #397；分支 `fix/home-lines-guard-20260923`，基线 origin/main
  18301fc5。提交时未合 main。与在审 #326（0078 名字历史）、#381（0080 SOCKS5 轮换）改同一资源，
  但不改它们触及的行；本 PR 不加 migration。
- **缺陷修复**：控制台「退掉这条线路」走 v1 `DELETE home-lines/{id}`，原先直接置 `retired`：
  不查绑定、不推进目录 revision，被绑客户的 `GET /exit-catalog` 整份 503 直到手动改绑；
  v1 `PATCH` 可写任意 status（非法值 500）且不推进 revision；v1 `POST` 不校验 proxyName、
  不推进 revision（其他账户下发的 YAML 变了而 revision 不变）；开户 `homeExitId` 不查出口
  是否 active。改后：新共享函数 `assertHomeExitUnbound`（`src/home.ts`）被 shared-admin
  DELETE、shared-admin PATCH→retired、v1 DELETE、v1 PATCH→retired 共用，仍有绑定时一律
  `409 HOME_EXIT_IN_USE`（不自动解绑，由运营显式解绑）；v1 退役与 status 变化、v1 新建都
  `bumpCatalogRevision`；v1 status 走白名单（400）；v1 新建用 `proxyNameField`，重名 409
  `HOME_EXIT_CONFLICT`；开户 `homeExitId` 指向非 active 出口时在任何写之前 409
  `HOME_EXIT_INACTIVE`。
- **新增/优化**：无。
- **工程与测试**：一个 Worker `it`（`test/ops-api.test.ts`
  `home-lines create and retire move the catalog revision and refuse a bound line`）。
- **验证**：MacBook 本机 worktree：该 `it` 在旧代码上失败（v1 新建后 revision 仍为 5，期望 6），
  修复后通过；`npx vitest run`（control-plane 全量）43 个文件、892 个测试通过；
  `npm run typecheck`、`npm run check:budgets` 通过。未部署，未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：shared-admin PATCH→disabled 仍允许在绑状态下执行（有意的 fail-closed 暂停，
  被绑客户目录 503）；控制台未单独提示 409 的含义，沿用通用错误提示。

## 2026-09-23 · 家宽出口、token-admin 用户与白名单写操作补审计

- **归属**：ops 任务（`docs/ops/plan-2026-09-11.md` 5.2 角色启用：角色越权的追溯依赖完整审计，
  见 `docs/ops/api-contract.md:154-156`）；控制面 `services/control-plane`。不属客户发布门。
- **来源**：内部审查 H8-F6，Issue #405；分支 `fix/admin-write-audit-20260923`，基线 origin/main
  18301fc5。提交时未合 main。无 migration。
- **缺陷修复**：以下写操作原先不写 `ops_audit`，改后复用 `writeOpsAudit`：
  shared-admin `PATCH home-exits/{id}`（`home.update`，摘要只列字段名，不含 SOCKS5 密码）、
  `DELETE home-exits/{id}`（`home.delete`）；token-admin `PATCH /api/v1/admin/users/{id}`
  （`user.usage-reset`、`user.update` 列出改动字段）、`DELETE /api/v1/admin/signup-allowlist`
  （`allowlist.remove`，仅实际删除时）、`POST`/`DELETE /api/v1/admin/invitations`
  （`invitation.create` 不含邀请码、`invitation.delete` 仅实际删除时）；开户 `homeExitId`
  分支在绑定当时写 `home.assign`，后续账号指派 409 时也留痕。token-admin actor 为
  `token-admin`（映射 `token_admin`）。
- **新增/优化**：无。
- **工程与测试**：`src/index.ts` 已在行数上限（`test/index-size.txt` = 4014），按预算脚本要求把
  上述四个 token-admin 写路由原样移到 `src/ops/token-admin.ts` 再加审计；index.ts 降到 3906 行，
  上限文件未下调（避免与其他在审 PR 冲突）。一个 Worker `it`（`test/worker.test.ts`
  `audits a home exit SOCKS5 password change without recording the password`）。
- **验证**：MacBook 本机 worktree：该 `it` 在旧代码上失败（无 `home.update` 审计行），修复后通过；
  `npx vitest run`（control-plane 全量）43 个文件、892 个测试通过；`npm run typecheck`、
  `npm run check:budgets` 通过。其余审计点无单独测试（规则 5）。未部署，未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：审计写入仍为尽力而为（`writeOpsAudit` 吞错），不与业务写同一事务；
  token-admin 审计无法区分具体持 token 的人。

## 2026-09-23 · 控制面遥测、失败上报、支持报告改为按账户限流

- **归属/来源**：G2（失败进入客户时间线）与 ops 客户在线状态；控制面 Worker。内部审查
  H13-F4，Issue #440。基线 main bb2ed4e4 → 分支 `fix/telemetry-ratelimit-account-20260923`；
  提交时未合 main。
- **缺陷修复**：`/telemetry/windows`、`/telemetry/failures`、`/diagnostics/reports` 已要求
  用户令牌，但限流器另有一个按 `cf-connecting-ip` 计数的桶（遥测 30/h、失败 60/h、支持报告
  30/h）。已连接客户端访问控制面走出口节点，同一节点上的所有用户共用这个 IP 预算：超过约
  10 台开周期遥测的设备后，每小时排在后面的设备持续 429，在 ops 显示离线、失败事件丢失，
  支持报告也可能被别人的流量拒绝。现在三条路由只按账户的小时/天桶计数，与日志上传的做法
  一致；移除不再使用的 `RATE_LIMIT_{TELEMETRY,FAILURE,DIAGNOSTICS}_IP_HOUR`（env 类型、
  `wrangler.jsonc`、`worker-configuration.d.ts`、`docs/ops/ingest-limits.md`）。
- **新增/优化**：无。
- **工程与测试**：`test/ops-ingest-hooks.test.ts` 新增一个 `it`：6 个账户从同一
  `cf-connecting-ip` 各发满每小时 6 个窗口，全部应为 201。旧代码第 31 个请求返回 429
  （本机先红后绿）。
- **验证**：MacBook worktree：该 `it` 在旧代码失败；修复后 `ops-ingest-hooks`、
  `ingest-limits`、`ingest-budgets` 3 文件 19 测试通过，control-plane 全量 vitest 43 文件
  892 测试通过，`tsc --noEmit` 无错误。CI 结果以 PR 页为准。未部署。
- **候选/发布**：无新包，仅源码（Worker）。
- **剩余限制**：单个账户多台设备仍共用账户小时预算（遥测 6/h，与原来一致）。未鉴权的登录类
  路由仍按 IP 限流，不在本条范围。

## 2026-09-23 · Claude 账号指派与替换改为单个 D1 batch

- **归属**：ops 任务（`docs/ops/plan-2026-09-11.md` 4.2 审查残留：开户/指派写路径；
  其结果也是 1.6 月结对账中 assigned 账号与漏斗 `first_entitled_at` 的输入）；控制面
  `services/control-plane`。不属客户发布门。
- **来源**：内部审查 H8-F5，Issue #401；分支 `fix/product-account-assign-20260923`，基线
  origin/main 18301fc5。提交时未合 main。无 migration（沿用 0023 的 `account_ref` 唯一索引与
  每用户仅一个 assigned 的部分唯一索引）。
- **缺陷修复**：两位运营同时把同一 pooled 账号指派给两位客户，两次都 201；输家被写上
  `plan`、`first_entitled_at` 和 `assigned` 事件，名下却没有账号。替换先退旧、再单独建新，
  第二步失败时客户两头落空。改后：`createAssignedProductAccount` 把「取账号 + 事件 +
  开通标记 + 审计」放进一个 D1 batch，取账号语句带 `status='pooled'` 条件，其后每条都以
  `changes() > 0` 串联；取账号未命中返回 409 `ACCOUNT_REF_IN_USE`，不留事件、标记或审计；
  唯一索引冲突同样整批回滚（每用户已有 assigned 时为 409 `PRODUCT_ALREADY_ASSIGNED`）。
  `replaceProductAccount` 把退旧、指派新号、`replaced` 事件与审计放进同一个 batch；退旧本身
  要求目标仍可用（pooled 或尚未登记），失败时原账号保持 assigned。
- **新增/优化**：无。
- **工程与测试**：一个 Worker `it`（`test/worker.test.ts`
  `assigns a pooled Claude account to only one of two concurrent users`）。
- **验证**：MacBook 本机 worktree：该 `it` 在旧代码上失败（两个请求都 201，期望 [201, 409]），
  修复后通过；已有替换原子性/pooled 替换测试仍通过；`npx vitest run`（control-plane 全量）
  43 个文件、892 个测试通过；`npm run typecheck`、`npm run check:budgets` 通过。未部署，
  未碰 remote D1。
- **候选/发布**：仅源码，无新候选；Worker 未部署。
- **剩余限制**：替换的部分失败路径由 batch 的事务语义保证，没有单独的故障注入测试；
  指派审计现在与写入同批，`ops_audit` 不可写时整次指派失败（原先静默跳过审计）。

## 2026-09-23 · 已冲正的账目行与冲正行锁定归属（H8-F2）

- **归属**：ops 任务（运维计划 §1.3 D1 账目/月结），非客户 ship gate；`services/control-plane`。
- **来源**：基线 main `18301fc5` → 分支 `fix/ledger-reversal-lock-20260923`；Issue #398，内部审查 H8-F2；
  提交时未合 main。
- **缺陷修复**：
  - **原问题**：`PATCH ledger/{id}` 只查月份未锁，不查 `reversed_by`/`reverses`。冲正后再把
    原行或冲正行改到另一个客户，月总额仍为 0，但同一笔钱在月报里拆成一个 −、一个 +。
  - **修复**：已冲正的原行和冲正行不能改 `subjectType`/`subjectId`（409 `ALREADY_REVERSED`，
    `note`/`paidAt` 照常可改）。PATCH 的 UPDATE 加条件：所在月未关账、归属变更时行仍未冲正；
    变更 0 行按 `MONTH_CLOSED`/`ALREADY_REVERSED` 返回 409，顺带关掉「检查月份与 UPDATE 之间
    关账」的竞态。冲正行在同一 batch 里从原行当前值复制，不再用 batch 之前读到的旧值。
- **新增/优化**：无。`docs/ops/api-contract.md` 的 `PATCH ledger/{id}` 行补上新约束。
- **工程与测试**：`test/ops-ledger.test.ts` 新增一个 `it`（录入 → 冲正 → 改原行/冲正行归属均 409）。
  旧代码上实际跑红（收到 200），修复后绿。
- **验证**：MacBook worktree `npx vitest run test/ops-ledger.test.ts`（21 项通过）、control-plane
  全量 vitest 43 文件 892 项通过、`tsc --noEmit` 无错误。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；Worker 部署需 owner 执行。
- **剩余限制**：
  - 关账「先算快照、后插入关账行」之间落进的新行仍会留在已关月却不在冻结总数里，见 #398。
  - 冲正落在 UTC 当前月，控制台按本地月选月的不一致仍由 #191 跟踪（后端 UTC 为准）。
  - 生产中已被拆开的冲正对不会自动修正。

## 2026-09-23 · 账目按币种小数位折算人民币（H8-F1）

- **归属**：ops 任务（运维计划 §1.3 D1 账目/月结），非客户 ship gate；`services/control-plane`。
- **来源**：基线 main `18301fc5` → 分支 `fix/ledger-fx-decimals-20260923`；Issue #391，内部审查 H8-F1；
  提交时未合 main。
- **缺陷修复**：
  - **原问题**：`cnyMinorFrom(amountMinor, rate)` 按两位小数算，JPY（零小数）入库少乘 100：
    JPY 10000、汇率 0.0489 存成 489 分（¥4.89），控制台预览是 ¥489。成本、分摊、对账和
    月结冻结值都按 1/100 计。
  - **修复**：`fx.ts` 新增 `currencyDecimals`（JPY/KRW 为 0，其余 2，与控制台 `DECIMALS`
    一致），`cnyMinorFrom` 按币种缩放；`ledger-recon.ts` 改用同一定义，不再自带一份。
    `weekly-picks.ts` 只对 CNY/USD 调用，行为不变。
- **新增/优化**：无。
- **工程与测试**：`test/ops-ledger.test.ts` 新增一个 `it`（JPY 10000 @0.0489 → 48900）。旧代码上
  实际跑红（收到 489），修复后绿。
- **验证**：MacBook worktree `npx vitest run test/ops-ledger.test.ts`（21 项通过）、control-plane
  全量 vitest 43 文件 892 项通过、`tsc --noEmit` 无错误。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；Worker 部署需 owner 执行。
- **剩余限制**：没有生产 D1 访问，不知道是否已有 JPY 行。已入库的错误行不自动改写；未关账月
  可由运营冲正后重录，已关账月需 owner 决定。

## 2026-09-23 · macOS 签名/公证/Sparkle workflow 凭据范围（内部审查 H5-F2）

- **归属**：发布工具链加固（非客户可见行为）；`.github/workflows/macos-release.yml`。
- **来源**：基线 main `498ed426` → 分支 `fix/macos-release-secrets-20260923`；Issue #366；
  提交时未合 main。
- **缺陷修复**：注释把 `macos-appcast` 称作 “gated” 环境，但审批/分支限制取决于仓库
  环境配置，workflow 文件本身不提供 → 改为如实说明门禁位置；`build` 与
  `validate-appcast` 的 checkout 改 `persist-credentials: false`，`release/macos` 祖先
  检查的 fetch 单独接收只读 token。签名/公证/Sparkle secrets 原本已是 step 级，未改动。
- **新增/优化**：无。仓库设置不在本 PR 范围。
- **工程与测试**：`tooling/scripts/tests/macos-candidate-workflow.test.rb` 新增一段：签名
  secrets 不得出现在 workflow/job 级 env、任一 job 无写权限、所有 checkout 不持久化
  凭据。旧 workflow 上失败于 “build checkout must not persist the token in .git/config”。
- **验证**：MacBook 本机 `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb`
  全部通过（修复前新增段失败）；所有 `run:` 块 `bash -n`；本机无 actionlint，未跑。
  `build`/`validate-appcast` 只在 release 线或 release tag 上运行，PR CI 不执行，需所有者
  在下一次 macOS 发布时观察 ancestry fetch。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Developer ID 身份在打包步骤期间位于已解锁的临时钥匙串中，xcodebuild 与
  打包脚本在此期间运行，这是签名所必需的。

## 2026-09-23 · 发现总账与审查流程记录

- **归属/来源**：G1–G3 审查与修复的可追溯性（工程流程与记录，非产品行为）；基线 origin/main
  [bb2ed4e4](https://github.com/raydocs/tono/commit/bb2ed4e4)（2026-09-24 rebase），分支 `docs/findings-ledger-20260923`。
- **缺陷修复**：无。
- **新增/优化**：新增 [FINDINGS_LEDGER](FINDINGS_LEDGER.md) 作为唯一已知问题总账（首轮 W/M/S、
  审查轮 R1–R4、隐秘搜寻 H1–H15、内部复核轮 X1–X3、撤回项与已交付设计），取代每轮手工粘贴的 known-findings；
  新增 [审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md)（方法、覆盖/未覆盖、可复用约束）。
  AGENTS.md 要求审查或修 bug 前先读总账、交付时同 PR 更新条目。
- **工程与测试**：无代码、配置或测试改动。
- **验证**：文档变更，未运行产品测试；条目中的 issue/PR 编号与状态按 2026-09-24 GitHub 实查
  （已合入的写 main 合并提交 SHA）；表格列数用脚本校验一致。
- **候选/发布**：无新包，仅文档。
- **剩余限制**：总账状态是写入时快照；并行进行中的合并与修复 PR 需由各自 PR 同步更新对应行。
  `fixed` 只表示源码进 main，不表示实机验收。
## 2026-09-23 · exit-agent 在控制面不可达时从本地副本恢复 roster 并继续计量

- **归属/来源**：ops 出口计量与吊销执行；`services/exit-agent`。内部审查 H13-F5，Issue #463。
  基线 main bb2ed4e4 → 分支 `fix/exit-agent-roster-cache-20260923`；提交时未合 main。
- **缺陷修复**：agent 只记录已安装标签，不保存凭据。控制面不可达（网络错误或 5xx）期间
  Xray 一旦重启，经管理 API 加入的客户端全部丢失，节点上所有账户连不上，直到控制面恢复。
  这期间计数器也不读，恢复后第一轮只按新进程读数计，重启前的增长不计费。现在每次拉到并
  核对 nodeId 后，先把 roster 原子保存为 `state.json.roster`（0600、服务用户所有），再执行。
  拉取失败且属于不可达时，若副本不超过 24 h，就按副本重装客户端；无论副本能否使用，都继续
  把计数器折叠进持久 totals。本轮不 ACK、以非零退出，恢复后第一轮正常上报这段增长。副本
  超龄、缺失、权限不对或损坏时不恢复任何客户端，并拒绝说明原因。控制面的其他任何回答都会先
  删除副本，包括 401/403、roster 校验失败和 nodeId 不符。副本写入失败时删除旧副本；删除也
  失败时本轮在执行后拒绝，不 ACK。
  审查修正（R4）：删副本移进 `fetch_roster_or_discard_cache`，在 `run_once` 的任何 handler 之前完成；
  并预留 `node_disabled_answer`：响应（或 #375 的 `NodeDisabled` 的 cause）是 403 且 body 为
  `EXIT_NODE_DISABLED` 时先删副本，删除失败只告警、不替换原错误，撤除照常执行。这样 #375 的
  `except NodeDisabled` 放在 `except Exception` 之前也不会留下副本（否则下一次网络错误会把停用
  节点的全部客户端装回）。README 修正写反的论断：副本在执行前保存，是"不落后于"而不是"不新于"
  已执行的 roster；并写明副本是明文 VLESS 凭据（0600，应排除出快照/备份）和 24 h 回填窗口。
- **新增/优化**：无。
- **工程与测试**：`test_reconcile_and_report.py` 新增一个测试
  `test_an_outage_restores_the_last_verified_roster_and_keeps_metering`，连续跑 7 轮：成功；
  不可达；不可达加 Xray 重启（客户端重装，重启前 4,000 字节保留）；25 h 后不可达（不恢复）；
  成功（上报 5,300）；401（副本删除）；再次不可达（不恢复）。旧代码第一轮后不存在副本，
  测试失败。
  审查修正后第 6 轮由 401 改为经真实 `fetch_roster`（patch `build_opener`）得到的
  403 `EXIT_NODE_DISABLED`，断言副本已删。单独在本分支上它和修正前一样通过（任何 403 都删）；
  它守护的是与 #375 的合并：临时 worktree 里把本分支与 #375 合并、`except NodeDisabled` 放前面
  且不加 discard（朴素解法），修正前的 #464 在该断言失败（`True is not false`），修正后 84 项通过。
- **验证**：MacBook worktree：新测试在旧代码失败、修复后通过；exit-agent 全部 83 个测试
  通过（`python3 test_reconcile_and_report.py`；审查修正后复跑 83 项通过）。未连接任何真实节点或 hub，未部署。CI 结果
  以 PR 页为准。
- **候选/发布**：无新包，仅源码（exit-agent）。
- **剩余限制**：恢复要等到 Xray 重启后的下一次 timer 运行，本 PR 未给 `tono-xray` 加
  `ExecStartPost`。控制面不可达期间被吊销的账户，在副本 24 h 期限内仍会被重装，与 Xray 不
  重启时内存中保留它们的行为一致。副本是明文客户端凭据（0600）。停用节点删副本失败时副本
  仍在（只告警）。hy2 允许列表是文件，重启后仍在，不可达时不改动。与在审
  #375、#384、#389 修改同一 `run_once`，合并顺序与解决方式见 PR 正文。
## 2026-09-23 · ops hub 执行前确认租约，等待中的 job 一并续租

- **归属/来源**：ops 控制台节点作业（hub 执行器）；`ops-panel/jobs.py`。内部审查 H13-F6，
  Issue #465。基线 main bb2ed4e4 → 分支 `fix/ops-jobs-lease-20260923`；提交时未合 main。
- **缺陷修复**：hub 每次最多租 5 个 job，串行执行，只给正在执行的 job 续租，开始前也不
  确认租约。排在长任务后面的 `xray_restart`（租约 60 s）过期后会被 Worker cron 放回队列，
  hub 仍会执行它，下一轮又租到再执行一次，节点被连续重启两次。现在每个 job 开始前先发一次
  心跳确认租约，409 或不可达就跳过，不执行、不上报；不可达时本轮以非零退出。执行期间的
  心跳同时覆盖尚未开始的 job。
- **新增/优化**：无。
- **工程与测试**：`ops-panel/tests/test_jobs.py` 新增
  `test_a_leased_job_whose_lease_was_lost_before_its_turn_never_runs`：假心跳对第二个
  `xray_restart` 回 409，断言 SSH 只到第一个节点、只上报第一个结果。旧代码 SSH 到了两个
  节点（`['A', 'B'] != ['A']`）。
- **验证**：MacBook worktree：新测试在旧代码失败，修复后 `python3 -m unittest discover -s
  ops-panel/tests -p 'test_*.py'` 26 个测试通过。scratchpad 模拟脚本 `sim_jobs.py`：旧代码
  对 B 执行了 restart，新代码跳过 j2。未连接 hub 或任何节点，未部署。CI 结果以 PR 页为准。
- **候选/发布**：无新包，仅源码（ops-panel，需要在 hub 上部署后生效）。
- **剩余限制**：Worker 侧租约与 cron 未改。hub 在执行期间与控制面断开时，等待中的 job 仍
  可能过期被重新入队，本轮会在开始前发现并跳过。与在审 #377（重启目标改为
  `tono-xray.service`）不改同一段代码；#377 合并后本修复才防止真实的二次重启。

## 2026-09-23 · macOS 升级事务终态：consumed 后可达归档 + successor 合法重绑

- **归属/来源**：G3 原生升级链；macOS `tono-core-helper` 升级账本。R4-F2 与 R4-F3
  （2026-09-22 升级中断恢复审查发现，对抗核实轮 V9 确认为同一根因族：consumed 后唯一出口
  commit + 证明权绑定唯一进程 incarnation + 全部门以 pending 拒绝）。叠在 #303、#307
  （快照 quarantine + 4.7.0）与 #308（bootout 干净停止 + 4.8.0，
  `fix/macos-update-bootout-startup-20260922`）之上；本条分支
  `fix/macos-update-terminal-states-20260922`。
- **缺陷修复**：F2——执行器侧一次失败（validate/`runtime.prepare` 失败、App 30 s 未退出、
  `.replacing` 中断回滚、48 h 过期）后，事务停在 consumed+blocked / rolledBack，无任何终态：
  `reconcile` 抛错、`AppUpdater.check` 的 retryable 只认 reserved/staged、"Restore internet"
  可解除 PF 但 `gate`/`offer`/`reserve`/`--update-install-guard`/`--emergency-reset` 全部永久拒绝。
  F3——successorToken 唯一绑定首个收养 App 的 audit token，commit 前 successor 退出/崩溃/重启机
  （audit token 仅同一 boot 有效）后任何新 incarnation（含执行器 `launchSuccessor` 自己拉起的）
  都被 `reconcile`/`bound` 拒绝，结果同 F2。修复为同一结构集：(a) 特权终态归档
  `retireResolved`——要求 owner 认证、已验证显式 Disconnect、`observe()==.unprotected`，且
  磁盘组件证明二选一（未进 replacement/已回滚 == originalComponents，或已替换安装 ==
  签名 target 组件），归档 JSON 保留（含最后证明相位与 blockedReason）后清槽，highWater 与
  generation 不变，并像 commit 一样退休执行器 launchd 项；挂在 `/update/retire`（按 execution
  分派 unconsumed/resolved 两套谓词）与 `--emergency-disarm`（验证释放后自动评估，root CLI 无
  peer，谓词不满足则什么都不改）。(b) `reconcile` successor 重绑——记录的 successor 跨 boot 或
  token 不再解析为活进程且新 peer 通过既有认证/owner/组件校验时，重新分配 successor 代际
  （换代不换相位：receipt 证明相位不动，适配器层原位更新 successorGeneration/token/boot，不调
  `propose`，不动共享 wire 模型）；旧 successor 可证明存活时仍独占拒绝。App 侧
  "Disconnect and Retry" 的 retryable 扩展到 blocked/rolledBack/expired/已断开/放弃替换的
  consumed 侧（健康执行中与 successor 可恢复的仍不可重试）。U1 单次消费、U3 高水位不回退、
  U4 Disconnect 不伪造提交全部保持；未放宽任何 gate 对未决事务的保护。
- **工程与测试**：新增两个窄 helper 自测（载体 `--update-self-test`，计数 8→10）：
  `rolled-back-attempt-can-be-retired-after-verified-disconnect`（F2：回滚 + 已验证 Disconnect
  后归档清槽、highWater 保留、证据归档、`gate` 放行 /core/start）与
  `successor-relaunch-after-adoption-can-be-readopted-and-commit`（F3：绑定 successor 存活时
  拒绝第三 incarnation；消亡后重绑新代际且 commit 达 committed）。修复前实现分别在 retire 调用
  与第二处 reconcile 处失败。helper 源码变更按 `build-core-helper.sh` 契约门推进
  `HelperProtocolVersion` 4.8.0 → 4.9.0；CONTRACT.sha256 以脚本同一 sed|shasum 管道本机重算
  （纯文本哈希，未编译；管道已先对修改前树复现 #308 记录的 4.8.0 哈希自证一致）。审查轮：
  链上父分支修正后 rebase 并重算契约；App 启动 `RuntimeCleanup.cleanupStaleRuntime` 在
  reconcile 拒绝时的错误文案改为指向新出口（"检查更新 → 断开并重试"），并在
  Localizable.xcstrings 补中英文条目（纯文案，无新测试）。
  `docs/UPDATE_PROTOCOL_V1.md` 新增小节 "Terminal resolution and successor re-adoption
  (clarified 2026-09-22)"，记录两个终态/重绑契约，不改旧条款含义。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；回归委托
  本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --update-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得本轮 CI
  结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能面向客户、无新包、无部署，仅源码。`--emergency-reset` 在
  pending 时仍拒绝（先 disarm 归档后再 reset 可走）；重绑不覆盖 48 h 过期（过期+replaced 仍只能
  走放弃归档，与"过期不是未安装证明"的文档语义一致）；Windows F1/F4/F6 不在本条。触发概率的
  实机数据仍缺，仅源码路径与 launchd/audit-token 语义核实。

## 2026-09-23 · macOS 升级开机竞态：执行器 bootout 停 Helper 不再误装紧急 PF 阻断

- **归属/来源**：G3 原生升级链；macOS `tono-core-helper` 启动恢复。R4-F5
  （2026-09-22 升级中断恢复审查发现，对抗核实轮 V9 确认并修正影响面）。叠在
  R3-F4 修复 PR #303 与 R3-F3 修复 `fix/macos-dns-snapshot-outlet-20260922`（#307）之上，
  本条分支 `fix/macos-update-bootout-startup-20260922`。
- **缺陷修复**：consumed→replaced 窗口内重启机时，`core-helper`（RunAtLoad+KeepAlive）与
  `update-executor`（RunAtLoad）并行启动；执行器先持锁进入 perform 的 validate（全束验签
  冷启动可达数秒），Helper main 的 `UpdateExecutor.startup()` 在 `storage.locked` 自旋等待；
  执行器到 `stopDaemon()` 的 `launchctl bootout` 发 SIGTERM，自旋守卫抛错，main 的 catch
  无差别 `installEmergencyBlock`（全阻断）并 exit(1)——把自己的执行器停机当成了账本损坏。
  现把 main 的 catch 收进 `UpdateExecutor.startup(storage:emergencyBlock:)`：`locked` 的
  自旋守卫在 `helperShutdownRequested` 时改抛可区分的 `HelperFailure.stopping`，startup 对
  stopping 返回干净停止（main exit(0)，执行器拥有流程，`startDaemon` 事后拉回，无需任何
  PF 动作）；其余任何 startup 错误仍照旧装紧急阻断（fail-closed 不变）。核实修正的影响面
  （V9）：`installEmergencyBlock` 不写持久化状态文件，受保护义务经执行器
  `restoreAtLaunch`/`retainBootstrap` 自愈；真正落入坏态的是 `.unprotected` 义务——紧急
  规则残留使 validate 观测 `.unknown` → blocked → 落入 R4-F2 的永久 pending（事务终态缺
  口由后续 PR 修，本条只修"bootout 被当成账本损坏"这一根因）。触发面经核实为窗口内重启
  机（UpdateStorage.swift:61-62 注释自证该交错是设计预期），同一 boot 内正常升级不暴露。
- **工程与测试**：新增一个窄 helper 自测
  `startup-interrupted-by-own-executor-bootout-does-not-arm-emergency-block`（载体
  `--update-self-test`）：第二持有者持锁 + `helperShutdownRequested=1` → 断言 startup 返回
  干净停止且 emergencyBlock 回调未 invoked；同测并断言损坏账本仍会触发 emergencyBlock
  （仅此一个白名单分支，不放宽保护）。修复前实现 `armed==1` 必失败。另：helper 源码变更
  按 `build-core-helper.sh` 契约门推进 `HelperProtocolVersion` 4.7.0 → 4.8.0；
  CONTRACT.sha256 以脚本同一 sed|shasum 管道本机重算（纯文本哈希，未编译；管道已先对
  修改前树复现 #307 记录的 4.7.0 哈希自证一致）。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --update-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得本轮
  CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。R4-F2（consumed 后无终态）与
  R4-F3（successor 单 incarnation 绑定）不在本条；触发概率的实机数据仍缺（依赖启动次序
  与冷启动验签耗时），仅源码路径与 launchd 语义核实。

## 2026-09-23 · macOS 快照文件不可读时隔离后清扫，三条恢复出口不再同点死锁

- **归属/来源**：G1 断开与恢复；macOS `tono-core-helper` 的 `protected-dns.json` 恢复链。
  R3-F3（2026-09-22 并发/时序审查发现，对抗核实轮 V7 确认为源码推导级：`save` 本身
  fsync+rename 原子，触发前提限外部权限漂移/备份恢复/截断事件）。叠在 R3-F4 修复
  `fix/macos-dns-status-snapshot-20260922`（PR #303）之上，本条分支
  `fix/macos-dns-snapshot-outlet-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/fix/macos-dns-status-snapshot-20260922...fix/macos-dns-snapshot-outlet-20260922)。
- **缺陷修复**：`loadSnapshot()` 对 uid≠0、非普通文件、mode 含 group/other 位、size==0、
  size>16 KiB、JSON 解码失败一律 throw（`HelperFailure.invalid`，永久性）。此前 `restore()`
  第一步即 throw：loopback 清扫不执行、文件不隔离；`--emergency-disarm` 在 disarm 前
  `_ = try dns.restore()` 失败即 "PF remains fail-closed"；`--emergency-reset` 依赖同一
  函数失败即回滚 launchd 注册；App 报错指引的 sudo emergency-disarm 本身就是死路——
  机器停留 PF 全阻断，唯一出口是 root 手删文件。现在 restore()/enable() 遇 invalid 级
  失败先把文件改名隔离保留（`protected-dns.json.corrupt-<ts>`，重申 root/0600；不当成
  已恢复的证据），再按「无快照但当前值可能受污染」的保守语义继续：loopback 清扫
  （127.0.0.1 → DHCP/Empty）照常执行、用户自设 resolver 不动、不凭空捏造原始值（M2
  拒绝假恢复的语义保持）；`.system` 级（lstat/open/read）瞬态失败仍 throw 交重试。
  `--emergency-disarm` / `--emergency-reset` 保持严格顺序（`dns.restore()` 失败即
  "PF remains fail-closed"，与父基一致），它们经同一 restore 事务，快照损坏时隔离后即可
  完成，不再因此回滚 launchd 注册。审查轮修正：首版曾把非 pending 的 `--emergency-disarm`
  改为 DNS 恢复失败也拆 PF，超出根因（把 `.system` 瞬态读失败也纳入放行）且与 pending
  分支不一致，按所有者决定已回退。`/dns/status` 对 invalid 级快照改报
  `ok:false, snapshotPresent:true`（`.system` 级仍报 false），App 既有门
  （`ok == true || snapshotPresent`）因此在断开与启动恢复时直接转调 /dns/restore 完成
  隔离+清扫，不再只剩 sudo 出口、也不再弹无意义的 helper 重装提示；`UpdateRuntime.observe`
  对 snapshotPresent:true 不判 `.unprotected`，更新准入只更严。
- **工程与测试**：新增一个窄 helper 自测 `runCorruptSnapshotSelfTest`（沿用
  statusResponse/restoreServices 的注入模式，restore 的快照失败决策提取为静态事务
  `restoreTransaction(snapshotResult:…)`）：喂 `.failure(HelperFailure.invalid)` 与
  settings `{"Wi-Fi":[127.0.0.1], "Custom":["8.8.4.4"]}` → 断言不再 throw、Wi-Fi 被清为
  `[]`、Custom 不动、quarantine 执行；修复前实现直接 throw，用例必失败。载体
  `--lifecycle-self-test`。审查轮在同一用例追加一条断言：`statusResponse` 对
  `.failure(HelperFailure.invalid)` 必须报 `snapshotPresent == true` 且 `ok == false`；
  修改前 status() 的 catch 固定返回 snapshotPresent:false（且 statusResponse 不接受
  失败结果），该断言必失败。另：helper 源码变更按 `build-core-helper.sh` 契约门推进
  `HelperProtocolVersion` 4.6.0 → 4.7.0；CONTRACT.sha256 以脚本同一 sed|shasum 管道
  本机重算（纯文本哈希，未编译）。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --lifecycle-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得
  本轮 CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。未做实机损坏快照演练（需 root
  构造 uid/mode/截断文件）；`.system` 级瞬态读失败下 App 断开与 sudo emergency-disarm
  仍保持 fail-closed 拒绝（有意，重试可恢复）；隔离文件不随 emergency-reset 删除
  （有意保留诊断证据）；审查 nit（隔离时 chown/chmod 跟随符号链接、同秒两次隔离覆盖）
  未在本轮处理。

## 2026-09-23 · macOS 快照服务不可读时 status 折叠掉 snapshotPresent，断开被无谓拒绝

- **归属/来源**：G1 断开与恢复；macOS `tono-core-helper` 的 `/dns/status`。R3-F4
  （2026-09-22 并发/时序审查发现，对抗核实轮 V7 已确认低危）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/macos-dns-status-snapshot-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/macos-dns-status-snapshot-20260922)。
- **缺陷修复**：受保护期间快照存在但 `currentDNS(for: snapshot.service)` 抛错（服务被
  重命名/删除、`networksetup` 非零返回）时，`status()` 的 catch 把状态折叠成
  `ok:false, snapshotPresent:false` 并丢掉 service 键；App 侧
  `guard envelope.ok == true || snapshotPresent`（HelperManager.swift:726）随之失败，
  POST `/dns/restore` 从未发出——而 `restore()`/`restoreServices` 对快照服务缺失有明确
  处理本可成功。现在 `status()` 区分两种失败：loadSnapshot 失败仍报
  `snapshotPresent:false`（快照不可信，属 R3-F3 后续范围）；快照已加载但当前服务不可读
  改报 `ok:false, snapshotPresent:true` 并携带 service，读回失败信息单独携带，App 侧
  既有状态门无需改动即转调 `/dns/restore`。restore 的读回验证语义与 M2「读取错误不
  假装恢复」不变；本条只修“状态折叠导致根本不去尝试恢复”。
- **工程与测试**：按 `restoreServices` 的注入模式把状态决策提取为静态事务
  `statusResponse(snapshot:read:)`（生产 `status()` 仍用真实 loadSnapshot/currentDNS，
  行为面不变），新增 helper 自测 `runStatusUnreadableServiceSelfTest`：有效快照 +
  注入 currentDNS 抛错 → 断言 `snapshotPresent==true`、`ok==false`、service 保留；
  修复前实现报 false，用例必失败。载体 `--lifecycle-self-test`。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，`tooling/scripts/**` 触发 macos-ci，
  `sudo … --lifecycle-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得
  本轮 CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。未做实机服务重命名演练；
  R3-F3（快照文件损坏/不安全时的隔离与产品内出口）为独立后续修复，不在本条；本条
  不改动 App 侧 guard、HelperManager 或 restore 读回验证。
## 2026-09-23 · 睡眠不再把进行中的显式 Restore internet 改写为保留保护+唤醒重连；未 armed 的 teardown 不再宣称 Kill Switch 在护机

- **归属**：G1（断开与恢复：用户明确要求的恢复直连跨睡眠保持，UI 保护状态与真实 PF
  一致）；macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-sleep-during-release-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）、
  `fix/macos-external-release-misjudge-20260922`（PR #304）、
  `fix/macos-optional-policy-reconnect-20260922`（PR #306）、
  `fix/macos-pending-network-change-20260922`（PR #309）之上，基线同后者；R1-F2，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V3 对抗核实（已确认：变体 b 确定、
  变体 a 源码推导级——需睡眠落在 release teardown 窗口内）。提交时未合 main。
- **缺陷修复**：两个根因面。
  （1）睡眠路径无视「进行中的 teardown 是显式 release」：用户点 Restore internet 后
  teardown A（release:true）可阻塞在 `repairForRelease()` 的管理员提示（最长 180 s）；
  此时合盖，`prepareForSystemSleep` 只看聚合状态（`isProtectionBlocked/isArmed` 均真）→
  置 `resumeProtectionAfterWake=true` 并入队 preserve teardown B，唤醒后
  `resumeAfterSystemWake` 再入队 C；用户应答提示后 A 完成释放（PF 打开、`isArmed=false`），
  但其 `completeDisconnect(A)` 因 requestID 已被 C 取代而被丢弃——A 的
  `isProtectionBlocked=false` 永不发布；B/C 的 `restrictToBootstrap()` 因 `!isArmed`
  空转成功却仍发布 Protected Offline（PF 已解除而 UI 报 Kill Switch blocking），唤醒
  恢复继续 `connect()`——用户的"恢复直连"被整体改写为重新保护+自动重连。修复：
  `ConnectionCoordinator` 记录 teardown 队列最新请求的 release 意图
  （`enqueueDisconnect` 置位、最新请求的 `completeDisconnect` 退役、新请求按新意图覆盖，
  与 `disconnectRequestID` 同一新者胜语义）；`prepareForSystemSleep` 检测到进行中的
  release 时不置 `resumeProtectionAfterWake`、不入队 preserve teardown（release 自己的
  `cancelReconnectTasks`/prepare 已做同等清理）；`resumeAfterSystemWake` 检测到时不建
  `wakeRecoveryTask`、不再入队 C 也不 `connect()`——release 独自收尾并经自身
  `completeDisconnect` 发布释放状态。`system_will_sleep`/`system_did_wake` 审计事件
  增加 `release_teardown_in_flight` 字段。
  （2）`restrictToBootstrap()` 的 `guard isArmed else return` 空转成功被当作"保护已保留"：
  变体 b（无睡眠也成立）——首次连接尚未完成 stage-1 arm（helper 安装提示打开，
  `isArmed=false`）时合盖，sleep 路径的 preserve teardown 中 stopCore 失败（helper 不可达
  → `coreStatus` 不可证 → `coreStopped=false`）→ 报
  "The protected core could not be stopped. Kill Switch remains active"而机器上没有任何
  PF 规则；`restrictToBootstrap` 空转 → `completeDisconnect` 置 `isProtectionBlocked=true`。
  修复：preserve 分支在 `restrictToBootstrap` 后按真实 `KillSwitchService.isArmed` 决定
  `transitionLeavesProtectionBlocked`（未 armed 的空转不再发布 Protected Offline）；
  stopCore 失败文案同按 `isArmed` 选择（未 armed 不再声称 Kill Switch remains active）。
  不放宽保护：`isArmed=true` 的一切语义不变；release 路径（含 stopCore/DNS 失败的
  不完整释放）与 `restrictToBootstrap` 抛错的 catch 仍 fail-closed 置
  `isProtectionBlocked=true`；helper 持久化状态可能存在的释放失败场景维持原有
  保守声明。本修复只消除"未 armed 却宣称已保护"的反向不一致。
- **新增/优化**：无新能力。`ConnectionCoordinator` 新增内部记录
  `disconnectQueueReleaseIntent` 与只读查询 `disconnectQueueRequestsRelease`；两个睡眠
  审计事件各增一个诊断字段。
- **工程与测试**：新增一个窄 XCTest
  `AppStateSleepTests.testSleepDuringExplicitReleaseDoesNotConvertItIntoWakeReconnect`
  （新文件 `apps/macos/TonoTests/AppStateSleepTests.swift`，文件系统同步组自动入 target）：
  fixture `isConnected=true`、`coreRuntime.isRunning=true`、`KillSwitchService.isArmed=true`，
  `repairForRelease` seam 挂在门上（显式挂起，非 sleep 轮询），断开路径全部走
  `networkProtection` seam（stopCore 置 `isRunning=false`、disarm 置 `isArmed=false`、
  restrictToBootstrap 内置"不得在 release 之上重 arm"canary）；`disconnect(release:true)`
  → 等 teardown 到达提示 → `prepareForSystemSleep()` + `resumeAfterSystemWake()`（提示
  未应答，等价合盖再唤醒）→ 断言 `resumeProtectionAfterWake==false`、
  `wakeRecoveryTask==nil` → 开门让 release 独自完成 → 断言 `isProtectionBlocked==false`、
  `KillSwitchService.isArmed==false`、`isDisconnecting==false`。当前实现（修复前）三者
  分别为 true/true/false 且唤醒恢复任务已建立，断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定与本 PR 本机限制）只编辑未编译
  未运行——未执行 `xcodebuild`/`swift build`/`swift test`/`swiftc`；Swift 语法、访问
  级别与调用链人工自查（含与 #298 armed 快照、#304 重连 loop 前提、#306 调度点、
  #309 pending 消费的共存核对）。回归委托本 PR CI（GitHub-hosted `macos-26`）；提交时
  CI 结果未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：变体 a 的实机命中率未量化（需睡眠恰落在 release teardown 窗口内，V3
  已核路径确定）；release 在 helper `PowerTransitionGate` 睡眠窗口内到 `disarm()` 会被
  拒绝并按既有 fail-closed 保留保护（用户重试 Restore internet），属既有语义非本条
  引入；唤醒恢复自身在未 armed 主机上的"Re-protecting"过渡文案、以及 helper 崩溃后
  持久化 PF 与 app `isArmed` 失同步的交互 5 场景不在本条范围（后者释放失败仍保守报
  Protected Offline）。

## 2026-09-23 · 连接中途到达的系统网络变化不再被丢弃，改为 pending 待窗口结束对账

- **归属**：G1（断开与恢复：网络切换后受保护会话及时自愈，不依赖 60 s 命令审计兜底）；
  macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-pending-network-change-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）、
  `fix/macos-external-release-misjudge-20260922`（PR #304）、
  `fix/macos-optional-policy-reconnect-20260922`（PR #306）之上，基线同后者；R1-F5，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V3 对抗核实（已确认，源码推导级；
  是 Windows W8/#259（特权服务 netmon.rs 保留 pending、窗口结束后对账）的 macOS
  平台遗漏——同族问题 Windows 已修、macOS 纯丢弃）。提交时未合 main。
- **缺陷修复**：`handleSystemNetworkChange()` 在 `isConnecting/isDisconnecting` 期间的
  入口 guard 直接 return，不留 pending。连接中途主网络服务切换（Wi-Fi→有线/热点，
  securingDNS 之后、`onCoreStarted` 之前的数秒窗口）时：`onCoreStarted` 把新拓扑固化为
  `lastPhysicalFingerprint` 基线，connected 分支的 `physicalChanged` 对此永远为 false；
  系统 DNS 已是新服务的 ISP resolver，PF 阻断其 53 端口，域名健康探测失败进入
  Recovering 循环不升级，唯一兜底是 `healthCycle.isMultiple(of:12)` 的
  primaryNetworkService 命令审计（最长约 60 s，2 s 降级 tick 下更快）才发现并重连；
  期间 fail-closed 不泄漏但无 DNS。修复：过渡期到达的网络变化置
  `pendingNetworkChangeCheck = true`（记 `network_change_held_pending` 审计）不再丢弃；
  在两个收尾点消费——`onCoreStarted` 收尾（基线已捕获）与 `completeDisconnect` 收尾
  （teardown 已 settle）：已连接走与 connected 分支完全相同的 750 ms 去抖
  `networkEnvironmentTask` 对账（primaryService/protectedDNSService、DNS 完整性、
  物理指纹；自写排除由既有指纹机制承担，任务体内的 settle 守卫等连接收尾清
  `isConnecting`）；断开收尾只清 pending 标记、不 kick。第二轮审查
  （prreview-mac-conn #309，需返工）指出首版在断开收尾无条件回放 immediate
  protected-reconnect kick：被保留的通知常是 Tono 自己的 DNS 写入（connect 的
  `enableProtectedDNS` / release 的 `restoreDNS`），回放会抬起「同一失败三次暂停」、
  清零退避，并把 disarm 失败的显式 release 自动重连（违反 I5）；每条 preserve
  teardown 已自行调度 loop 或有意暂停，release 不得重连，故断开分支不再 kick。消费
  只触发既有协调路径，不新增任何直连旁路；PF 全程 armed，不放宽保护；60 s 命令审计
  兜底原样保留。
- **新增/优化**：无新能力。配套把 connected 分支的环境对账任务体抽为共享私有函数
  `scheduleNetworkEnvironmentReconciliation()`（任务体逐字未改），新增
  `network_change_held_pending`/`pending_network_change_reconciled` 两个诊断审计事件。
- **工程与测试**：新增一个窄 XCTest
  `NetworkChangeTests.testNetworkChangeObservedWhileConnectingIsReconciledOnceConnected`
  （新文件 `apps/macos/TonoTests/NetworkChangeTests.swift`，文件系统同步组自动入 target）：
  fixture `isConnecting=true`、`protectedDNSService="Wi-Fi"`，调
  `handleSystemNetworkChange()` 断言留下 pending 标记且不建协调任务；切
  `isConnecting=false; isConnected=true` 后调 `consumePendingNetworkChange()`，断言
  `connectionCoordinator.networkEnvironmentTask != nil`（只断言调度，750 ms 去抖与
  helper 探测不在测试内运行，结束前取消任务）。当前实现（修复前）无 pending 字段、
  无任务，断言失败。第二轮在同一测试追加断开阶段：`isArmed=true`、目录一个节点
  （`isTonoReady`）、`isDisconnecting=true` 时通知入 pending，收尾消费后断言标记清除且
  `protectedReconnectTask == nil`；首版会 immediate kick 建 loop，断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定与本 PR 本机限制）只编辑未编译
  未运行——未执行 `xcodebuild`/`swift build`/`swift test`/`swiftc`；Swift 语法、访问
  级别与调用链人工自查。回归委托本 PR CI（GitHub-hosted `macos-26`）；提交时 CI 结果
  未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。第二轮修改同样本机未编译，
  委托 CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：断开/teardown 期间到达的真实环境变化（非自写）现同样只清标记：
  preserve 路径依赖其已调度的 loop 退避重试，睡眠/显式 release 不重连，与父基丢弃
  语义一致；实机 SCDynamicStore 通知与连接窗口交错的命中率未量化（V3 已核时序上界
  成立，降级路径常快于 60 s）；pending 消费只缩短发现延迟，不改变 fail-closed 语义；
  R1 审查其余发现（F2、F6）与 F5 的 Windows 侧（已由 W8/#259 修复）不在本条范围。

## 2026-09-23 · 后台可选策略替换失败后必须调度受保护重连

- **归属**：G1（断开与恢复：稳定网络上的 fail-closed 主机不滞留 Protected Offline）；
  macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-optional-policy-reconnect-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）与
  `fix/macos-external-release-misjudge-20260922`（PR #304）之上，基线同后者；R1-F4，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V2 对抗核实（已确认；与 F3 不同
  根因——F3 是 loop 被误判退出，F4 是 loop 根本没被调度）。提交时未合 main。
- **缺陷修复**：每次连接成功后 `onCoreStarted → scheduleBackgroundOptionalPolicy →
  applyOptionalDirectPolicyInBackground` 在共享 config-reload 句柄后执行运行时替换
  （arm → writeRuntimeConfig → helper `/core/sync` → reload → TUN 验证）；任一步抛错
  （重启后 8 s TUN 探测失败、`/core/sync` 超时等，弱网最易发生）时 catch 只做
  `disconnect(releaseKillSwitch:false)` + `errorMessage`，是全代码库唯一不调度
  `scheduleProtectedReconnect` 的 fail-closed 失败分支（对比 `reloadCoreConfig` 三个
  catch、`recoverFailedNodeSwitch`、monitor/watchdog/connect 失败路径与唤醒重试耗尽
  路径）。终态 PF bootstrap-only、`isProtectionBlocked=true`、无重连 loop；稳定网络上
  无 kick 事件，主机无限期停在 Protected Offline，仅网络抖动或用户 Retry now 能救回。
  修复：该 catch 补 `scheduleProtectedReconnect()`（非 immediate，与
  `reloadCoreConfig` 通用 catch 同形同序），loop 接管恢复；`disconnect(release:false)`
  的 fail-closed 语义与 stale-generation/cancellation 守卫原样保留，loop 从不 disarm，
  不放宽保护。调度点安全：调用点在 `onCoreStarted` 之后（`isConnected=true`），守卫在
  disconnect 之前判定 generation；loop 首次尝试先 `finishPendingDisconnect()` 排空本次
  teardown，不与进行中操作竞争；沿用 F3 修复的 armed 调度快照（本场景 PF 已 armed，
  loop 以 armed 前提调度，helper wanted=true 时正常 connect）。
- **新增/优化**：为可测性给 `AppState` 加 `optionalPolicyRuntimeMutation` seam
  （`() async throws -> Void`，默认 nil 走真实解析+特权替换，生产行为不变；同
  `tunInterfaceExists`/`networkProtection` 模式）：注入时替代解析段与运行时变更段，
  准入守卫与 catch 结构保持原位。无其他行为变化。
- **工程与测试**：新增一个窄 XCTest
  `OptionalPolicyTests.testBackgroundPolicyFailureSchedulesProtectedReconnect`：
  fixture `isConnected=true`、`KillSwitchService.isArmed=true`、含一个托管域的策略、
  抛错的 `optionalPolicyRuntimeMutation`，`NetworkProtectionOperations` 各 seam 空操作；
  调 `scheduleBackgroundOptionalPolicy()` 后等 config-reload 任务与 teardown 序列完成；
  断言 `isProtectionBlocked` 与 `errorMessage` 确证 fail-closed 终态，且
  `isProtectedReconnectScheduled == true`、`connectionCoordinator.protectedReconnectTask
  != nil`。当前实现（修复前）无任何调度，后两断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法、访问级别与调用链人工自查。回归
  委托本 PR CI（GitHub-hosted `macos-26`，`macos-ci` 由 `apps/macos/**` 路径触发）；
  提交时 CI 结果未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：失败触发为环境性（TUN 探测/`/core/sync` 超时的实机命中率未量化）；
  R1 审查其余发现（F2、F5、F6）不在本条范围；错误文案仍为内部原文（与
  `reloadCoreConfig` 的本地化文案对齐留待后续文案统一）。
## 2026-09-23 · ops hub SSH 固定主机密钥（H7-F1）

- **归属**：ops 任务（运维计划 §3 hub 部署 / 3.4 hub 任务执行器），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-ssh-hostkey-20260923`；Issue #365，
  内部审查 H7-F1；提交时未合 main。
- **缺陷修复**：`jobs.py` `ssh_exec`/`ssh_agent` 与 `collect.py` `probe_cn_agents`/
  `run_on_node_via_ssh` 四处 SSH 原为 `StrictHostKeyChecking=no` + `/dev/null` known-hosts
  后以 root 密码登录。现统一由 `collect.ssh_password_argv` 生成：`StrictHostKeyChecking=yes`、
  `UserKnownHostsFile=/opt/tono-ops/tono-collector-known-hosts`（与 `check-node-in-fleet.py`
  同一文件）、`GlobalKnownHostsFile=/dev/null`。未登记或变更的主机密钥连接失败，不自动接受。
  主机密钥未验证的大陆探针不计入封锁判定（记 `host_key_unverified`；`node_probe` 带
  `hostKeyUnverified` 计数），避免把未登记误报成「被墙」。
- **新增/优化**：`ops-panel/README.md` 写明 known-hosts 登记流程（新增/重装节点、新增探针前
  追加并与供应商控制台核对指纹）。
- **工程与测试**：`test_jobs.py` 新增一个测试 `test_node_ssh_pins_the_hub_known_hosts_file`，
  断言 `ssh_exec` argv 含严格校验与固定文件；旧代码上失败（argv 为 `StrictHostKeyChecking=no`）。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：旧代码
  26 项 1 失败（新测试），修复后 26 项 OK；另以打桩的 `subprocess.run` 手动确认主机密钥失败时
  `probe_cn_agents` 返回 None（无大陆数据）。未连接任何真实主机。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；hub 部署需 owner 执行。
- **剩余限制**：部署前必须确认 hub 上 known-hosts 已登记全部 `nodes.secrets.json` 节点与
  `mainland_probes`，否则对应节点采集/任务会 fail-closed 报错；仍使用 root 密码认证，
  改为 key 认证未在本条范围；`onboard-node.rb` 不写 hub 这份文件，需单独登记。
## 2026-09-23 · 节点上报的 public_ip 进入大陆探针前校验（H7-F2）

- **归属**：ops 任务（运维计划 §3 hub 部署 / 3.4 hub 任务执行器；采集器封锁探测），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-probe-ip-20260923`；Issue #370，内部审查 H7-F2；
  提交时未合 main。
- **缺陷修复**：`run_on_node_via_ssh` 读到的节点自报 `public_ip` 原来不做校验，`main` 和
  `collect_quality` 用它做探测目标，`probe_cn_agents` 把它拼进在大陆探针上以 root 执行的命令
  （`node_probe` 已有 `SAFE_HOST`，这两条路径没有）。现在新增 `collect.public_ip`，只接受
  `ipaddress` 能解析的公网 IPv4/IPv6 字面量，其余一律丢弃，并在三处使用：
  - 入口 `run_on_node_via_ssh`；
  - 目标选择 `probe_target`，节点自报值无效时回落到登记的 host，host 也要通过同一校验，
    两者都无效就跳过全部封锁探测；
  - 汇点 `probe_cn_agents`。

  目标改为作为 `bash -c` 的位置参数传入（`shlex.quote`），不再拼进脚本文本。
- **新增/优化**：无。
- **工程与测试**：新增 `ops-panel/tests/test_collect.py` 的一个测试：`probe_cn_agents` 收到
  非 IP 值（节点在 IP 回显失败时输出的 `unknown`）时不发起 SSH、返回 None。旧代码上失败
  （会调用 ssh）。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：
  - 旧代码：26 项中 1 项失败，即新测试；
  - 修复后：26 项全部通过。

  另外打桩手动确认合法 IP 生成 `bash -c '…$0/$1' <ip> 443`，并且 `probe_target` 对私网
  地址或主机名回落/返回 None。没有连接任何真实主机。CI 结果见 PR。
- **候选/发布**：只有源码，没有新候选；hub 部署由 owner 执行。
- **剩余限制**：如果节点在 `nodes.secrets.json` 里是用主机名而不是 IP 登记的，并且自报 IP 无效，
  这一轮就不做封锁探测（记 `no_public_ip`，显示为基线失败）。`node_probe` 仍然沿用
  `SAFE_HOST`，本条没有改动。本条和 H7-F1 的 PR 都改了 `probe_cn_agents` 的相邻行，合并时
  可能需要解决文本冲突。
## 2026-09-23 · ops 诊断/重启任务改用实际 Xray unit `tono-xray.service`（H7-F8）

- **归属**：ops 任务（运维计划 3.4 hub 任务执行器；3.1 验收单报错证据），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-xray-unit-20260923`；Issue #376，内部审查 H7-F8；
  提交时未合 main。
- **缺陷修复**：
  - **原问题**：`xray_dial_errors`/`xray_error_digest` 读的是 `journalctl -u xray`，
    `xray_restart` 执行的是 `systemctl restart xray`，但部署脚本安装的都是 `tono-xray.service`。
    journal 对不存在的 unit 通常返回 0 且没有输出，任务会报 `ok matched=0`，验收单可能把它
    当作「无报错」证据。
  - **修复**：新增常量 `XRAY_UNIT = "tono-xray.service"`，三个任务都改用它。journal 任务先确认
    `LoadState=loaded`，否则以 rc=3 报 error，不再把空读当成功。
  - **审查修正（R4）**：`provision-tono-node.py` 允许每个节点自定 `serviceName`（如 `extend` 模式下的
    `xray.service`），写死 `tono-xray.service` 会把这类节点上原本可用的 `xray_restart` 改坏。现在三个任务
    都读节点记录（`nodes.secrets.json`）里的 `serviceName`，缺省才用 `tono-xray.service`；值不是
    `[A-Za-z0-9_.-]+.service`（与 provision 脚本同一规则）时直接报 error，不拼进远程 shell。
- **新增/优化**：无。
- **工程与测试**：`test_jobs.py:471` 原来把错误的 `journalctl -u xray` 写成断言，现改为
  `journalctl -u tono-xray.service`。这条就是本修复的回归测试，没有新增其他测试。在旧代码上
  它会失败（handler 返回 error，不是 ok）。审查修正后同一测试给节点记录 `serviceName: "xray.service"`，
  断言 LoadState 检查和 journal 都用这个 unit；只还原 `jobs.py`（写死 tono-xray.service）时失败
  （`'error' != 'ok'`）。缺省分支没有单独测试。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：旧代码 25 项
  1 失败，修复后 25 项 OK（审查修正后复跑 25 项 OK）。没有连接任何真实主机，也没有在节点上确认 `systemctl show -p LoadState`
  的输出。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；hub 部署需 owner 执行。
- **剩余限制**：
  - 如果某节点确实只跑旧的 `xray.service`（非 Tono 部署）而记录里没有 `serviceName`，journal 任务
    会报 error、不再报 ok，这是有意的 fail-closed；在该节点的 `nodes.secrets.json` 记录里补
    `serviceName` 即可。provision 脚本不会自动写 hub 上的这份记录，需要手工同步。
  - 历史上 `ok` 的 journal 任务行不会追溯改判。

## 2026-09-23 · 永不 armed 的内部转换不得被重连 loop 判为外部 release

- **归属**：G1（断开与恢复：用户连接意图不被静默丢弃）；macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-external-release-misjudge-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）之上，基线同该分支；R1-F3，出自
  2026-09-22 macOS 连接生命周期并发/时序审查及 V2 对抗核实（已确认；helper 未安装
  子变体因 `.unavailable` 自愈，不在本条范围）。提交时未合 main。
- **缺陷修复**：连接中途（PF 尚未 arm，如启动即点 Connect 撞上立即策略刷新）到达的
  托管流量策略更新走 `installManagedTrafficPolicy` 的 `disconnect(release:false)` +
  `scheduleProtectedReconnect(immediate:true)`；teardown 的 `restrictToBootstrap` 因
  `!isArmed` 空转，`completeDisconnect` 仍发布 `isProtectionBlocked`；重连 loop 的
  `reconcileConfirmedExternalProtectionRelease` 把 helper「无持久化 kill-switch 状态
  （wanted=false）」误判为 root 外部 release，`acceptConfirmedExternalProtectionRelease`
  取消 loop、清空错误并写假 `external_protection_release_confirmed` 审计——用户的
  Connect 意图静默消失，终态 idle 无错误无重试。同一入口：唤醒重试耗尽后的
  `scheduleProtectedReconnect()`（`AppState.swift` wake 路径）在同样 never-armed 状态
  同样静默退出。修复：`scheduleProtectedReconnect` 在调度时快照
  `KillSwitchService.isArmed`，loop 每次 attempt 以「调度时快照 || attempt 时实时
  `isArmed`」作为 external-release 确认的前提
  （`reconcileConfirmedExternalProtectionRelease(protectionWasArmed:)` 前置守卫），
  never-armed 的内部转换不再冒充外部 release，loop 继续重连。第二轮审查
  （prreview-mac-conn #304）指出仅用调度时快照会过期：同一 loop 内某次 attempt 已
  arm 后失败（preserve teardown + 去抖，loop 继续、快照仍 false），退避期内真正的
  root 紧急 disarm 会被 loop 无视并由 connect 重新 arm；现改为 attempt 时求值，
  app 认为 PF armed 时 helper 认证回答 wanted=false 仍被接受并退出；激活路径
  `reconcileExternalProtectionState()` 走默认参数，行为不变；loop 从不 disarm，不放宽
  保护。
- **新增/优化**：`NetworkProtectionOperations` 增加 `refreshKillSwitchStatus` seam
  （默认真实 `PrivilegedRuntimeCoordinator.refreshKillSwitchStatus`，生产行为不变），
  `reconcileConfirmedExternalProtectionRelease` 改经 seam 调用以便测试注入状态 IPC。
- **工程与测试**：新增一个窄 XCTest
  `ProtectedReconnectTests.testInternalTransitionReconnectDoesNotTreatNeverArmedHelperAsExternalRelease`：
  fixture `isConnecting` + `isArmed=false` + 一个可被选中但过不了 owned-node 校验的
  目录节点（使 loop 的 connect 尝试在任何特权 helper/core 操作之前快速失败，其
  pre-arm release teardown 按既有设计结束 loop），`refreshKillSwitchStatus` seam 返回
  `.confirmed(requiresProtectionRecovery:false)`，其余 seam 空操作；执行
  `disconnect(releaseKillSwitch:false)` + `scheduleProtectedReconnect(immediate:true)` 并
  等 loop 结束；断言 `lastConnectionFailure` 与 `errorMessage` 非空——即一次真实 connect
  尝试已发生且其失败文案留存。当前实现 loop 静默退出、两值为 nil，断言失败。
  第二轮在同一测试追加过期快照阶段：同样以 `isArmed=false` 调度 loop 后、首个
  attempt 运行前置 `isArmed=true`（模拟本 loop 先前 attempt 已 arm 后失败），seam
  仍回答 wanted=false；断言 release 被接受（`isArmed`/`isProtectionBlocked` 为
  false、`lastConnectionFailure`/`errorMessage` 为 nil、loop 结束）。仅用快照的上一
  版会跳过确认直接 connect，留下失败记录，断言失败（loop 等待以 10 s 看门狗封顶，
  不会挂死 CI）。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法、访问级别与调用链人工自查。回归
  委托本 PR CI（GitHub-hosted `macos-26`）；提交时 CI 结果未知，不沿用任何旧 SHA 绿灯。
  准确受测源码为 PR head。第二轮修改同样本机未编译，委托 CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：F2（睡眠改写显式 release / never-armed 的 Protected Offline 误报）与
  F4（后台可选策略失败漏调度重连）为不同根因（V2 判定），另行修复不在本条；替换窗口
  与外部 release 的实机量化未做。
## 2026-09-23 · exit-agent 吊销执行先于计量检查、逐个删除（H7-F6）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-revoke-first-20260923`（提交时未合 main）；内部审查 H7-F6，Issue #388。
- **缺陷修复**：状态文件损坏、durable source 不匹配、缺 stats 命令、队列 observedAt 超前等与吊销无关的检查原先都在应用 roster 之前，任一失败本轮 Xray 与 hy2 都不删用户；`reconcile` 首个 rmu 失败即中止后续删除；roster 超过 512 KiB 被截断后每轮 JSON 解析失败。现在：roster 的 nodeId 与配置的 source 一致（吊销唯一依赖的检查）后立即更新 hy2 并 reconcile Xray，计量相关检查放到之后，仍拒绝本轮、不 ack；删除与添加逐个尝试、最后汇总报错；roster 读取上限提到 8 MiB，超限显式 Refusal 且不应用任何变更（截断前缀无法证明谁缺席，因此不据此删除）；非 JSON roster 转为 Refusal。审查修正（R4）：state 是合法 JSON 但不是 object（`[]`/`null`）或 `installedClients` 含非字符串时，`load_state` 在吊销前就报 Refusal（原先 `AttributeError`/`TypeError` 让本轮在删除任何客户端之前崩溃），按"state 不可用"处理：照常吊销，之后拒绝本轮、不 ack；该文件原样保留、不读取也不覆盖（原地隔离）。没有把它改名移走：下一轮会从空 totals 重新计量，少计重启前的用量。
- **新增/优化**：`require_commands` 把 stats 命令改为可选，缺失时在 reconcile 之后拒绝（不再挡住吊销）。
- **工程与测试**：一个 unittest（队列中有超前 observedAt 的报告 + 记录清单两个待删 label、首个 rmu 失败 → hy2 仍更新、两个 label 都尝试删除、Refusal 且不 ack），在修复前代码上实际跑红。既有 `test_a_queued_future_timestamp_is_not_dropped_on_replay` 原断言 "reconcile 未调用" 固化的正是本缺陷，改为断言 reconcile 已执行，其余断言（报告不投递、状态不变）不变。审查修正新增一个窄测试 `test_a_state_file_that_is_not_an_object_still_lets_revocation_run`（state 为 `[]`、listing 有 `u:gone` → 仍 rmu、Refusal、不 ack、文件不变；只还原 `reconcile_and_report.py` 时报 `AttributeError: 'list' object has no attribute 'get'`）。
- **验证**：MacBook 本机 `python3 -m unittest test_reconcile_and_report`（83 通过；审查修正后 `python3 test_reconcile_and_report.py` 84 通过）。未连接真实节点。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：hy2 发布失败仍会阻止本轮 Xray reconcile（既有行为与测试，未改）；roster 超过 8 MiB 仍需控制面分页。state 损坏时计量一直拒绝，直到运维修复或移走该文件（移走会从空 totals 重新计量）。
## 2026-09-23 · 停用/退役的出口节点必须撤下全部客户端（H7-F4）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/control-plane`、`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-node-disabled-20260923`（提交时未合 main）；内部审查 H7-F4，Issue #371。
- **缺陷修复**：节点被 PATCH 为 disabled 或经退役流程 `revokeExitToken`（同时轮换 token）后，Worker 对其 token 返回与未知 token 相同的 401，exit-agent 直接退出，不删 client、不更新 hy2，最后一份 roster 中的身份（含之后被吊销/过期/超额的）在该节点持续可用且不计量。现在：属于 disabled 节点的 token（含退役前被轮换掉的旧 token，存于新列 `revoked_token_hash`，只用于应答、不认证任何请求）得到 `403 EXIT_NODE_DISABLED`；未知 token 仍 401。exit-agent 只在收到这个确切的 403 body 时移除所有 `u:` client 与 `shared-legacy`、清空 hy2 allowlist、记录并以非零退出；普通 401/403、边缘拦截页、5xx 与网络错误维持原行为（保留 roster、下轮重试）。
- **新增/优化**：migration `0081_exit_node_revoked_token.sql`（新增可空列，不改旧 migration）。手工添加的非 `u:` client 仍不动；节点无法列出也无记录的 client 清单时只能删 `shared-legacy`，退出信息提示运维停掉 `tono-xray`。
- **工程与测试**：Worker 一个 `it`（disabled 与 retired 节点 token 得 403 `EXIT_NODE_DISABLED`，未知 token 仍 401）；exit-agent 一个 unittest（403 HTML 页不删任何 client；403 `EXIT_NODE_DISABLED` 删 `u:` 与 `shared-legacy`、保留手工 client、不 ack）。两者在修复前的代码上均实际跑红。
- **验证**：MacBook 本机 `npx vitest run`（control-plane 全量 43 文件 892 通过）、`npm run typecheck`（首轮 CI 因测试中 `env` 未转 `Env` 类型检查失败，已修正）；`python3 -m unittest test_reconcile_and_report`（83 通过）。未连接任何真实节点，未部署，migration 未在远端 D1 执行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：需部署 Worker 并执行 migration 后才生效；已在运行的旧 agent 需更新后才会响应该信号。退役前已被轮换且未经本改动记录旧 hash 的节点（改动部署前退役的）仍只得到 401，需人工停掉其 `tono-xray`。Xray 移除 client 不保证断开已建立的连接。
## 2026-09-23 · shared-legacy 退役持久化到 Xray 静态配置（H7-F5）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-legacy-persist-20260923`（提交时未合 main）；内部审查 H7-F5，Issue #382。
- **缺陷修复**：(a) `retireSharedLegacy` 只经 API 从运行中的 Xray 删除 `shared-legacy`，它仍在 `config.json`，Xray 每次重启复活；现在退役时同时从静态配置删除（同目录临时文件、保留属主/权限、`xray run -test` 通过后原子 rename 并 fsync 目录），每轮检查，失败则本轮最终 Refusal（见下）。(b) 拿不到 live 用户列表、只能用记录清单时（退役后记录中已无它）不再跳过：退役态下总是对 `shared-legacy` 执行 rmu（"not found" 视为成功），不改变其他 client 的"清单未知不删"规则。(c) `TONO_RETIRE_SHARED_LEGACY` 大小写不敏感，接受 `1/true/yes/on`、`0/false/no/off`（原先 `True` 等被当成 false）。审查修正（R4）：其他值告警并**保持现状**（本轮不退役）——退役持久化后是单向的，`false` 撤不回，回滚时拼错不能触发它。静态配置写入失败不再挡 roster ACK 与用量上报：失败先告警，本轮在计量完成后才以 Refusal 退出（超额吊销依赖用量上报）。
- **新增/优化**：新环境变量 `TONO_XRAY_CONFIG`（默认 `/opt/tono-xray/current/config.json`），README 与 env 示例同步。
- **工程与测试**：一个 unittest（override=`True`、无 list 能力、记录清单不含 shared-legacy、服务端信号为 false → 仍 rmu `shared-legacy` 且 config.json 中只剩手工 client），在修复前代码上实际跑红；既有 `RosterControlSignals` 测试夹具补一行 patch 持久化函数。审查修正新增两个窄测试（同一夹具加 `persist_error` 参数）：`test_an_unrecognized_override_leaves_shared_legacy_in_place`（`flase` → 不退役；旧实现 `True is not false`）、`test_a_failed_retirement_write_still_meters_before_refusing`（持久化抛 Refusal 时仍 ack roster 与 metering、state 已保存、最终仍 Refusal；旧实现 `acknowledge_roster` 调用 0 次）。两者只还原 `reconcile_and_report.py` 时均失败。
- **验证**：MacBook 本机 `python3 -m unittest test_reconcile_and_report`（83 通过；审查修正后 `python3 test_reconcile_and_report.py` 85 通过）。未连接真实节点，未在真实 Xray 上验证空 clients 的 vless inbound 能否通过 `run -test`（不通过时 agent 不写入、告警，本轮在计量后以非零退出；计量不停）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：agent 运行用户需对 release 目录可写；只跑 `--hy2-roster-only` 或未配置 exit_nodes/agent 的节点仍不会退役 Xray 上的 shared-legacy，`device_only` 就绪门看不到这些节点（未在本 PR 处理）。退役后重跑 `enable-tono-exit-metering.sh` 会因 vless 无 client 而拒绝。退役对每台节点是单向的，恢复需 `.pre-metering` 备份或重新配置。
## 2026-09-23 · 出口节点质量工具按摘要固定，去掉第三方镜像兜底（H7-F3）

- **归属**：ops 任务（采集器 / 运维面供应链）；`ops-panel/collect.py`，不影响客户端和 Worker。
- **来源**：基线 main → 分支 `fix/node-diag-tools-20260923`；Issue #364；关联 PR，提交时未合 main；内部审查 H7-F3（源码推导）。
- **缺陷修复**：质量采集在每台出口节点上以 root 下载并执行 `securityCheck`、`backtrace`，来源是可变 release tag `output`，GitHub 失败时回退第三方 CDN 镜像，不校验摘要；节点上已存在的文件以后每轮直接信任。现在两个工具各固定一个 sha256（记在 `collect.py`），`backtrace` 改用版本化的 `v0.0.21`；`securityCheck` 上游只发布 `output` tag，以摘要为固定点。下载只走 HTTPS，校验通过才赋可执行权限；每轮都重新校验节点上已有的文件，不符就删除并按 missing 上报；删除镜像兜底。securityCheck 缺失（下载失败或摘要不符）时 `parse_quality` 报 `quality: "unknown"`，不再报 `ok`（审查 R4：上游一换 `output` 资产，全舰队会永久显示 ok）。
- **新增/优化**：无。工具仍然需要：`parse_quality` 用其输出生成节点质量、风险/线路关键词，供 Komari 标签、report.json、控制面快照和 ops console 节点抽屉使用。
- **工程与测试**：新增一个窄测试 `ops-panel/tests/test_collect.py::test_node_tools_are_digest_pinned_and_github_only`（旧代码上第三个 `dl` 参数是 CDN 地址而不是摘要，断言失败）；审查后同一测试让假 SSH 输出 `missing` 并断言 `quality == "unknown"`（只还原 `collect.py` 时失败：`'ok' != 'unknown'`）。
- **验证**：MacBook 本机 `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：修复前新测试失败，修复后 26 项通过（审查修正后复跑仍 26 项通过）。两个固定摘要由本机下载同一 URL 后 `shasum -a 256` 复核，与 GitHub release asset digest 一致（未执行二进制）。用本机 shim 演练 `dl()`：摘要相符安装、不符删除并返回 1、篡改后的已有文件被替换。未连接任何节点，未在 Linux 节点上运行远程脚本。
- **候选/发布**：无新包，仅源码；hub 上的 `collect.py` 需按 README 手工部署后生效。
- **剩余限制**：工具仍以 root 在节点上运行（固定摘要后的上游构建）；以低权限/沙箱运行、由 hub 分发（依赖 H7-F1 SSH 主机密钥校验）是后续项。上游更新 `output` 资产后，`securityCheck` 会显示 missing、质量为 unknown，直到有人审查并更新摘要；2026-09-23 核对上游 `oneclickvirt/securityCheck` 只有 `output` 一个 release/tag，没有可固定的版本，所以摘要仍是唯一固定点。

## 2026-09-23 · coreMonitor 不得把运行时替换的瞬时 utun 消失判为 TUN 死亡

- **归属**：G1（已连接=能用：切换/热重载不掉线）；macOS 客户端 `apps/macos`。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/macos-tun-switch-guard-20260922`（关联 PR，提交时未合 main）；
  R1-F1，出自 2026-09-22 macOS 连接生命周期并发/时序审查及对抗核实轮（已确认）。
- **缺陷修复**：切节点（`switchingNodeId`）/配置热重载（`configReloadTask`）/连接成功后的
  后台可选策略（同 `configReloadTask` 句柄）都经 helper `/core/sync` 以 stop+start 重启
  sing-box，utun199 消失 0.2–1.5 s 且 PF 全程 armed；`startCoreMonitor` 的 utun 存在性分支
  只做单次 `if_nametoindex` 判定（同循环 reassert/探测分支均有同款任务抑制，唯此分支
  没有），把正常替换窗口判为 "Protected TUN stopped"，fail-closed 断开+重连，表现为
  “连上/切换后几秒又掉线重连”。现在该分支：替换任务在飞时本 tick 不判死（与既有
  reassert 分支同款抑制）；且要求缺失连续两个 tick（`tunMissingVerdictTicks = 2`）才判死。
  真 TUN 死亡仍 fail-closed 断开，最多延迟一个 tick（2–5 s）确认，判定只延迟、不跳过；
  PF/Kill Switch 语义不变。
- **新增/优化**：为可测性给 `AppState` 加 `tunInterfaceExists` I/O seam（默认真实
  `KillSwitchService.interfaceExists`，生产行为不变），monitor 单次迭代从循环抽为
  `runCoreMonitorTick(state:)`（`CoreMonitorState`/`CoreMonitorTickOutcome` 承载跨 tick
  状态，循环只负责睡眠与退出）。无其他行为变化。
- **工程与测试**：新增一个窄 XCTest
  `AppStateCoreMonitorTests.testMonitorHoldsMissingTUNVerdictWhileRuntimeReplacementIsInFlight`
  （fixture：isConnected + `configReloadTask` 挂起任务 + `tunInterfaceExists=false` → 一次
  tick 不断开；清掉任务再 tick → 此时才进入断开）。XCTest 无法驱动真实特权 helper，
  seam 与 tick 抽取即为此设计；加 seam 但去掉守卫的旧实现会在第一段断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法与访问级别人工自查（结构迁移为纯代码
  搬移 + 控制流映射，未跑机器检查）。回归委托本 PR CI（GitHub-hosted `macos-26`，
  `macos-ci` 由 `apps/macos/**` 路径触发）；提交时 CI 结果未知，不沿用任何旧 SHA 的
  绿灯。准确受测源码为 PR head（基线 576d7087 之上的本分支提交）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：替换窗口命中概率的实机量化未做；R1 审查其余发现（F2–F6）不在本条范围；
  真 TUN 死亡的判定延迟一个 tick 属本修复的有意权衡。
## 2026-09-23 · Windows 升级事务中断后无终态/误回滚的结构修复（F1/F4/F6）

- **归属**：G3 受保护升级中断恢复；Windows Service 更新事务
  （`apps/windows/service` 独立 workspace）+ 协议文档。
- **来源**：基线 main `576d7087` → 分支 `fix/windows-update-txn-recovery-20260922`；
  PR #301；提交时未合 main。
- **缺陷修复**（2026-09-22 并发/时序审查 + 对抗核实轮确认三项同根因：事务全部权威
  出口以精确进程 incarnation 为钥匙、唯一非 commit 终态只对 Install 前发起进程开放）：
  - **F1**（权限绑定单一 App incarnation）：Disconnect/退休 peer 谓词从 pid+started_at
    精确相等改为「owner 匹配 + 注册安装根路径 + 当前摘要为 old/target App 组件」；
    新增 `retire_rolled_back` 归档终态（已验证 Disconnect 且安装身份等于保留原件）。
    触发序：Prepare 持久化后发起 App 退出/执行器回滚（已终止发起进程）→ 重开 App 的
    全部出口被拒。
  - **F4**（successor 单 incarnation + 恢复一律回滚）：`classify_recovery` 三分支按
    「durable plan 是否存在 + 已装组件是否等于 signed target」判定；已等于 target 不
    回滚——successor 未登记的事务由恢复提升为 Replaced，首个 target 身份 App 经
    `authenticate_successor` 重绑收养；`service.start`/`wait_for_service_ready` 失败
    不再经 `SuspendedApp::drop` 终止已登记 successor。触发序：提交前退出新 App 或
    重启机 → 完整已校验安装被撤销且落入 F1。
  - **F6**（Launching 静默终态）：执行器 incarnation 空/死 ⇒ 消费可判定不可能 →
    `retire_unconsumed` 接受 Launching；`reconcile_before_desired` 将该状态置回
    Staged（同一发起 App 可再 launch，或经 Disconnect 退休），不二次授权执行。
- **新增/优化**：UPDATE_PROTOCOL_V1.md 新增「Interrupted-transaction recovery and
  terminal states (2026-09-22 clarification)」小节，只澄清不改变旧条款；U1 单次消费、
  U3 高水位不回退、U4 Disconnect 不伪造提交全部保持（退休只在证明未消费或已验证
  回滚到 old 时发生）。
- **工程与测试**：新增 4 个窄回归——`update_fresh_registered_app_incarnation_can_disconnect_and_retire_unconsumed_attempt`、
  `update_app_started_after_replacement_with_target_identity_is_an_adoptable_successor`、
  `update_launching_without_live_executor_incarnation_is_retirable_after_verified_disconnect`
  （以上在 update_transaction.rs，前三个在旧实现第一处 unwrap 必失败）与
  `update_recovery_classifies_publication_by_installed_identity_not_successor_liveness`
  （update_executor.rs 恢复判定纯函数）。既有
  `update_explicit_disconnect_archives_only_proven_unconsumed_attempts` 中「同注册路径、
  started_at+1 被拒」的断言改为异路径身份拒绝——原断言正是 F1 过度收紧的正面描述。
- **验证**：本机未运行任何 cargo（所有者 2026-09-14 执行位置决定，MacBook 只做
  编辑/审查）；全部委托本 PR 的 GitHub-hosted `windows-2025` Service lane：
  `cargo test --locked --features standalone,client,test` 及既有
  `update_transaction::tests::update_` / `core::update::tests::update_` /
  `update_executor::tests::update_` 定向枚举步。提交时未获得原生结果，不沿用上一轮
  main 的绿灯，也不声称未测代码已验证。
- **候选/发布**：无新包，仅源码。
- **版本生效边界**：升级时运行的 `executor.exe` 是 Prepare 时从**已安装旧版**
  `resources/tono-service-install.exe` 复制的，`--update-recover`/ONSTART 任务与发布前
  全部 Service 侧检查也由已装旧版 Service 执行。因此本 PR 对从 0.0.73（及任何不含本
  修复的版本）出发的首跳升级**不生效**（F4 恢复判定、F6 reconcile、F1 发布前半段均不
  适用），**不构成 G3 证据**；它保护的是从含本修复的版本出发的下一跳升级。
- **剩余限制**：
  - **未解决的独立问题（已存在，非本 PR 引入）**：Replaced 且已验证 Disconnect 仍永久
    pending、产品内无出口——连接、Adopt/Commit、再更新、Quit/登出释放、卸载/重装全部被
    拒（网络已释放，不泄漏流量）。这是可达性最高的产品锁死路径：升级后自动重连失败 →
    用户点 Restore internet 即触发。需单独设计「已安装+已释放」归档终态（不能把释放当
    commit，备份清理归属需明确），另立待办。
  - **跟进项（安装完整性缺口，无保护绕过）**：恢复判定（`classify_recovery`
    TargetVerified）与 `retire_rolled_back` 以三组件（Tono.exe / tono-core.exe /
    tono-service.exe）摘要代替整份 durable plan（整棵 payload 树 + `core-sha256.txt`，
    逐成员 `old_digest/new_digest`）成员校验；发布在二进制之后、后续成员之前中断，或
    回滚恢复了二进制而未恢复某资源时，会被判为全部发布/全部回滚。修法是逐成员校验。
  - 非 Windows 平台的 incarnation 探测编译为恒「已死」，只影响开发编译路径（该
    crate 测试仅在 windows-2025 lane 执行）；Windows 11 实机升级中断验收仍属 G3 未闭合
    证据。
- **剩余限制**：Replaced 且已验证 Disconnect（用户显式拒绝一个已完成安装）仍保持
  pending（不回滚也不退休），需后续单独判定；非 Windows 平台的 incarnation 探测编译
  为恒「已死」，只影响开发编译路径（该 crate 测试仅在 windows-2025 lane 执行）；
  Windows 11 实机升级中断验收仍属 G3 未闭合证据。
## 2026-09-23 · Windows PrepareCoreStart 绑定当前 release epoch（R2-F6）

- **归属**：G1 连接生命周期（I1：旧 attempt 的迟到 Service 副作用不得影响新会话）；
  平台/模块：Windows Service IPC 协议（`apps/windows/service`，App 侧无代码改动，
  客户端逻辑在 `tono-service-protocol` 内）。
- **来源**：基线 main 576d7087 → 分支 `fix/windows-prepare-start-freshness-20260922`；
  PR 与准确源码 SHA 见续记，提交本条时未合 main。
- **缺陷修复（R2-F6，源码确认 + 需实机级）**：被取消 attempt 的
  `POST /clash/prepare-start` 迟到数秒到达时，该路由只有 `Unchecked` owner 门、
  无会话/epoch 新鲜度令牌（对照 Lock/MarkVerified/Stop 均有会话门），且
  `is_protected_startup_replacement_candidate` 对后继连接未验证的 Core 为假，
  `prepare_start(false)` 会停掉后继受监督 Core，表现为一次莫名连接失败
  （fail-closed，不泄漏）。修复：协议 revision 17 起，客户端在发出该破坏性请求前
  经 `GET /version` 快照 Service 的 `RELEASE_EPOCH`（复用 StartClash 已有 epoch
  机制，不引入新令牌类型）并在请求内携带；Service 在 `OWNER_LIFECYCLE_LOCK`
  内比较，epoch 不等于当前 → 以新错误码 `StaleReleaseEpoch`(1013, HTTP 409)
  拒绝，拒绝发生在任何快照/操作发布/Core 停止之前，无半停止状态。合法路径
  （App 存活、期间无显式 release）行为不变。兼容：新旧混合配对时——新 App +
  旧 Service（<rev 17）由能力探测降级发送旧 `null` payload，行为同旧版；
  旧 App + 新 Service 的无 epoch 请求**被接受**，由 Service 在请求到达时自取 epoch
  快照、在锁内比较（与 StartClash 的到达时快照相同）。
- **审查修正（第二轮）**：初版对旧 App 的 `null` 请求一律 409，结果探测判定配对
  可用，之后每次连接都在 prepare 阶段永久失败，违反 `lib.rs` "Reject a
  mismatch at the protocol probe" 规则。没有把 `MIN_SUPPORTED_CLIENT_REVISION`
  提到 17：探测门 `require_protocol_version`（`server/mod.rs` 686-700，经
  `authenticate_request` 741 行）同样挡在 `ReleaseKillSwitch`/`StopClash`/
  `RestoreProtectedDns` 前面，提到 17 会让与新 Service 短暂共存的旧 App 无法
  释放 WFP、无法恢复 DNS。改为对 Legacy 采用到达时快照，旧 App 行为不比
  rev 16 差。
- **新增/优化**：`ProtocolInfo` 增加 `release_epoch`（`#[serde(default)]`，
  仅服务端 GetVersion 路由填充）；`PrepareCoreStartPayload` 采用与
  `StopClashPayload` 相同的 untagged `Legacy/Freshness` 线型。
- **工程与测试**：新增一个 Service 集成回归
  `late_prepare_core_start_superseded_by_release_cannot_stop_the_successor_core`
  （`tests/test_owner_lifecycle.rs`）：快照 epoch → 显式 release（真实 bump）→
  后继 StartClash（Core 未验证）→ 用旧 epoch 发 PrepareCoreStart → 断言返回
  `StaleReleaseEpoch` 且 `core_pid` 不变；若门被移除，后继 PID 断言失败。
- **验证**：本机（MacBook）按所有者 2026-09-14 决定只做编辑与源码自查，
  未运行 `cargo build/test/check/clippy`；回归委托本 PR CI 的 GitHub-hosted
  `windows-2025`（`cargo test --locked --features standalone,client,test`），
  结果以该 run 的实际 checkout 为准，不预支。R2-F6 的实机触发窗口
  （数秒级 IPC 在途延迟）未在 Windows 11 实机复现，维持原定级。
- **候选/发布**：仅源码，无新候选、无新包；未触碰 WFP/PF 规则、DNS 恢复语义、
  `appcast.xml`/`latest.json` 或 `windows-updates`。
- **剩余限制**：不 bump epoch 的取消路径不刷新令牌：StopClash(release=true)
  在无 armed 时为空操作；节点消失 `selected_node_vanished`（`stop_core(false)`，
  无 release）；更新安装的 `invalidate_connection(false)`；连接事务 240 s 超时。
  经这些路径取消的 attempt，其迟到 prepare 仍可能通过门，但触发条件比已修的
  Disconnect→重连序列更窄。修复只在 Service 也升到 rev 17 后生效：
  `MIN_REQUIRED_SERVICE_REVISION` 仍为 14，只升级 App 时新 App 对旧 Service
  发 Legacy，F6 未修。旧 App 配新 Service 时只拿到到达时快照，在途迟到请求
  仍会漏过（与 rev 16 相同）。Service 重启会把 epoch 归零，快照于重启前的请求
  被拒绝并表现为一次连接失败（fail-closed，重试即恢复）。第二轮修正同样
  本机未编译，委托 CI；已有回归测试走 Freshness 路径，不受本修正影响，未改。

## 2026-09-23 · Windows connecting 期间到达的 policy 行为变更不再丢弃

- **归属**：G1「已连接=能用」——已连接会话应按最新已安装 policy 提供 DIRECT/WeChat
  直连覆盖，而不是把 connecting 期间到达的行为变更静默丢到下次手动重连（会话内一致性，
  属已连接行为，不占 G2 的失败下一手）。
- **来源**：基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087)，分支
  `fix/windows-policy-defer-connecting-20260922`（PR 见该分支）；提交时未合 main。
- **缺陷修复**：R2-F5（对抗核实降级为低后只修丢弃/延迟部分；原报告"UI 显示直连已开"
  被 V5 核实推翻——实际走 `skip_optional_direct_policy` 写 `optional_direct_skip`，
  UI 如实显示 directSkipped，故本条不改前端）。原行为：FSM 处于 Connecting 时
  `handle_policy_behavior_change → handle_network_change_inner` 入口守卫直接无操作且无
  任何待处理记录；连接成功后 `spawn_optional_direct_after_connected` 携带连接前捕获的
  旧 policy 快照，`direct_context_is_current` 比对 revision/digest 不一致 → 跳过 overlay，
  新 policy 的 DIRECT 授权本会话永不应用，直到下次重连（pin-refresh 的 wechat 腿也因
  `applied_wechat_path_regexes` 为 None 不补放）。现行为：connecting 期间的行为变更由
  `policy_change_disposition`（ReconnectNow / DeferUntilConnected / Ignore 纯判定）给出
  DeferUntilConnected 并在 `TonoInner` 记录 pending（记下该 attempt 的 connect
  generation）；每次代际退役（Disconnect、连接失败、账户关闭/切换、下一次 attempt 准入）
  都清除 pending，connect 提交块在 `connect_succeeded` 后只消费与本 attempt 代际相同的
  记录，其它一律丢弃，因此绝不会串到下一个会话或其他账户；判定时在同一锁下重新核对
  `sign_in_generation`。消费后用最新已安装 policy 重建快照再走 optional-direct 应用
  路径。若刷新后的 policy 含 DIRECT 内容而本次连接**从未尝试**接口发现
  （`needs_physical_interface` 为假，内容从无到有），改走与已连接时相同的受保护
  teardown + 重连，由新事务发现接口并安装新 policy；该兜底任务携带本 attempt 代际，
  入口处会话已不是该代际的 Connected 就退出。接口发现**已尝试但失败**（虚拟/Hyper-V
  默认路由常态）不触发兜底，仍走原 skip 路径保持全隧道。已连接时立即 teardown+重连、
  DIRECT 应用失败的 restrict/不重连收敛、policy 写锁与 DIRECT 激活读锁互斥的既有
  纪律均不变；不泄漏（跳过路径保持全隧道）。
- **新增/优化**：无新功能。
- **工程与测试**：`connection/monitor.rs` 一个回归
  `a_policy_change_deferred_during_connecting_is_consumed_only_by_that_attempt`
  （`#[tokio::test]`：attempt A Connecting 时记录 pending → 按 `disconnect()` 的顺序
  `invalidate_connection` 后断开 → 下一 attempt B 提交时 `take_pending_policy_change(B)`
  为假；B 之后的 attempt C 自己记录的 pending 在其提交时被消费且仅一次）。审查返工前的
  实现断开不清 pending、消费不比代际，"不得到达下个会话"一条会失败（返工前的测试反而
  把"断开后记录仍在"写成了预期，已改正）。兜底条件与代际入口检查未被单测覆盖。
  三个 Windows Cargo workspace 保持分离，仅改 `app`。
- **验证**：本机未运行 cargo 构建/测试/格式检查（2026-09-14 执行位置决定：MacBook 只做
  编辑与源码自查）；委托本 PR 的 GitHub-hosted CI——`windows-2025` 上
  `apps/windows/app/src-tauri` 的 `cargo test --locked` 覆盖上述测试。提交时未获得 CI
  结果，不把未跑的检查写成通过；准确源码 SHA 以 PR 为准。审查返工（pending 清除与
  代际比较、兜底只在"从未尝试发现"时触发、兜底任务带代际）同样本机未编译，委托 CI。
- **候选/发布**：无新包，仅源码；不改 `appcast.xml` / `windows-latest.json`，不推
  `windows-updates`。
- **剩余限制**：只修 connecting 窗口的丢弃/延迟。兜底任务的代际检查与
  `handle_network_change_inner` 再次捕获代际之间仍有一个很小的锁释放窗口（与 policy_sync
  调用方同一纪律）。V5 旁注的 `directOverlay==='off'` 被前端渲染为 directOn 已由
  #296 修复（仪表盘只在 `directOverlay==='on'` 时显示 directOn），不再是剩余限制；
  Windows 11 实机行为未验证，夹具结论不等于设备验收。

## 2026-09-23 · Windows 监视器重连成功后不再自中断丢失连接尾部

- **归属**：G1（已连接=能用；monitor 恢复的会话与用户点 Connect 的会话尾部行为一致）。
  影响 `apps/windows/app` 连接编排与仪表盘。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087) → 分支
  `fix/windows-monitor-self-abort-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-monitor-self-abort-20260922)。
  提交时未合 main。
- **缺陷修复**：R2-F4（对抗核实降级后仍成立）：网络监视器驱动的重连在旧 monitor
  自己的任务栈内联执行，成功尾部 `spawn_network_monitor` 无条件
  `abort_network_monitor()`，abort 了槽位里正在执行 `run_stages` 的自己；tokio 仅标记
  取消，任务在下一个 Pending await（`spawn_control_plane_pin_refresh` 的
  `state.lock().await`，常与托盘刷新任务争锁）被销毁。核实确认的实际损失：本会话
  DIRECT 覆盖层缺失（国内/WeChat 直连回到全隧道，fail-closed 不泄漏）、pin-refresh
  注册丢失（新任务以孤儿存活、靠代际自查，功能不丢）、`seed_autostart_after_connect`
  跳过（仅首连生效，无实质影响）；且 `direct_overlay="off"` 被仪表盘 connectHint 当成
  直连已开显示（旧逻辑只区分 `skipped`）。现在
  `TaskRegistry::register_network_monitor` 比较 `JoinHandle::id()` 与
  `tokio::task::try_id()`，槽位句柄即当前任务时只替换不 abort；旧 monitor 完成连接
  尾部后按既有 `connection_loop_continues(Handled)` 语义自行退出。前端仅
  `directOverlay === 'on'` 显示 directOn，`off`/`skipped` 显示 directSkipped。
- **新增/优化**：无新能力。DIRECT 覆盖层语义、WFP 保护、断开/登出路径的
  `abort_connection_tasks` 全部不变；其余替换路径（用户 Connect、重连退避、节点切换）
  仍中止被替换的监视器。
- **工程与测试**：新增一个回归
  `a_monitor_replacing_its_own_registration_finishes_the_connect_tail`
  （connection/monitor.rs tests）：任务把自身句柄放入槽位后执行同一注册逻辑，
  `yield_now().await` 后 oneshot 发送并断言接收；旧无条件 abort 语义下任务在 yield
  后被取消、收不到 → 失败。
- **验证**：按所有者 2026-09-14 执行位置决定，本机（MacBook）仅编辑与源码自查，
  未运行 cargo/npm 构建与测试；`apps/windows` workspace `cargo test` 与该回归委托
  本 PR CI（GitHub-hosted `windows-2025`），结果续记于 PR。未在 Windows 11 实机复现
  monitor 驱动重连场景。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：实机上的监视器重连后 DIRECT 覆盖层到位情况未验证；UI 提示
  directSkipped 同时覆盖 `off` 与 `skipped`（两者语义一致：国内直连未开）。

## 2026-09-23 · Windows 原生更新接管后不再搁浅 Connecting 状态机

- **归属/来源**：G3 升级生命周期与连接交错（R2 审查 F3，V5 对抗核实已确认）；基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-update-connecting-fsm-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-update-connecting-fsm-20260922)。
  提交时仍是独立修复分支，未合 main。选 G3 而非 G1：缺陷不在断开/恢复语义本身，而在原生
  更新事务（Prepare/Install）作废在途连接 attempt 后的收敛缺口；G1 的断开与释放路径未被触碰。
- **缺陷修复**：`tono_install_update` 下载完成后 `inner.invalidate_connection(false)` 使在途
  连接事务以 `Attempt::Stale` 返回（按约定不改 FSM），而后续收敛只折叠 `is_connected`
  （tunnel_died），`resync_after_cancelled_quit` 两侧分支都不命中 connecting——更新失败后
  FSM 永久停留在 Connecting，connect/retry 全拒，仅手动 Disconnect 可解。现把该收敛抽为
  `quiesce_connection_after_update(fsm, core_running)`：connecting 未 armed → 回 Not Connected；
  已 armed → 保留 blocked 闩收敛为 Protected Offline（不放宽保护：更新不是 Disconnect）；
  Connected 行为保持现状（仅 Service 报 Core 已停时 tunnel_died）。审查修正（代际门）：
  收敛原先只要 Service 快照有应答就折叠 connecting，若更新在 `invalidate_connection` 之前
  失败（如下载中途因 WinTUN 改路由断流），会把一个活着的 attempt 强改为 Not Connected，
  进而令其提交时 `InvalidSuccessPrecondition`、已验证连接被丢弃换成受保护重连。现在作废时
  记下 `connect_generation`，仅当它仍等于当前代际（即确是本次更新作废的 attempt）才折叠
  connecting；未作废或代际已被更新后准入的新 attempt 推进时不碰 FSM。遗留 `tono_prepare_update`
  （quit.rs）形状相同但前端与 `generate_handler` 均未引用（死代码），本轮不动，留待专门清理。
- **新增/优化**：无。
- **工程与测试**：app workspace 新增一个窄回归 `update_quiesce_never_strands_connecting`
  （update.rs 测试模块），覆盖未 armed → Not Connected 与已 armed → Protected Offline 两个
  收敛分支，并在同一测试中断言“更新未作废（None）或代际已推进”时进行中的 connecting 不被
  改动（修正前函数无条件折叠 connecting，该断言会失败）；无表驱动套件。代际比较在纯函数内，
  调用点只负责传入作废时与收敛时的代际，调用点本身无测试覆盖。tono-core 无改动（复用既有 `initial_release_failed` /
  `tunnel_died` 转移），三个 Windows workspace 保持分离。
- **验证**：本机（MacBook）按所有者执行位置决定只做源码编辑与 diff 自查，未运行任何
  cargo build/test/check（原生构建禁止本机执行）；编译与回归委托本 PR 的 GitHub-hosted
  `windows-2025` CI（app workspace `cargo test`）。准确源码 SHA 与 CI 结果续记于关联 PR；
  提交时无本机测试结果，不沿用其他 SHA 的绿灯。
- **候选/发布**：仅源码，无新候选包；未触碰 `appcast.xml` / `windows/latest.json` /
  `windows-updates`。
- **剩余限制**：更新在作废前失败时不触碰 FSM（进行中的 attempt 自行完成其转移）。更新收敛依赖 Service 状态快照应答；Service IPC 完全无应答的极端情形仍保持
  本地视图（与取消退出路径的既有设计一致）。该缺陷为已核实的源码推导（R2 + V5），修复前
  未在 Windows 11 实机复现，实机验证仍属 G3 验收范围。

## 2026-09-23 · Windows App 在 Protected Offline（armed 未验证）期间的 Service 真值再同步

- **归属/来源**：G1 断开/保护状态与实际一致（R2-F2）；影响 Windows App
  （`apps/windows/app`，三个 Windows workspace 保持分离）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-service-restart-resync-20260922`
  （[与 main 的差异](https://github.com/raydocs/tono/compare/main...fix/windows-service-restart-resync-20260922)，
  PR 随后在该分支上创建）；提交时未合 main。
- **缺陷修复**：App 存活并显示 Protected Offline（armed 未验证）期间 Service 重启时，
  Service 启动路径 `retire_unverified_windows_kill_switch`（`bin/service.rs` →
  `retire_unverified_on_service_start` → `disarm_unlocked`）会自动删除全部 WFP 过滤器并
  恢复 DNS，而 App 侧核实无任何再同步路径（monitor 仅 `is_connected` 时运行、自动重连需
  `session_verified`、`tono_status` 只回缓存、restore 探测只在启动、IPC 每请求新建管道无
  断线回调），UI 持续显示"已封锁"而机器已明文开放——I3 明文禁止的反向不一致。修复两部分：
  (1) 把 `resync_after_cancelled_quit` 里的 KillSwitchStatus → FSM 折叠抽成
  `apply_service_kill_switch`（`commands/quit.rs`），quit 路径与轮询共用同一语义；
  (2) 新增有界 Service 真值轮询 `protection_resync_loop`（`connection/monitor.rs`，30 s 一次
  读 `/status` 的 kill_switch 聚合），FSM 处于空闲 Protected Offline（armed 未验证为原始
  形态，推广到全部 protection_blocked idle）时经 `TaskRegistry.protection_resync` 注册，
  离开该状态即撤销（registry abort + 循环自退，无常驻线程）；注册点：
  连接失败收敛尾、节点消失/冷切换、启动与重试 restore 尾、释放协调 settled 回调、取消退出
  resync。只在 Service 亲口证明 `wanted=false` 时收敛 FSM 到 Not Connected 并清闩；读不到
  状态保持原状（fail-closed，不放宽保护）；IPC 在途代际变动时不折叠陈旧读数。
- **新增/优化**：无客户可见新功能；仅上述再同步任务与 TaskRegistry 槽位。
- **工程与测试**：新增一个回归
  `protected_offline_converges_when_the_service_proves_the_barrier_gone`
  （`connection/monitor.rs`，`#[tokio::test]`，无 AppHandle 依赖的 spawn 注入）：armed-unverified
  idle 夹具断言 (a) TaskRegistry 持有 protection 轮询句柄——这是新 seam 的存在性测试，
  在 main 上的失败方式是编译失败（`protection_resync` 字段与 `ensure_protection_resync_locked`
  不存在），不是行为失败；它只证明该函数在匹配状态下注册，不覆盖各生产入口是否调用它
  （入口接线靠源码核对）、
  (b) `apply_service_kill_switch(…, Some(wanted=false))` 后 `!kill_switch_armed` 且
  `ui_state == NotConnected`（锁住折叠语义）。W4/W5/W10 已修项（release 所有权、元数据收尾、
  55 s UI 等待）行为不变。
- **验证**：本机（MacBook，编辑机）按 AGENTS.md 执行地点约束未运行任何
  cargo build/test/check/clippy；回归与编译委托本 PR 的 GitHub-hosted `windows-2025`
  CI（app workspace `cargo test`）。源码自查基于逐文件比对，不声称本机已验证。
- **候选/发布**：无新包，仅源码；不涉及 Sparkle/windows 更新源。
- **剩余限制**：登出/关闭路径无需单独挂钩——生产上所有 release（Disconnect、quit/失败转移
  的 `release_explicit`、登出与 restore 的 `release_for_account`）都经 `start_explicit_release`，
  其 settled 回调在监督者更新 FSM 之后、`operation.complete()` 之前注册轮询；唯一直接调用
  `coordinate_release` 的 `commands/account.rs` 位于 `#[cfg(test)]`。但登出 release 被拒时
  FSM 处于 blocked（从而被轮询覆盖）依赖 #295（R2-F1）落地；未合 #295 时未 arm 竞争分支
  FSM 为 Not Connected，是 F1 本身而非本条。已验证会话经 monitor `tunnel_died` →
  `schedule_reconnect_for_generation` 进入 idle Protected Offline 且未排程重连（如重连预算
  耗尽）时不注册轮询；已验证 intent 在 Service 重启时保留、不被 retire，不构成 I3 反向。
  实机"Service 重启 + 存活 App"组合夹具仍缺
  （known-findings §6），本轮以源码级路径与单测覆盖。

## 2026-09-22 · Windows 拒绝释放后的连接 FSM 保护可见性

- **归属/来源**：G1 断开与恢复——断开后保护状态必须两端一致；本条修的是 Service
  拒绝 release 时 App FSM 谎报 Not Connected、Disconnect 随之变成空操作的断开一致性
  缺陷。基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/windows-release-refused-fsm-20260922`（PR 见关联分支）；提交时未合 main。
- **缺陷修复**：R2-F1（2026-09-22 并发/时序审查 + 对抗核实轮已确认）。Disconnect/登出
  与 in-flight StartClash 竞争且 Service 拒绝 release 时，release 监督者只调
  `initial_release_failed()`，而该方法把 `is_protection_blocked` 折叠成本次 attempt 的
  本地 `kill_switch_armed` 闩——该闩被 StartClash 竞争跳过、从未置位，FSM 于是报
  Not Connected，WFP 实际仍 Blocked；此后 `disconnect()` 命中 idle 早退成空操作，托盘
  禁用 Disconnect。现在监督者 Err 分支先 `mark_kill_switch_armed()` 再
  `initial_release_failed()`（拒绝本身即事实，fail-closed 假定保护仍在，与错误文案
  "protection stays on" 一致）；`tono_sign_out` 的 release 失败早退分支同样置闩，与既有
  Expired 收尾分支对齐。不放宽保护：WFP 删除逻辑、Service 侧、fail-closed 语义均未改。
- **新增/优化**：无。
- **工程与测试**：新增一个窄回归
  `refused_release_after_an_unarmed_connect_race_keeps_protection_visible`
  （`apps/windows/app/src-tauri/src/tono/connection/disconnect.rs` tests）。旧实现上该测试
  必失败：夹具 `begin_connect`+`begin_disconnect`（闩未置位）加注入 Err 的 release，
  旧 `initial_release_failed` 得 `is_protection_blocked=false`，末条断言不成立。
- **验证**：本机未编译未运行（编辑机约束，见 [BUILD_AND_TEST](BUILD_AND_TEST.md)）；
  回归委托本 PR 的 GitHub-hosted CI（`windows-2025`，`app-rust` job 在
  `apps/windows/app/src-tauri` 跑 `cargo test --locked`，路径过滤命中 `apps/windows/app/**`）。
  准确源码 SHA 为本 PR 实际 push 的 commit（PR head）；提交时 CI 结果未产出，以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：只修 FSM 闩推断，不改变 Service 拒绝 release 的根因（DNS restore 失败、
  core 终止未确认、WFP 过滤器删除失败仍会拒绝并保持 armed）；Windows 11 实机断开/恢复
  清单未重测，不据此关 G1。监督者 Err 分支不区分 Err 来源、不读 Service 真值：Err≠拒绝
  的子情形（Service 不可达/修复被拒、更新栅栏、release 任务 join 失败）同样置闩，若此时
  机器从未 arm（Disconnect 落在 StartClash 之前），会被显示为 Protected Offline 而实际开放；
  这与 `restore.rs` 对 `Unknown` 的既有取舍（记作 armed、不 verified）一致，由 #299 的
  Service 真值轮询在 Service 可达后约 30 s 内以 `wanted=false` 纠正（未合 #299 时无自愈）。

## 2026-09-23 · Windows 混合 DNS 残留不能证明恢复成功

- **归属/来源**：G1 断开与恢复；从已合入的
  [4d4aafc8](https://github.com/raydocs/tono/commit/4d4aafc8129988cee76150ddb7ebdf0becd7d4b2)
  继续定点检查，分支 `fix/dns-followup-20260923`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/dns-followup-20260923)。
  本条提交时仍是独立修复分支，不沿用上一轮 main 合并授权。
- **缺陷修复**：恢复快照损坏、进程内没有旧失败标记时，IPv4 `NameServer` 或
  `ProfileNameServer` 中的 `1.1.1.1, 198.18.0.2` 被“列表全是 Tono 地址”的判断漏掉，
  `recover_unreadable_snapshot` 可错误接受恢复并隔离唯一快照；卸载恢复也会漏选这个适配器。
  现在复用已有“包含当前 TUN DNS 地址”的判断：仍有该地址就保留快照并拒绝恢复成功，
  不把公共备用 DNS 当成移除残留的证据。旧 loopback/用户本地解析器处理保持不变。
- **工程与测试**：新增一个生产 facade 回归
  `mixed_protected_dns_cannot_prove_corrupt_snapshot_recovery`，经过真实损坏文件解析、
  原生 engine 的注册表读取、恢复拒绝和卸载选择；清除残留后还须能完成恢复并保留隔离文件。
  延用 OS I/O 隔离夹具，补入 NRPT/DoH 恢复计数，避免反例和正例触碰宿主策略；没有伪造
  facade 的成功/失败结果。既有 native DNS 前缀已覆盖新测试，无工作流改动。
- **验证**：本地只做 diff/格式检查；原生命令由现有 GitHub-hosted `windows-2025` Service
  执行：`cargo test --locked --features standalone,client --lib core::dns::engine::native_apply::tests:: -- --nocapture`，
  前置相同前缀的 `-- --list` 防止零测试。准确源码 SHA、实际结果及日志续记保留在关联 PR；
  提交时未获得本次原生结果，不把上一轮 main 的绿灯移用到此修复，也没有修复前的原生红灯。
- **新增/发布/限制**：无新功能、无新包、无部署；只收紧残留 DNS 的恢复证据，不变更
  WFP、恢复超时、原始 DNS 字符串或快照 schema。夹具验证不等于 Windows 11 实机恢复、
  真实 API/适配器变化或 G1/G3 验收；本轮定点检查不表示整个产品已无 bug。

## 2026-09-23 · 桌面源码合入 main，保留发布边界

所有者在本线程明确要求把能合并的 PR ship 到 GitHub `main`。归属仍为 G1–G3
桌面整改、升级与可追溯验收；本轮是源码集成交付，不是新的功能实现或客户发布。

- **已合入**：[#289](https://github.com/raydocs/tono/pull/289) 正常合并为
  [1ca878cf](https://github.com/raydocs/tono/commit/1ca878cfb8f9c213356eae263a83e5eba0b39075)，
  一次保留 #281 → #282 → #283 → #286 → #289 的完整提交历史和最终修复。
  合并前 main 为 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；
  `git diff --exit-code d954a7f740f95f141136af423a39338d79a1b674 origin/main` 返回 0，
  合并结果与已验证最终组合源码的完整树相同，没有把有已知续修的中间版本逐次送入 main。
- **说明已合入**：[#280](https://github.com/raydocs/tono/pull/280) 正常合并为
  [e94161e0](https://github.com/raydocs/tono/commit/e94161e07593d581995b4a9eecc54030eeaa7118)。
  相对上一项仅增加两端 release notes 和既有 RC 报告，不改变候选字节。
- **重复 PR 收尾**：GitHub 已把 #281 标记为 merged；#282/#283/#286 的准确 head
  已是 main 的祖先，作为已集成记录关闭。#277/#278/#284/#285/#287/#288/#290 经
  `git cherry` 确认所有提交均有等价补丁，再按 #279/#289 的组合交付关闭。
  这不是丢弃源码，也不把子分支曾有的编译/测试失败改写成通过；没有重复合入旧实现。
- **依赖组合另验**：三个原有绿灯 PR [#252](https://github.com/raydocs/tono/pull/252)、
  [#255](https://github.com/raydocs/tono/pull/255)、[#256](https://github.com/raydocs/tono/pull/256)
  在新 main 上无冲突合成 [#292](https://github.com/raydocs/tono/pull/292)，准确源码
  [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)。
  只含 Rollup、Windows 前端依赖组与 Rust 锁文件这七个文件；新 updater 的依赖条目保留。
  `git diff --check origin/main...HEAD` 返回 0；记录时组合 Windows CI 待完成，仍为 Draft，
  尚未合入。8 分钟有界等待结束时 18 项成功、2 项 Windows app-rust 待完成，详见
  [当时状态及续验入口](https://github.com/raydocs/tono/pull/292#issuecomment-5787253794)。
  已完成的准确 push 日志确认：
  [前端](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851595) 36 文件/282 测试通过；
  [Service](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851691) 310 项 lifecycle、
  6 项 DNS、4+3+1 项更新及 WFP 形状检查通过。旧依赖 PR 的绿灯不代替新组合证据。
- **未强行合入**：[#253](https://github.com/raydocs/tono/pull/253) 的 control-plane/
  ops-contract/migrations 失败；[#254](https://github.com/raydocs/tono/pull/254) 的
  ops-contract 与四个 E2E shard 失败；[#203](https://github.com/raydocs/tono/pull/203)、
  [#204](https://github.com/raydocs/tono/pull/204) 有冲突且保留未完成的产品范围。
  [#275](https://github.com/raydocs/tono/pull/275) 仍是固定旧二进制的单次诊断 Draft，
  其红/绿诊断已用于 #276 修复，不把过时的例外工具作为新主线功能合入。
- **验证与限制**：合并前复核 #289 的 12 项检查全成功，原始命令、确切 CI checkout、
  377 项 macOS（1 skip）及 Windows DNS 6 项/lifecycle 310 项等证据见下文 F。
  合入 main 后 [Services CI](https://github.com/raydocs/tono/actions/runs/35804170997) 成功；
  [macOS CI](https://github.com/raydocs/tono/actions/runs/35804298002) 的实际 checkout 为上述
  e94161e0，仍是 377 项、1 skip、0 失败；旧 1ca878cf 的 macOS run 被后续 push 的既有
  concurrency 规则取消，不计通过。[Windows Service](https://github.com/raydocs/tono/actions/runs/35804170998/job/107001095427)
  实际 checkout 为上述 1ca878cf，310 项 lifecycle、6 项 DNS 及更新/WFP 检查通过；当时
  app-rust 仍在跑，不声称整个 main workflow 全绿。命名结果来自完整 job 日志，非步骤名推断。
  未手动 dispatch、重跑或取消 CI，也未创建后台监控或自动合并承诺。
  本记录的文档整理不另跑产品测试。没有 force push、历史改写、分支删除或工作树清理。
- **候选/发布：源码交付，未发布新候选。** 已发布 RC 仍固定在旧的 569ce865，仍不含下文 C–F；
  常规 CI 产生的未签名构建不是已签名 RC，不替换旧下载包。未部署 Worker、签名、安装设备、推进 Sparkle/windows
  更新源，#26 及原有 G1/G3 实机、PF/WFP/DNS 与性能证据要求不因合并关闭。

### 2026-09-23 续记 · 剩余依赖检查完成并合入

整理交付记录期间的最终复核发现两个 app-rust 已完成；[#292 的完成续记](https://github.com/raydocs/tono/pull/292#issuecomment-5787272136)
保留了这个状态变化，没有删除上面的 pending 观察。准确组合源码的 **20/20 检查全部成功**，
包括 [Windows push 原生消费者](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851447)：
499 项 Tauri、18 项 journal、3 项 atomic、1 项共享合同通过；另一个原有 opt-in target 的
1 项 ignored 不计为执行成功。CI 日志提取摘要可用但命名列表有截断，不充作全需求证明。

[#292](https://github.com/raydocs/tono/pull/292) 随后正常合入 main 为
[4f58da37](https://github.com/raydocs/tono/commit/4f58da37fffa15bf5dc4430d6afb413af6e9561c)。
合并后的完整树与已测试的 [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)
相同；GitHub 同时确认 #252/#255/#256 均为 merged。没有另行解决依赖代码冲突、变更锁文件
之外的实现或放宽测试。此前桌面合并的 Windows run 35804170998 此时也已全部成功。

本总账及维护规则通过 [#291](https://github.com/raydocs/tono/pull/291) 的文档变更收尾。
最后的新 main push CI 是独立运行，不把上述合并前或前一 main 的通过数重标为该 run 的结果。
保留未合入项仍为 #253/#254 的失败检查、#203/#204 的冲突/未完成范围和 #275 的旧诊断 Draft。
已合入源码与既有 RC 的包含关系仍不同，发布及实机门不变。

## 2026-09-21—23 · 工程整改线程全程回填

来源：[Tono 工程整改验收线程](https://ampcode.com/threads/T-01a0c5d0-1c0d-77a0-b272-0a931282c5b5)。
本条按已交付提交、PR、分项报告和候选来源回填，不把线程启动前已存在的修复重新算作发现。
例如 #240/#242/#244/#258/#262 及其子 PR 的代码被纳入基线/后续合并，但不是本条新发现的 20 项。
首轮报告明确编号 **20 项（W1–W14、M1–M4、S1–S2）**；下文另列后续修复与功能，
不把它们混成一个无法复核的「全部 bug 总数」。

### 交付与包含关系（2026-09-23 合入授权前的历史快照）

以下保留首次回填时的状态，不覆盖当时的未合入/未验证事实；后续合入状态以上方续记为准。

| 批次 / 归属 | 源码与 PR | 当前交付状态 |
|---|---|---|
| 首轮工程整改 / G1–G3、ops | [#267](https://github.com/raydocs/tono/pull/267)，合并 [0e20f2df](https://github.com/raydocs/tono/commit/0e20f2df671a528d80c2366d65aca3df1830117a)；含 #268/#271/#272 | 已合 main；20 项源码整改和组合证据见 A。 |
| 候选安装与构建 / G3 | [#276](https://github.com/raydocs/tono/pull/276)，实现 [429d6e40](https://github.com/raydocs/tono/commit/429d6e40ea775d0fb38d0e84053a4e44943c015e) | 已合 main；含 B 的安装路径和候选配置修复。 |
| 两端易用性 / G1–G3 | [#279](https://github.com/raydocs/tono/pull/279)，合并 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；含 #277/#278 | 已合 main；也是当前已发布 RC 的冻结源码。 |
| 测试包及说明 / G1/G3 | [#280](https://github.com/raydocs/tono/pull/280)，文档 [3d57e59c](https://github.com/raydocs/tono/commit/3d57e59ccb7cb4b4248f32733ecafeb89a51b800) | RC 已发布；说明 PR 尚未合并。不能把说明提交当包源码。 |
| #251 续修 / G1/G3 | [#281](https://github.com/raydocs/tono/pull/281)，[ac2cde16](https://github.com/raydocs/tono/commit/ac2cde16a5e303a09e0bc8893f02972b34671115) | 已推送、未合 main；C。 |
| 共用升级合同 / G3 | [#282](https://github.com/raydocs/tono/pull/282)，[e811d740](https://github.com/raydocs/tono/commit/e811d740bfc733f65b54bf6ea4223d4f250482c8) | 已推送、未合 main；仅该批是未接入的值模型，不单独声称原生升级完成。 |
| 原生升级接入 / G3 | [#283](https://github.com/raydocs/tono/pull/283)，[aeb4b5ad](https://github.com/raydocs/tono/commit/aeb4b5ad69330507fdeed70a4b263667b2619eda)；含 #284/#285 | 已组合、未合 main；D。受保护装机验收仍开放。 |
| 连接优化 / G1/G2 | [#286](https://github.com/raydocs/tono/pull/286)，[705e16d9](https://github.com/raydocs/tono/commit/705e16d9ac80a800591da195c0c360029db0ff77)；含 #287/#288 | 已组合、未合 main；E。没有设备提速百分比证据。 |
| DNS 反例续修 / G1 | [#289](https://github.com/raydocs/tono/pull/289)，[d954a7f7](https://github.com/raydocs/tono/commit/d954a7f740f95f141136af423a39338d79a1b674)；含 #290 的测试与修复 | 已组合、ready for review、12/12 CI 检查成功，未合 main；F。 |

未合并源码的依赖链为 **#281 → #282 → #283 → #286 → #289**；子 PR 已实际集成，
不是只引用提交号，也不应重复计算/重复应用。当前远端 main 与 RC 都仍是 569ce865，
**已发布 RC 不包含 #281 及其后的 picker、原生升级、连接优化和 DNS 续修**。

### A. 首轮确认并修复的 20 项

原始归属、反例、命名测试、红/绿结果与未覆盖模块见
[组合整改记录](reports/ENGINEERING_ACCEPTANCE_2026-09-21.md)、
[macOS 分项](reports/ENGINEERING_MACOS_2026-09-21.md)和
[服务端分项](reports/ENGINEERING_SERVICES_2026-09-21.md)。以下保留原编号，便于逐项回查。

| 编号 | 确认的失败场景 → 修复结果 |
|---|---|
| W1 / #247 | 重试槽位覆盖后旧任务失去句柄仍运行 → 替换前取消旧 loop，任务归属和代际一起提交。 |
| W2 / #249 | 卸载时 NRPT 恢复失败被适配器 fallback 吞掉 → 不报告恢复成功，保留快照和重试责任。 |
| W3 / #251 | 节点页/托盘用旧 idle 状态，在后端热切换后追加 Connect → 选择确认后读回后端状态；残余 admission 竞态见 C。 |
| W4 / #248 | 退出登录尚未结束，调用者消失后又允许连接 → 账户关闭责任持续到真实清理结束。 |
| W5 / #246 | 断开 UI 等待者取消，会话计时/重试元数据未清理 → 释放所有者继续完成收尾。 |
| W6 | 旧验证迟到后覆盖新连接的 controller secret/port → 发布边界核对原连接代际。 |
| W7 | 旧 logout 响应迟到，撤销或删除替换账户的凭据 → logout 绑定发起时账户。 |
| W8 / #259 | DNS 自写窗口直接丢弃真实网络变化 → 保留待处理事件，窗口后比较物理拓扑再协调。 |
| W9 | 下一次重试清空 live error，旧失败原因丢失 → 按原 attempt 保留有界、脱敏的原因及阶段。 |
| W10 | 55 秒 UI 超时被当成真正释放结束，过早重开登录 → owner 等实际释放，UI 等待预算不改变责任。 |
| W11 | restore 401 的代际检查后账户已替换，旧清理误伤新账户 → 首个副作用前原子预约账户关闭。 |
| W12 | vault 写/删乱序，旧写复活令牌或旧删抹掉新令牌 → 单写者 FIFO，退出等待持久化删除确认，错误不装作已退出。 |
| W13 | A 的 JSON 请求遇 401，借 B 的凭据重放 A 内容 → 请求与重试都绑定原账户身份。 |
| W14 | A 的失败在等待 Service status 后才取身份，首次上传已归给 B → 连接 admission 捕获不可变账户身份，贯穿失败记录和上报。 |
| M1 | macOS AppState 拒绝释放后，AccountSession 第二个 owner 仍恢复 DNS/解除 PF → AppState 成为唯一释放所有者。 |
| M2 | DNS 读取失败被当成空配置，删除恢复快照并允许释放 → 保留读错与快照，拒绝假恢复，允许重试。 |
| M3 | audit 写盘失败不断回填整批，重试缓冲无界增长 → 限制为最近 256 条/256 KiB，恢复后记录本地丢失情况。 |
| M4 | 更新日记把旧 Mihomo 版本/build number 当运行 Core/源码，丢失已知 catalog revision → 不可得身份保持 unknown，保留实际已知 revision。 |
| S1 / #269 | 密码脱敏只替换标签，值仍进入 collector/Worker 结果 → 上传和存储边界移除值，保留非敏感故障上下文。反例使用合成凭据，不声称发生真实泄漏。 |
| S2 / #270 | SSH rc255、journal rc1 被当作成功观测 → 非零读取报错，不能产生「无故障」证明；成功空输出仍合法。 |

工程配套：collector 的路径触发和 25 项测试补入 Services CI；权限阻塞解除后才实际推送并
执行成功。纯边界提取、测试 seam、预算内模块拆分不另算产品 bug。
首轮组合及 merge 后证据包括 Windows App 492 项、macOS 344 项（1 既有 skip）、Worker
890 项和 collector 25 项；准确命令、不同 checkout 与范围均在原始记录，不冒充最新全部源码结果。

### B. 安装、候选与易用性阶段的后续修复

| 范围 | 已修复内容 | 记录 |
|---|---|---|
| Windows 覆盖安装 | `C:Users` 是随工作目录变化的盘符相对路径，导致合法候选修复失败；改为合法 SystemDrive 下的绝对 Users 路径，保留枚举/日记拒绝。 | [候选修复与原始安装 smoke](reports/CANDIDATE_INSTALL_FIXES_2026-09-22.md)，#276。 |
| macOS 候选配置 | 签名候选仍只接纳 0.0.72；收敛到精确 0.0.73 专用分支/产物合同，并移除同一 run 重复生产同名 Core artifact 的冲突，不放宽到任意 PR。 | 同上；签名实际执行另见 RC 记录。 |
| Windows Activity | 把只有 selector 的链当作已观测出口 → 仅已报告的 terminal 作为线路证据，未知不猜测；正对照保留 DIRECT/家宽/云端。 | [易用性组合记录](reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，R1，#279。 |
| macOS 近期成功 | 验证期间同名目录被替换，将旧 digest 的成功记给新目录 → connect/switch 提前捕获 digest，完成时不相同就不记成功。 | 同上 R2，具备 hosted red/green。 |
| 易用性实现中的整合错误 | 修正 Windows 旧上传调用、账户替换后残留预览/回执、收藏按钮归属、缓存摘要被误读为实时健康；保留冻结预览、明确同意和未知状态。 | 同上；这是本线程新能力整合时纠正的问题，不全是旧版本缺陷。 |
| 发布说明 | macOS 14+/helper 4.3.0 与实际包不符 → 说明 Apple Silicon、macOS 26.3+、helper 4.4.0；Windows 标 x64；去掉稳定版/首次公开发行误标。 | [已发布 RC 的后续记录](https://github.com/raydocs/tono/blob/3d57e59ccb7cb4b4248f32733ecafeb89a51b800/docs/reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，#280；未改变兼容性目标或包字节。 |

同时交付的 **六项新增能力，不计为六个 bug**：本地只读健康检查；报告冻结预览/同意/回执；
版本与运行身份说明；按账户的收藏/近期成功/固定地区/推荐；恢复进度反馈；应用线路解释。
最终该阶段 Windows App 499 项、macOS 356 项（1 既有 skip）通过；Windows 浏览器和 macOS
生产组件图已检查。完整原生窗口、真实上传、真实网络与所有交互不由这些截图证明。

### C. #251 剩余时序与更新日记覆盖

[#281](https://github.com/raydocs/tono/pull/281) 处理状态读回与 Connect admission 之间的竞态：
另一窗口已赢得连接，本窗口收到重复/过时代际拒绝后，节点页误报失败、托盘不刷新/不关闭。
改为只协调已识别的 **Connect** 竞争拒绝，仍刷新真实后端状态；Select/status 错误不吞，
不重试 Connect，也不发明 Connected。21 项页面/托盘回归通过，旧实现 2 项按预期失败。

同批扩展更新日记的逐相位写盘失败/旧文件保留回归，并把依赖包日记 unit tests 真正接入
Windows lane、加非零枚举门；以前 App 的 cargo test 不会自动跑依赖的 unit tests。
这项测试覆盖不等于实现了受信任安装交接。
详见[该准确源码的闭环记录](https://github.com/raydocs/tono/blob/ac2cde16a5e303a09e0bc8893f02972b34671115/docs/reports/WINDOWS_251_G3_CLOSEOUT_2026-09-22.md)。

### D. 共用升级协议及原生接入

这是 #282/#283 的 **新增与结构性实现**，不是把整个协议计为一个已经发布的 bug 修复：

- 两端共用 canonical manifest、同源码成对包、签名 releaseSequence；校验独立签名与实际包摘要。
- macOS 的 root Helper 与独立 launchd 执行器持有完整包更新；Windows 的 Service 与独立
  SYSTEM 执行器持有准入和替换。App 日记、同版本字符串或同路径不再充当安装授权。
- 私有暂存、先持久化消费再替换、丢确认的单次消费、真实 successor 身份、回滚及高水位保留；
  明确 Disconnect 不伪造恢复/提交，也不删除已消费或不确定事务。
- 配套成对构建/离线验证、精确只读下载路由与原生测试 lane；没有部署路由或发布 v1 更新对象。

实现中另纠正了：macOS 重读账本时的持久化确认、未消费事务先归档再退休、合法临时包路径
序列化；Windows 恢复任务早于持久化消费注册、未消费事务退休边界；更新拒绝在模态框外看不见、
关闭重开后还能重试同一拒绝 manifest；不完整更新提示与进度卡重叠。失败证据与保护未放宽。

编译 API/PID 绑定、sha2 版本调用、测试临时目录冲突、截图缩放/透明度、缺失 OK 翻译及旧包装
变异断言也已修正，分别保留失败来源；它们不都等于独立生产运行时漏洞。
证据见 [#283 的组合日志](https://github.com/raydocs/tono/pull/283)、
[原生接入合同](https://github.com/raydocs/tono/blob/aeb4b5ad69330507fdeed70a4b263667b2619eda/docs/UPDATE_INTEGRATION_V1.md)：
macOS Helper 更新自测 7 项、XCTest 361 项（1 既有 skip）；Windows Store/native/executor
4+3+1 项通过。具体 OS/签名成功效果有注入，不是实际受保护安装/断电/重启验收；#26 仍开放。

### E. 连接速度与取消责任

- macOS 原阻塞 resolver 会使 task-group timeout 仍等待子任务；改用 DNS-SD 后，独立审查
  又确认其同步提交也会卡住同队列 deadline/cancel。最终独立 waiter 先启动 timer，取消/截止
  立即结束调用者等待，C ref 仍在原串行队列清理；旧调用未清理前拒绝堆叠第二次提交。
  **没有强制取消同步 C 调用**，这是明确保留的边界。
- 最后一轮 mixed diagnostic 与 TUN 探测并行；TUN 成功不等诊断，迟到/取消的结果不能改
  新连接的 preferred origin 或遥测。诊断成功不能替代真实 TUN 成功。
- Windows 原生 IP Helper 应用 DNS 并读回有效 IPv4/IPv6，健康路径不启动 shell；已完成的
  错误才用一次兼容批次并全量重读。保留原始 DNS、restore 与超时后单写者，非设备性能证明。
- 新增只读同设备/同线路 P50/P95 比较工具，保留失败/取消/丢失尝试；纠正实现期间发现的
  Mac stage 名、缺少 Windows 单调计时和显示四舍五入越过 30% 阈值的问题。9 项测试使用
  合成时长，不能算实际提速。

证据：[连接 beta 记录](https://github.com/raydocs/tono/blob/705e16d9ac80a800591da195c0c360029db0ff77/docs/CONNECTION_BETA_2026-09-22.md)、
[#286 的组合结果](https://github.com/raydocs/tono/pull/286)：macOS 372 项（1 既有 skip），
包括 6 个系统 DNS 与 5 个连接时序测试；Windows 原生 DNS 4 项通过。
DNS-SD 同步提交的修复前问题是源码确认，没有把未执行的 native red 记成通过；最终 held-call
回归已执行。补齐的 Swift 显式源码列表与原生测试枚举是工程修正，不是额外连接缺陷。

### F. 最近一次发现并修复的四组 DNS 问题

| 范围 | 失败场景 → 修复结果 |
|---|---|
| macOS listener 取消 | NWConnection 构造期间取消，尚未登记连接而丢失取消 → 独立终态立即结束等待，真实 Disconnect 不必等 DNS 超时。 |
| macOS listener 响应证明 | 无关问题/owner、错误/截断应答、后续畸形 RR 仍留下 fake-IP；复审发现 OPT 扩展错误也被忽略 → 匹配实际随机 ID、IN A 问题和 owner/CNAME，完整校验帧，并拒绝未协商的 OPT。 |
| Windows 适配器消失 | 消失被报 apply 成功，清掉未验证标记 → 消失不给正面结果，返回后仍须实际 setter/readback；不反复重写健康适配器。 |
| Windows 部分写失败 | IPv4 已写、IPv6 失败，还没有 pending 标记，下一次被「看起来已配置」跳过 → 活跃适配器写前保存义务，错误/超时不退休，watchdog/idempotence 看活跃 pending。 |

[#289](https://github.com/raydocs/tono/pull/289) 保留 listener、OPT、Windows 两项的真实红/绿结果，
并已集成 #290 两个提交。最终源码是 d954a7f7，不是只拿子分支 green 代替组合：

- [Windows Service job](https://github.com/raydocs/tono/actions/runs/35800295759/job/106988865192)
  实际 checkout 为 d954a7f7；`cargo test --locked --features standalone,client --lib
  core::dns::engine::native_apply::tests:: -- --nocapture`：6 passed / 0 failed，另有 310 项 lifecycle。
- [macOS XCTest job](https://github.com/raydocs/tono/actions/runs/35800298994/job/106989255243)
  实际 checkout 为 PR merge [63a98602](https://github.com/raydocs/tono/commit/63a986027d50948438bc5daad33f3f95f85abf80)，
  与 d954a7f7 的完整 tree 相同；现有无签名 `xcodebuild ... test`：377 项、1 既有 skip、0 失败，
  五项 listener 测试均通过。完整命令、精确来源及红/绿链接在 PR。
- 2026-09-23 复核 #289 的 12 项 CI 全部成功。限定独立复审没有剩余确认的范围内源码缺陷，
  不是「所有 bug 已找完」。原始 DNS、restore/NRPT/DoH、PF/WFP、App 真流量证明保持。

### 已发布 RC 与最新源码不能混用

[RC 2026-09-22.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.73-rc.20260922.1)
为 `draft=false, prerelease=true`；标签实读指向 569ce865。详细签名、安装和下载证据见
[#280](https://github.com/raydocs/tono/pull/280)。这是此前明确授权后的历史交付，本次整理没有重发。

| 实际包 | SHA-256 | 已有资格及限制 |
|---|---|---|
| `Tono-0.0.73-build73-arm64.zip` | `fb4dc0f68987da54705b20c386426d631cb3a2659740d87965ff672f5332393f` | Developer ID/公证/Gatekeeper 通过；Apple Silicon、macOS 26.3+；非 Sparkle 客户发布或最新 v1 实机验收。 |
| `Tono_0.0.73_x64-setup.exe` | `e0837a2ab2f5126ae05f11188f9a7de469605453785888310cafb7f566ed0cad` | 原始 hosted fresh install/同版本 repair/uninstall/DNS 不变通过；无 Authenticode/updater 签名，`physicalUpgradeQualified=false`。 |

两包同源，包含 A/B 已合并产品修复和六项能力；不包含 C–F 后续源码。
本总账不创建新候选、不更新旧资产、不改客户源；不能把前一轮「未签名/未合并」的报告时点
套到整个线程，也不能把这一个旧 RC 的签名/安装证据套到最新源码。

### 查过什么，以及尚未查完什么

已重点检查：Windows 连接/切换/取消/重试/账户/凭据/失败上报、Service DNS/NRPT/WFP/网络事件、
两端安装更新；macOS AppState/协调器/helper/PF/DNS/audit；Worker 身份/目录/策略/诊断边界；
exit/home-agent、collector；相关 ops 证据、构建/测试/发布来源。深度和方法不同，详细覆盖矩阵
见 A 的三份报告；不是所有目录逐行审计、全 parser fuzz 或全并发状态空间穷举。

仍保留：

- [#26](https://github.com/raydocs/tono/issues/26) 的最新 v1 在已安装 macOS/Windows 11 上成功/失败
  更新、实际 successor/PF/WFP/DNS、重启与中断恢复证据。协议源码已接入，不代表此项已关闭。
- [#241](https://github.com/raydocs/tono/issues/241)、[#249](https://github.com/raydocs/tono/issues/249)、
  [#259](https://github.com/raydocs/tono/issues/259) 的设备/系统边界；[#251](https://github.com/raydocs/tono/issues/251)
  的后续代码仍待合并。Issue 开放不意味着表中已修代码不存在，也不该只凭代码关闭实机项。
- [#273](https://github.com/raydocs/tono/issues/273) 已有旧 RC 的签名执行证据，不能写成从未签名；
  但最新分支的新包/已安装 helper 资格仍未由旧 RC 建立。
- 真实线路 UUID/握手、运行中组件/配置身份、睡眠/Wi-Fi/IPv6/适配器变化、包级防漏、真实凭据库
  与报告回执；没有把 EOF 推断成特定网络原因，也没有实测 30–50% 提速。
- ops [#4](https://github.com/raydocs/tono/issues/4)、[#5](https://github.com/raydocs/tono/issues/5) 的计量
  边界/重置代际未解决；没有生产切换。一般 ops UI/digest freshness、未交付 Linux/CLI/移动端、
  无关第一方文件和第三方内部并未全部审计。

本次文档交付仅建立总账与以后同 PR 留记录的规则，归属 G1–G3 可追溯验收及已有 ops 证据。
历史检查均沿用其原 SHA/日志；不为整理文字重跑产品测试，不作新的合并、签名、部署或发布。
