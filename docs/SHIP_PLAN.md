# Tono 第一发升级计划（直到过发布标准）

写给执行 agent 与老板。立场：客户打开 App 会不会觉得这是成品，不是运维台好不好用。
运维后台剩余工作仍以 `docs/ops/plan-2026-09-11.md` 为准，**不构成本计划的发布门**。

定稿日期：2026-09-10。基线：`main` `2cef4eac`（PR #140，第十四次控制面部署）。源码版本 macOS / Windows **0.0.72**。客户更新源仍是 Sparkle **0.0.67**、`windows/latest.json` **0.0.34**。GitHub 上的 `v0.0.72` / `tono-macos-0.0.72-build72` **不是**客户频道（issue #80）。

**这一发的产品版本号是 0.0.73。** 0.0.72 的 GitHub 标签已经存在且未进更新源；门 1–3 的代码合入 `main` 时仍可停留在 0.0.72，冻结提交再升到 0.0.73 再打标签、再推源。

---

## 0. 一句话与四条门

0.0.72 不发，是因为半成品感还在客户路径上：Windows 实机 Connected 之后仪表盘/Activity 卡在重试；失败即报 Windows 没合；备用通道没有；受保护自动更新生命周期没走通。继续升级，直到下面四条全部有证据，然后冻、发、只修装上会坏的洞。

| 门 | 客户能感知到什么 | 过门的证据 |
|---|---|---|
| **G1 已连接=能用** | 点连接后，流量动、网页通、断开收回 DNS/保护；两端一致 | Windows 11 实机重测通过（含仪表盘+Activity）；macOS 回归不断开即坏 |
| **G2 连不上有下一手** | 失败看得到原因；TCP 握手失败会再试备用通道（或发布说明写死「本版只有 TCP」） | Windows 失败出现在客户时间线；hy2 三网证明后自动切换，或书面降级 |
| **G3 发出去还能再发** | 客户能从旧版自动更到这一版，失败证据还在 | issue #26 的 journal 全相位 + 一台已装 Windows / 一台 macOS 真机走通 |
| **G4 客户版本=你以为的版本** | 更新源指向 0.0.73，不是 GitHub 上挂着、客户还在用 0.0.34 | Sparkle 与 `windows-updates` 推进后，内部设备先吃，再小范围朋友 |

四条齐了才叫过发布标准。缺任何一条，禁止改 `public/appcast.xml`、禁止推 `windows-updates`、禁止把 0.0.73 标成客户频道。

---

## 1. 现状（代码是真相，2026-09-10）

**已经真的有的**

- 两端登录、签名目录、VLESS Reality、TUN、系统保护、微信国内直连、Claude 家宽链、家宽不可用不再偷偷退回云出口。
- macOS 失败即报已合（PR #119）。Windows 周期遥测骨架在 `apps/windows/app/src-tauri/src/tono/telemetry.rs`，`connectFail` 事件名已列入白名单。本分支失败当时 `POST telemetry/failures`（stage / 稳定 code / 当时的目录节点名），周期窗口仍带同一事件。**不是** #138 的 3.5 连接日志。
- Windows 插件 IPC 命名空间源码已改为 `tono-plugin-core`（`crates/tono-plugin-core/src/lib.rs` 的 `PluginBuilder::new` 与 `app/tests/core-plugin-namespace.test.ts`）。**实机尚未用新包复测**，`docs/WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md` 仍记着 FAIL。
- 目录与保护已经按传输层区分端点：macOS `ConfigPipeline.DialEndpoint.transport`；Windows `ProxyEndpoint.protocol` 含 `Udp`。hy2 要接的是这两处，不是新造一套防火墙。
- 控制面目录合同已接受同节点 hy2 块（`password: {{TONO_CLIENT_UUID}}` + fingerprint，禁止 skip-cert-verify；迁移 0072）。**生产目录仍不塞块**，直到客户端准入合入。
- 杭州 `47.110.84.71` 只出站：东京 VLESS TCP 通；Dedirock hy2 UDP 握手 5/5 且经 hy2 到 Google 通。Panstar 东京入站 UDP 被商家拦住。自动切换默认关。客户目录默认剥掉 ` · hy2`（`HY2_CATALOG_EMAILS` 灰度）。**生产目录仍不塞块。**
- **2026-09-11：** 杭州阿里云（非移动）打东京/Dedirock Reality dest SNI，拿到微软 `r.bing.com` 证书。出口没挂。「移动用不了」要用移动家宽测；东京 hy2 仍进不来，大陆 hy2 备用目前是 Dedirock。Dedirock 手工 hy2 原先是共享口令，目录 UUID 登不上；本分支改为 HTTP 鉴权吃全部 VLESS UUID。
- **0.0.73 发布说明草稿**已写在 `apps/macos/release-notes/build73.md` 与 `apps/windows/release-notes/0.0.73.md`（含中文）：**本版备用通道仅手动。** 源码版本仍是 **0.0.72**。G1–G3 证据齐之前禁止升号、禁止改 appcast / `windows-updates`。
- **G3.1 Failed 日记：** 两端仪表盘在日记为 Failed 时提示「更新未完成，请手动断开后重装」；文件留下。真机 G3.3 之前仍不算过门。
- **G2 手选备用通道：** 握手 eof / `CORE_EXIT_UNREACHABLE` 时，失败卡片、托盘、菜单栏、非首页横幅在目录有 ` · hy2` 时提供「试用备用通道」。同城 hy2 优先，但东京 hy2 入站 UDP 被商家拦：目录里还有其它城 hy2（Dedirock）时跳过东京那条。用户点击才切到 hy2 并重试。未连接时在设置页/托盘选城（含 hy2）会真正发起连接。macOS 不再在 `CORE_EXIT_UNREACHABLE` 上自动换城。G2.8 自动切换仍关。生产目录仍不塞块。

