## 第 7 轮证据基线（冻结，供独立盲审；本评论不含分数）

本评论只列证据。实施方自评已密封，将与独立盲审一起交付；在盲审完成前，本 PR 不发布新的自评分或结论。

### 冻结的 head 与 CI
- **Head**：[`c18daa3d`](https://github.com/raydocs/tono/commit/c18daa3db114fb059e1190e6e0e7aa7635f715b9)（源仓 rw8/Tono-droid `7c2a71a`）。盲审完成前不再提交。
- **CI**：[android-ci run 39176556620](https://github.com/raydocs/tono/actions/runs/39176556620)，**success**，run attempt 1（未整体重跑）。
  - emulator (ui)：**首次尝试 12/12**（u1–u9、l1–l3），帧时 300 ms。
  - emulator (tunnel)：**首次尝试 8/8**（b1–b3、t1–t4），另加 t1 出口日志分流核对，帧时 850 ms。
  - emulator (system)：9/9（a1–a6、s1–s3），**在 job 内全新模拟器重试后才通过，已标 FLAKY**。attempt 1 中 s1 失败：快捷设置面板三次重开都停在紧凑行，看不到副标题（磁贴描述为 "Tono, Sign in"，共享状态正确），与 run 39103789541 同类。attempt 1 证据在 `evidence-attempt-*/`。
  - 合计设备测试 **29/29**，另加分流核对 1 项；没有跳过测试，也没有放宽断言或阈值。JVM 46 项（17 个按需截图项跳过），0 失败。
  - Artifacts：ui `12155260564`、tunnel `12155056933`、system `12155007330`、APK `12154513635`。
- 设备：Android 14 x86_64 模拟器，KVM，软件 GPU（swangle_indirect），pixel_6 配置。

### 用户要求的 7 项模拟器验收：逐项对应真实 MainActivity
早先的 "7/7" 是 run 39081051696 的 a1–a4 + b1–b3，其中 b1–b3 用的是夹具宿主。本轮把 b1–b3 换成真实 MainActivity 上的对应测试；夹具版 b1–b3 保留，只作为标注了的补充证据。

| # | 验收项 | 真实应用测试 | 断言 | 截图 |
|---|---|---|---|---|
| 1 | 登录与本地校验 | a1 | 登录页真实渲染；非法邮箱提示 | real-01、real-02 |
| 2 | 系统 VPN 授权框 | a2 | Android 自己的授权框出现 | real-03、real-04 |
| 3 | 无账号连接保持未登录 | a3 | 无 VPN 网络，仍在登录页 | real-05 |
| 4 | libbox ABI / 配置 | a4 | 固定 sing-box 版本在本 ABI 上接受两种模式的配置（引擎级，无界面） | — (`real-core.txt`) |
| 5 | 五态（原 b1） | **t3**：真实 MainActivity，连本地替身 | 未连接、连接中（授权完成起即开始观察）、已连接（有 VPN 网络）；Home 出口下线 → “Partly working”、短因 HOME_UNREACHABLE、VPN 仍在；目录不可用 → “Didn't connect”、无 VPN、主操作为 Retry | local-10…14 |
| 6 | 动效（原 b2） | **t3** 录屏 + 天空亮度断言 | 已连接比未连接亮 30 以上；部分可用、失败的亮度都在两者之间（实测 27.3 / 80.9 / 63.1 / 48.6） | local-real-motion.mp4 |
| 7 | 大字号（原 b3） | **t4**：真实 MainActivity，系统字号 200% | 登录、验证码、首页、Details、设置均无截断，每个控件 ≥ 48 dp 且有标签 | local-15…18、`real-font-2.0-report.txt` |

### 引擎失联后仍显示“已连接”（第 6 轮 F1）：修复与实跑证据
- **t1 故障注入**：真实 MainActivity 在前台、隧道已连时，杀掉 `:vpn` 进程，并在之后 90 s 内持续采样。系统没有 VPN 网络时，以下任何一处都不得说已连接：首页（有 1.5 s 重绘宽限）、磁贴/Widget 读取的共享状态、通知；登录页也不得出现。首页必须显示 “Status unknown”，之后必须重新出现已连接。之后再回到桌面、再回到应用，过程中不得经过 “Status unknown”。**本 head 首次尝试通过。**
  - logcat 时间线：杀进程 23:40:26.43 → 0.08 s 后 VPN 网络断开 → 3.1 s 后应用启动引擎 → 5.8 s 后 VPN 重新建立。t1 的文字笔记被后续测试覆盖，计时取自 logcat。
- **故障注入本轮找出的真实缺陷**，均已修复并加了回归测试（去掉修复时测试失败）：
  1. run 39170392763：Android 把被杀引擎的常驻通知留在 “Connected” 整整 90 s，期间系统没有 VPN 网络。现在应用在失去引擎时，把这条通知替换为 “Status unknown · Open Tono to check”。
  2. 同一 run：Android 在 90 s 内都没有重启引擎。现在应用在前台、且 3 s 后引擎仍未回来时，按 Android 自己重启服务的方式启动引擎；如果隧道本来已在运行，这个请求不做任何改变。
  3. run 39173982324：引擎被应用复活、隧道已恢复，但界面一直停在 “Status unknown”。原因是 Android 丢弃了死去的服务，旧绑定再也不会连上。现在复活时会重新绑定；在后台失去引擎后，回到应用时也会这样做。
- **残余**：如果引擎在应用关闭期间死亡、Android 又不重启它，通知仍可能显示已连接，直到打开应用或引擎重启。磁贴和 Widget 会自己检查 VPN 网络，没有这个问题；Widget 最长约 100 s 才刷新。

### 真实应用横屏 t2（真实 MainActivity，非夹具宿主）
- 竖屏下软键盘弹出时转屏：已输入的验证码数字保留，输入框在键盘之上。
- 横屏首页与 Details 没有任何内容压在摄像头挖孔下；面板的全窗口遮罩（“Close sheet”）不算控件，已排除，并在代码中注明。
- 横屏时打开 Tono 授权说明，转回竖屏后说明仍在。
- 截图：local-06、07、07b、08、09。

### 本轮 CI 失败与重试记录（全部保留）
- **39151329824**：650 ms 门槛误拦健康的模拟器；l3 的夹具标记被横屏面板盖住（已改为面板停在状态栏下方）。
- **39153105611**：tunnel 两次都失败。模拟器 900/950 ms，t2 挂起在 `ActivityScenario.onActivity`，t1 被 t2 遗留的账号影响。
- **39159687608**：类级 Compose 测试规则让真实应用停在首帧；t3 的场景切换被应用的无明文策略拒绝；a3 挂起。全部是测试缺陷，不是产品断言失败。
- **39163947970**：t4 首次通过；t1 与 t3 被系统通知权限弹窗挡住（现在像用户一样点“允许”）；t2 把遮罩算作挖孔下的控件；system 的 850 ms 模拟器光启动应用就用了 9 分钟。
- **39167725741**：system 首次 9/9；775 ms 门槛把 ui 与 tunnel 的四台模拟器拦了两次（含一次失败 job 重跑）。
- **39170392763**：所有测试都至少通过过一次；t1 attempt 2 发现上面的缺陷 1、2；t4 与 u1 是 Compose 测试在非主线程画帧（现在状态改在主线程写入）。
- **39173982324**：system 与 ui 首次通过；tunnel 只有 t1 失败（上面的缺陷 3），且故障注入期间没有任何表面过报。
- **测试条件的变化（不是阈值变化）**：
  - 与动效无关的测试在系统“移除动画”下运行。a5、b2、u8、t3 作为动效证据保持动画开启；a5 和 t3 先静止启动应用，再开启动画。
  - 开测前的帧时门槛只拦截慢于已见最慢值（1000 ms）的模拟器。这是开测前的环境检查，不是验收阈值；测试断言没有改变。

### 证据
截图 65 张（real 14、local 22、fixture 29）；真实应用录屏 1 段。

| 内容 | 链接 |
|---|---|
| 引擎失联：已连接 → 杀 `:vpn` 后状态未知 → 重启后重新已连接（真实 MainActivity） | [local-engine-death](https://ampcode.com/user-content/artifacts/6b42526aad43846d972930a08277370e628843ba781f255ec847756ce31ea729-file.png) |
| 真实应用五态（t3） | [local-real-states](https://ampcode.com/user-content/artifacts/baa9a70016c4522397c573790bbc5667d96e4637735da451d1e69ca083759287-file.png) |
| 真实应用录屏（t3，软件 GPU，缩小版） | [mp4](https://ampcode.com/user-content/artifacts/2d42d9c9aa2a6668712f72d28fa23a85d642cc1a0e3b508b9a97ef646a7e8972-file.mp4) |
| 真实应用横屏：验证码 + 键盘、首页、Details、授权说明 | [local-landscape](https://ampcode.com/user-content/artifacts/c8eebaaef5b6b4d1257a3b8fc94319e5d618d480af0d2862690cfa19f0a092eb-file.png) · [转屏保留](https://ampcode.com/user-content/artifacts/3ec6deaaa711cf19ba016de50b4a98f8b6b9960b9c720e5b6e94ff9f1b53f790-file.png) |
| 真实应用系统字号 200%（t4） | [local-real-font](https://ampcode.com/user-content/artifacts/18f365a0fbbf2381a7ce565ab209a423e1aba1807564de7ae9e63dcf6eef8225-file.png) |
| 本地替身上的真实隧道流程（t1） | [local-tunnel](https://ampcode.com/user-content/artifacts/0a111e3b0e39db51d227214a9fca6c3f7b514a811084d9781b9ca73d0148e72b-file.png) |
| 真实流程、真实系统入口 | [real-flow](https://ampcode.com/user-content/artifacts/efe472563659dc0dd23bb0c758794124073b730dcd666126b9d9a806134c12bc-file.png) · [real-surfaces](https://ampcode.com/user-content/artifacts/5530f9fd0559c23e6800b465ac631d8fe7ae5cde9cd0bdcf5db7312b5e2c41d6-file.png) |
| 补充（夹具宿主，不算真实应用验收） | [fixture-states](https://ampcode.com/user-content/artifacts/3adb0fbd5551f520e578445a08b2c7ebd338db91c50356e16761c30e0a83535e-file.png) · [fixture-sheets](https://ampcode.com/user-content/artifacts/7e5b0a9873b102bc94fdd1f95c899430dbec51f73a1e91966d0bcaa7816fbc41-file.png) · [fixture-a11y](https://ampcode.com/user-content/artifacts/26b7220a0b3c33185772c0b44cdaa26e81cf77298ea8c74cee73e5486833f0f8-file.png) |

**t1 分流核对**（依据两个出口自身的日志）：
- youtube 只走云出口；
- claude.ai、api.anthropic.com 只走 Home 出口；
- example.com 直连，两个出口都没看到；
- 云出口向 198.20.0.11:21080 发起了连接，说明 Home 是经云到达的。

### 未执行
- Tono 真实账号登录与真实服务隧道：需要白名单账号与 Home 分配，验证码发到用户手机。
- 真机：GPU 玻璃、实时动效、触感、电量。
- TalkBack 实际朗读。
- 应用关闭期间引擎死亡时的通知残余（见上）。

不合并、不发布、不部署。
