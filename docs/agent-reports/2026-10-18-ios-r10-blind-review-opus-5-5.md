# raydocs/tono PR #1672 第10轮独立盲审报告

- 审查人：Amp 线程 T-01a150c0-0ccd-765d-abdd-920fa5302750（Claude Opus 5.5，独立完成，未另建线程）
- 日期：2026-10-18
- 固定代码：`90822de32f2cad955237b3549e0482369c537eaa`（本地 detached worktree `/home/user/workspace/wt-1672`）
- PR tip：`16e9b2b2cfb110f59a92478be25d4662876226f9`。`git diff --stat 90822de..16e9b2b` 只有 `docs/changelog.d/2026-10-17-ios-singbox-horizon.md | 2 ++`。该文件内容没有读（避免看到密封自评）。
- 读取范围：只把 PR 正文 `## Rubric (verbatim, unchanged)` 一节提取到 `rubric-extracted.md`（sha256 `115c32d770b204543dfe188cc4ded55ed615c75fcec9d752efadbd3f233d76df`），正文其余部分已删除、未读。没有读评论、`docs/agent-reports`、其他评审线程或实施方自评，也没有联系实施线程。没有参考之前轮次的分数。
- 没有改产品代码，没有提交、推送，也没有发 GitHub。

## 证据等级

- 【执行】：CI 实际执行的结果（日志或断言），或本地实际执行的命令。
- 【视觉】：我亲自查看的原始 PNG，或从 MP4 抽出的帧。
- 【源码】：在固定 SHA 上读源码得出的推论，没有执行。
- 【未验证】：真机隧道、VoiceOver 听读、触感、120Hz 和真机性能都没有验证，不算证实。

## 1. CI 核对【执行】

| 项 | 结果 |
|---|---|
| iOS CI run 39160461314 | `push`，headSha=90822de，completed/success；2 个 job 都成功（Linux 117772492676，macOS 117772492879） |
| UI 测试 | ui-tests.log 中 `Test Case … started` 25 条，`passed` 25 条；`Executed 25 tests, with 0 failures`；`** TEST EXECUTE SUCCEEDED **`；全文 `skipp` 0 次；macOS job 日志中同一行一致（20:36:02） |
| TonoKit | macOS 上 66/66；Linux 上 `Executed 66 tests, with 0 failures`；随后跑了 check-singbox.sh |
| ci-gate run 39160465005 | `pull_request`，headSha=90822de，success；iOS 不在 ci-gate 路径过滤内（sing_box/macos/connect_bench 为 skipped），所以 iOS 的证据来自独立的 iOS CI |
| artifact 12150076988 | `ios-preview-screenshots`，580,064,492 B，未过期，head_sha=90822de；下载后实测 70 PNG + 5 MP4 + 7 个其他文件，共 82 个文件，sha256 清单见 `artifact-12150076988.sha256` |
| tip 16e9b2b | ci-gate 当时部分 job 仍在运行（null）。这是 changelog-only 的提交，不影响本评审 |

## 2. 小组件 placed 断言

- 源码 `UITests/TonoUITests.swift:201-239`：进入 SpringBoard 编辑模式 → Add Widget → 搜索 Tono → 断言系统画廊列出 “Tono status” → 点最后一个 Add Widget → 按 Home → 断言 SpringBoard 中有 label 含 “Status unavailable” 的元素 → `XCTAssertTrue(placed)`。
- 【执行】日志 2954 行：`REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`，测试 passed。
- 关于假阳性：断言用的谓词也可能命中仍未关闭的画廊预览。但本 run 中画廊预览**没有**把该文本暴露出来（gallery-text-exposed=no），所以命中的只能是放置后的组件。这一点由下一条视觉证据交叉确认。
- 【视觉】`real-widget-home-screen.png`：主屏左上可见 2×2 的 Tono 组件，显示 “Status unavailable / Open Tono to see the status”，名称为 “Tono”。结论：真实组件确实放到了主屏，状态读数也诚实。
- 断言本身的局限：谓词没有限定在主屏图标容器内，只靠 “画廊不暴露文本” 这一事实来排除假阳性。如果以后画廊开始暴露该文本，断言会变弱。属于测试稳健性小项，不影响本 run 的结论。