**还没有的（这一发要补）**

- 客户端准入 hy2：Windows `admit_node` / `proxy_endpoint_of` 与 macOS `validatedOwnedNode` / Helper UDP 放行在本分支落地；合进 `main` 之前 App 仍吃不进托管 hy2 块。macOS `ConfigParser` 的 `hy2://` 仍是手工 URL。
- 连接失败只换下一座城市（macOS `rotateCatalogExitAfterConnectFailure`），不自动换同一座城市的备用传输。G2.8 自动切换不做，直到家宽三网证明。失败卡片已提供手选「试用备用通道」。
- Windows 更新日记：`prepare` 停在 `UpdatePrepared`；所有者按相位推进；`commit_verified_recovery` 才允许删日记。`--replace-runtime` 写 `InstallStarted`（App 不再猜）。真机 G3.3 之前不算过门。
- 客户更新源：`services/control-plane/public/appcast.xml` 0.0.67；`public/windows/latest.json` 0.0.34。

**已开、未合、这一发要用的分支**

| PR / 分支 | 内容 | 合入条件 |
|---|---|---|
| #137 `client/macos-phase-3.5` | 连接日志上传、断开字节、`bytesByRoute`、隐私文案 | 老板拍板「默认开还是关」后本机看一眼；Worker 合同已在 #135 |
| #138 `client/windows-phase-3.5`（叠在 `client/windows-phase-1.5` 上） | 同上 + Windows 1.5 失败即报 | Windows 机器 `cargo test` + 打包；#137 口径必须一致 |
| #116 | 瞬态 desired-state 读失败不拆健康 Core | G1 |
| #117 | Owner monitor 把可读的 `NotActive` 当传输失败 | G1 |
| 更早的 `client/windows-connection-contract` | 被 1.5/3.5 叠住 | 不要单独合，随 #138 |

**明确不进这一发**（写在这里是为了阻止「再升一点」）

- 运维：不可变 `nodeId`、故障域、`ChangeReceipt`、客户列表按页、角色启用、SLO、旧 `/ops/` 切走、Telegram 令牌、hub `--jobs`。那些是 `docs/ops/plan-2026-09-11.md`。
- 产品：Android / iOS / Linux 桌面、Authenticode（第一发允许 SmartScreen 提示，发布说明写明）、银行 3DS、全部浏览器 Secure DNS、计量切换（#4/#5）。
- 自动下架、自动换节点、默认把 hy2 当主通道。

---

## 2. 硬规则

1. **四条门是发布门，不是愿望清单。** 任何 PR 说明必须写它服务 G1–G4 的哪一条；写不上来的不合进这一发的集成分支。
2. **禁止提前推客户源。** 在 G1–G3 证据齐之前，不得改 `public/appcast.xml`、不得推 `windows-updates`、不得把 GitHub release 从 prerelease 改成客户频道。`tooling/scripts/release-macos.sh` 与 Windows 发布脚本只打内部候选。
3. **版本。** 门 1–3 的开发提交保持 0.0.72。冻结提交一次性改：`apps/macos/Tono.xcodeproj/project.pbxproj` 的 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`、`apps/windows/app/package.json`、`apps/windows/app/src-tauri/Cargo.toml`，以及 `python3 tooling/scripts/verify-desktop-version.py --expected-version 0.0.73`。夹具里的 `0.0.72` 示例不必全改，那是演示数据。
4. **目录合同。** 托管目录仍然只有 Tono 签发的出口。hy2 是同一节点的第二块，名字后缀 ` · hy2`（中间是空格+间隔号+空格）。展示名、判定、退役都折叠到基名。禁止为 hy2 另开一套节点身份。
5. **保护面不得放宽。** hy2 只把 **那一个** `(IPv4, hy2_port, UDP)` 放进 PF/WFP 允许集；禁止 `skip-cert-verify`；禁止非公开 IPv4；Windows `admit_node` 与 macOS `validatedOwnedNode` 只**增** hy2 分支，不删 VLESS Reality 约束。
6. **hy2 自动切换的前提是三网 UDP 证明。** 任一运营商完全不通 → 目录仍可带块，客户端只提供手动选择，开关默认关，发布说明写「本版备用通道仅手动」。禁止在未证明时做自动切换。
7. **测试预算。** 每个行为一个最窄回归：Windows 一个 `#[test]` 或 `#[tokio::test]`，macOS 一个 XCTest，Worker 一个 `it`。不写表驱动大套。Playwright / 运维夹具与本计划无关，除非改了客户时间线的 `transport` 展示。
8. **分支。** 客户端改动走 `release/macos` / `release/windows` 或直接 PR 到 `main`（现有习惯：Windows 在 Mac 上编不了 sidecar，PR 必须在 Windows 机器验证）。控制面+目录合同走 `main`。不要往 `ops/platform` 塞客户端。
9. **密钥与隐私。** hy2 证书私钥只留在节点；指纹进 `ops_node_profiles`。密码与 VLESS 一样用 `{{TONO_CLIENT_UUID}}` 占位，Worker 按用户替换。原始连接日志默认是否开启由老板在 B0 拍板，拍完两端同一口径。
10. **冻。** G4 开始后只接受「装上会坏 / 更新会坏 / 连不上且无下一手」的修复。新功能排下一发。

