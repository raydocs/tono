## 第 6 轮证据基线（冻结，供独立盲审；本评论不含分数）

> 更正（发布后）：system 是重跑后才通过的，不是首次通过；横屏截图是模拟器上的夹具界面，不是真实 MainActivity，也不是真机。只改了措辞，数据与 head 都没变。

本评论只列证据。按要求，下一次正式评分将把实施方自评与独立盲审一起交付；在盲审完成之前，本 PR 不再发布新的自评分或结论。上方较早的第 6 轮自评评论发布在这条要求之前，所看 head 为 `62fee220`，不是本基线。

### 冻结的 head 与 CI
- **Head**：[`bf449391`](https://github.com/raydocs/tono/commit/bf449391feacb3fdc329680ca7115aea8397659a)（源仓 rw8/Tono-droid `36c7517`）。在盲审完成前不再提交，因为即使只改文档也会触发整套 CI。
- **CI**：[android-ci run 39138009249](https://github.com/raydocs/tono/actions/runs/39138009249)，**success**，共两次 attempt。
  - attempt 1：build 通过；emulator (ui) **首次尝试 12 / 12 通过**（含 l3 横屏）。emulator (system) 失败：两台模拟器都从开机起就极慢（a1 用了 187 s / 312 s，正常约 33 s），两次都被 35 分钟预算停止。第二台在停止前已过 10 / 10。两台模拟器都以状态 0 正常退出。证据见 artifact `12143211019`。
  - attempt 2（只重跑失败的 system job，同一 head）：13 / 13 通过，t1 出口日志分流核对通过。重跑出的这台模拟器没有再用到 job 内的重试，但**对这个 head 来说，system 是在重跑后才通过的，不算首次通过**。证据见 artifact `12143093299`。
- **设备测试合计 25 / 25**，另加 1 项分流核对：
  - system：a1–a6、s1–s3、b1–b3、t1；
  - ui：u1–u9、l1、l2、l3。
  - 没有跳过测试，没有放宽断言。JVM 单元测试与 lint 在 build job 中通过。
- 设备：Android 14 x86_64 模拟器，KVM，软件 GPU（swangle_indirect），pixel_6 配置，2 个客户机核心。

### 横屏 l3（本轮重点）
- **方法**：先让 Tono 窗口处于前台，再调用 `UiAutomation.setRotation(90)` 旋转显示；等 Activity 重建为横屏后再设置内容。之前两次是在启动前旋转，当时竖屏锁定的启动器在前台，窗口一直停在竖屏，已撤回。
- **结果**（`landscape-report.txt`）：系统旋转生效，显示转为横屏，窗口 866 × 363 dp。以下状态全部没有截断，每个控件都 ≥ 48 dp 且有标签，每个首页控件都能滚到可见：8 个首页状态、登录页、Details、设置。
- **它发现的真实缺陷**：在上一个 head（run 39135197245）上，横屏登录页的提示文字被截断。已修复：横屏时文字和卡片左右排列；内容放不下时改为滚动，不再裁切。修复时契约检查还发现“Use another email”按钮只有 40 dp（已改为 48 dp）。
- **截图**（Android 14 模拟器上的夹具界面，2400 × 1080；**不是真实 MainActivity，也不是真机**）：[fixture-landscape](https://ampcode.com/user-content/artifacts/46f364546fa1c9985070e5c7ec8aa4fa3125ac9c520bd1dbfe75f6587134bd33-file.png)。原图在 artifact `12141320388` 的 `evidence/` 目录：`fixture-27-landscape-home.png`、`fixture-27-landscape-details.png`，以及 `landscape-report.txt`。
- **已知瑕疵**：
  - 左侧黑边是摄像头挖孔区域。夹具宿主在首帧之后才开启全面屏；真实 MainActivity 的横屏没有截图。
  - Details 上的“Drag handle”气泡：u9 之后设备处于键盘模式，Material 会在拖动手柄获得焦点时显示这个提示。
  - 横屏登录页在设备上只做了截断与契约检查，没有截图；登录页横屏布局的截图只有 JVM 渲染（未发布）。

### 证据
截图共 48 张（real 14、fixture 29、local 5），视频 2 段。

| 内容 | 链接 |
|---|---|
| 本地替身上的真实隧道：登录 → 真实 TUN 已连接 → Details → 断开 | [local-tunnel](https://ampcode.com/user-content/artifacts/0aa5b78fa9929a8e45963b070e06dc392d6b6b46d338b62f7c10e2e11677a151-file.png) |
| 横屏首页与 Details | [fixture-landscape](https://ampcode.com/user-content/artifacts/46f364546fa1c9985070e5c7ec8aa4fa3125ac9c520bd1dbfe75f6587134bd33-file.png) |
| 键盘焦点描边、360 × 640 dp 小屏 | [fixture-adapt](https://ampcode.com/user-content/artifacts/2eb27a249b3890ff2ce8a77fdd0bd4d341beaa3a05e20337b7bfa2d2d46e4286-file.png) |
| 夹具五态 | [fixture-states](https://ampcode.com/user-content/artifacts/5a3fb505245fbc177de6011f7454b53b96f20a5ce6458622c0ce456ebda5ae93-file.png) |
| Details、上滑、线路、设置、授权前说明 | [fixture-sheets](https://ampcode.com/user-content/artifacts/7a32f6ccac8b89a31686a5eec5e6f93bdd2d530a36c9d23ed5b46bfdcbe071b2-file.png) |
| 系统字体 200 %、玻璃模糊测试 | [fixture-a11y](https://ampcode.com/user-content/artifacts/f57b89fa50a043d4c0cd67ebac8522e90bd1791fc23614a48cbbd91a1f4b18cc-file.png) |
| 简体中文 | [fixture-zh](https://ampcode.com/user-content/artifacts/47360911e908aed5bd455d1ac37ba4a4446fa9827681265ea1a761dc1e67df48-file.png) |
| 真实流程、真实系统入口 | [real-flow](https://ampcode.com/user-content/artifacts/669a7ffddec442639a9cd39a6d8035f6782d559a5233bff44a6658110736f181-file.png) · [real-surfaces](https://ampcode.com/user-content/artifacts/11bf2ad0253e6f7f023dbb6e7bbfefd710facc0851c2a83fa167cfc965540bce-file.png) |
| Widget、通知（夹具） | [fixture-surfaces](https://ampcode.com/user-content/artifacts/bbe74bc7a5f2c905bf649f7ff1928aa65a6aa5f8cd4d193fc0c926e59a919939-file.png) |
| 逐帧动效（每帧 16 ms 的测试时钟） | [mp4](https://ampcode.com/user-content/artifacts/d1d6591668d2cf352470fe9759051fe06e81ad5a46758702f3e169b1219a5375-file.mp4) · [gif](https://ampcode.com/user-content/artifacts/f91a5c2bddb8329b7eda17aa1ef924b24d4d7cf46b74daccecf439b5df5b2a79-file.gif) |
| 设备实时录屏（软件 GPU） | [mp4](https://ampcode.com/user-content/artifacts/da1b8548f91036129c14b645fbf43e8b237adea20d52313e1a0575a2a2a9d18a-file.mp4) |

Actions 产物（保留到 2027-01-16）：
- `android-emulator-evidence-ui` `12141320388`
- `android-emulator-evidence-system` `12143093299`（attempt 2）、`12143211019`（attempt 1，失败记录）
- 测试 APK `tono-mobile-0.3.1-test-bf449391f` `12140558090`：debug 签名，安装前先卸载旧版

### 本轮失败与重试记录（全部保留）
| Run | Head | 结果 |
|---|---|---|
| 39113297176 | `91dbbc07` | 模拟器 3 次 SIGSEGV（状态 139）导致掉线；随后改用 swangle_indirect |
| 39115256726 | `fdb85d28` | 不再掉线；t1 本地标记被状态栏遮住（读屏读不到，已修）；u9、l3 失败 |
| 39120135343 | `9c38bd3a` | t1 只在退出登录一步失败；u9 描边采样受时序影响；l3 第二种方法失败 |
| 39125188504 | `62fee220` | 24 / 24，首次尝试通过（当时还没有 l3） |
| 39126740818 | `8b07d840`（只改 changelog） | system 模拟器极慢，超时；重试时旧模拟器仍在运行，两次尝试都失败。随后加入 35 分钟预算，并在重试前清理旧模拟器 |
| 39135197245 | `2d6540d3` | l3 在设备上真实转为横屏，并发现登录页截断（真实缺陷）；system 13 / 13 |
| 39138009249 | `bf449391` | attempt 1：ui 12 / 12，system 两台都慢、被预算停止；attempt 2：system 13 / 13 → **success** |

模拟器速度在不同 runner 之间波动很大：同一份测试代码，a1 用时 33 s 到 312 s 不等。慢的都是驱动真实应用动画场景的测试，系统界面测试不受影响。这一点还没有解决，只是让失败能尽早停下、留下记录，并在干净的环境里重试。

### Rubric（不变）
原文见本分支 `docs/agent-reports/2026-10-18-mobile-opus-5-5.md` 的 “Rubric（原样，不改标准）” 一节：信息层级减字 20、交互连贯单手 20、高级克制及与最新桌面品牌一致 15、玻璃材质 15、状态动效 15、可访问性适配 10、真实性性能 5；门槛 ≥ 85 且每项 ≥ 70 %；严重状态误导、主操作难发现、不可读一票否决。目标 ≥ 95。

### 未验证（单列）
- 真机：GPU 与玻璃观感、实时 60 fps、触感、功耗、真机横屏。
- 真实 Tono 账号登录与真实服务隧道：需要白名单账号和 Home 分配，验证码发到用户手机。
- TalkBack 实际朗读与手势（模拟器镜像里没有 TalkBack）。
- QUIC 回退、始终开启 VPN、应用排除、网络切换、后台恢复。
- 真实 MainActivity 的横屏截图。

无 Release、无商店、无 feeds、无部署；PR 保持 Draft，不合并。

https://ampcode.com/threads/T-01a14a6e-7a99-745c-ab7f-888543f76c3b
