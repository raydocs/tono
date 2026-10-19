# PR #1672 iOS 第 11 轮独立盲审

- 代码：c2f8762977360d8f2c953bf787651b8c5ad825df。tip f63a947e0a4e 已核验：父提交是 c2f8762，与 c2f8762 的差异只有 `docs/changelog.d/2026-10-17-ios-singbox-horizon.md`（+7 行）。
- 读取来源：固定源码（worktree）、iOS CI 39184374749 的原始作业日志（Linux 117843584664、macOS 117843584885）、ci-gate 39184377684 的日志、artifact 12159295214（79 PNG、5 MP4、ui-tests.log），以及 PR 正文中逐字引用的 Rubric 一节。没有读取旧评分、评审或实施线程、自评、agent-reports，也没有读 PR 的其他正文或评论。
- 评分标准：完全使用 PR 正文的 Rubric 原文。

## 结论

**总分 83.5 / 100，未通过（低于 85）。没有触发一票否决。** 用户目标 ≥95 未达到。可访问性 7/10、真实性性能 3.5/5 都刚好落在 70% 的下限。

| 维度 | 分数 |
|---|---|
| 信息层级减字 | 18 / 20 |
| 交互连贯单手 | 17.5 / 20 |
| 高级克制及最新桌面品牌一致 | 12.5 / 15 |
| Liquid Glass 材质 | 12 / 15 |
| 状态动效 | 13 / 15 |
| 可访问性适配 | 7 / 10 |
| 真实性性能 | 3.5 / 5 |

一票否决的判断：
- 严重状态误导：没有，但有中等程度的不一致，见 F2。
- 主操作难发现：没有。
- 不可读：没有，但 Preparing 状态下主操作文字最低只有 2.2:1，接近否决线，见 F1。

## 主要发现

### F1【可访问性，已测量】Preparing / Connecting 状态的主操作 “Cancel” 低于 4.5:1，CI 的测量方法漏掉了这个问题

这是 CI 产物中的 PNG 稳态截图，采样时取文字上方 12px 的局部背景中位数：

| 截图 | 文字与局部背景的对比度 |
|---|---|
| en-03a-preparing（fill 0.36） | 3.72 → 2.24:1（单词后半段 “el” 落在 sunCore 米色上） |
| en-03-connecting（fill 0.78） | 4.34 → 3.35:1 |
| zh-Hans-03-connecting | 4.32 → 3.82:1 |

- 字号是 17pt semibold，按 WCAG 属于正常文本，阈值应为 4.5:1。
- 截图是稳态画面：preview 启动时 `onAppear` 直接把 fill 设为 `PrimaryAction.progress`（0.36 / 0.78），不是动画进行中的某一帧。
- CI 中 home-CONNECTING 的 sweep 把 Cancel 测成 4.8:1，判为通过。当时有 53% 的像素算作 ink，说明“元素中位数背景”在渐变底上并不是局部背景。
- PREPARING 状态完全不在审计和 AX5 sweep 的范围内。
- Apple audit 在 CONNECTING 报了 3 条无法定位到元素的 contrast flag，都被 sweep 判定为“通过”。

### F2【状态诚实，源码 + 截图】未确认状态下，“Where traffic goes” 仍按旧模式描述

- 在 unconfirmed 状态下，模式两个分段都不选中，Route check 也拒绝回答。
- 但 lanes 仍然按 `model.mode`（旧的 Three-tier）显示 “Other apps → Local direct”（DetailsSheet.swift:102；截图 details-mode-unconfirmed.png）。如果实际生效的是 Stable，这一项应该是 Cloud。
- 这与“哪个模式都不声称”的设计自相矛盾。不过它低估了保护范围，而不是在保护已释放时显示“受保护”，所以不触发否决。

### F3【心跳，源码推论，未执行】状态写入没有串行化

- 写入路径有三条：`writeStatus` 的心跳在 reloadQueue 上执行；`handleAppMessage` 和 stop 在其他线程上执行；它们与 App 的 `publishStatus` 之间又是跨进程的 load→save，整体是 last-writer-wins。
- 可能的交错：心跳先拷贝了 running=true 的 graph，随后 reload 被拒并写入 ROUTES_STOPPED，然后心跳把 “on” 写回去，最长持续 5 分钟。
- App 回到前台时，`publishStatus(force:)` 在 `readStatus` 之前执行，会先把陈旧的 phase 写一次（随后 runProbes / readStatus 会纠正）。
- 窗口很窄。没有做注入，不称之为已发生的问题。

### F4【测试测量方法】

逐项核实如下：