---

## 3. 只有老板能做的（agent 遇到就停）

1. 拍板连接日志「默认开还是关」（B0）。不拍板，#137/#138 不准合。
2. Windows 11 真机：编 #138、跑 `cargo test`、装候选包、走 G1 与 G3 清单。云端 Linux agent 不能代替 WFP。
3. macOS 真机：Developer ID、公证、Sparkle EdDSA、`tooling/scripts/verify-release-gate.sh /path/to/Tono.app`、Helper 安装。
4. hy2 三网证明（T0）：在 **vm-Gk43AX**（东京 JP Plus，`45.8.173.206`）手工装 hysteria2，电信/联通/移动各 5 次握手 + 30 秒下载；同一套配置再在 **vm-nvLHV3**（洛杉矶，`144.225.255.38`）各测一轮。结果写 `docs/ops/transport-hy2.md`。不通就执行 §2.6 的降级，不要让 agent 猜。
5. 内部账号灰度：客户目录默认剥掉 ` · hy2`。`HY2_CATALOG_EMAILS`（逗号分隔）里的邮箱才能看见。未设则谁也看不见 hy2。Ops/admin 明文目录不剥。改这个变量之后必须 bump catalog revision（Windows 把同 revision 不同 digest 当篡改）。**仍不要 PUT**，直到客户端准入合进 `main` 且老板把邮箱写进该变量。不要把真实邮箱写进仓库。
6. 推 Sparkle / `windows-updates` / R2 `tono-releases`（G4）。
7. 小范围朋友：从谁开始、看哪些失败率、何时扩大。

---

## 4. 任务清单（按门；每条可独立派）

规模：S < 1 小时 agent，M 半天，L 一天。谁：Grok / 本机 agent 做实现；老板做真机；Fable/总监只审合发。

### B0 · 冻结口径（先做，否则 3.5 与 hy2 会打架）— 老板 · S

- 目标：两个决定写进本文件本节，作为后续 PR 的前提。
- 决定 A：连接日志默认开 / 关。开 → #137/#138 按现状合，发布说明写「可在设置关闭」。关 → 两 PR 把默认改成关再合，隐私文案跟着改。**尚未拍。**
- 决定 B：hy2 目标节点。**已拍（2026-09-10，Panstar 机队表）：**
  1. **vm-Gk43AX** — 东京 JP Plus Nano，`45.8.173.206`，Debian 13，1C/512MB，流量几乎空（约 0.15%）。三网直连线路，用来证明大陆 UDP。
  2. **vm-nvLHV3** — 洛杉矶 LAXPre Nano，`144.225.255.38`，Debian 12，1C/1024MB，流量几乎空（约 0.09%）。另一条大洲路径，同一商家，用来区分「GFW 拦 UDP」和「这一家机房不给 UDP」。
- 不选：JP Lite（不是三网直连、5GB 盘、18 天到期）；Ubuntu 26.04 / Debian 11（provisioner 合同外）；洛杉矶用量最高的那台（约 54 GB，先别在忙机上做实验）。目录名以控制面 `catalog_name` 为准，机队表只有实例名。
- T0 不通的运营商不做自动切换。SSH 口令只留在 Notion / 钥匙串，**不准进仓库、不准进本文件**。
- 验收：决定 B 已写。决定 A 仍空时，#137/#138 仍不准合；T0 / G2.5 可以按上面两台开工。

---

### 门 1 · 已连接 = 能用

**G1.1 用新包复测插件命名空间** — 老板 · S

- 背景：源码已修（`PluginBuilder::new("tono-plugin-core")`），09-08 实机 FAIL 是旧包。`docs/WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md` 仍是 qualification incomplete。
- 步骤：按该文档 §3 打候选包；断开状态下从当前已装版升级；连接；看仪表盘速率与 Activity 是否离开 controller retry。
- 验收：该文档顶部 Status 改成「插件命名空间实机通过」，记下包哈希。仍 FAIL 则停在这里，不要开始 G2。

**G1.2 健康会话不被瞬态读失败拆掉** — 接 PR #116 · M

- 目标：desired-state 读失败一次，不立刻拆掉已经 Connected 的 Core。
- 文件：Windows owner monitor / run-state 路径（以 #116 diff 为准；相关 issue #102）。
- 唯一测试：模拟一次可读失败、一次恢复，会话仍为 Connected。
- 验收：真机：Connected 后短暂打断 named pipe 或制造一次读失败，UI 不掉到「未连接」且不重启 Core。

