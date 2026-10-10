# Amp 待办全集（2026-10-10）

给 Amp orb 无人跑的任务清单。每条独立成 PR，按 [AGENTS.md](../../AGENTS.md) 的规则合并；
高风险项（标 **高**）必须有独立评审回执才能合。编号 A 开头的是任务，D 开头的是老板已定的事。
2026-10-10 老板决定：§7 全部按推荐执行，§6 原先不派的项也一起派（[decision 079](../decisions/079-2026-10-10-amp-backlog-defaults.md)）。

### 给 Amp 的启动提示词（直接粘贴）

```text
Read AGENTS.md, docs/BUILD_AND_TEST.md and docs/ops/amp-backlog-2026-10-10.md. Work through §8 in order, one task per PR,
branch from current main, one regression test per behavior, a docs/changelog.d entry per PR. §7 is decided: use the
chosen option of each D item. High-risk PRs (marked 高, and every PF/WFP item in §6) need an independent review receipt
in a PR comment before merge (Grok-only while Codex is down: --finders grok). Do not touch tono-xray on port 443, PF/WFP
permit tables beyond the task text, or production D1. For §6 UI items, attach screenshots to the PR and leave it draft
for the owner. For §6 hardware items, do the code and tests, record "hardware evidence pending" in the finding.
Report at the end of each task: PR number, ci-gate run id, review receipt, what is left.
```

## 0. Amp 的工作规则（先读）

- 规则源：[AGENTS.md](../../AGENTS.md)、[docs/BUILD_AND_TEST.md](../BUILD_AND_TEST.md)、[docs/ops/plan-2026-09-11.md](plan-2026-09-11.md) §2 硬规则。
- 一条任务一个 PR，一个行为一条回归测试；每个 PR 带 `docs/changelog.d/` 条目；碰到的缺陷写 `docs/findings.d/`。
- 不碰：PF/WFP 放行表、`skip-cert-verify`、helper 协议（除非任务写明）、节点 443 上的 `tono-xray`、生产 D1 写入。
- 不要在 UI 观感上做决定；文案可以改，视觉不改。
- 分支从最新 `main` 开；#1458–#1461 合入前不碰 `apps/windows/app/src/tono-ui/`、`apps/macos/Tono/Views/SeaScene*`。
- 评审：Codex 不可用期间用 Grok（`--finders grok`），高风险 PR 在 PR 评论里贴回执（覆盖 SHA、不变量、结论）。

## 1. 中继这条线的尾巴（接着 #1462–#1467）

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A1 | Windows 更新器复用登录路径 | `apps/windows/app/src-tauri/src/tono/commands/update.rs`、`transport.rs` 的 `preferred_relay` | 登录走了中继的设备，更新检查第一跳就是中继；黑洞网络下不再先等 21 s；一条 `#[test]` | 中 | 无 |
| A2 | macOS 更新器中继回退 | Sparkle appcast 拉取（`Info.plist` 的 `api.afk.ccwu.cc/appcast.xml`）改走 `TonoAPIClient.exchangeOverPaths` 再喂 Sparkle，或给 Sparkle 配自定义 URLSession | 三条路径都试；XCTest 覆盖「直连死、中继活」 | 中 | 无 |
| A3 | Windows 登录失败面板对齐 mac | `apps/windows/app` 错误渲染 | 失败时列出每条路径的失败原因和耗时，一键复制诊断包；mac 已有合并文案（#1464） | 低 | 无 |
| A4 | 首次启动网络自检 | 两端客户端 | 登录前并行探直连 / pin / 中继（只做 TCP+TLS 握手，不带身份），结果缓存 24 h，登录直接走通的那条 | 中 | D14 |
| A5 | 节点侧中继探针 | 两台 DMIT 节点 cron + 控制面上报接口 | 节点每 5 分钟经本机 2053 对 Cloudflare 做一次完整 HTTPS 探测并上报；后台卡片显示「TCP 可达」和「端到端可用」两列 | 低 | 无 |
| A6 | 中继探测失败告警 | `services/control-plane/src/ops/` 现有 alerts 规则 | 连续 3 次探测失败发一条告警，恢复发一条 | 低 | 无 |
| A7 | 中继日志轮转 | 节点 `logrotate` 配置 + `tooling/ops/relay/` 的规范副本 | `/var/log/nginx/tono-relay.log` 按天轮转保留 14 天 | 低 | 无 |
| A8 | 按 ASN × 路径的成功率表 | 控制面 `X-Tono-Path` + 现有 ASN 字段；ops 控制台 | 一张表：最近 7 天每个 ASN 用了哪条路径、成功率 | 低 | 无 |

