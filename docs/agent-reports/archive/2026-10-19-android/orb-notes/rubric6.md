## Android Horizon UI 正式逐项重评分（第 6 轮）

**正式分数：88 / 100**（上一轮 86）。过 85 门槛，各项都 ≥ 70 %；**未达 95**。

这是实施方对自己作品的评分，不是独立评审。量表与权重未改（20 / 20 / 15 / 15 / 15 / 10 / 5）。模拟器上验证不了的部分标“未验证”，对应项不给满分。

- **代码 head**：[`62fee220`](https://github.com/raydocs/tono/commit/62fee220cd279dcdb4fb7ffde635225899eb52c9)（源仓 rw8/Tono-droid `5612e58`）。之后的 [`8b07d840`](https://github.com/raydocs/tono/commit/8b07d840659d4fa71bad7ae89cc371ff7086b926) 只改 changelog。pull_request 的路径过滤看的是整个 PR 的 diff，所以它也触发了 android-ci：这是在相同代码上再跑一遍，结果会补充在本评论下方。
- **CI**：[android-ci run 39125188504](https://github.com/raydocs/tono/actions/runs/39125188504) **success**。
  - build：JVM 测试、lint、APK。
  - emulator (system)：a1–a6、s1–s3、b1–b3、**t1**，共 13 项，外加 t1 的出口日志分流核对。**首次尝试全过**。
  - emulator (ui)：u1–u9、l1、l2，共 11 项。**首次尝试全过**。
  - 合计设备测试 **24 / 24**（原 21 项，加 t1、u9、l2），两半的重试步骤都是 skipped。没有跳过测试，没有放宽断言。
  - 设备：Android 14 x86_64，KVM，软件 GPU（本轮改为 swangle_indirect）。
- **本轮中途失败的记录，全部保留**：
  - [run 39113297176](https://github.com/raydocs/tono/actions/runs/39113297176)（`91dbbc07`）：模拟器进程 3 次以状态 139（SIGSEGV）退出，导致掉线。
  - [run 39115256726](https://github.com/raydocs/tono/actions/runs/39115256726)（`fdb85d28`）：改用 swangle 后不再掉线。t1 / u9 / l3 两次尝试都失败，a2 在重试里失败一次。
  - [run 39120135343](https://github.com/raydocs/tono/actions/runs/39120135343)（`9c38bd3a`）：t1 隧道和分流核对已经通过，只是最后的退出步骤失败。u9 的描边采样受时序影响失败。l3 第二种方法仍然失败。
  - 后三次 run 共 10 次模拟器启动，**全部以状态 0 退出，没有掉线**。
- **证据命名**：
  - `real-*`：真实应用加真实系统。
  - `local-*`：真实应用、真实 TUN、真实 sing-box，连的是 CI 主机上的**本地替身服务**（不是 Tono 的服务）。每屏都标“Local test server · not Tono”。
  - `fixture-*`：同一套 UI 喂夹具状态，背后没有隧道。画面里标“FIXTURE · no tunnel”。

### 证据（截图 46 张：real 14、fixture 27、local 5；视频 2 段）
| 内容 | 链接 |
|---|---|
| **本地替身上的真实隧道**：登录 → 已登录 → 真实 TUN 已连接（状态栏出现钥匙图标）→ Details 显示 AI 走 Home broadband、视频走 Cloud、其余直连 → 断开 | [local-tunnel](https://ampcode.com/user-content/artifacts/2331e4bf0e5e27726ca401f73af8fb4e85b15e276852c44acab0208e1073c188-file.png) |
| 键盘焦点描边、360 × 640 dp 小屏首页、小屏 Details | [fixture-adapt](https://ampcode.com/user-content/artifacts/a247b4458685cbb20f899dc6b0e858fa9615abce9d2cc2b7f89af01e0e7fba4c-file.png) |
| 夹具五态（标记已移到状态栏带，不再压标题） | [fixture-states](https://ampcode.com/user-content/artifacts/99c8628b10093f6e34d39501ec704810229e82e7defb2100e6c113f7141277a1-file.png) |
| Details、上滑、线路、设置、授权前说明 | [fixture-sheets](https://ampcode.com/user-content/artifacts/e31d4905f2e8f0e573b36c481038cac9c6d237e5054a26999a9bcab6440c49cb-file.png) |
| 系统字体 200 %、玻璃模糊测试图 | [fixture-a11y](https://ampcode.com/user-content/artifacts/6d05cf34dded7c308806ba4bbc606c4fc5975c7b9555f675cc47da5fb94a9566-file.png) |
| 简体中文（“AI 已暂停，不会直连”） | [fixture-zh](https://ampcode.com/user-content/artifacts/1ae6373412dca32c9b43f5b74f3828d923bcfa80deeef307d344c5f8f6174923-file.png) |
| 真实流程、真实系统入口（快捷设置磁贴、Widget、移除动画） | [real-flow](https://ampcode.com/user-content/artifacts/a2c2c09d35c15471911cbd35faced51f27051ec57019a546fc2afe5cf9dfcdc8-file.png) · [real-surfaces](https://ampcode.com/user-content/artifacts/f9057e2f1920cd15c989607662dcf1ed4f4b8100d982db465bfdf56560b6222f-file.png) |
| Widget、通知（夹具） | [fixture-surfaces](https://ampcode.com/user-content/artifacts/b4c57f5104f61427991cbfae4659e5f77870e80b833f88f7c1847ab8bf0ec24c-file.png) |
| 逐帧动效（测试时钟每帧 16 ms）：反映设计时序，不代表实时流畅度 | [mp4](https://ampcode.com/user-content/artifacts/011f84ec84c386cbdb685392d86555d68992b0ce76e91e38a6099e0adf8a3b26-file.mp4) · [gif](https://ampcode.com/user-content/artifacts/47ee7053e0b0838d51b906bf6348a3a9c43e8497e28e3356525d17385833516d-file.gif) |
| 设备实时录屏（软件 GPU，约 5 fps） | [mp4](https://ampcode.com/user-content/artifacts/131521a5c969d729cafc7f81633c32ccedbdfc6b832cc1fdc5480c11ea6b1e7d-file.mp4) |

**t1 分流核对**（依据两个出口自身的日志，`local-tunnel-routing.txt`）：
- cloud：www.cloudflare.com（引擎探测）和 www.youtube.com（HTTP 302）只出现在云出口；
- home：claude.ai（引擎探测）和 api.anthropic.com（HTTP 404）只出现在 Home 出口；
- direct：example.com（HTTP 200）两个出口都没看到；
- 链路：云出口向 198.20.0.11:21080 发起了连接，说明 Home 是经云到达的。

其他测量：点 Connect 到 Connected 约 13.3 s（含授权点按，模拟器）；连接时 PSS 为应用 80 MB、引擎 77 MB；冷启动 1.0–1.5 s；APK 65 MB。这些只是测量，不作为门禁。

### 本轮改动（对应 Puck 指令与上轮扣分）
| 问题 | 处理 | 证据 |
|---|---|---|
| 措辞：“AI paused”和“traffic held”混用 | 状态短句、Details 说明、路由范围说明统一为 paused / 暂停，中英文一致 | JVM `shortStatusAndItsExplanationNameTheStopTheSameWay`；fixture-zh |
| 夹具标记压住标题 | 标记移进状态栏带，夹具宿主改为全面屏 | fixture-states、fixture-sheets |
| 模拟器掉线 | 包装模拟器二进制，记录退出状态和 core 栈，定位到 SIGSEGV（139）；改用 swangle_indirect 渲染。后续 10 次启动全部正常退出 | `host/emulator-exit.txt` |
| D7：没有真实隧道 | 加入 debug 专用的本地控制面开关，限制见 `LocalTestServer`（仅 debug、应用私有文件、仅本机回环、账号绑定服务端、每屏标记、目录准入不放宽）；新增 t1：真实登录 UI → 系统授权 → 真实 TUN → Details → 断开（VPN 网络消失）→ 退出，再由出口日志核对分流 | local-tunnel；run 39125188504 |
| D6：键盘与切换控制 | 首页控件和登录按钮聚焦时显示描边；u9 走系统按键：Tab 顺序与读屏顺序一致，描边像素变化 33–74 %，Shift+Tab 后 Enter 执行断开；平台 `ACTION_CLICK` 在每个首页控件上都生效 | fixture-adapt；`keyboard-report.txt` |
| D6：其他屏幕尺寸 | l2 小屏（360 dp）：8 个首页状态加登录、Details、设置，没有截断，控件可达 | `small-phone-report.txt` |
| **新发现的无障碍缺陷** | 本地测试标记完全落在状态栏窗口下方，Android 把它判为“对用户不可见”，TalkBack 读不到。现在在状态栏下方加一条细线节点承载同样文字，排在读屏顺序第一 | t1 用 `By.desc` 找到它 |

### 逐项评分
| # | 项（权重） | 第 5 轮 | 本轮 | 依据 | 未验证／扣分 |
|---|---|---|---|---|---|
| 1 | 信息层级／少字（20） | 18 | **18.5**（92.5 %） | 上轮扣分点“措辞不一致”已修，中英文一致并有测试覆盖 | 线路名来自服务端，没有本地化；设置页仍有 5 个分区；没有用户测试 |
| 2 | 交互连续／单手（20） | 18 | **18.5**（92.5 %） | 真实流程（本地替身）从头走到尾；键盘 Enter 与平台无障碍点击都生效 | **未验证**：连接 Tono 真实服务；快速打断；真机触感；通知与 Widget 的操作按钮 |
| 3 | 高级克制／与桌面一致（15） | 13 | **13**（87 %） | 夹具标记不再压标题 | 没有和桌面、iOS 并排对照；只有深色；键盘模式下 Details 的拖动手柄会弹出 Material 提示气泡，l1、l2 的截图里可见 |
| 4 | 玻璃材质（15） | 12 | **12**（80 %） | u4 在 swangle 下仍然通过（Tono 玻璃下条纹剩 0.1 %） | 观感偏深；**未验证**真实 GPU |
| 5 | 动效（15） | 12.5 | **12.5**（83 %） | 本轮没有改动 | **未验证**真机实时流畅度和触感 |
| 6 | 无障碍／适配（10） | 9 | **9.5**（95 %） | 键盘与切换控制、平台无障碍点击、小屏；修复读屏读不到本地测试标记的问题 | **未验证**：TalkBack 实际朗读；横屏（两次没能让模拟器转为横屏，测试已撤出，不计分） |
| 7 | 真实性／工程（5） | 3.5 | **4**（80 %） | 当前 head 首次尝试 24 / 24、没有用到重试；掉线根因已定位并缓解；本地替身上的真实隧道，并由出口日志核对分流 | **未验证**：Tono 真实账号与服务、真机、后台恢复、网络切换 |
| | **合计** | **86** | **88** | | 过门槛；未达 95 |

### Red check / Ran / Not run
- **Red check**：
  - t1 的标记断言，在旧实现（标记只在状态栏带里）上 run 39115256726 两次失败，加细线节点后通过；
  - fixture-servers 的 `check` 在本地用错误预期验证过会失败；
  - JVM `plainHttpOnlyForTheLoopbackTestServer` 拒绝 10.0.2.2、局域网地址、localhost、`@` 混淆等地址。
  - u9 描边断言没有在去掉描边的实现上反向跑过。
- **Ran**：本地 `testDebugUnitTest lintDebug compileDebugAndroidTestKotlin` 通过；Robolectric 临时测试确认，在 136 px 状态栏下，细线节点位于 y 136–139，并标记为对用户可见（测试已删除）；CI run 39125188504 设备 24 / 24 加分流核对。
- **Not run**：
  - 真机；TalkBack 实际朗读；横屏（设备上）；
  - Tono 真实登录与隧道：需要白名单账号和 Home 分配，验证码发到用户手机；
  - QUIC 回退、始终开启 VPN、应用排除、网络切换。

### 到 95 还差什么
1. **一台真机**（Android 14+）：实时 60 fps、玻璃观感、TalkBack 走查、触感、横屏。涉及第 2–6 项，约 +4～5。
2. **白名单 Tono 账号加 Home 分配**：连接真实服务，验证断线重试和系统入口的实时状态。涉及第 2、7 项，约 +1.5。

这两项都依赖外部条件，模拟器上剩下能做的不足以到 95。

### 产物
| 产物 | 保留期 |
|---|---|
| `android-emulator-evidence-system` / `-ui` | 到 2027-01-16 |
| 测试 APK `tono-mobile-0.3.1-test-62fee220c` | 到 2027-01-16。debug 签名，安装前先卸载旧版 |
| `instrumentation-apk` | 到 2026-11-01 |
| `android-test-reports` | 到 2026-11-17 |

无 Release、无商店、无 feeds、无部署；PR 保持 Draft，不合并。

https://ampcode.com/threads/T-01a14a6e-7a99-745c-ab7f-888543f76c3b
