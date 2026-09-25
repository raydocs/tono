# Tono 发现总账（Findings Ledger）

这是**唯一的已知问题总账**。每一轮审查、核实、修复开始前先读它，用它去重，
不再每轮手工粘贴 known-findings。它回答「这个问题有没有人报过、现在是什么状态、
还剩什么限制」。它不取代 [INTERNAL_CHANGELOG](INTERNAL_CHANGELOG.md)（交付和验证记录）、
[SHIP_PLAN](SHIP_PLAN.md)（发布门）或 GitHub issue/PR 正文（详细分析）。

## 维护规则

- **同 PR 更新**：每个修复 PR、审查 PR 都要同步更新对应条目的状态和链接。
  新发现加新行；开出 issue/PR 后把「待开」改成真实编号。
- **驳回的也要留一行**：被核实推翻、撤回或排除的结论记为 `refuted`，写一句依据，
  防止以后重复上报。重报必须给出推翻依据失效的新反例。
- **状态值只有五种**：
  - `open`：确认或推导成立，尚无合入 main 的修复（可能已有 issue 或工作分支）。
  - `in-PR`：修复 PR 已开，尚未合入 main。
  - `fixed(<main SHA>)`：修复源码已进入 main，SHA 是合入 main 的提交。**只表示源码进 main**，
    不表示签名、候选包、实机验收或客户发布。
  - `refuted`：核实推翻、撤回或排除。
  - `accepted-design`：有意设计或已记录的取舍，不作为缺陷修。
- **等级**写成「影响·核实度」。影响：高 = 流量/身份泄漏、越权、跨账户串扰、保护已解除却显示已保护；
  中 = 产品内锁死、保护状态失真（仍 fail-closed）、自愈缺失；低 = 显示、体验或前提很窄。
  核实度：已确认 / 推导（源码推导）/ 实机（需实机验证）。
- **ID 保留原编号**：首轮 W/M/S；审查轮 R1–R4（`R<块>-F<n>`，`R3-O<n>` 为观察项）；
  隐秘 bug 搜寻 H1–H19（`H<块>-F<n>`，`H6-C` 为功能缺陷；H16 起多席位并行，写成
  `H<块>-<席位>-F<n>`，O/C/G 分别为 Opus/Codex/Grok 席位，多个席位报同一问题时取一个 ID 为行 ID，
  其余在问题栏以「=」列出；跨行合并修复用描述性 ID，如 `H17-AUTH-MAC`）；
  内部复核轮 X1–X3（`X<轮>-<n>`，带连字符）。
  `-hint`、`-notice`、`-order` 后缀是同一发现派生出的独立缺陷，单列一行。首轮之后的零散修复用 I（安装/易用性）与
  N（连接等待/DNS）；没有轮次编号、直接以 issue 报告的用 issue 号（如 `#491`）；撤回/排除用不带连字符的
  X<n>（与复核轮 `X<轮>-<n>` 区分）；已交付结构与设计取舍用 D。
- **安全类条目**（数据面泄漏、特权、越权）只写缺失的约束与影响，不写复现命令或绕过手法；
  详细分析留在 issue/内部报告。仓库是公开的。
- 同一根因的续修、移植、补测试、cherry-pick 不算新条目，在原行「剩余限制」或链接里补充。
- 工程/测试/文档修正（CI 覆盖、fixture、编译错误、截图等）不进本账，见 INTERNAL_CHANGELOG。
- 方法与覆盖范围见 [2026-09-23 审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md) 与 [2026-09-24 审查轮记录](reports/REVIEW_ROUNDS_2026-09-24.md)。

状态快照：2026-09-24，origin/main `059a2ea2`（R1–R4 修复已合入至 #311；#300、#305 仍在审；#312、#482 已关闭）。
H5–H15 与 X1–X3 的修复 PR 均已开出、尚未合入。H16/H17 已登记 15 行，均为 `open`；另外 5 条由各自修复 PR 登记：
H16-O-F1（#513）、H16-O-F2（#518）、H16-O-F6（#520）、H17-AUTH-MAC（#516）、H17-O-F2 (Windows)（#515）。表中编号与状态为写入时 GitHub 的真实状态。