**G1.3 `NotActive` 不是传输失败** — 接 PR #117 · S

- 目标：owner monitor 读到合法 `NotActive` 走状态机，不走「传输挂了，开始恢复」分支（issue #103）。
- 唯一测试：可读的 NotActive 回复不触发 recovery。
- 验收：断开后的 NotActive 不再刷一串 spurious recovery。

**G1.4 过期的 protected-offline 文案** — issue #101 · S

- 目标：保护释放成功后，仪表盘不再留着「protected offline」；「再试一次」在无对象时禁用或变成连接。
- 文件：Windows dashboard / `UiState::ProtectedOffline` 的清除路径（`apps/windows/app/src-tauri/src/tono/connection/` 与前端 `pages/tono/`）。
- 验收：连接 → 断开 → 仪表盘无过期红字；此时点「再试一次」要么能连，要么按钮不在。

**G1.5 托盘流量卡死** — issue #99 · M

- 目标：WebSocket 连接挂起时，托盘与仪表盘流量订阅要超时并重建，不能无限冻。
- 文件：`apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts`、`use-traffic-data.ts`；已有 `use-mihomo-ws-subscription.test.ts`。
- 唯一测试：订阅 connect 超时后会断开并允许重开。
- 验收：Connected 状态下托盘数字在 5 秒内开始变化（G1.1 的同一台机器）。

**G1.6 macOS 回归：不断开即坏** — S

- 目标：G1 的 Windows 修复不得破坏 macOS。跑 `python3 tooling/scripts/test-desktop-stability.py --expected-version 0.0.72`（冻结前）里的 macOS XCTest 与 ConnectionCoordinator。
- 验收：既有套件绿；真机一次连接/断开，DNS 回到基线。

**G1 过门清单（老板在同一台 Windows 11 上连续做）**

1. 安装候选包，哈希写入 `docs/WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md`（或 0.0.73 验收文档）。
2. 冷启动 → 登录（若需要）→ 连接 → HTTPS 出口成功。
3. 仪表盘速率非零；Activity 有行且不在 retry。
4. 托盘流量 5 秒内更新。
5. 断开 → Core 停 → DNS 回到基线 → 直连网页通。
6. 再连一次成功。
7. 睡眠/唤醒一次仍 Connected 或能一键恢复（失败则记进发布说明「睡眠恢复未认证」，不阻断 G1，除非醒后漏流量）。

---

### 门 2 · 连不上有下一手

分两截：先让失败能被看见（2A），再给同一节点第二条传输（2B）。2A 不依赖 T0；2B 依赖 T0。

#### 2A 失败即报（可与 G1 并行，但合入在 G1.1 之后以免脏包）

**G2.1 合 macOS 3.5** — PR #137 · 老板拍板 B0 后 · S

- 目标：日志上传口径、断开字节、`bytesByRoute`、隐私文案进 `release/macos` → `main`。
- Worker：`telemetry-window.ts` 已允许 `bytesUp` / `bytesDown` / `bytesByRoute`（#135）。不要再改合同，除非漏了字段。
- 验收：真机上传一段窗口后，D1 `telemetry_windows` 有该设备行；设置页文案与 B0 一致。

**G2.2 合 Windows 1.5+3.5** — PR #138 · M

- 目标：Windows 客户的 `connectFail` 带阶段与代码，出现在 `GET customers/{id}/connections`；断开带字节。
- 本分支已落地 **1.5**：`connectFail` 立刻 POST 已有的 `telemetry/failures`（node + stage + 稳定 code），不合并 #138 的 3.5 连接日志 / `bytesByRoute`。断开带字节仍等 B0 后合 #138。
- 步骤：Windows 机器 rebase 到含 G1 修复的 `main`；`cargo test`；打包；一次故意连错节点或断网，确认时间线有失败。
- 唯一测试：tono-core `connect_failure_report_serializes_only_the_accepted_keys`；已有 3.5 分支测试保持绿。
- 验收：同一账号 Windows 失败与 macOS 失败在客户 360 时间线格式一致（阶段、代码、节点名用目录名不是设备 id，macOS 已由 PR #123 保证）。

**G2.3 失败文案对客户可读** — S

- 目标：两端 UI 把稳定错误前缀翻成一句人话（Windows `connection/failure.rs` 已有 `TONO_*` 前缀；核对前端 i18n 与 macOS `lastConnectionFailure`）。
- 验收：握手失败时主界面不是一串英文 debug，设置/支持页能复制报修用的阶段+代码。

#### 2B Hysteria2 备用通道

**T0 三网 UDP 证明** — 老板 · S（不通就停自动切换）