## 2. 账本里 open 且纯代码可修

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A9 | H17-C-F1 设备上限立即生效 | 控制面账户设备逻辑 | 调低上限时按 LRU 立刻踢超额设备；一条 `it` | 中 | D15 |
| A10 | H21-O-F7 识别其他 VPN/TUN | 两端诊断探针 | 检测到其他 TUN/VPN 适配器时失败归因写明「存在其他 VPN」，进诊断报告 | 低 | 无 |
| A11 | H21-O-F8 识别强制门户 / TLS 拦截 | 两端 | 证书链非预期或 HTTP 被跳转时归因写明，进诊断报告 | 低 | 无 |
| A12 | R3-O5 macOS 网络服务按 ID 定位 | `apps/macos` helper DNS 写入 | 多个同名 Network Location 不会写错服务；XCTest | 中（helper） | 无 |
| A13 | R3-O4 `--emergency-disarm` 先 bootout daemon | macOS helper 操作员路径 | 不再和在线 daemon 双写 | 中（helper） | 无 |
| A14 | #208 定时 D1 备份修好 | `.github/workflows` + Cloudflare 凭据 | 每日备份自动落 R2，失败有告警 | 低 | D16 |
| A15 | 清理 71 条 open finding 的状态 | `docs/findings.d/` | 已 fixed 只等真机证据的项统一标 `fixed·待实机`，真正 open 的留下；不改代码 | 低 | 无 |

## 3. 产品与可靠性（大项）

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A16 | Hysteria2 备用通道，第 1 步：节点探针与三网数据 | 节点 hy2 块（已有）、`docs/ops/transport-hy2.md` | 从移动 / 电信 / 联通各至少 3 个探测点得到 hy2 可达性和延迟，写进文档 | 低 | D2 |
| A17 | hy2 第 2 步：客户端切换 | 两端连接 FSM | TCP 连续失败 N 次后切 hy2，成功后记住；手选也可用 | **高**（连接 FSM） | A16、D1 |
| A18 | hy2 第 3 步：后台开关 | 控制面策略 + ops 控制台 | 按账户 / 全局开关，默认按 D1 | 中 | A17 |
| A19 | Windows 客户时间线补齐 | Windows 审计事件 | 与 mac 的 `control_plane_path_failed` 等价的事件和耗时；后台能看「这台机器最近怎么连上的」 | 低 | 无 |

## 4. 后台与机队（ops 计划第 3、4 批）

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A20 | 节点自注册第 1 版 | 节点 agent + 控制面 `nodes` 表 | 节点持 token 自己上报 IP、角色（xray / hy2 / relay）、版本、心跳；Notion 表退化为备份 | 中 | D7 |
| A21 | 节点容量字段与验收项 | 计划 §4 第 3 批已有描述 | `capacity_users`、验收项 pass/fail | 低 | A20 |
| A22 | 客户规模项 | 计划 §4 第 4 批 | 按计划逐条，每条一个 PR | 低～中 | 无 |

## 5. 工程与安全

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A23 | 大文件拆分 | `windows_kill_switch.rs`（8.9k 行）、`connection.rs`、`dns/mod.rs`、`auth.rs`、`index.ts`（各 3.5k+） | 一个文件一个 PR，纯移动不改行为，现有测试全绿 | 中（量大） | D6 |
| A24 | 发布信任：构建来源证明 | GitHub attestations + 发布脚本 | 每个包有 provenance；mac 发布脚本校验 notarization 票据 | 中 | D8 |
| A25 | CI 提速 | `.github/workflows` | Swift / Cargo 缓存命中率可见；截图类测试按 D9 移出 PR 门；ci-gate 平均缩短 | 低 | D9 |
| A26 | 仓库卫生 | 远端 533 个分支、本地 70 多个 worktree | 脚本按「已合并 + 工作树干净」清理，规则写进 AGENTS | 低 | D10 |
| A27 | 本机测试稳定 | `services/control-plane/test/worker.test.ts`（6.6k 行） | 拆文件或给长用例加 timeout，部署脚本不再被偶发超时打断 | 低 | 无 |
| A28 | 控制面 `index.ts` 拆 cron | 同 A23 的一项，单列因为影响部署脚本 | `enforceAll` 与 ops cron 独立文件，行为不变 | 低 | D6 |