## 3. 审计方法变更（回调内低于 4.5 → 审计后重测并以重测判定）

源码 `UITests/TonoUITests.swift:563-575, 606-613`：回调内测得 <4.5 时不再直接判失败，而是放进 `settle`，等 `performAccessibilityAudit` 结束、sleep(1) 后，在元素当前 frame 上重测；重测 <4.5（或不在屏上）才算失败。阈值 4.5 没变，两次读数都打印。

**本 run 是否触发：没有触发。【执行】**
- ui-tests.log 中 `after the audit` 出现 0 次。
- 回调内所有带元素的对比度读数都 ≥4.5（6.3–16.6:1），全部 PASSES，没有 FAILS。
- 唯一的离屏项（largest-text-onboarding “Everything else → your own network”）走的是原有的滚动后测量路径，16.5:1。
- 因此本轮 a11y 审计的通过结果**不依赖**这项新方法。

**新方法是否可能掩盖问题：可能，属于方法风险，本轮未实现。**
- Apple 审计在回调期间会切换字号。某个对比度问题如果只在更大字号的布局中出现（例如文字被推到太阳/光晕或浅色玻璃上），按“审计后恢复到原字号再测”的规则就会被判通过，而真实问题仍在。
- 这种情况只有在该字号也被单独启动审计时才能兜住。`testAccessibilityAuditLargestText` 覆盖了 connected/failed/signin/onboarding/primer/details/settings，但**没有覆盖 Lines sheet 和 Home 的 degraded/network-changed 等状态在 AX5 下的情况**。
- 改进建议（不阻塞）：重测时同时在回调当时的字号下截图或记录 frame，或者在被标记元素所在屏幕的最大字号下再审计一次。不应只以恢复后的布局判定。
- 其他残留：35 个对比度标记中有 26 个是 Apple 无法归属的 “no element”，由 `sweep()` 用 3%/中位数的像素启发式兜底。sweep 跳过带子文本的控件，结果为 0 低于 4.5。这只是启发式证据，不等于 Apple 审计意义上的通过。

## 4. 路由 desired/applied 与 save/send/reload 拒绝/恢复失败

**做对了的部分**
- 【源码】`TonoKit/Sources/TonoKit/RouteApply.swift`：先保存；隧道关着时返回 `.saved`；隧道开着时只有 `.applied(running)` 且 `running == requested` 才算成功。无回复（NO_REPLY）、看不懂的回复、被拒绝（refused）都不算成功；文件会回写为实际在跑的那张图。
- 【源码】`AppModel.swift:357-417`：界面上的 `mode`/`selectedNode` 只用 in-effect 的值，请求另存在 `routeChange`（pending/failed）里；失败时发 VoiceOver 公告。
- 【源码】`PacketTunnelProvider.swift:197-227`：重建失败时先尝试恢复上一张图；恢复也失败时回复 `running:nil`。App 端据此置 `routesStopped`，`ConnectionState.derive` 映射为 failed/ROUTES_STOPPED（`ConnectionState.swift:153`）。
- 【执行】RouteApplyTests 5/5（SAVE_FAILED、NO_REPLY 回写文件、refused 保留旧图、refused 无图 → failed、确认后才报新模式），macOS 与 Linux 都通过。
- 【执行 + 视觉】UI 测试 `testRefusedModeSwitchKeepsShowingTheModeInEffect`（只注入 `reload` 故障）：ui-tests.mp4 584–606 s 的帧显示：点 Stable → “Switching to Stable…”，带 spinner，分段变暗 → “Couldn't switch to Stable. Still using Three-tier.”；Three-tier 保持选中；答案仍按 Three-tier 给出；Home 显示 “Couldn't switch to Stable ›”。
- save/send/stopped 三种故障在 UI 层**没有交互执行**，只有 RouteApply 单测加上 `en-19-routes-stopped.png`（直接以 FAILED+ROUTES_STOPPED 预览渲染，不经过 apply 路径）。