- **vm-Gk43AX**（东京 JP Plus，`45.8.173.206`）先装：官方 hysteria2，`listen :443/udp`（若 443/udp 被 TCP 占用则另选端口，记下来），自签证书，记下 SHA-256 指纹。带宽先不限。同一套再装到 **vm-nvLHV3**（洛杉矶，`144.225.255.38`）。
- 客户端用 mihomo 手工 `type: hysteria2` + `sni` + `skip-cert-verify: false` + `fingerprint`。
- 电信 / 联通 / 移动各 5 次握手 + 30 秒下载。记成功率、是否 UDP 阻断、是否仅限速。
- 写 `docs/ops/transport-hy2.md`：每运营商 `ok | throttled | blocked`。任一 `blocked` → 自动切换对该运营商不做，客户端开关默认关。
- **2026-09-10 实测：** 东京 hy2 本机握手成功；Panstar 入站 UDP 从杭州/洛杉矶/美国云端均不通。Dedirock `198.12.84.154` 入站 UDP 通：杭州 hy2 握手 5/5，经 hy2 到 Google 约 190ms；该机 xray PID 未换。按本节：自动切换仍默认关（缺家宽三网），目录暂不塞块。详见 `docs/ops/transport-hy2.md`。
- 验收：文件存在且有三个运营商结论。没有这份文件，G2.4 之后的「自动」任务一律不做。

**G2.4 目录合同：hy2 块过发布门** — Grok · M · 迁移 **0072**

- 背景：`managedCatalogYAML` 经 `catalogProxyUsesManagedIdentity` 拒绝没有 `uuid` 占位的块。hy2 必须用 `password: {{TONO_CLIENT_UUID}}`。
- 文件：
  - `services/control-plane/src/catalog-yaml.ts`：`catalogProxyUsesManagedIdentity` 改为按 `type:` 分支——`vless` 保持现约束；`hysteria2` 要求恰好一个 `password` 占位、禁止 `skip-cert-verify: true`、禁止缺 `fingerprint`。`filterCatalogYamlForUser` 的占位替换已按全文 `{{TONO_CLIENT_UUID}}` 替换则 hy2 密码会一起被换；核对 `placeholderCount` 与发布工具的计数，改为「每个块一个占位」而不是「全文 uuid 个数」。
  - `tooling/scripts/publish-managed-catalog.rb`：与 Worker 同一合同——vless 用 `uuid`；hysteria2 用 `password` + fingerprint、禁止 skip-cert-verify、名字带 ` · hy2`。**不要**把生产目录 PUT 成带 hy2 块，直到客户端准入合进 `main` 且老板指定灰度账号。
  - `catalogProxyName` / `splitManagedCatalogProxies`：识别后缀 ` · hy2`，基名 = 去掉该后缀。`retirementCatalogPlan` / `relistCatalogPlan` 同时处理基名与 hy2 块。
  - 新迁移 `0072_hy2_transport.sql`：`ops_node_profiles` 加可空 `hy2_port INTEGER`、`hy2_fingerprint TEXT`、`hy2_obfs_ref TEXT`；`connection_events` 加可空 `transport TEXT`；质量表加 `udp_ok`（列名以 `operations_quality_samples` 现结构为准，grep 后写）。
  - `migrations/README.md` 高水位 0072。
  - `docs/ops/api-contract.md` 目录节写命名约定；`NodeDetailDto.facts` 可选 `transports?: ('tcp'|'hy2')[]`、`hy2?: { port, udpOk }`——字段一律可选。
- 唯一测试：`test/catalog-yaml.test.ts` 一个 `it`：含 vless + `Name · hy2` 的目录，对基名退役后两块都不在；hy2 块缺 fingerprint 发布 400。发布脚本一个 hy2 源 dry-run/publish 通过，缺 fingerprint 或 skip-cert-verify 拒绝。
- 验收：preview 库 apply 0072；生产部署仍走 `zsh tooling/scripts/deploy-control-plane-main.sh`，且必须在客户端能解析 hy2 之后才能往生产目录里塞块。

**G2.5 节点侧 hysteria2 与 VLESS 共存** — Grok · M

- 目标：provisioner 增加 hy2 角色，不拆现有 Reality TCP。
- 文件：`tooling/scripts/provision-reality-node.rb`（现技能明确「不要为 Reality 开 UDP」——hy2 是**另一次**、显式的 `--hy2` 路径，默认不加）；systemd 单元、证书 10 年自签带 SAN，指纹写回私有 YAML。UFW 仍不擅自改。
- 密码派生：目录块仍用 `{{TONO_CLIENT_UUID}}`。节点 hy2 走 **`auth.type: http`**（`127.0.0.1:18765`），allowlist 是全部 VLESS UUID 的 SHA-256，外加本机遗留共享口令的 hash（ops 探测仍能用）。禁止 `auth.type: password` 只吃第一个 UUID；禁止 `command`（口令进 `ps`）。已有手工 hy2 用 `--hy2-sync-identities`（默认 dry-run；`--apply` 只写 hy2 鉴权并重启 `tono-hy2` / `tono-hy2-auth`）。**不要**对 Dedirock / 东京再跑 `--hy2 --apply`。
- 唯一测试：provisioner dry-run 在「未传 `--hy2`」时仍然不开放 UDP；hy2 远程脚本不含 `clients[0]["id"]` / `password: $password`，含 `type: http` 与 `sync-identities`。
- 本分支已落地 opt-in 补装路径与身份同步。**Dedirock 已 `--hy2-sync-identities --apply`（2026-09-11）：** allowlist 43，xray PID 658 未换；本机 UUID hy2 ping 通、随机口令拒；杭州只出站 5/5 且经 hy2 到 Google 通。东京 UDP 仍被商家拦，不要在那台上 apply。生产目录仍不 PUT hy2。家宽移动未测。