## 1. macOS 连接

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M1 | AppState 因 Core 停止失败保留保护，AccountSession 第二个 owner 仍恢复 DNS、解除 PF | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267)（含 #268） | 中·已确认 | AppState 为唯一释放 owner；实机未覆盖全部失败组合 |
| M3 | audit 写盘失败无界回填 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | 上限 256 条/256 KiB，超出部分本地丢弃并记录 |
| I5 | 验证期间同名目录被替换，旧 digest 的成功记给新目录 | fixed(569ce865) | [#279](https://github.com/raydocs/tono/pull/279) | 低·已确认 | — |
| R1-F1 | 切节点/热重载/后台策略重启 sing-box 的 utun 瞬时空窗被健康监视判为 TUN stopped，正常切换变成断开+重连 | fixed(def3dd79) | [#298](https://github.com/raydocs/tono/pull/298) | 中·已确认 | 空窗时长与命中率需实机；原报告「三次暂停」一句不成立（见 X8） |
| R1-F2 | 睡眠落在 Restore internet 期间：显式释放被改写为保留保护+唤醒重连；PF 未 armed 时仍宣告 Protected Offline | fixed(833c0607) | [#310](https://github.com/raydocs/tono/pull/310) | 中·已确认 | 睡眠通知次序需实机；后续改用 helper 真值见 R1-N1 |
| R1-F3 | PF 未 arm 时到达的策略更新拆掉连接后，重连 loop 把「从未 armed」当外部释放，Connect 意图丢失 | fixed(e7c913e1) | [#304](https://github.com/raydocs/tono/pull/304) | 中·已确认 | 与 R1-F4 非同根因 |
| R1-F4 | 连接后后台可选策略替换失败只断开不调度重连，停在 Protected Offline | fixed(18301fc5) | [#306](https://github.com/raydocs/tono/pull/306) | 中·已确认 | — |
| R1-F5 | 连接/断开进行中的系统网络变化通知被丢弃，最长 60 s 后才由审计发现（W8 的 macOS 遗漏） | fixed(1974c46f) | [#309](https://github.com/raydocs/tono/pull/309) | 低·已确认 | 审查要求断开分支不得把自写 DNS 当外部变化回放 |
| R1-F6 | 连接中选择另一节点，完成时被 core 实际选择覆盖回旧节点 | open | [#312](https://github.com/raydocs/tono/pull/312)（已关闭） | 低·已确认 | 生产卡片连接中已禁用，仅同帧竞争可触发；#312 的修法在后台策略重载进行中时更差，已关闭，暂不修 |
| R1-N1 | #310 判「未 armed」用 App 本地状态，应改用 helper 真值，仅确认为 false 才发布非 blocked | fixed(745e217d) | [#480](https://github.com/raydocs/tono/issues/480)，[#482](https://github.com/raydocs/tono/pull/482)（已关闭），[#433](https://github.com/raydocs/tono/pull/433) | 低·推导 | 即 #310 审查附注 §3；#482（preserve 拆除前逐次读回 helper）已关闭，由 #433（arm 结果未知保持 fail-closed，X1-7）覆盖 |
| X1-2 | 显式 Restore internet 的 PF 解除被 helper 睡眠门拒绝后，释放意图仍被清除，唤醒或网络变化时自动重连 | in-PR | [#442](https://github.com/raydocs/tono/issues/442)，[#443](https://github.com/raydocs/tono/pull/443) | 中·推导 | 全程 fail-closed，无泄漏；#310 只修了 R1-F2 的一个入口；任何解除失败的显式释放同样受影响 |
| X1-3 | Repair and reconnect 遇 403 先重新暂停，走不到 helper 重装 | in-PR | [#428](https://github.com/raydocs/tono/issues/428)，[#429](https://github.com/raydocs/tono/pull/429) | 中·推导 | — |
| X1-4 | 从未 armed 的连接失败也触发显式释放修复路径 | in-PR | [#431](https://github.com/raydocs/tono/pull/431) | 低·推导 | 与 R1-F3 同类「从未 armed」判断，不同入口 |
| X1-5 | 切节点途中睡眠被取消，唤醒后重连到旧出口 | in-PR | [#444](https://github.com/raydocs/tono/issues/444)，[#446](https://github.com/raydocs/tono/pull/446) | 低·推导 | — |
| X1-6 | 会话拆除时未清除 Recovering 状态 | in-PR | [#435](https://github.com/raydocs/tono/pull/435) | 低·推导 | — |
| X1-7 | arm 结果未知被当作未 armed | in-PR | [#433](https://github.com/raydocs/tono/pull/433) | 中·推导 | 同一 PR 覆盖 R1-N1 |
| X1-8 | disarm 出错后未读回 helper 就发布 blocked 状态 | in-PR | [#437](https://github.com/raydocs/tono/pull/437) | 低·推导 | — |
| X1-9 | 更新状态查询返回后未复核连接 attempt 即提交 onCoreStarted | in-PR | [#439](https://github.com/raydocs/tono/pull/439) | 低·推导 | — |
| H16-O-F5 | 启动时从 helper 收养已 armed 的 PF 屏障，但不设 isProtectionBlocked：菜单栏与主窗显示 Standby，激活对账与 Retry 都以该标志为前提（= H16-C-F1） | open | 待开 | 中·已确认 | 全程 fail-closed，无泄漏；直到一次 Connect 或网络变化才收敛；与 H17-AUTH-MAC（#516）同改文件，排在其后 |
| H16-O-F3 | 空闲、未 armed 的 Mac 上所选服务器被移出目录时，错误横幅称「断网保护仍在拦住直连」 | open | 待开 | 低·已确认 | 屏障不存在而文案称在拦截；药丸同时显示未连接，无泄漏；未绑定住宅线的用户都会走到这条分支 |
| H16-C-F2 | 从菜单栏 Restore internet 成功释放后，已显示的账户 gate（suspended）不失效，继续称 Kill Switch 在拦截 | open | 待开 | 中·推导 | gate 读取不可观察的静态 isArmed；登录卡同一读法；SwiftUI 实际重绘需实机；排在 H16-O-F5 之后 |
| MAC3-RECHECK-F1 | wake 保护未知与重试暂停并存时，菜单栏优先显示 Protected Offline | in-PR | [#610](https://github.com/raydocs/tono/pull/610) | 中·已确认 | `train/mac3-20260924` 已将未知判断移到暂停判断前；新增投影回归，XCTest 未运行，无新包 |
| MAC3-RECHECK-F2 | wake reassert 成功返回后未检查取消，旧任务可覆盖保护状态并继续连接 | in-PR | [#610](https://github.com/raydocs/tono/pull/610) | 中·推导 | `train/mac3-20260924` 返回后立即检查取消；新增取消后成功返回回归，XCTest 未运行，无设备验收 |

## 2. Windows 连接

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W1 | 重试任务槽位被覆盖，旧句柄丢失但 loop 继续 | fixed(0e20f2df) | [#247](https://github.com/raydocs/tono/issues/247)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W3 | 节点页/托盘用旧 idle 状态，在后端已接受热切换后追加 Connect | fixed(0e20f2df) | [#251](https://github.com/raydocs/tono/issues/251)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | admission 残余竞态见 I6 |
| I6 | #251 续：读取 idle 后、Connect admission 前另一窗口已连接，本窗口报错/托盘不刷新 | fixed(ac2cde16) | [#281](https://github.com/raydocs/tono/pull/281) | 低·已确认 | 只协调已识别的 Connect 竞争拒绝 |
| W4 | 登出进行中调用者消失，关闭责任提前结束并重开连接 admission | fixed(0e20f2df) | [#248](https://github.com/raydocs/tono/issues/248)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W5 | 断开调用者取消后会话时钟、重试元数据未收尾 | fixed(0e20f2df) | [#246](https://github.com/raydocs/tono/issues/246)，[#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| W6 | A 验证迟到，覆盖 B 的 controller secret/port | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W9 | 下一次重试清空上次失败原因/代际/阶段 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| W10 | 55 s UI 等待超时被当成释放已结束，提前重开 admission | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W14 | A 连接失败等 Service status 期间 B 登录，失败归给 B | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| I4 | Activity 把只有 selector 的链当作已观测终端出口 | fixed(569ce865) | [#279](https://github.com/raydocs/tono/pull/279) | 低·已确认 | — |
| #241 | 过期策略恢复在拆除期间借用替换中的 Core 会话 | fixed(基线 576d7087 已含) | [#241](https://github.com/raydocs/tono/issues/241) | 中·已确认 | issue 保持开放等设备证据 |
| #171 | 热切换端点收敛失败时两端都必须撤回 Connected | fixed(d769e134) | [#171](https://github.com/raydocs/tono/issues/171)，[#174](https://github.com/raydocs/tono/pull/174) | 中·实机 | 两端源码已修；issue 保持开放等已安装设备验收 |
| R2-F1 | Disconnect/登出与进行中的 StartClash 竞争且释放被拒：UI 报 Not Connected 而 WFP 仍封锁，Disconnect 成空操作 | fixed(3d957265) | [#295](https://github.com/raydocs/tono/pull/295) | 中·已确认 | 含登出第二路径；实机未复现 |
| R2-F2 | 未验证 Protected Offline 期间 Service 重启解除 WFP，App 无再同步，UI 持续显示已封锁 | fixed(244075f2) | [#299](https://github.com/raydocs/tono/pull/299) | 高·已确认 | 30 s 轮询；已验证会话进入 idle 且未排程重连时不注册轮询；无「Service 重启+存活 App」实机夹具 |
| R2-F3 | 原生更新安装落在连接早期，失败后 FSM 卡在 Connecting | fixed(16032c48) | [#294](https://github.com/raydocs/tono/pull/294) | 中·已确认 | 收敛前比对代际；实机未复现 |
| R2-F4 | monitor 驱动重连成功后 abort 了正在跑连接尾部的自身任务 | fixed(49c82dde) | [#296](https://github.com/raydocs/tono/pull/296) | 低·推导 | 实际损失为本会话 DIRECT 覆盖缺失与 UI directOn 失真 |
| R2-F5 | 连接中到达的策略行为变更被丢弃，本会话不应用 DIRECT | fixed(da7bad1b) | [#297](https://github.com/raydocs/tono/pull/297) | 低·已确认 | 「UI 显示直连已开」被驳回（X9）；pending 变更须随 Disconnect/换账户清除（二轮修正） |
| R2-F6 | 被取消 attempt 的 PrepareCoreStart 迟到，可停掉后继未验证 Core | fixed(b1b6fe6c) | [#302](https://github.com/raydocs/tono/pull/302) | 中·实机 | 协议 rev 16→17；旧 App + 新 Service 兼容按二轮修正处理；实机未复现 |
| H9-F2 | 完成释放后的更新检查返回释放错误，UI 显示仍保留保护 | in-PR | [#393](https://github.com/raydocs/tono/issues/393)，[#396](https://github.com/raydocs/tono/pull/396) | 高·推导 | #359/#361 需 rebase 到 retire_after_release 之上 |
| H9-F3 | 被更新取消的 attempt 未推进 PrepareCoreStart 代际 | in-PR | [#390](https://github.com/raydocs/tono/issues/390)，[#392](https://github.com/raydocs/tono/pull/392) | 低·推导 | R2-F6 的续项；其他取消路径仍不推进代际 |
| H13-F2 | 长时间睡眠后周期同步集中突发 | in-PR | [#455](https://github.com/raydocs/tono/issues/455)，[#456](https://github.com/raydocs/tono/pull/456) | 低·推导 | — |
| H13-F3 | 控制面拒绝会话后账户未进入挂起 | in-PR | [#459](https://github.com/raydocs/tono/issues/459)，[#460](https://github.com/raydocs/tono/pull/460) | 中·推导 | 与 #456 同文件，后合者需 rebase |
| X2-1 | 网络变化后 DIRECT 仍绑定已不再是上行的适配器 | in-PR | [#461](https://github.com/raydocs/tono/issues/461)，[#462](https://github.com/raydocs/tono/pull/462) | 低·实机 | 核实后降级 |
| H6-C | Support 页 WebRTC 检查按钮缺少打开其固定页面的权限 | in-PR | [#386](https://github.com/raydocs/tono/issues/386)，[#387](https://github.com/raydocs/tono/pull/387) | 低·已确认 | 功能缺陷，非安全项 |
| H16-C-F3 | 退出登录发布最终状态后，周期目录同步在解锁后发布的旧 Ready/Connected 快照可以覆盖 tono_status 缓存且不再被纠正 | open | 待开 | 中·推导 | 窗口是解锁与发布之间几条指令，需要 worker 线程被抢占；未复现；与 H17-AUTH-WIN（#515）同改 account.rs，排在其后 |
| H16-O-F7 | 冷启动恢复把已探测到的屏障状态压到 me() 返回之后才发布，期间托盘 flyout 显示 Standby 并提供 Connect | open | 待开 | 低·已确认 | 核实后收窄：仅初始未保护且持有 refresh token 的冷启动恢复、仅豁免恢复屏的托盘 flyout；Connect 会被账户准入拒绝；排在 #515 之后（restore.rs） |
| H16-O-F1 | Protected Offline 横幅、登录「网络已被拦截」卡片与托盘提示只凭状态机锁存声称已拦截，未看 Service 的 live 屏障（= H16-C-F5） | in-PR | [#511](https://github.com/raydocs/tono/issues/511)，[#513](https://github.com/raydocs/tono/pull/513) | 高·已确认 | 仪表盘、进度卡、托盘面板已由 b489ea16 修正；托盘提示被速率覆盖、图标不刷新见 H16-O-F2 |
| H16-O-F2 | 托盘图标只在启动时取样，状态发布不刷新；connecting/disconnecting 显示已连接图标；速率显示整段替换提示的保护行（= H16-C-F4） | in-PR | [#517](https://github.com/raydocs/tono/issues/517)，[#518](https://github.com/raydocs/tono/pull/518) | 中·已确认 | 反向「橙色卡住」变体为推导；未实机观察 |
| H16-O-F6 | 退出/重启拒绝对话框不读 Service 就承诺「本机保持受保护」，而 8 s 超时后释放仍可能完成、待完成更新时主机可能从未受保护 | in-PR | [#519](https://github.com/raydocs/tono/issues/519)，[#520](https://github.com/raydocs/tono/pull/520) | 中·推导 | 文案已确认，慢释放时序需实机；App 侧 IPC 报错而 Service 仍在释放时仍可能误说保持受保护 |

## 3. DNS（两端）

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W2 | 卸载时 NRPT 恢复失败被适配器 fallback 吞掉，误报已恢复 | fixed(0e20f2df) | [#249](https://github.com/raydocs/tono/issues/249)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | issue 开放等设备/系统边界证据 |
| W8 | Windows DNS 自写窗口内直接丢弃网络通知 | fixed(0e20f2df) | [#259](https://github.com/raydocs/tono/issues/259)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | issue 开放等设备证据；macOS 对应项 R1-F5 |
| M2 | macOS DNS 读取失败当作空配置，删除快照并允许释放 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267)（含 #268） | 中·已确认 | 「拒绝假恢复」是后续 DNS 修复的约束基线 |
| N1 | macOS getaddrinfo 阻塞在 task group 内 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | — |
| N2 | macOS DNS-SD 同步提交阻塞，timer/cancel 共用队列，旧请求未清理即堆叠 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | 无确定性挂住 deallocate 的回归 |
| N3 | macOS listener NWConnection 构造期取消丢失 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 低·已确认 | — |
| N4 | listener 接受不匹配问题/无关 owner/CNAME/错误或截断应答仍产生 fake-IP 证明 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | 无 parser fuzz |
| N5 | listener 读到 fake-IP 后续 RR 畸形仍保留正面结果 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | — |
| N6 | listener 忽略 OPT 扩展 RCODE | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 低·已确认 | — |
| N7 | Windows 适配器消失被合成为 apply 成功 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289)（含 #290） | 中·已确认 | 未证明 WFP 被绕过；夹具未跨真实 DLL |
| N8 | Windows IPv4 已写、IPv6 失败时无 pending，下一次被当作已配置 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289)（含 #290） | 中·已确认 | 同上 |
| N9 | Windows 快照损坏时混合 DNS（公共 + TUN 地址）被漏判，错误接受恢复 | fixed(576d7087) | [#293](https://github.com/raydocs/tono/pull/293) | 中·已确认 | — |
| R3-F1 | Windows 快照存在时，已带 TUN DNS 地址的新/重激活适配器被记为原始 DNS；损坏快照恢复只读 active 适配器，Disconnect 永久被拒 | in-PR | [#300](https://github.com/raydocs/tono/pull/300) | 中·已确认 | 区别于 N9；验收机需核实 wintun 删除后接口键残留 |
| R3-F2 | Windows 加密 DNS 旁路捕获文件非原子落盘，损坏后释放永久硬拒 | in-PR | [#305](https://github.com/raydocs/tono/pull/305)（叠在 #300 上） | 中·推导 | 需持久记录隔离证据；文件跨卸载存活 |
| R3-F3 | macOS `protected-dns.json` 损坏/权限异常时 restore、紧急解除、卸载、启动清理全被阻 | fixed(05c58d5d) | [#307](https://github.com/raydocs/tono/pull/307) | 中·推导 | 审查要求：DNS 恢复失败时紧急出口不得顺带拆 PF（M2） |
| R3-F4 | macOS status() 把「快照有效但服务不可读」报成无快照，App 不再调用 restore | fixed(be1c75d2) | [#303](https://github.com/raydocs/tono/pull/303) | 低·已确认 | helper 契约版本级联（4.6.0 起） |
| R3-O1 | Windows 恢复证明通过后删快照失败即拒绝拆 WFP，重试同样失败（ACL/AV 锁文件） | open | 待开 | 低·推导 | 观察项，未核实 |
| R3-O2 | Windows 外层超时丢弃 restore future 时自写窗口提前关闭，自写通知被当外部变化 | open | 待开 | 低·推导 | 观察项；影响为多一次网络事件 |
| R3-O3 | 无快照时把静态 DNS 改为 DHCP 的孤儿修复 | accepted-design | — | 低 | 有意取舍 |
| R3-O4 | macOS `--emergency-disarm` 不先 bootout daemon，与在线 daemon 双写 | open | 待开 | 低·推导 | 观察项；操作员手动路径 |
| R3-O5 | macOS 按名字取第一个网络服务，多 Network Location 同名时可能写错服务 | open | 待开 | 低·实机 | 观察项 |
| R3-O6 | Windows 卸载器在 owner lock 不可得且无 pid 文件时仍 disarm，可能与存活 Service 并发写 DNS | open | 待开 | 低·推导 | 观察项 |
| R3-O7 | 无快照守卫只认 TUN 地址，旧版遗留 127.0.0.1 被当作用户本地解析器 | accepted-design | — | 低 | 有意取舍，源码有注释 |
| X2-2 | Windows NRPT 漂移未计入受保护 DNS 健康状态 | in-PR | [#467](https://github.com/raydocs/tono/issues/467)，[#468](https://github.com/raydocs/tono/pull/468) | 中·实机 | 需实机 |
| X2-3 | macOS Protected DNS 服务按猜测的 Wi-Fi 选择，完整性检查只看单个服务 | in-PR | [#457](https://github.com/raydocs/tono/issues/457)，[#458](https://github.com/raydocs/tono/pull/458) | 中·实机 | 需实机；全隧道 VPN 为 IPv4 主服务时现在拒绝连接 |
| X3-1 | macOS helper DNS 快照按服务显示名键控，服务改名后静态 DNS 丢失 | in-PR | [#475](https://github.com/raydocs/tono/issues/475)，[#476](https://github.com/raydocs/tono/pull/476) | 中·推导 | helper 4.14.0 为占位版本；服务被删时存档快照而非报错（与 #307 一致） |
| X3-1-notice | 释放后原始 DNS 未能放回（originalDNSRestored:false）时 macOS App 不提示用户 | in-PR | [#487](https://github.com/raydocs/tono/issues/487)，[#489](https://github.com/raydocs/tono/pull/489) | 低·推导 | 依赖 #476 |
| X3-3 / X3-4 | Windows 终端诊断不走 Documents Known Folder；带 BOM 的配置被误判为 Ready | in-PR | [#477](https://github.com/raydocs/tono/issues/477)、[#478](https://github.com/raydocs/tono/issues/478)，[#479](https://github.com/raydocs/tono/pull/479) | 低·推导 | X3-3 需实机 |

## 4. 升级事务与候选安装

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M4 | macOS 更新日记用旧 Mihomo 版本/build number 冒充 Core/源码身份 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| I1 | Windows 覆盖安装使用盘符相对路径 `C:Users` | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276) | 中·已确认 | — |
| I2 | macOS 候选签名准入固定在 0.0.72 | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276)，[#273](https://github.com/raydocs/tono/issues/273) | 中·已确认 | #273 开放：最新分支的新包/已装 helper 资格未建立 |
| I3 | macOS 签名链同一 run 重复生产同名 Core artifact | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276) | 低·已确认 | — |
| #26 | Windows 受保护升级需安装器绑定的交接身份和装机证明 | fixed(1ca878cf) | [#26](https://github.com/raydocs/tono/issues/26)（已关闭） | 高·实机 | 协议源码已接入；已装 macOS/Windows 11 的升级/中断恢复实机验收仍缺 |
| #181 | 共享更新日记临时文件可被并发写坏 | fixed(34e5619b) | [#181](https://github.com/raydocs/tono/issues/181)，[#184](https://github.com/raydocs/tono/pull/184) | 低·推导 | 唯一 scratch + `create_new` + 回归已在 main；issue 保持开放等 Windows 原生验收 |
| R4-F1 | Windows 更新事务权限绑定单一 App incarnation，发起 App 退出/被杀/回滚后所有出口被拒 | fixed(498ed426) | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 与 F4/F6 同根因合修；对 0.0.73 首跳不生效 |
| R4-F4 | Windows 恢复执行器把「Replaced 且 successor 不活」一律当中断安装回滚，撤销完整安装 | fixed(498ed426) | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 慢机服务就绪超时是第三个入口 |
| R4-F6 | Windows Launching 且执行器登记为空/已死的事务既不退休也不对账 | fixed(498ed426) | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 网络可在产品内恢复，锁死的是产品本身 |
| R4-F7 | Windows Replaced + 已验证 Disconnect 后事务永久 pending，连接/再更新/卸载全被拒 | in-PR | [#358](https://github.com/raydocs/tono/issues/358)，[#359](https://github.com/raydocs/tono/pull/359) | 中·推导 | 非 #301 引入；#359 须先于 #361、#509 合并，并需 rebase 到 H9-F2 的 retire_after_release 之上 |
| R4-F8 | Windows 恢复判定与已回滚退休只校验三个二进制，不校验整份 durable plan | in-PR | [#360](https://github.com/raydocs/tono/issues/360)，[#361](https://github.com/raydocs/tono/pull/361) | 中·推导 | 内部别名 R4-301-2；叠在 #359 上；安装完整性缺口，无保护绕过 |
| R4-F2 | macOS consumed 后未到 replaced 的事务无终态，helper 永久拒绝启动/新 offer/修复 | fixed(bb2ed4e4) | [#311](https://github.com/raydocs/tono/pull/311) | 中·已确认 | 与 F3 合修；helper 契约 4.9.0 |
| R4-F3 | macOS successor 绑定唯一 audit token 无再收养，执行器 relaunch 的新实例也被拒 | fixed(bb2ed4e4) | [#311](https://github.com/raydocs/tono/pull/311) | 中·已确认 | 原报告对现有收养能力的描述不成立（X10） |
| R4-F5 | macOS 开机时 helper KeepAlive 重启与执行器停止 daemon 交错，startup 抛错触发紧急 PF 阻断 | fixed(26d438c1) | [#308](https://github.com/raydocs/tono/pull/308) | 低·推导 | 受保护义务可自愈；仅 `.unprotected` 义务落入 R4-F2 |
| X1-1 | 旧 helper 读不了自己的 DNS 快照时阻塞自身升级，停在 Protected Offline | in-PR | [#426](https://github.com/raydocs/tono/issues/426)，[#427](https://github.com/raydocs/tono/pull/427) | 中·推导 | — |
| H10-F3 | Windows 更新期间的 Disconnect 以墙钟先后作为准入条件 | in-PR | [#413](https://github.com/raydocs/tono/issues/413)，[#415](https://github.com/raydocs/tono/pull/415) | 中·推导 | — |
| X3-2 | Windows 更新恢复的 schtasks 使用硬编码 C:\ 路径 | in-PR | [#469](https://github.com/raydocs/tono/issues/469)，[#471](https://github.com/raydocs/tono/pull/471) | 低·推导 | — |
| X3-2-order | Windows 恢复任务注册失败时更新停在 Consumed | in-PR | [#484](https://github.com/raydocs/tono/issues/484)，[#488](https://github.com/raydocs/tono/pull/488) | 中·推导 | 与 #471/#361 可能文本冲突 |
| #490 | Windows 更新恢复在分类前停止 Service，对 Replaced 且 successor 未运行的 attempt 反复停启 | in-PR | [#490](https://github.com/raydocs/tono/issues/490)，[#509](https://github.com/raydocs/tono/pull/509) | 中·推导 | 叠在 #359 → #361 → #509；与 #488 同文件但无重叠 hunk |
| H15-F2 | Windows 安装/卸载器在 Tono 过滤器存在时静默拒绝 | in-PR | [#499](https://github.com/raydocs/tono/issues/499)，[#500](https://github.com/raydocs/tono/pull/500) | 中·实机 | NSIS 未在本地编译；需候选包与实机 |
| H15-F3 | 0.0.72 更新交接日记从不退役，永久显示「更新未完成」 | in-PR | [#496](https://github.com/raydocs/tono/issues/496)，[#497](https://github.com/raydocs/tono/pull/497)（macOS）、[#498](https://github.com/raydocs/tono/pull/498)（Windows） | 中·推导 | 未实跑 0.0.72→0.0.73 升级 |
| H15-F5 | Windows 降级到 0.0.72 后残留 NRPT catch-all 且加密 DNS 关闭 | in-PR | [#507](https://github.com/raydocs/tono/issues/507)，[#508](https://github.com/raydocs/tono/pull/508) | 中·实机 | 安装器改为拒绝降级并记录安全回滚步骤；需候选包与实机 |
| H15-F6 | 原生更新 store/账本无版本号，遇新版写入的未知字段即拒绝 | in-PR | [#501](https://github.com/raydocs/tono/issues/501)，[#502](https://github.com/raydocs/tono/pull/502)（Windows）、[#503](https://github.com/raydocs/tono/pull/503)（macOS） | 中·推导 | #503 的 helper 4.40.0 为临时编号，合并时重编号并重算 CONTRACT.sha256 |
| H16-O-F4 | macOS 原生更新准备失败后 isConnected 已清、isProtectionBlocked 未设：各表面显示 Standby 而 PF 仍 armed，Connect 点击被静默丢弃（= H16-C-F6） | open | 待开 | 中·已确认 | 全程 fail-closed，无泄漏；本会话内不收敛；准备失败的频率需实机 |

## 5. 控制面（Worker）

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H4-F1 | dual 阶段吊销设备不退役共享 legacy 出口凭据，被吊销设备仍可用出口并计入账户 | in-PR | [#313](https://github.com/raydocs/tono/issues/313)，[#323](https://github.com/raydocs/tono/pull/323) | 高·推导 | 暴露面取决于生产 rollout phase（本机无法查）；列车 #570 审查 TC-anthropic-1：退役账户的就绪判断看全部 active 出口，一个未上架的新节点就让所有退役账户 503，已在分支 `fix/cp-a-20260924` 改为只看本次下发目录中的节点（未合 main） |
| H4-F2 | 停用/退役/删除/改名的住宅（catalog 型）home exit 及其 hy2 孪生块从限制名单掉出，下发给所有账户 | in-PR | [#322](https://github.com/raydocs/tono/issues/322)，[#326](https://github.com/raydocs/tono/pull/326) | 高·推导 | roster 不按节点隔离（身份隔离）列为后续 |
| H4-F3 | ops 角色门不覆盖 shared-admin；另有原始日志读取与 signup-allowlist 写两处未拦截且文档未列 | open | 待开 | 低·推导 | shared-admin 不拦截是已记录限制；只有配置 OPS_ROLES 且有非 owner 角色时可利用 |
| H3-F4 | refresh 严格单次轮换无宽限且非原子：响应丢失即产生伪 401，客户端登出并释放保护 | in-PR | [#314](https://github.com/raydocs/tono/issues/314)，[#329](https://github.com/raydocs/tono/pull/329) | 高·推导 | 修复在服务端，客户端「真 401 才释放」不变；Windows 启动恢复遇 401 已不再释放（[#515](https://github.com/raydocs/tono/pull/515)） |
| H3-F5 | 策略 revision 不在签名字节内，历史签名策略配伪造 revision 可永久钉住客户端 | in-PR | [#317](https://github.com/raydocs/tono/issues/317)，[#342](https://github.com/raydocs/tono/pull/342)（Windows 客户端）、[#472](https://github.com/raydocs/tono/pull/472)（Windows sing_box）、[#473](https://github.com/raydocs/tono/pull/473)（macOS）、[#474](https://github.com/raydocs/tono/pull/474)（Worker/签名工具） | 中·推导 | 前提是 Worker/D1 被攻破或 TLS 中间人；#474 的开关默认关闭，四个 PR 都合入并由发布侧启用后才生效 |
| H10-F1 | 控制面节点名校验与客户端 YAML 解码不一致，受限住宅出口可能下发给其他账户 | in-PR | [#418](https://github.com/raydocs/tono/issues/418)，[#419](https://github.com/raydocs/tono/pull/419) | 高·推导 | — |
| H13-F1 | 服务端声明不存储日志时，客户端无限重传网络日志上传 | in-PR | [#452](https://github.com/raydocs/tono/issues/452)，[#453](https://github.com/raydocs/tono/pull/453)（macOS）、[#454](https://github.com/raydocs/tono/pull/454)（Windows） | 低·推导 | 两个 PR 都合入后手动关闭 #452 |
| H13-F4 | telemetry/失败/支持上报按来源 IP 限流，共享出口 IP 的账户互相挤占 | in-PR | [#440](https://github.com/raydocs/tono/issues/440)，[#441](https://github.com/raydocs/tono/pull/441) | 中·推导 | — |
| H13-F7 | enforce cron 扫描无上界，保留清理各步未相互隔离 | in-PR | [#445](https://github.com/raydocs/tono/issues/445)，[#447](https://github.com/raydocs/tono/pull/447) | 中·推导 | migration 0090 |
| H14-F1 | 索引行写入失败时原始日志 R2 对象成为孤儿 | in-PR | [#448](https://github.com/raydocs/tono/issues/448)，[#450](https://github.com/raydocs/tono/pull/450) | 低·推导 | migration 0088；部署前已有的孤儿需 owner 在控制台为 tono-diagnostics-logs 设 lifecycle 兜底 |
| H14-F2 | 可重新上架退役时出口 token 已吊销的节点；drain 与吊销存在竞态 | in-PR | [#449](https://github.com/raydocs/tono/issues/449)，[#451](https://github.com/raydocs/tono/pull/451) | 中·推导 | 与 #375 在 revokeExitToken 同一 UPDATE 相邻行冲突，后合者保留双方 |
| H15-F7 | 控制台重新上架会发布不完整的 Reality 条目，客户端整份目录不可用 | in-PR | [#492](https://github.com/raydocs/tono/issues/492)，[#493](https://github.com/raydocs/tono/pull/493) | 中·推导 | — |
| H15-F8 | 未声明 hy2 能力的客户端也收到 hy2 条目 | in-PR | [#494](https://github.com/raydocs/tono/issues/494)，[#495](https://github.com/raydocs/tono/pull/495) | 中·推导 | — |
| H17-O-F3 | 到期与超额在一个 cron 周期内吊销全部设备、会话与出口凭据，控制台却写「到期不撤设备」；续期或重置用量不能自行恢复服务 | open | 待开 | 中·已确认 | 需 owner 在两种修法间决定（只对非 active 账户吊销，或保留吊销并改文案、告知需重新登录）；修复队列暂按更严格的后者 |
| H17-G-F2 | Tailscale enrollment 关闭（生产配置）时吊销任务永不执行，带 tailnet 绑定设备的账户停用或销户后重新启用永远返回 409（= H17-O-F5） | open | 待开 | 中·推导 | 取决于生产是否仍有带 tailscale_node_id 的设备行（未查 D1）；这些设备的 tailnet 节点也不会被删除 |
| H17-C-F2 | 退款销户由多次独立提交组成，中途失败可留下「住宅线与产品账户已回收、VPN 仍有效」的账户 | open | 待开 | 中·推导 | 需故障注入确认；cron 不识别这种部分销户状态 |
| H17-G-F5 | 同一设备再次登录或登出只作废当前会话，更早签发的 refresh token 仍然有效 | open | 待开 | 中·已确认 | refresh 有效期默认 30 天；显式吊销设备会作废该设备全部会话 |
| H17-C-F1 | 调低账户设备上限不会移除已超出上限的设备，直到有新设备登录（= H17-G-F1） | open | 待开 | 低·已确认 | 超出部分在下一次新设备登录时才按 LRU 轮换 |

## 6. 客户端信任与账户隔离

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W7 | A 的 logout 响应迟到，撤销/删除 B 的凭据 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| W11 | restore 401 检查代际后账户被替换，旧操作清理新账户 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| W12 | 异步凭据写入/删除乱序，复活已退出令牌或抹掉新令牌 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | 进程被杀时未落盘的新 refresh 仍会丢（见 H3-F4） |
| W13 | A 的请求 401 后刷新借用 B 的凭据重放 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| H3-F1 | Windows 登出不丢弃账户专属目录，且同 revision 不同 digest 被当篡改：下一账户沿用上一账户的出口身份与住宅凭据 | in-PR | [#315](https://github.com/raydocs/tono/issues/315)，[#316](https://github.com/raydocs/tono/pull/316) | 高·已确认 | 同账户设备重发 UUID 变体同修；不是本机流量泄漏 |
| H3-F2 | Windows 不识别只改 routing 的轮换（routingSha256），解绑/换绑/轮换凭据后继续用旧 routing | in-PR | [#321](https://github.com/raydocs/tono/issues/321)，[#324](https://github.com/raydocs/tono/pull/324) | 中·已确认 | macOS 已修 |
| H3-F3 | Windows 换账户后首个 periodic telemetry 窗口上传上一账户的审计事件 | in-PR | [#319](https://github.com/raydocs/tono/issues/319)，[#320](https://github.com/raydocs/tono/pull/320) | 中·推导 | 需 telemetry 同意开启 |
| H3-F6 | Windows 接受未签名策略的 media 端点，macOS 同一文档全部丢弃；Worker canonical 也接受未签名的 media 与 TCP 端点 | in-PR | [#318](https://github.com/raydocs/tono/issues/318)，[#340](https://github.com/raydocs/tono/pull/340)（Windows）、[#470](https://github.com/raydocs/tono/pull/470)（Worker media）；[#485](https://github.com/raydocs/tono/issues/485)，[#486](https://github.com/raydocs/tono/pull/486)（Worker tcpEndpoints，叠在 #470 上） | 低·已确认 | 客户端已丢弃未签名端点，Worker 侧为纵深防御 |
| D5 | 控制面 TLS 只做 DNS pin，无证书/SPKI 固定 | accepted-design | — | — | 依赖系统信任库；被信任的中间人 CA 可伪造目录/策略/refresh |
| D6 | hy2 第二块与主块身份一致只由 Worker 保证，客户端只按名称后缀识别 | accepted-design | — | — | 目录本来只有 TLS 信任边界（见 X4） |
| H11-F1 | 登出后出口凭据仍以明文留在 runtime 副本 | in-PR | [#407](https://github.com/raydocs/tono/issues/407)，[#410](https://github.com/raydocs/tono/pull/410)（Windows）、[#411](https://github.com/raydocs/tono/pull/411)（macOS） | 高·已确认 | — |
| H11-F2 | keychain ThisDeviceOnly 未生效，迁移到另一台机器会克隆设备身份 | in-PR | [#409](https://github.com/raydocs/tono/issues/409)，[#414](https://github.com/raydocs/tono/pull/414)（macOS 硬件锚，部分修复） | 中·推导 | Windows CRED_PERSIST_LOCAL_MACHINE 与 macOS data-protection keychain 仍 open；迁移后复制行为需实机 |
| H11-F3 | 卸载保留 refresh token，重装后自动登录回原账户 | in-PR | [#408](https://github.com/raydocs/tono/issues/408)，[#412](https://github.com/raydocs/tono/pull/412) | 中·已确认 | — |
| H15-F4 | macOS 0.0.72 遗留的含凭据 config/config.yaml 从未删除 | in-PR | [#504](https://github.com/raydocs/tono/issues/504)，[#505](https://github.com/raydocs/tono/pull/505) | 低·推导 | 与 #411 相关 |
| #491 | Windows 从 Suspended/Error 换账户登录时保留上一账户的目录、runtime 副本与 Core | in-PR | [#491](https://github.com/raydocs/tono/issues/491)，[#506](https://github.com/raydocs/tono/pull/506) | 高·推导 | 叠在 #316 → #410 → #506 |
| H17-AUTH-MAC | macOS 会话被拒（401：到期、超额、停用、设备吊销）时，启动恢复与后台上传路径先释放 PF/DNS 再登出（= H17-O-F1、H17-O-F2 macOS 部分、H17-G-F3 第 2、4 步） | in-PR | [#510](https://github.com/raydocs/tono/issues/510)，[#516](https://github.com/raydocs/tono/pull/516) | 高·已确认 | Worker 仍对所有不合格情形回 401，启动时仍登出且不显示原因；suspended 不停 Core（H17-C-F3）；Windows 同类见 H17-AUTH-WIN；启动 401 后菜单栏仍显示 Standby，待 H16-O-F5 |
| H17-C-F3 | macOS 账户进入 suspended 后不停止 Core、不作废缓存的设备出口凭据，唤醒恢复仍可用它连接（= H17-G-F3 第 3 步） | open | 待开 | 中·已确认 | 被吊销设备可用到出口应用新 roster 为止；实际 Core/PF 行为需实机；排在 H17-AUTH-MAC（#516）之后 |
| H17-O-F7 | macOS 账户 suspended 后网络日志上传器不停止，持续用已被拒绝的 refresh 重试 | open | 待开 | 低·已确认 | 退避上限约 16 分钟一次；Windows 由 #460 处理 |
| H17-O-F2 (Windows) | Windows 启动恢复遇 401（到期、超额、停用、设备吊销）即释放 WFP 并登出，不给原因（= H17-G-F3 第 2 步） | in-PR | [#512](https://github.com/raydocs/tono/issues/512)，[#515](https://github.com/raydocs/tono/pull/515) | 高·已确认 | Worker 仍对所有不合格情形回 401（H17-O-F2 的 Worker 部分未修）；#460 合并前暂停页文案为"账号已暂停"；暂停页可主动退出登录，退出照旧先释放保护；缓存目录保留到新登录（出口凭据已被服务端拒绝）；会话已被 cron 吊销时续费后需重新登录；未实机 |

## 7. 数据面规则（PF / WFP / sing-box / mihomo）

以下 H1 条目均为源码推导，没有实机复现。只记缺失约束与影响。

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H1-F1 | macOS Continuity 直连规则只按进程名匹配，未绑定受保护路径或代码身份；直连策略活动时，非预期进程的 web 端口流量可能经物理接口出去 | in-PR | [#325](https://github.com/raydocs/tono/issues/325)，[#327](https://github.com/raydocs/tono/pull/327) | 高·推导 | Windows 侧已明确不按进程名直连 |
| H1-F2 | macOS reviewed 直连的默认安装路径不校验存在性与签名即授予路径前缀；Windows 对用户可写的官方布局目录授予前缀 | in-PR | [#332](https://github.com/raydocs/tono/issues/332)，[#336](https://github.com/raydocs/tono/pull/336)（macOS）；[#333](https://github.com/raydocs/tono/issues/333)（Windows，PR 待开） | 高·推导 | Windows 变体未修；运行时按路径匹配仍依赖目录不可写 |
| H1-F3 | Windows TLS 嗅探对裸 IP 生效，与无 IP/进程条件的域名后缀直连规则组合，直连目的不受 pinned 地址约束 | in-PR | [#338](https://github.com/raydocs/tono/issues/338)，[#339](https://github.com/raydocs/tono/pull/339) | 高·推导 | 依赖 mihomo 嗅探语义，需实机；macOS 无嗅探，行为不同 |
| H1-F4 | Windows WFP 只在出向授权层阻断，入向接受层无 block-all，外部发起的入向流不经隧道也不被阻断 | in-PR | [#328](https://github.com/raydocs/tono/issues/328)，[#343](https://github.com/raydocs/tono/pull/343) | 高·推导 | 全局 IPv6 场景最现实；macOS PF 行为不同；FILTER_NAMESPACE 与 #345 冲突，后合者需 rebase |
| H1-F6 | 两端 DHCP 放行只按端口，不限目的地址、接口和进程 | fixed(1c211a3e) | [#341](https://github.com/raydocs/tono/issues/341)，[#345](https://github.com/raydocs/tono/pull/345)（Windows）、[#347](https://github.com/raydocs/tono/pull/347)（macOS） | 中·实机 | 取决于非特权进程能否占用 DHCP 客户端端口 |
| D7 | macOS 连接中 `tono-lan` 对私网任意端口、任意用户放行（含直连 LAN DNS） | in-PR | [#344](https://github.com/raydocs/tono/issues/344)，[#348](https://github.com/raydocs/tono/pull/348) | 中·推导 | 内部编号 H1-macDNS；#348 只收紧 LAN DNS，helper 4.10.0 合并时需重编号；其余私网放行仍是设计残留，Windows 无此放行 |
| H12-F1 | macOS 未持有 PF enable 引用，kill switch 存活无人监督 | in-PR | [#420](https://github.com/raydocs/tono/issues/420)，[#421](https://github.com/raydocs/tono/pull/421) | 高·推导 | — |
| H12-F2 | macOS helper 启动时未优先恢复 PF，且依赖 /etc/pf.conf | in-PR | [#423](https://github.com/raydocs/tono/issues/423)，[#424](https://github.com/raydocs/tono/pull/424)（helper）、[#425](https://github.com/raydocs/tono/pull/425)（App 显示未受保护） | 高·推导 | 两个 PR 都合入才闭合 |

## 8. 特权边界

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H1-F5 | bootstrap/恢复控制面放行未绑定 Tono 程序身份（Windows permit 无 AppId；macOS PF 只能按 UID），Protected Offline 期间非 Tono 进程也能到达共享 anycast 地址 | in-PR | [#330](https://github.com/raydocs/tono/issues/330)，[#334](https://github.com/raydocs/tono/pull/334)（Windows）；[#331](https://github.com/raydocs/tono/issues/331)，[#335](https://github.com/raydocs/tono/pull/335)（macOS，仅把注释改为 UID 边界） | 中·推导 | macOS PF 无法表达程序身份，#335 只修正描述，程序身份约束仍缺（需 helper 代理或记为风险） |
| H2-F1 | macOS helper 静默升级路由缺版本下限、签名要求弱于安装器、候选未绑定请求方 App 封存资源，可无管理员同意换成旧版或开发版 helper/核心 | in-PR | [#337](https://github.com/raydocs/tono/issues/337)，[#350](https://github.com/raydocs/tono/pull/350) | 中·推导 | 从下一个 helper 版本起才有可回滚目标；helper 契约版本 4.6.0 合并时需重编号；封存绑定是否可达需实机 |
| H2-F2 | Windows StartClash 不检查已武装 WFP 的 owner，另一名交互式用户可接管后释放他人保护 | in-PR | [#353](https://github.com/raydocs/tono/issues/353)，[#354](https://github.com/raydocs/tono/pull/354) | 高·推导 | 新增错误码 1014，App 专用提示见 H2-F2-hint；受害方 UI 表现需实机 |
| H2-F3 | Windows Service 只认证用户（SID + token 文件）不认证 Tono 映像，特权端也不校验 runtime YAML；macOS 对同一威胁有签名与配置白名单 | in-PR | [#351](https://github.com/raydocs/tono/issues/351)，[#352](https://github.com/raydocs/tono/pull/352)（映像绑定）、[#357](https://github.com/raydocs/tono/pull/357)（runtime 配置校验） | 高·推导 | 两个 PR 都合入才闭合；是否在威胁模型内需所有者确认 |
| H2-F4 | Windows runtime asset 校验与复制不在同一句柄，复制按路径重开并跟随 reparse point | in-PR | [#355](https://github.com/raydocs/tono/issues/355)，[#356](https://github.com/raydocs/tono/pull/356) | 低·推导 | 未确认有把复制内容回显出去的渠道 |
| H2-F2-hint | Windows App 对 1014（保护被另一用户持有）没有专门提示 | in-PR | [#481](https://github.com/raydocs/tono/issues/481)，[#483](https://github.com/raydocs/tono/pull/483) | 低·已确认 | 叠在 #354 上，#354 先合 |
| H6-F1 | webview 拥有完整的 mihomo controller 变更权限 | in-PR | [#378](https://github.com/raydocs/tono/issues/378)，[#380](https://github.com/raydocs/tono/pull/380) | 中·推导 | 在 Tono mihomo 补丁中禁用变更接口为后续项 |
| H10-F2 | helper 的 sing-box 配置 JSON 检查与 Go 解码器语义不一致（重复键、大小写折叠键） | in-PR | [#416](https://github.com/raydocs/tono/issues/416)，[#417](https://github.com/raydocs/tono/pull/417) | 高·推导 | helper 版本合并时重编号 |

## 9. 计量与 ops

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| S1 | Python/Worker 密码脱敏只替换标签，值仍进入存储结果 | fixed(0e20f2df) | [#269](https://github.com/raydocs/tono/issues/269)，[#267](https://github.com/raydocs/tono/pull/267)（含 #271） | 中·已确认 | 反例用合成凭据，不声称真实泄漏 |
| S2 | SSH rc255、journal rc1 被报为成功观测 | fixed(0e20f2df) | [#270](https://github.com/raydocs/tono/issues/270)，[#267](https://github.com/raydocs/tono/pull/267)（含 #271） | 中·已确认 | — |
| #4 | legacy/named 计量切换在安静窗口内放过增长 | open | [#4](https://github.com/raydocs/tono/issues/4) | 中·已确认 | 没有生产切换 |
| #5 | home-agent 无法识别高于旧水位的计数器重置 | open | [#5](https://github.com/raydocs/tono/issues/5) | 中·已确认 | — |
| OPS-1 | ops 观测表达/freshness 后续项 | open | [ops 计划](ops/plan-2026-09-11.md) | 低 | 不是客户发布门 |
| #208 | 定时 D1 备份在导出前因缺 Cloudflare 凭据失败 | open | [#208](https://github.com/raydocs/tono/issues/208) | 中·已确认 | — |
| #191 | D1 当月冲销警告需吸收且不覆盖 Batch 8 Ledger | open | [#191](https://github.com/raydocs/tono/issues/191) | 低 | — |
| #188 | #187 集成被 Batch 8 UI 冻结与 migration 0072 冲突阻塞 | open | [#188](https://github.com/raydocs/tono/issues/188) | 低 | — |
| #183 | Today 之外 18 个既有 Mac 截图失败待对账 | open | [#183](https://github.com/raydocs/tono/issues/183) | 低 | 测试/fixture 类 |
| H7-F1 | ops SSH 未校验主机密钥 | in-PR | [#365](https://github.com/raydocs/tono/issues/365)，[#368](https://github.com/raydocs/tono/pull/368) | 中·推导 | 部署前 hub known-hosts 需含全部节点与探针 |
| H7-F2 | 节点上报的 public_ip 未经校验即进入 ops 探针的 root shell 命令 | in-PR | [#370](https://github.com/raydocs/tono/issues/370)，[#373](https://github.com/raydocs/tono/pull/373) | 高·推导 | — |
| H7-F3 | 出口节点诊断工具下载未固定哈希 | in-PR | [#364](https://github.com/raydocs/tono/issues/364)，[#367](https://github.com/raydocs/tono/pull/367) | 中·推导 | 需手动部署 collect.py 到 hub |
| H7-F4 | 停用/退役的出口节点保留最后一份 roster | in-PR | [#371](https://github.com/raydocs/tono/issues/371)，[#375](https://github.com/raydocs/tono/pull/375) | 高·推导 | migration 0081；需 Worker、migration、agent 全部部署 |
| H7-F5 | shared-legacy 退役只在运行时生效，未持久化 | in-PR | [#382](https://github.com/raydocs/tono/issues/382)，[#384](https://github.com/raydocs/tono/pull/384) | 中·推导 | — |
| H7-F6 | 计量检查阻塞吊销执行 | in-PR | [#388](https://github.com/raydocs/tono/issues/388)，[#389](https://github.com/raydocs/tono/pull/389) | 中·推导 | — |
| H7-F7 | 解绑后住宅 SOCKS5 凭据不轮换 | in-PR | [#379](https://github.com/raydocs/tono/issues/379)，[#381](https://github.com/raydocs/tono/pull/381) | 中·推导 | 控制面标记并阻止复用；上游改密仍手动；migration 0080；到期或超额而 status 未变时不标记（#381 正文已列，H17-G-F4 指的是同一缺口） |
| H7-F8 | ops journal/重启作业指向错误的 xray unit | in-PR | [#376](https://github.com/raydocs/tono/issues/376)，[#377](https://github.com/raydocs/tono/pull/377) | 低·推导 | — |
| H8-F1 | JPY 等零小数货币换算后存储值小 100 倍 | in-PR | [#391](https://github.com/raydocs/tono/issues/391)，[#394](https://github.com/raydocs/tono/pull/394) | 中·推导 | — |
| H8-F2 | 已冲销的账本行可改变归属主体 | in-PR | [#398](https://github.com/raydocs/tono/issues/398)，[#400](https://github.com/raydocs/tono/pull/400) | 中·推导 | 关账计算与写入之间的窗口仍在；UTC 月归属见 #191 |
| H8-F3 | v1 home-lines 退役绕过使用中/解绑/revision 守卫 | in-PR | [#397](https://github.com/raydocs/tono/issues/397)，[#399](https://github.com/raydocs/tono/pull/399) | 中·推导 | 退役改为拒绝，需先手动解绑 |
| H8-F4 | telemetry 窗口重复计入活动时长；字节数从未写入 | in-PR | [#403](https://github.com/raydocs/tono/issues/403)，[#404](https://github.com/raydocs/tono/pull/404) | 低·推导 | migration 0082；字节来源缺失，客户端显示 pending |
| H8-F5 | 账号池分配存在并发重复分配 | in-PR | [#401](https://github.com/raydocs/tono/issues/401)，[#402](https://github.com/raydocs/tono/pull/402) | 中·推导 | — |
| H8-F6 | 影响客户的写操作缺少审计记录 | in-PR | [#405](https://github.com/raydocs/tono/issues/405)，[#406](https://github.com/raydocs/tono/pull/406) | 低·推导 | token-admin 路由移到 src/ops/token-admin.ts |
| H13-F5 | Worker 不可达时 exit-agent 没有 roster 回退 | in-PR | [#463](https://github.com/raydocs/tono/issues/463)，[#464](https://github.com/raydocs/tono/pull/464) | 中·推导 | 与 #375/#384/#389 冲突，解决步骤写在 PR |
| H13-F6 | hub 在租约丢失后仍执行作业（重复 xray_restart） | in-PR | [#465](https://github.com/raydocs/tono/issues/465)，[#466](https://github.com/raydocs/tono/pull/466) | 低·推导 | 应先于或同 #377 合并 |
| H17-O-F4 | 为尚未注册的客户开通时，控制台填写的到期日与套餐被静默丢弃，账户首次登录后无到期、无配额 | open | 待开 | 中·已确认 | 之后没有任何提醒会发现（到期提醒与批量续期都要求已有日期） |
| H17-O-F6 | 控制台「停用」调用退款销户接口：操作者填写的原因被丢弃，空备注被写成「退款销户」 | open | 待开 | 低·已确认 | 核实降级：恢复文案并未承诺可重绑原 Claude 号，停用确认已告知拆除范围；Claude 引用退役后不能经现有接口重新分配是否算缺陷待产品决定 |

## 10. 发布流水线与安装器

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H5-F1 | Windows 发布作业在构建代码运行期间持有可写 token | in-PR | [#362](https://github.com/raydocs/tono/issues/362)，[#363](https://github.com/raydocs/tono/pull/363) | 高·推导 | 发布作业只在手动派发时运行，需下次发布观察 |
| H5-F2 | macOS 发布作业的签名材料与凭据作用域过宽 | in-PR | [#366](https://github.com/raydocs/tono/issues/366)，[#369](https://github.com/raydocs/tono/pull/369) | 高·推导 | — |
| H5-F3 | 打包了未使用且下载未固定哈希的 enableLoopback.exe | in-PR | [#372](https://github.com/raydocs/tono/issues/372)，[#374](https://github.com/raydocs/tono/pull/374) | 中·推导 | — |
| H5-F4 | 安装器以提权方式从用户临时目录运行 VC++/WebView2 安装程序 | in-PR | [#383](https://github.com/raydocs/tono/issues/383)，[#385](https://github.com/raydocs/tono/pull/385) | 高·实机 | 需实机与 NSIS 编译 |

## 11. 已撤回 / 已排除（refuted，勿重报）

| ID | 结论 | 状态 | 依据 |
|---|---|---|---|
| X1 | 「macOS logout 一定保留旧 managed catalog」 | refuted | macOS 登出会清理/重新认领 managed catalog；Windows 的对应问题是 H3-F1，另一根因 |
| X2 | 旧 updater cache-install 文件是生产漏洞 | refuted | 未确认生产可达；重报须给出当前可达调用链 |
| X3 | TLS EOF 说明封锁/UUID/Reality 错误；UUID 格式正确说明 roster 已接纳 | refuted | 两者都不能由该证据推出 |
| X4 | catalog 有 Ed25519 签名 | refuted | catalog 是加密 + SHA-256 完整性边界，只有流量策略有 Ed25519；digest 无密钥，不防伪造 |
| X5 | Windows native setter 返回成功、注册表看起来受保护、空 IPv6 输入可证明 DNS 有效 | refuted | 这些都不单独证明有效 DNS，必须读回 |
| X6 | 超时后后台仍保留阻塞 OS 调用和 claim 是泄漏 | refuted | 有意的 fail-closed 设计 |
| X7 | CI 绿 / issue 关闭 / 进 main / 签名 / 设备通过 / 客户发布可以互相替代 | refuted | 是不同事实，分别记录 |
| X8 | R1-F1 附带的「三次暂停」说法 | refuted | 该计数只在 connect 失败路径递增 |
| X9 | R2-F5 附带的「UI 显示直连已开」 | refuted | 先写入 optional_direct_skip，UI 如实显示 directSkipped |
| X10 | R4-F3 原报告称 propose 已支持 adopting | refuted | 核实不成立，最小修复在适配器层重绑 |
| H5-F5 | 「安装器 .onInit 从 $PLUGINSDIR 运行 gate exe 构成提权风险」 | refuted | NSIS 3.11 提权运行时 $PLUGINSDIR 仅管理员可写（util.c:59-75，exec.c:368-382） |

## 12. 已交付的结构与优化（accepted-design，勿报「未实现」）

| ID | 内容 | 状态 | 说明 |
|---|---|---|---|
| D1 | Windows 原生 SetInterfaceDnsSettings + IPv4/IPv6 有效读回；未验证成功的原生调用进一次兼容批次并重读全部相关适配器；facade 超时不清除 worker 单写者 claim | accepted-design | [#289](https://github.com/raydocs/tono/pull/289)；不是提速证据 |
| D2 | macOS 最后一轮 mixed 诊断与 TUN 探测并行；迟到/取消结果不改新连接偏好或遥测；mixed/controller 成功不能替代 TUN 成功 | accepted-design | [#289](https://github.com/raydocs/tono/pull/289) |
| D3 | 原生升级 v1：canonical manifest 绑定两端包、摘要、签名 releaseSequence；root helper / SYSTEM 独立执行器；私有暂存、消费前持久化、单次消费、successor 身份、回滚、高水位保留 | accepted-design | [#282](https://github.com/raydocs/tono/pull/282) 模型、[#283](https://github.com/raydocs/tono/pull/283) 接入，经 #289 进 main；不代表受保护装机升级已验收 |
| D4 | Disconnect 不伪造恢复/提交，不删除已消费或不确定事务；保留证据并拒绝新 offer | accepted-design | 文档化设计；「没有任何出口」的部分是 R4-F2/R4-F7 的缺陷 |


## 11. 2026-09-24 晚轮（H19–H22、候选诊断、合并列车）

详见 [交接记录](reports/HANDOFF_2026-09-24.md)。

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H19-C-F1 | 连接在 WFP 武装前关闭非 Tono 代理且不恢复 | in-PR | [#541](https://github.com/raydocs/tono/issues/541) / [#557](https://github.com/raydocs/tono/issues/557) | 高·已确认(写入与顺序) | 安装更新仍清代理；未实机 |
| H19-O-F5=C-F3=G-F3 | 更新恢复任务与执行器跨提交/卸载存活 | in-PR | [#549](https://github.com/raydocs/tono/issues/549) / [#565](https://github.com/raydocs/tono/issues/565) | 中·已确认 | #471 后改系统目录；未实机 |
| H19-O-F7=C-F2 | 删除应用数据只删批准 UAC 的账户 | in-PR | [#559](https://github.com/raydocs/tono/issues/559) / [#569](https://github.com/raydocs/tono/issues/569) | 中·推导 | 重定向 AppData 不覆盖；未实机 |
| H19-G-F4 | 卸载保留 Service 运行时配置出口凭据 | in-PR | [#560](https://github.com/raydocs/tono/issues/560) / [#571](https://github.com/raydocs/tono/issues/571)(叠 [#565](https://github.com/raydocs/tono/issues/565)) | 低·已确认 | 未实机 |
| H19-O-F2 | 无主 WFP 拦截时安装门禁死路 | in-PR | [#564](https://github.com/raydocs/tono/issues/564) / [#573](https://github.com/raydocs/tono/issues/573)(叠 [#500](https://github.com/raydocs/tono/issues/500)) | 中·已确认 | 静默安装仍拒绝；未实机 |
| H19-C-F4 | 自启任务全机同名 | in-PR | [#568](https://github.com/raydocs/tono/issues/568) / [#577](https://github.com/raydocs/tono/issues/577) | 低·已确认 | DOMAIN\user 旧任务不识别；未实机 |
| H19-O-F4 | 绑定用户被删后 `--emergency-disarm/reset` 因查 home 失败 | in-PR | [#545](https://github.com/raydocs/tono/issues/545)/[#550](https://github.com/raydocs/tono/issues/550) | 中·已确认 | 用户不存在时 daemon 仍起不来；未实机 |
| H19-O-F6 | reset 留下 pf.conf 挂钩与两个 `.tono-backup` | in-PR | [#551](https://github.com/raydocs/tono/issues/551)/[#562](https://github.com/raydocs/tono/issues/562) | 低·已确认（降级） | 不重载主规则集；reset 接线未被自测覆盖 |
| H19-O-F1 = H19-G-F1 | 删 Tono.app 后 helper 每次开机重新 arm | in-PR | [#555](https://github.com/raydocs/tono/issues/555)/[#566](https://github.com/raydocs/tono/issues/566) | 中·已确认 | 需实机验证 bootout/登录项；dev 机无 /Applications 副本会自移除 |
| H19-O-F3 = H19-G-F2 | 第二账户可改绑 helper，或只报 connectFailed | in-PR | [#561](https://github.com/raydocs/tono/issues/561)/[#579](https://github.com/raydocs/tono/issues/579) | 中·已确认 | 无 socket 时授权后才拒绝；自动重连仍重试 |
| OD-0924-W | Worker 不记录设备客户端版本 | in-PR | [#574](https://github.com/raydocs/tono/issues/574) / [#578](https://github.com/raydocs/tono/issues/578) | 源码推导 | 控制台未展示；旧客户端 NULL；与 #329 冲突；0092 需重编号 |
| OD-0924-Win | Windows 内部候选版失败记录默认关且升级被 v2 重置 | in-PR | [#575](https://github.com/raydocs/tono/issues/575) / [#580](https://github.com/raydocs/tono/issues/580) | 源码推导 | 未在真实候选包验证；无单独关闭开关 |
| OD-0924-Mac | macOS 内部候选版失败记录默认关且升级被 v2 重置 | in-PR | [#576](https://github.com/raydocs/tono/issues/576) / [#581](https://github.com/raydocs/tono/issues/581) | 源码推导 | 未在签名候选包验证；无单独关闭开关 |
| H21-O-F1 | 控制面不可达而出口可达时，重启后已登录用户无法连接（有已验证缓存目录） | fixed(e0b7be4a) | [#582](https://github.com/raydocs/tono/issues/582) / [#612](https://github.com/raydocs/tono/pull/612) | 中·已确认 | Windows+macOS 离线授权准入与单一拒绝漏斗；未实机；token 轮换后至下次同步（≤300 s）离线启动被拒 |
| R612-F1 | 401/403 答复头已到、body 读取中断时按传输失败处理，refresh 拒绝可被当作控制面不可达而离线准入（macOS；Windows 同类 = R612-O1） | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 中·已确认 | Codex 发现，Opus 复核；Opus O1 为 Windows 同根，Codex 复核；修复 ac1de43d，两端红绿已跑 |
| R612-F2 | macOS 离线准入后 `user` 为空，收到拒绝后 Check again 不做任何事 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 修复 2c41bf8a；无回归（完整 restore 需 helper IPC） |
| R612-F3 | Windows 目录同步在未限时的凭据 flush 上等待授权写入，且排在消失出口处理之前；凭据库卡住时拖住同步与登录 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 修复 313a6e05（先处理消失出口，flush 限 2 s）；无回归 |
| R612-F4 | Windows 离线结束后不再读取账户，`inner.account` 为空，日志上传与路由偏好不恢复 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 修复 35cb2a08（Verified 结束离线后每 60 s 补读 `me()`）；无回归 |
| R612-O2 | 待写 tombstone 内容过期：后到的 forbidden 覆盖 refused；解除后的旧 tombstone 仍可覆盖新授权 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | Opus 发现，Codex 复核；修复 b662119e；无回归 |
| R612-O3 | tombstone 未绑定被吊销的会话，新会话离线启动被旧会话的拒绝挂起（macOS 还会清掉目录缓存） | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | Opus 发现，Codex 复核；修复 e1d61944，吊销记录带 token 摘要，不匹配或无摘要按无授权处理 |
| R612-O4 | Windows 退出只等待 tombstone，不触发写入；写入器处于长退避时 3 s 预算内无新尝试 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | Opus 发现，Codex 复核；修复 f124c0b7（退出唤醒写入器）；无回归 |
| R612-O5 | macOS 受保护重连只看 kill switch 与缓存目录，控制面不可达且无授权（账户 error）时网络变化仍会拨缓存出口 | open | 待开 | 低·已确认 | Opus 发现，Codex 复核：origin/main 已存在，非 #612 引入；需在共享 Connect 入口要求在线验证或离线准入 |
| R612-G1 | Windows 恢复预算超时时，已收到的 refresh 401（body 未完）被丢弃并按不可达离线准入 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 第 2–6 轮逐步收紧，终版 380fe8e3：收到状态行后等 `me()` 链结束；罕见情况 Restoring 较久 |
| R612-G2 | 两端 body 中断的非 401/403 非 2xx 状态被当作不可达 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 36a43680；2xx 中断仍按传输失败（接受，服务端已接受会话） |
| R612-G3 | Windows 解除 FORBIDDEN 与 tombstone 写入器的快照-写盘之间有缝，已解除的 tombstone 仍可落盘 | fixed(e0b7be4a) | [#612](https://github.com/raydocs/tono/pull/612) | 低·已确认 | 36a43680 + f594995a（只在真正解除时取文件锁）；该罕见路径 sink 可能等一次写盘 |
| H21-O-F2 | Windows 恢复 30 s 预算被 pinned 连接耗尽，系统 DNS 回退不执行 | open | [#583](https://github.com/raydocs/tono/issues/583) | 中·已确认 | 与 F1 症状重叠 |
| H21-O-F3 = H21-C-F1 | macOS 控制面客户端无 pinned 地址/备用端口/DNS 回退 | in-PR | [#584](https://github.com/raydocs/tono/issues/584)，[#622](https://github.com/raydocs/tono/pull/622) | 中·已确认 | 先系统 DNS，连接级失败再走 pinned（NW TLS，SNI/证书按主机名，10 s），pinned 答复后首选 pinned；连接超时的 POST 不回退；未做备用端口（PF 只放行 443） |
| H21-O-F4 | macOS「试用备用通道」提供核心不可用的 hy2，受保护重连无限循环 | in-PR | [#585](https://github.com/raydocs/tono/issues/585)，[#617](https://github.com/raydocs/tono/pull/617) | 中·已确认 | 备用通道按 `singBoxUnavailableReason` 过滤；prepare 拒绝计入三次暂停，PF 保持；仍请求 hy2 |
| H21-O-F5 | macOS 每次连接首次 arm 在无 TUN 时放行 root web 端口 | open | [#586](https://github.com/raydocs/tono/issues/586) | 高·已确认 | 仅存在 DIRECT plan 时；泄漏量需实机 |
| R604-F1 | macOS Core 重启（`/core/sync`、崩溃）期间无隧道，reviewed-bundle 放行仍在 | in-PR | [#608](https://github.com/raydocs/tono/issues/608) | 高·已确认 | 叠在 #604 上；崩溃窗口至多约 10 s；Core 运行中 utun 消失不覆盖；需实机 |
| H21-O-F6 | macOS 控制面请求继承他人系统代理，受保护离线下被 PF 挡 | in-PR | [#587](https://github.com/raydocs/tono/issues/587)，[#617](https://github.com/raydocs/tono/pull/617) | 中·已确认 | 控制面 session 空 `connectionProxyDictionary` |
| H21-O-F7 | 其他 VPN/TUN 未识别，失败归因错误 | open | 待开 | 中·推导(PLAUSIBLE) | #458/#468 部分覆盖 |
| H21-O-F8 | 强制门户/TLS 拦截代理未识别 | open | 待开 | 低·推导(PLAUSIBLE) | |
| H21-O-F9 | 系统时钟错误不被点名，保护期间无法校时 | in-PR | [#588](https://github.com/raydocs/tono/issues/588)，分支 `fix/clock-skew-classification-20260925`（PR 待开） | 低·已确认 | 只做分类与文案：macOS `APIError.clockSkew` 与探测 `.clock`，Windows `TONO_CLOCK_SKEW`；按传输失败参与离线准入；未开 NTP 放行；Windows hy2 不拒 NTP |
| H21-C-F2 | 受保护离线时更新发现失败且不说明原因 | accepted-design | — | 低·推导 | fail-closed 设计；只改文案 |
| H21-C-F3 | Windows 检查更新失败时显示「已是最新版」 | in-PR | [#589](https://github.com/raydocs/tono/issues/589)，[#618](https://github.com/raydocs/tono/pull/618) | 中·已确认 | |
| H20-C-F1 = H20-O-F2 | Windows 目录刷新失败显示「详情见下」但无详情 | in-PR | [#590](https://github.com/raydocs/tono/issues/590)，[#618](https://github.com/raydocs/tono/pull/618) | 中·已确认 | 稳定错误键与诊断字段未做 |
| H20-C-F2 = H20-O-F10 | macOS 浏览器加密 DNS 冲突显示通用文案并持续自动重试 | in-PR | [#591](https://github.com/raydocs/tono/issues/591)，[#619](https://github.com/raydocs/tono/pull/619) | 中·已确认 | 未实机复现 |
| H20-C-F3 = H20-O-F9 | macOS 拒绝管理员授权被报成 helper 版本不匹配 | in-PR | [#592](https://github.com/raydocs/tono/issues/592)，[#619](https://github.com/raydocs/tono/pull/619) | 中·已确认 | 未实机复现 |
| H20-C-F4 | Windows WFP 锁定校验失败被报成「重启电脑」 | in-PR | [#593](https://github.com/raydocs/tono/issues/593) · [#616](https://github.com/raydocs/tono/pull/616) | 中·已确认(代码路径) | 新前缀 `TONO_WFP_LOCK_UNVERIFIED` 带 Service `last_error`；频率需实机；看门狗恢复后不清 `last_error` 的旧横幅另记 |
| H20-C-F5 | Windows 上传诊断缺上一次失败记录 | in-PR | [#594](https://github.com/raydocs/tono/issues/594) · [#616](https://github.com/raydocs/tono/pull/616) | 低·已确认 | 当前无错误时上传上一次失败的阶段与稳定码（不含本地详情）；#580 仅内部版自动报告 |
| H20-C-F6 = H20-O-F13 | 验证码错误/过期被显示为「会话过期」 | in-PR | [#595](https://github.com/raydocs/tono/issues/595)，[#620](https://github.com/raydocs/tono/pull/620) | 中·已确认 | 只把带 `INVALID_OR_EXPIRED_CODE` 的 401 改为专门错误；其它 401（含 verify 的 `AUTHENTICATION_FAILED`、带令牌请求）不变 |
| H22-C-F2 = H22-O-F6 | 验证码未送达时两端没有求助/诊断出口 | in-PR | [#596](https://github.com/raydocs/tono/issues/596)，[#620](https://github.com/raydocs/tono/pull/620) | 中·已确认 | 验证码页 60 秒后给出求助；菜单栏入口未加 |
| H22-C-F1 | Windows 欢迎页吞掉存储失败导致循环 | open | 待开 | 低·推导(PLAUSIBLE) | 触发条件未证实 |
| H20-O-*, H22-O-* | Opus 席位 H20（15 条）与 H22（8 条，含 H22-O-F1 BFE 关闭时无法安装、H22-O-F2 VC++ 运行库缺失时安装门禁失败）| open（待核实）| 待开 | 待 Codex 异厂商核实 | 见交接文档 |
| XRAY26-RMU | exit-agent 用 `--email=` 调 Xray 26 `rmu` 被拒，自 2026-09-18 起吊销不执行、计量停报；`rmu` 失败也退出 0 | in-PR | [#563](https://github.com/raydocs/tono/pull/563)（5bcc6b9d/924cafb3/b3299814）| 高·已确认(实机输出) | 未部署到节点 |
| TF-opus-4 | exit-agent 停用轮不读计数，上次正常轮到停机之间的流量丢失 | fixed | [#600](https://github.com/raydocs/tono/issues/600)，[#624](https://github.com/raydocs/tono/pull/624)（f5c31d58，2026-09-25 已部署到 14 个节点） | 中·已确认 | 撤除后尽力折入最后计数，下一次可上报的轮次报出；永久退役节点仍不上报；需部署到节点 |
| TF-opus-8 | exit-agent hy2 出错时整轮跳过 Xray 吊销与计数 | fixed | [#600](https://github.com/raydocs/tono/issues/600)，[#624](https://github.com/raydocs/tono/pull/624)（f5c31d58，2026-09-25 已部署到 14 个节点） | 中·已确认 | hy2 错误后仍做 Xray 对账并保存计数，再拒绝本轮、不 ACK；需部署到节点 |
| TC-anthropic-1 | `dual` 阶段新建/重新启用出口节点使所有已退役账户设备目录 503 | in-PR | [#570](https://github.com/raydocs/tono/pull/570)（8ea01b3f、b6c0a817、a62703fe、f775a895）| 高·已确认(Codex) | 就绪门只看本次下发目录中的节点（hy2 归并基名、目录内家宽不计）；jev-route 7a7e1e73/bb710dc6（Opus+Codex）复审修复提交通过；**部署仍须按交接顺序：LA 节点恢复 ACK、第二节点先登记** |
| TC-anthropic-2 | 零 active 节点时退役账户永久 503；测试未断言成功路径 | in-PR | [#570](https://github.com/raydocs/tono/pull/570) | 中·已确认(Codex，条件性) | 生产有 1 个 active 节点；`worker.test.ts` 已断言 ACK 前 503、ACK 后 200 且为设备 UUID |
| TC-anthropic-3 | 0078 改变过滤集合但不 bump 目录 revision，Windows 拒收同 revision 不同 digest | in-PR | [#570](https://github.com/raydocs/tono/pull/570) | 中·已确认(Codex) | 运维步骤：部署且节点拉取新 roster 后，无条件用带 `expectedRevision` 的受审计 catalog PUT bump revision（写入列车 changelog 与 PR 描述）|
| TC-anthropic-4 | migrations README 缺 0077、0088 | in-PR | [#570](https://github.com/raydocs/tono/pull/570) | 低 | README 补 0077/0081/0088 |

测试覆盖缺口（夹具未跨真实 DLL、无断电/睡眠/多网卡实机、无 parser fuzz 等）不是本账条目，
见 [审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md) 的「未覆盖」一节；找到具体失败再作为新条目上报。