**发现的问题**

F1（严重，【源码】确定性推论，未执行）：routes stopped 后，小组件和控制中心会被心跳改写为“已连接”。
- 链路如下：
  1. routesStopped 时 App 写入 `fromApp(.failed, "ROUTES_STOPPED")`，state=failed，since=nil（`StatusSnapshot.swift:55-66`）。
  2. 扩展的心跳计时器无条件执行 `writeStatus(running: true)`，不看 `graphRunning`（`PacketTunnelProvider.swift:63-75`）。
  3. `fromTunnel(running:true)` 只在 `previous.state.tunnelUp` 时保留 App 状态；failed 不是 tunnelUp，于是落到 `return StatusSnapshot(state: .on, …)`（`StatusSnapshot.swift:71-85`）。
  4. 小组件读到 fresh 的 `.on` → “Connected + 计时 + Tokyo”；`TunnelControl` 的 `switchOn` 变为 true。
- 心跳每 5 分钟刷新一次 fresh，所以只要 App 还没回到前台重写，误报就会一直持续。
- 后果：主界面写着 “Routes stopped / Retry”，主屏组件、锁屏组件和控制中心却写着已连接/开。流量实际被黑洞掉，属于 fail-closed，没有泄漏，但这是“没在工作却显示已连接”。
- 触发条件很少见：重建被拒，而且恢复旧图也失败。但这正是本轮要求核查的“恢复失败”路径，没有单测覆盖 fromTunnel(previous: failed)。

F2（中，【源码】）：在运行中的隧道上切换模式或线路时，扩展在 `handleAppMessage(.reload)` 里设置 `reasserting = true`（`PacketTunnelProvider.swift:107-110`）。NEVPNStatus 因此变为 `.reasserting`，`derive` 映射为 `(.connecting, "NETWORK_CHANGED")`（`ConnectionState.swift:144-148`）。结果是 Home、Live Activity 和组件会短暂显示 “Network changed · reconnecting / Reconnecting”，主按钮变成 “Cancel”，原因文案与事实不符。预览注入路径不会经过 NEVPNStatus，所以 CI 截图里看不到这个问题。

F3（低，【源码】）：
- `RouteApply.run` 中三处 `try? save(...)` 静默吞掉恢复写失败，界面不会提示“文件与界面不一致”。下一次 On Demand 重启会按 requested 建图；到 connected 时 `readStatus` 会把界面校正过来，所以可以自愈，但这段时间里 routeChange 可能残留，Home 的 routeNote 不检查 requested 是否已等于 in-effect，可能出现“没能切换到 X”而 X 已在用的陈旧提示。Details 和 Lines 有这层检查，Home 没有。
- 在 Lines 中选线后 sheet 立即关闭，Home 的线路胶囊没有 pending 指示（`HomeView.swift` 中没有引用 changingRoutes），真实重建的数秒内仍显示旧线路，没有“切换中”的提示。

## 5. 视觉与交互（原始 PNG/MP4）【视觉】

- 层级：Home 是一个大字状态、一行副文、一个主胶囊，下面是线路胶囊和两枚小按钮。主操作在拇指区，没有难找的问题。中文、英文和 AX5 下都可读；AX5 的 Home 走 BottomScroll（【源码】`HomeView.swift:45`），底部的 Details 被截半但可以滚动到。
- 动效（`state-cycle-en.mp4`，31 s，约 58 fps 的可变帧率）：日出、日落、月亮对应各个状态；连接进度在 Cancel 胶囊内填充；标题交叉淡入淡出。`sheet-zoom.mp4` 中各 sheet 从各自控件缩放展开。`state-cycle-reduce-motion.mp4` 改为淡变（268 帧/29 s）。
- 玻璃：【源码】`Theme.swift:196` 使用真实的 `.glassEffect(.regular.tint().interactive())`；降低透明度或提高对比度时退到实色。【视觉】胶囊玻璃克制，Settings 滚动到标题栏下方时模糊正确（`settings-scrolled-under-bar.png`）。Home 有意没有使用 GlassEffectContainer，所以没有融合形变。
- 品牌：【源码】macOS 的 `SeaSceneWater.swift`、`SeaControls.swift` 同样以海面和日出暖色为母题，iOS 与之一致；没有逐屏对照桌面截图。
- 次要：Settings 中“路由模式”只说“去 Details 改”，多了一跳；Details 的“发生了什么”卡片在中号字下是 4 行，略长。

