## Android Horizon UI 正式逐项重评分（第 5 轮，基于两份独立盲审返工）

**正式分数：86 / 100。** 上一正式分数 73；两份独立盲审（较早 head）分别为 Opus 79.5、GPT-6.1 Sol 83。本轮过 85 门槛，每项 ≥70 %，但第 7 项正好 70 %，**没有余量；未达 95 目标**。

这是实施方对自己作品的评分，不是独立评审。量表与权重未改（20 / 20 / 15 / 15 / 15 / 10 / 5）。模拟器验证不了的部分一律标“未验证”，该项不给满分。

- **Head**：[`519afc07`](https://github.com/raydocs/tono/commit/519afc078ba3962c3a338fc155d328733277ae84)（`feat/android-singbox-horizon`）／源仓 rw8/Tono-droid `be480099`
- **CI**：[android-ci run 39108918669](https://github.com/raydocs/tono/actions/runs/39108918669) **success**
  - build：JVM 测试、lint、APK
  - emulator (system)：a1–a6、s1–s3、b1–b3 共 12 项，**首次尝试全过**
  - emulator (ui)：u1–u8、l1 共 9 项全过，**但是在全新模拟器上的重试**。第 1 次在 u2 时模拟器离线：没有崩溃转储，没有 OOM，宿主剩余内存约 15 GB，原因未查明。summary 里保留了这次失败，没有隐藏
  - 当前 head 完整套件 **21 / 21**，没有跳过、没有只补跑失败项
  - 设备：Android 14 x86_64，KVM，swiftshader 软件 GPU
- **证据命名**：
  - `real-*`：真实应用与真实系统，包括快捷设置、Widget 宿主、系统 VPN 框、系统动画与主题设置。
  - `fixture-*`：同一套 UI 喂夹具状态，背后**没有隧道**。本轮起每张夹具截图画面右上角都有“FIXTURE · no tunnel”标记。
- **两份盲审**：原文已逐字提交到 `docs/agent-reports/`（commit [`a3587a91`](https://github.com/raydocs/tono/commit/a3587a91b)）。两份的 cutoff 与 head 不同（Opus `c53eba6`，GPT `ddc3d343` 与绿色 `0a65ffd`），不能当作同一基线的 A/B 对比。

### 证据
| 内容 | 链接 |
|---|---|
| 真实流程：登录、系统 VPN 框、无账号不建 VPN、系统浅/深色 | [real-flow](https://ampcode.com/user-content/artifacts/8fb0d20203e482c0f0cf8206a521b00ca0487a5c59b503b0f7a1fef624c6f404-file.png) |
| 真实系统入口：完整展开的快捷设置里磁贴显示“Tono / Sign in”，点按打开登录；Widget 点按 `widget_action` 打开登录；系统“移除动画”开/关 | [real-surfaces](https://ampcode.com/user-content/artifacts/1457ba9fd76c358f0a1cae1de1fa840f013ec6a1fa1cbc545e3675f165cd0290-file.png) |
| 夹具状态：未连接、连接中、已连接、部分可用、失败。底部玻璃条里是齿轮和 Details | [fixture-states](https://ampcode.com/user-content/artifacts/c1fb5a4e69afcee9171f389c2f470ca69442b845dcccfde0de36802c61723a2a-file.png) |
| Details、上滑、线路、设置（模式说明各一行）、VPN 授权前说明（压在首页海面上，带日出标） | [fixture-sheets](https://ampcode.com/user-content/artifacts/aca02e4c5b533e116e0773f9d36dd3334646110fc0eef79fb269f4fabf6773f3-file.png) |
| 简体中文：首页、部分可用、Details（显示“日本”）、设置 | [fixture-zh](https://ampcode.com/user-content/artifacts/156d351782482f2aa6c5a2f5d94dce78f25b38c296d87fba4299a727015c60d3-file.png) |
| 系统字体 200 %、Apps 列表加载完成且 Done 在底部、玻璃模糊测试图 | [fixture-a11y](https://ampcode.com/user-content/artifacts/3546910133898fcc035093c813850eb2b4b24c76e6863e3a67efe0f1caef95d4-file.png) |
| Widget 各状态、常驻通知、停止并重试通知（夹具） | [fixture-surfaces](https://ampcode.com/user-content/artifacts/ab339001f224a83e48d0ab4ed6b04f4a1b66e06403287042aa7487416ff183ac-file.png) |
| 动效抽帧：连接中 → 已连接 → 断开中 → 未连接 → 失败 | [motion-strip](https://ampcode.com/user-content/artifacts/99ee90fca4ce11e8f6bd2df11f68d0c22b5b6ec68a613e1df93fa8f01a15a675-file.png) |
| 逐帧动效：392 帧，测试时钟每帧 16 ms，设备逐帧渲染。体现的是设计时序与缓动，不是实时流畅度 | [mp4](https://ampcode.com/user-content/artifacts/132aae8d1ec85452d561eb86e5a0e5c4a5a5a709cf18a0769e020da7ac2df760-file.mp4) · [gif](https://ampcode.com/user-content/artifacts/66a9b2a65444726410a2a38448dfe26b80377a402f638f8cf27d4ce2ac1db3c8-file.gif) |
| 设备实时录屏：软件 GPU，约 5 fps | [mp4](https://ampcode.com/user-content/artifacts/3cd57cdbd1a03cb545e8d73103b9de212b078c80b151736dcaaceebb79129fd2-file.mp4) |

### 本轮对照两份盲审的改动
共识项优先，其次各自的建议。每条都已核实，没有降低断言或放宽量表。

| 盲审意见 | 来源 | 本轮处理 | 证据 |
|---|---|---|---|
| 当前 head 模拟器 CI 不绿，l1 没跑 | 两份 | 设备测试拆成 system / ui 两半，各自带一次全新模拟器重试；每个测试前收起通知栏；检测到设备离线即停并记录；保留宿主 dmesg、内存和模拟器崩溃库 | run 39108918669，21 / 21 |
| Settings 在右上角，不在拇指区；读屏先读 Settings | 两份 | 齿轮移到底部，和 Details 合进同一个玻璃条；顶栏只留品牌。读屏顺序改为 状态 → Disconnect → Tokyo → Settings → Details | fixture-states；u6 `screen-reader-order.txt` |
| 文案：模式说明两行、Details 重复路由摘要、“家宽 Home”、跨平台不一致 | 两份 | 模式说明各一行；删去 Details 里的路由摘要；中文统一为“家宽”；“AI held”改为与 iOS 一致的“AI paused”；城市不重名时出口胶囊只显示城市。中文“日本”修正保留 | fixture-sheets、fixture-zh；u7 |
| 快捷设置只截到紧凑行，没有点按验证 | GPT | 反复展开直到看到磁贴副标题“Sign in”，然后点按，断言打开登录；Widget 同样点按验证 | real-surfaces；s1 / s2 |
| 胶囊像不透明深色药丸；Details 单独描边，重复的框太多 | 两份 | 玻璃染色调淡（主胶囊 0.32、出口 0.26、底部条 0.24），加上高光渐变；Details 不再单独描边 | fixture-states；u4 |
| 转场时两个半透明标签叠在一起 | GPT | 改为先淡出（90 ms）再淡入（延迟 100 ms），同一时刻只有一个标签 | motion-strip 第 4、5 帧 |
| 夹具把断开压到 288 ms，天空过渡却是 1800 ms，于是“未连接”配满天日光 | Opus | 落日和夜色过渡改为 650 ms；夹具各阶段拉长到真实量级 | 逐帧 mp4；`motion-frames.txt` |
| Apps 页只截到加载圈，Done 浮在中间 | Opus | 截图前等到列表行出现（最多 30 s）；加载区占满剩余高度，Done 固定在底部 | fixture-a11y 中 Apps 一格；u1 |
| 首页夹具截图画面里没有标记 | Opus | 所有 TonoRoot 夹具截图右上角显示“FIXTURE · no tunnel”，不进入读屏 | 所有 fixture-* |
| VPN 授权说明页没有海面场景，显得平 | Opus | 说明页作为底部表单压在首页海面上，标题前加日出标 | fixture-sheets 第 5 格 |

### 逐项评分
| # | 项（权重） | 73 版 | Opus | GPT | 本轮 | 证据 | 未验证／扣分 |
|---|---|---|---|---|---|---|---|
| 1 | 信息层级／少字（20） | 17 | 16.5 | 18 | **18**（90 %） | 每屏一个标题、一行原因、一个主胶囊；模式说明一行；Details 只保留三条流量去向；中文 200 % 通过（JVM），u7 通过 | 状态短句与 Details 说明用词仍不统一：英文“AI paused”对“AI traffic is held”，中文“AI 已暂停”对“AI 流量已拦住”；线路名（如 Dawn）来自服务端，未本地化；设置页仍有 5 个分区；没有用户测试 |
| 2 | 交互连续／单手（20） | 16 | 16 | 17 | **18**（90 %） | 主胶囊、线路、设置、详情都在屏幕下三分之一；u2 用 UiDevice 真实点按逐状态核对，断开中禁用；u3 上滑开 Details；真实磁贴、真实 Widget 点按都打开登录（s1、s2）；先说明再弹系统 VPN 框（u5 + a2） | **未验证**：真实连接全流程；返回、拖动、取消的快速打断；真机触感；通知与 Widget 的 Retry / Disconnect 只验证了渲染 |
| 3 | 高级克制／与桌面一致（15） | 12 | 12.5 | 13 | **13**（87 %） | 日出与同一套图形用于应用内、磁贴、Widget、通知；底部合并成一个玻璃条，重复的框更少；授权说明页回到海面场景；系统入口用 Android 原生控件 | 本轮没有与桌面、iOS 并排对照；应用只有深色，Widget 没有浅色变体；Apps 页的 FIXTURE 标记压住标题（仅测试截图） |
| 4 | 玻璃材质（15） | 8 | 11 | 12 | **12**（80 %） | u4：不透明条纹场景，按条纹幅度计算，并除以无模糊的同款玻璃以排除染色。Tono 玻璃下剩 0.1 %，平台模糊剩 0.3 %；染色调淡，加了高光 | 截图里胶囊仍偏深，材质感有限；**未验证**：真实 GPU 上的观感与功耗；低版本 API 的回退效果 |
| 5 | 动效（15） | 10 | 12 | 12 | **12.5**（83 %） | u8：392 帧逐帧渲染连接、断开、失败；两份盲审指出的动效问题（标签叠影、文字与天空不同步）都已修复，并在帧里确认；a5：真实应用在系统“移除动画”下停止动画 | **未验证**：真机实时流畅度、掉帧、帧节奏（软件 GPU 约 5 fps）、触感；没有与 iOS 并排录像 |
| 6 | 无障碍／适配（10） | 7 | 8 | 8 | **9**（90 %） | u1：每屏 ATF + 自有契约（≥48 dp、有标签）；l1 在当前 head 跑过，系统字体 200 % 不截断；u6：读屏顺序以状态开头，每项只读一次；中文 200 % 通过 | **未验证**：TalkBack 实际朗读与手势（镜像里没有 TalkBack）；切换控制、外接键盘 |
| 7 | 真实性／工程（5） | 3 | 3.5 | 3 | **3.5**（70 %） | 当前 head CI 绿，21 / 21；real 与 fixture 分开，且夹具截图画面里有标记；a3 无账号不建 VPN；a4 在设备 ABI 上跑 libbox checkConfig | ui 一半要靠重试才过，模拟器离线原因未查明；**未验证**：真实账号、真实隧道、联网、后台恢复、性能 |
| | **合计** | **73** | **79.5** | **83** | **86** | | 过门槛（≥85，各项 ≥70 %），第 7 项无余量；未达 95 |

### Red check / Ran / Not run
- **Red check**：
  - 去掉计时器修正 → `fadingTimerKeepsTheLastElapsedTimeWhenDisconnected` 失败；
  - 去掉国家名修正 → `exitCountriesFollowTheAppLanguageNotTheProcessDefault` 失败；
  - run 39103789541 的 s1 停在紧凑行时失败，本轮改为反复展开后通过。
  - u6 的新顺序断言（状态先于 Settings）没有在旧布局上反向验证过。
- **Ran**：本地 `:android:mobile:testDebugUnitTest lintDebug assembleDebugAndroidTest` 通过；CI run 39108918669 设备测试 21 / 21。
- **Not run**：真机；TalkBack 实际朗读；真实登录与隧道（需要白名单账号和 Home 分配，验证码发到用户手机）；TUN / DNS / QUIC 回退、始终开启 VPN、应用排除、Home 第二跳；真实桌面启动器上的 Widget 尺寸变化。

### 真实缺口与下一步（到 95 还差什么）
1. **一台真机**（Pixel 级，Android 14+）：60 fps 实时录屏、玻璃观感与 GPU 开销、TalkBack 实际走查、触感、返回手势打断。涉及第 2、4、5、6 项，约 +5。
2. **白名单账号与 Home 分配**：真实连接、断线重试、系统入口的实时状态。涉及第 2、7 项，约 +2。
3. 模拟器上还能做的，约 +1～2：统一短句与 Details 说明的用词；设置页继续收敛；与桌面、iOS 并排对照截图；Widget 浅色变体；查明模拟器离线原因。

即使第 3 项全部做完，没有 1 和 2 也到不了 95。这是外部条件阻塞，不是继续改 UI 能解决的。

### 产物与保留期
| 产物 | 保留期 |
|---|---|
| `android-emulator-evidence-system` / `-ui` | 90 天（到 2027-01-16） |
| 测试 APK `tono-mobile-0.3.1-test-519afc078` | 90 天，到 2027-01-16。debug 签名，安装前先卸载旧版 |
| `instrumentation-apk` | 14 天（到 2026-11-01） |
| `android-test-reports` | 30 天（到 2026-11-17） |

无 Release、无商店、无 feeds、无部署；PR 保持 Draft，不合并。

https://ampcode.com/threads/T-01a14a6e-7a99-745c-ab7f-888543f76c3b