**G2.6 Windows 准入 hy2** — Grok · M

- 目标：`admit_node` 接受第二种合同，kill switch 放行该 UDP 端点。
- 文件：
  - `apps/windows/crates/tono-core/src/node.rs`：`ValidatedNode` 扩成带 `protocol: VlessReality | Hysteria2`（或等价枚举）。hy2 分支：`type: hysteria2`、公开 IPv4、端口、password、sni/servername、fingerprint（64 hex SHA-256）、禁止 skip-cert-verify、network 缺省即 UDP。`to_runtime_mapping` 发 mihomo `hysteria2` 块。
  - `apps/windows/app/src-tauri/src/tono/connection/endpoints.rs`：hy2 节点的 `ProxyEndpoint.protocol = Udp`。选中 vless 且目录里有同基名 hy2 时，**不要**预放 hy2 UDP，直到本次会话真的切换过去（避免扩大允许集）。切换后再 `ReplaceProxyEndpoints`。
  - 名字：` · hy2` 不得进入 `RESERVED_NODE_NAMES`；基名仍是选择器里用户看到的名字。
- 唯一测试：`admit_yaml` 一个 hy2 块通过；`skip-cert-verify: true` 拒绝；`proxy_endpoint_of` 对 hy2 为 UDP。
- 验收：WFP 在仅 TCP 会话时抓不到对 hy2 端口的 UDP 放行；切换后有。

**G2.7 macOS 准入 hy2 + PF** — Opus / Grok · M

- 文件：`ConfigPipeline+Nodes.swift` `validatedOwnedNode` 增加 hy2 分支（password + fingerprint + tls 语义 = 证书钉扎，不是 Reality）；`ConfigPipeline.dialEndpoints(for:)` 对 hy2 产出 `transport: "udp"`；`AppState+Connect` / `KillSwitchService` 把该端点交给 helper。Helper 协议若只认 TCP，**先加字段再升 Helper 版本**，不要静默丢 UDP（`HelperProtocolVersion.swift` 的历史注释就是这个坑）。
- 唯一测试：`validatedOwnedNode` 接受 hy2；`uniqueDialEndpoints` 能同时保留同 IP 的 tcp:443 与 udp:hy2_port。
- 验收：`verify-release-gate.sh` 仍绿（签名要求没被这次改掉）。

**G2.8 连接编排：TCP 握手失败 → 同节点 hy2 一次** — 两端各 M

- 规则：先按现逻辑连基名 VLESS。`connectFail` 且 `stage ∈ {tcp, handshake}`（Windows 用 `connection/failure.rs` 与 stages 的稳定码；macOS 用 `lastConnectionFailure` / ConnectionStage），若目录存在 `基名 · hy2` 且本会话未试过 → 切到该块重连一次。成功则本会话钉在 hy2，UI 显示「备用通道」。两条都失败才走现有的换城市 failover（`rotateCatalogExitAfterConnectFailure`）。**换城市时对新城市重新从 TCP 开始。**
- 设置：开关「连不上时自动尝试备用通道」。T0 全通 → 默认开；有运营商 blocked → 默认关。
- 遥测：`connectBegin/Ok/Fail/nodeSwitch` 加 `transport: tcp|hy2`。Worker `telemetryEventStringKeys` 加 `transport`（`telemetry-window.ts`）；入库 `connection_events.transport`（0072）。**本分支已收这条遥测并 flatten；自动切换（本节其余规则）仍不做。**
- 文件（Windows）：`connection/stages.rs`、`connection/switch.rs`、`connection.rs` 外层 attempt。
- 文件（macOS）：`AppState+Connect.swift`、`ConnectionCoordinator.swift`；不要把 hy2 试探做成又一次用户可见的「断开重连」闪烁。
- 唯一测试：两端各一条——夹具目录两个块，第一次 TCP 失败，第二次调用的节点名以 ` · hy2` 结尾。Worker 一个 `it`：事件带 `transport=hy2` 写入。
- 验收：内部账号在故意让 TCP 握手失败后（例如临时断 443/tcp、保留 udp）能经 hy2 连上；时间线两行尝试。

**G2.9 后台呈现（最小）** — S

- 客户时间线显示通道；节点详情 `transports`。文案走 `services/ops-console/src/copy/customers.ts`。本分支：hy2 行显示「备用通道」；客户端 connect 事件带 `transport`，Worker 写入 `connection_events.transport`。
- 不做 Playwright 新基线，除非现有 spec 因文案红了。
- 验收：夹具或真数据里 hy2 行看得见「备用通道」，不是英文 `hysteria2`。

**G2 过门清单**

- 2A：Windows 与 macOS 各一次真实失败出现在客户 360。
- 2B：`docs/ops/transport-hy2.md` 有结论；若自动切换启用，内部账号完成「TCP 失败 → hy2 成功」一次；若降级为手动，发布说明有那一句，设置里能手选 ` · hy2`。