## 6. 评分（原 rubric 七维，70% 单项底线）

| 维度 | 满分 | 得分 | 比例 | 主要依据 |
|---|---|---|---|---|
| 信息层级减字 | 20 | 17 | 85% | Home 层级很清楚；Details 和 Settings 的解释句偏多 |
| 交互连贯单手 | 20 | 16 | 80% | 拇指区主操作、缩放出入、滑动关闭都已测；Settings→Details 多一跳；选线后 Home 没有 pending 提示（F3）；切换期间主按钮变 Cancel（F2） |
| 高级克制与最新桌面品牌一致 | 15 | 13 | 87% | 海面和日出母题与 macOS 一致，配色克制；没有逐屏对照 |
| Liquid Glass 材质 | 15 | 12 | 80% | 真实使用 glassEffect 且可交互，并有无障碍降级；没有容器融合；真机 120Hz 观感未验证 |
| 状态动效 | 15 | 11 | 73% | 动效本身质量高；扣分来自状态准确性：F1（组件误报已连接）、F2（切换误报网络切换） |
| 可访问性适配 | 10 | 8 | 80% | Apple 审计全过，AX5、降低透明度、提高对比度、公告都有；VoiceOver 顺序和听读未验证；新重测方法有掩盖风险（本轮未触发）；无归属标记靠启发式兜底 |
| 真实性与性能 | 5 | 4 | 80% | 预览徽标诚实；真实组件已放置并读到 unavailable；真实 Live Activity 已显示；性能只有模拟器宿主数据 |
| **总分** | **100** | **81** | | 低于 85 |

各项都 ≥70%，但总分 81 < 85。

## 7. 否决判定

- 主操作难发现：不成立。主按钮在所有状态下都位于底部拇指区，大胶囊（【视觉】）。
- 不可读：不成立。Apple 审计 0 失败；AX5 截图可读（【执行】+【视觉】）。
- 严重状态误导：**成立**。证据等级是【源码】确定性推论，未执行复现。
  - 依据 F1：routes stopped（主界面显示 Routes stopped、需要 Retry）时，小组件、锁屏组件和控制中心会在 ≤5 分钟内被扩展心跳改写为 fresh 的“已连接/开”，并随心跳持续，直到 App 回到前台。
  - 主界面本身的 desired/applied 区分是准确的，主屏幕层面不构成误导。
  - 如果所有者只认可已执行的证据作为否决依据，这一项降为“待真机/单测复现的严重缺陷”。但即便如此，总分 81 仍未达到 85。

**结论：不通过**（81/100，低于 85；另有一项源码级的严重状态误导否决）。

## 8. 最小修复建议（不由本评审实施）

1. `fromTunnel(running:true)`：当 `previous.state == .failed` 且同一会话时保留 failed，或者扩展在 `!graphRunning` 时写 failed/ROUTES_STOPPED。补一条单测：`fromTunnel(previous: failed 同会话) != .on`。
2. App 发起的 reload 不设置 `reasserting`，或者 derive 在 `changingRoutes` 期间把 `.reasserting` 显示为“正在切换”。
3. Home 的 routeNote 加上 `requested != in-effect` 检查；线路胶囊增加 pending 状态。
4. 审计重测时同时保留回调字号下的证据，或者在被标记屏幕的最大字号下补测。

## 9. 未验证（不能算证实）

真机隧道连通和路由、真实 reload 的耗时、VoiceOver 听读与顺序、触感、120Hz 和 ProMotion 观感、真机 CPU/内存/电量、系统控制中心与锁屏中用户放置的组件。另外 save/send/stopped 三种故障在 UI 层没有交互执行，只有单测。