## 6. 原先不派、现在也派（老板 2026-10-10）

| # | 任务 | 范围 | 完成标准 | 风险 | 依赖 |
|---|---|---|---|---|---|
| A29 | D7 macOS 连接中私网放行收紧 | `apps/macos` helper PF 规则 `tono-lan` + 设置项「允许局域网设备」（默认关） | 开关关时只放行 LAN DNS（#348 已收紧）和 mDNS，其余私网与 Windows 一致不放行；开关开时恢复现状；XCTest 两条（关 / 开）；helper 协议版本按 AGENTS 升 | **高**（PF 语义，必须评审回执） | D3-A |
| A30 | H1-F5 bootstrap 窗口缩短并记录为已知风险 | 两端 bootstrap 放行时长 | 放行只存在于控制面握手期间（秒级），完成或失败即撤；`docs/findings.d/H1-F5` 状态改为「已知风险，窗口 ≤ N s」 | **高**（PF/WFP） | D4-A |
| A31 | 真机验收项的代码侧收口 | W2、W8、#171、H16-O-F6、I2/#273 | 每项：确认修复在 main、补缺失的回归测试、finding 标「fixed·待实机」；真机证据留给老板 | 中 | 无 |
| A32 | 海面 UI 后续调整 | #1458–#1461 合入后的 `tono-ui/` 与 `SeaScene*` | 按 `MAC-POLISH-SPEC.md` 与 Windows 截图审计剩余项做；PR 保持草稿并附截图，老板看过再合 | 低 | #1458–#1461 合入 |

## 7. 老板已定（2026-10-10「按你推荐的来」；全部取推荐列）

| # | 问题 | 选项 | 推荐 | 影响的任务 |
|---|---|---|---|---|
| D1 | hy2 自动切换默认开不开 | A 全员默认开 · B 默认关，手选 · C 内部账号先开，两周后转 A | **C** | A17、A18 |
| D2 | Amp 能不能改生产节点上的 hy2 配置 | A 能（先备份，不碰 443 的 xray） · B 不能，只读探测 | **A** | A16 |
| D3 | D7 macOS 连接中的私网放行 | A 和 Windows 对齐，全封（加「允许局域网设备」开关，默认关） · B 保持现状 · C 只放同网段 + mDNS | **A** | A29 |
| D4 | H1-F5 bootstrap 期间非 Tono 进程能到共享 anycast | A 记为已知风险 + 把窗口缩到几秒 · B helper 代理控制面请求（大改） | **A** | A30 |
| D6 | 大文件纯拆分要不要做 | A 做，一次一个文件 · B 不做 | **A** | A23、A28 |
| D7 | 节点身份方案 | A 节点持 token 自注册 · B 后台 SSH 拉取 | **A** | A20 |
| D8 | 构建来源证明 | A 先只生成和审计，客户端不校验 · B 客户端也校验 | **A** | A24 |
| D9 | 截图测试位置 | A 移到合并后 nightly · B 留在 PR 门 | **A** | A25 |
| D10 | 已合并远端分支 | A 自动删 · B 每批你批 | **A** | A26 |
| D11 | Amp 的 PR 怎么合 | A 按 AGENTS 自动（高风险要回执） · B 每个你看一眼 | **A** | 全部 |
| D14 | 登录前就发网络探测 | A 允许（只握手，不带身份） · B 等点登录 | **A** | A4 |
| D15 | 调低设备上限时 | A 立即踢最旧 · B 等下次登录 | **A** | A9 |
| D16 | #208 需要一个有 D1 导出和 R2 写权限的 Cloudflare token 放进 GitHub secret | 只能你提供（仍待提供） | — | A14 |

## 8. 建议顺序

1. A3 → A4 → A1 → A2（登录与更新体验，客户这周就用到）
2. A5 → A6 → A7 → A8（中继可观测）
3. A9、A10、A11、A14、A15（账本收口）
4. A20 → A21（机队）
5. A16 → A17 → A18（hy2，按 D1/D2）
6. A31 → A30 → A29（账本与 PF 项，A29/A30 带评审回执）
7. A32（等 #1458–#1461 合入）
8. A23 / A27 / A28 / A25 / A26 当填缝