---

### 门 3 · 发出去还能再发

**G3.1 实现完整 journal 相位，禁止跳相** — Grok · L

- 背景：issue #26。允许序列（`tono-core/src/update_journal.rs`）：
  `UpdatePrepared → ConnectionQuiescing → CleanShutdownCompleted → ProtectedHandoffRecorded → InstallStarted → FirstLaunchMigration → ProtectionResuming → Verified → Committed`。
- 错误现状：`apps/windows/app/src-tauri/src/tono/update_handoff.rs` `prepare` 直接 `ConnectionQuiescing`；`begin_first_launch_migration` 直接 `FirstLaunchMigration`；`mark_committed` 直接 `Committed` 且可能在失败后删日记。
- 改法（issue 原文禁止的捷径不要走）：每个相位只由**完成了对应操作的所有者**推进。
  | 相位 | 谁在什么成功之后 advance |
  |---|---|
  | ConnectionQuiescing | 更新器开始静默连接 |
  | CleanShutdownCompleted | Core/TUN 已停、DNS 已还（断开路径的同一套证明） |
  | ProtectedHandoffRecorded | Service 记下 WFP 所有权 / 是否保持 kill switch |
  | InstallStarted | NSIS/安装器进程入口，不是 App 猜「大概要装了」 |
  | FirstLaunchMigration | 新进程起来，读到日记 |
  | ProtectionResuming | 保护按日记恢复（或用户本就断开则跳过恢复但仍记录） |
  | Verified | 探针证明数据面或「保持断开」与日记一致 |
  | Committed | **仅** Verified 之后且 durable save 成功，才允许删日记 |
- Failed：任一跳相或持久化失败 → `Failed`，**文件留下**，UI 可提示「更新未完成，请手动断开后重装」。
- macOS：`UpdateHandoffJournal.swift` 已有 `allowedNext` 与 XCTest 序列；核对 Sparkle 钩子是否同样跳相，缺哪段补哪段。两端相位名保持一致。
- 唯一测试：Windows 集成测试重放 prepare→installer→new process→verified，断言磁盘上相位按表前进；每个相位注入崩溃，不得出现 Committed；失败文件仍在。`prepare_installer_new_process_verified_crash_between_owners_never_commits` 走 `write_prepared` / `record_install_started` / `record_first_launch_migration` / `commit_verified_recovery`，不是只调 `advance_pending`。macOS 已有 `UpdateHandoffJournalTests`，补「跳相被拒绝且文件还在」。
- 验收：单元/集成绿。**真机 G3.3 之前不算过门。**

**G3.2 安装器与 App 的所有权** — M

- 目标：NSIS/`tono-service-install.exe --replace-runtime` 写入 `InstallStarted`；安装失败不调 `mark_committed`。App `tono_prepare_update` 停在 `ProtectedHandoffRecorded`（未保护则 `CleanShutdownCompleted`）。
- 本分支已落地：helper 在替换事务入口写盘；找不到日记不发明日记。跨权限扫描 `%APPDATA%`、用户 `AppData\Roaming`、便携 `.config`。旧二进制读到未完成安装会记 `Failed`。
- 相位 × 进程（谁写盘）：

```
UpdatePrepared              App tono_prepare_update
ConnectionQuiescing         App，开始静默断开之后
CleanShutdownCompleted      App，Core/TUN 已停、DNS 已还
ProtectedHandoffRecorded    App，仅当 kill switch 保持武装
InstallStarted              tono-service-install.exe --replace-runtime（NSIS）
                            找不到日记不发明日记
FirstLaunchMigration        新 App 进程，且版本 == next
ProtectionResuming         新 App，上一进程受保护时
Verified → Committed        仅新 App commit_verified_recovery
Failed                      任一跳相或持久化失败；文件留下
```

macOS Sparkle 没有 NSIS，仍由 `installHandler` 在静默断开之后写 `InstallStarted`。
- 验收：上表与安装器脚本、App 启动路径一致。真机 G3.3 之前不算过门。

**G3.3 真机更新** — 老板 · M

- Windows：已装旧客户频道版（0.0.34 或当前朋友在用的包）→ 内部更新源指向 0.0.73 候选 → 若当时已连接，必须先走静默断开（日记里 `was_connected`）→ 安装 → 新进程 → 保护恢复 → 能连。再故意在 `InstallStarted` 后杀安装器一次，日记为 Failed 且还在，手动修复后能用。
- macOS：Sparkle 从 0.0.67（或内部中间候选）升到 0.0.73；`verify-release-gate.sh` 通过；Helper 若版本变了要出管理员提示，发布说明写明。
- 验收：两份短笔录（哈希、相位日志、是否漏流量）。issue #26 在证据贴上之前保持 OPEN。

**G3 过门：** 两端各一次成功受保护更新 + 一次失败证据保留。没有失败注入的「成功更新」不够。

---

### 门 4 · 客户版本 = 你以为的版本

**G4.1 冻结 0.0.73** — S