- **校准实际上是准确的。** 探针的卡片是 smokeHigh 以 50% 叠在 night 上（约 #161622），不是注释里写的 #1F2029。按 sRGB 合成计算，真实对比度是 3.24 / 4.42 / 16.2，CI 测得 3.3 / 4.4 / 16.2。注释里“约 3:1 / 4:1”的说法是错的，但 4.42 只比 4.5 低 0.08，所以这个校准在阈值附近有区分力。
- **旧方法确实失效。** 三个探针在 97th percentile 方法下都测成 1.1:1（包括 16.2:1 的那一行）。这证明稀疏 ink 会让旧方法读到背景，新的解释成立。旧的 audit-race 解释在这里并不需要；settle 复测仍然保留。
- **校准只覆盖均匀背景。** 渐变、玻璃和 sun 背景上的误差没有被校准覆盖，F1 就是反例。
- **172 不是 172 个独立元素。** sweep 对 sheet 和 network-changed 各扫了两遍（滚动前和滚动后），Lines 还把 sheet 底下 Home 的元素也算进去了，所以独立元素数少于 172。
- **被排除的元素都有记录。** 因 not-hittable 而排除的 “86 ms” 两次都是 1.0:1（被不透明 sheet 覆盖），并写进了日志，属于合理排除。
- 阈值保持 4.5:1、44pt，没有被放宽。

### F5【证据分层】

| 主张 | 证据层级 |
|---|---|
| TunnelGraph 新图与恢复都被拒 → heartbeat → 共享文件编码 → StatusWording（routes stopped / switch off / Retry） | 单元测试已执行，Linux 和 macOS 上均 69/69 通过。允许读取的 CI 里找不到 mutation red 的运行记录；从源码推断，若让 heartbeat 忽略 `routing`，这个测试会失败。provider 是否真的调用 `graph.heartbeat`，只读源码核实过，没有测试覆盖。 |
| routes-stopped 的小组件卡片和 Control Center 标签 | 来自 App 内的 WidgetGallery（DEBUG），不是扩展进程实际运行的结果。 |
| 真实系统小组件 | 在 SpringBoard 中已放置，显示 “Status unavailable”（模拟器 unsigned 构建，没有 App Group）。 |
| 真实 NetworkExtension | Release iphoneos 构建针对 CI 现场编译的真实 Libbox 完成了编译和链接（PacketTunnel.appex 为 arm64，44M），**从未运行**。不只是 stub typecheck，但仍属于未运行。 |
| widget Retry → `sendProviderMessage(reload)` 的路径 | 只有源码，没有测试。 |
| 真机运行、VoiceOver 听读、触觉反馈 | 未验证。 |
| ci-gate | 不包含 iOS（作业只列出 macos / windows / services / sing-box / connect-bench）。gate 绿灯不是 iOS 的证据。 |

### 其他核查（通过）

- 主动 reload 没有冒充网络变化：`handleAppMessage(.reload)` 不设置 `reasserting`。注意：sing-box 自身请求的 reload（serviceReload）会设置 `reasserting`，App 会显示 “Reconnecting / Network changed”。这是轻微的命名偏差。
- NO_REPLY 后状态查询仍无应答时进入 unconfirmed：文件保留请求，两个模式都不选中，Route check 拒绝回答，`readStatus` 在下一次进入 connected 或回到前台时裁定。但没有主动重试；在没有新的状态事件时，unconfirmed 可能一直停留。
- 回滚与重试：TunnelGraph 在 build 失败时不动正在运行的 graph；启动失败后会尝试恢复 last 并持久化 last。App 的 putBack 失败时记为 unsaved，在下次变更、回到前台或连接时重试。Retry 时用生效中的设置重建。
- requested 与 in-effect：pending 期间保持选中生效的线路并显示转圈；unconfirmed 时不选中任何线路。有一个边角情况：`setInEffect` 会忽略不在当前 lines 里的节点，`exitName` 会回退到 `lines.first`。
- 视觉：Home 层级清晰，主要操作集中在拇指区；sheet 有 zoom 过渡；Reduce Motion 和 Increase Contrast 都有对应变体；Live Activity 真实出现在模拟器的灵动岛中。AX5 下 Home 需要滚动才能看到 Details；degraded 状态的 reason dot 与多行文本没有对齐（轻微）。

## 证据文件（SHA-256）

见 r11-evidence-sha256.txt（同目录）。关键文件：

- art.zip：f765c76f21301c3cfc16a8b5c209aae3924578717281318c773f4bfe45b44e7f
- ci/macos.log：8545c13478b9e4ae7ae8e5770eefe67765fcfd7f8656f837d3161ea47b49f531
- ci/linux.log：cb5a789c12b014b61757113ef61e947352fc6fdcfe724b82c3ac091a23e12361
- ci/gate.log：6e8f2aee845e301a4100d3c12e42f948e3d729f71616d4c03b373074e641a632
- art/ui-tests.log：b7cf76961ebea03e32b3409643a2841bcfee7659cee73ccb2886cc9bfdfd0008
- art/en-03a-preparing.png：dba337a452fd6a8ce203c946c648254fc749c14ec7b71ad8356316d8fe26f9b9
- art/en-03-connecting.png：9a959e2cc2a922610bbcda8f72eb7cc7ac31425684ab8348127107f4f0b7ef97
- art/details-mode-unconfirmed.png：a37fbb635743961c530916094f19bdafe98472eda0bd2cb07abaf77f480b84ca
- r11-local-contrast.py（测量脚本）：f67c8ac0aba407541edb94ad0bed00d96dd5c1fb3b6cc0e8042f695cdeccd016