- 升版本号（§2.3）。写 `apps/macos/release-notes/build73.md` 与 `apps/windows/release-notes/0.0.73.md`，中英或中文与现有系列一致。
- 发布说明必须包含：已知局限（无手机/Linux；Windows 可能 SmartScreen；hy2 自动或仅手动，引用 `transport-hy2.md`；睡眠恢复若未认证就写未认证）。**不要**承诺银行 3DS / 全部 Secure DNS。
- 跑 `verify-desktop-version.py --expected-version 0.0.73` 与稳定性脚本。

**G4.2 内部设备** — 老板 · S

- 至少一台 macOS、一台 Windows，用与客户相同的更新通道（不是拖安装包，除非通道还没指过去——那时先指内部 appcast / latest.json）。
- 看 `connection_events`：失败率不高于旧版；若开了 hy2，出现过至少一次 `transport=hy2` 的成功或确认没有 UDP。

**G4.3 推客户源** — 老板 · S

- macOS：从干净的 `release/macos` 按 `docs/RELEASE_LINES.md` 打 `tono-macos-0.0.73-build73`，改 `public/appcast.xml`，部署控制面（`main` 含该 appcast）。
- Windows：从 `release/windows` 打 `v0.0.73`，推 `windows-updates` 的 `latest.json`，R2 对象存在且后台发布行 `verifiedAt` 有值（PR #140 已要求未校验不能发布）。
- 验收：未改过 hosts 的内部机器「检查更新」看到 0.0.73；`curl` 更新源版本字符串是 0.0.73 不是 0.0.72。

**G4.4 小范围朋友** — 老板 · S

- 先 2–3 人，含至少一个 Windows、一个大陆运营商。24 小时内看失败即报与投诉。升高则撤 `latest.json` / appcast 到上一好版本（macOS 不能降 `CFBundleVersion`，回滚 = 再发更高 build 的旧代码，见 `RELEASE_LINES.md` Build 64 说明）。
- 过门：朋友能用、你能在 `/ops2/` 看到他们的连接，不靠他们发截图。

---

## 5. 建议执行顺序（依赖）

```
B0 口径
  ├─ G1.1 新包复测 ───────────────────── G1.2 / G1.3 / G1.4 / G1.5 ── G1.6 ── G1 过门
  ├─ G2.1 / G2.2 / G2.3 失败即报（等 G1.1 包干净）────────────────── G2A 过门
  └─ T0 UDP 证明
        ├─ 不通：G2.4 仍做目录合同（手动块）+ 开关默认关 + 说明降级 ── G2 过门（降级）
        └─ 通：G2.4 → G2.5 → G2.6+G2.7 → G2.8 → G2.9 ── G2 过门（自动）

G1 且 G2A 之后：G3.1 → G3.2 → G3.3 ── G3 过门
四门证据齐：G4.1 → G4.2 → G4.3 → G4.4 ── 发布标准达成，冻
```

G3 不要与 G1 并行改同一份 Windows 连接/更新代码；G3.1 基于已过 G1 的 `main`。

---

## 6. 整体验收（过发布标准的检查表）

打印这一页，四门全勾才能推客户源。

**G1**

- [ ] Windows 候选包哈希已记录；Connected 后仪表盘与 Activity 离开 retry
- [ ] 断开收回 DNS 与保护；再连成功
- [ ] #116 / #117 行为在真机上可复述
- [ ] macOS 连接/断开回归通过

**G2**

- [ ] B0 日志默认口径已写进发布说明
- [ ] Windows 与 macOS 失败都在客户时间线
- [ ] `docs/ops/transport-hy2.md` 有三网结论
- [ ] 自动切换：内部账号完成 TCP 失败 → hy2 成功；**或** 降级句写进 0.0.73 说明且手选可用

**G3**

- [ ] journal 相位测试：成功序列 + 每相位失败留证
- [ ] Windows 真机一次成功更新、一次失败留证
- [ ] macOS Sparkle 真机一次成功更新
- [ ] issue #26 可关

**G4**

- [ ] 源码、安装包、Sparkle、`latest.json` 都是 0.0.73
- [ ] 内部机器从客户源升上来，不是旁路拖包
- [ ] 后台发布行有 `verifiedAt`，R2 对象存在
- [ ] 小范围朋友 24h 失败率未升高，或已回滚并停止扩大

**产品验收仍是一句：** 朋友装上之后，能连、连不上时 App 自己有下一手或一句诚实的失败、下一次你还能再发一版到他们机器上。做不到其中任何一项，就还没过发布标准。

---

## 7. 工作方式

1. 每条任务开分支 `cursor/<gate>-<slug>-d57f` 或沿用已有 PR 分支，PR 标题写 `G1.x:` / `G2.x:` / `G3.x:`。
2. PR 说明：服务哪一扇门、原始测试输出、真机笔录链接或「待老板 G1 清单」、触碰的共享合同（`catalog-yaml.ts`、`telemetry-window.ts`、Helper 协议）。
3. 控制面迁移 0072 先在 preview apply，再进生产部署脚本。
4. 每天只问老板三件事：B0 是否已拍、Windows 机器是否空、T0 是否已写。其余按本计划推进。
5. 与 `docs/ops/plan-2026-09-11.md` 冲突时：客户发布门优先。不要把 ChangeReceipt / 角色 / 分页塞进 0.0.73。
