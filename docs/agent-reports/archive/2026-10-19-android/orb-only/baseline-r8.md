## 第 8 轮证据基线（冻结，供独立盲审；本评论不含分数）

本评论只列证据。实施方自评已密封，将与独立盲审一起交付；盲审完成前，本 PR 不发布新的自评分或结论。第 7 轮两份盲审原文、清单与密封自评已原样归档在 `docs/agent-reports/2026-10-19-android-r7-*`（含哈希与 rubric 污染披露）。

### 冻结的 head 与 CI
- **Head**：[`1cb5b59b`](https://github.com/raydocs/tono/commit/1cb5b59bb9d25335d185c3ec5c588192f24a36a6)（源仓 rw8/Tono-droid `255b907`）。盲审完成前不再提交。
- **CI**：[android-ci run 39184008733](https://github.com/raydocs/tono/actions/runs/39184008733)，**success**，run attempt 1（未整体重跑）。
  - emulator (system)：**首次尝试 9/9**（a1–a6、s1–s3），帧时 400 ms。
  - emulator (ui)：**首次尝试 12/12**（u1–u9、l1–l3），帧时 600 ms。
  - emulator (tunnel)：9/9（b1–b3、t1–t5）加 t1 出口日志分流核对，**在 job 内全新模拟器重试后才通过，已标 FLAKY**。attempt 1（帧时 950 ms，接近 1000 ms 准入上限）8/9：t1 在登录处失败（“code step”：替身控制面在点按后约 0.3 s 收到并以 200 应答发码请求，但 20 s 内界面上找不到验证码输入框；该路径没有失败截图，原因未查明），依赖 t1 的分流核对随之记为失败；同一次尝试里 b1–b3、t2–t5 通过。重试（800 ms）9/9 + 分流核对通过。attempt 1 证据在 artifact 的 `evidence-attempt-1792373454/`。
  - 计数：设备测试 **30 项**（9 + 12 + 9）加 **1 项**出口分流核对 = 31 项检查；没有跳过测试，也没有放宽断言或阈值。
  - JVM（CI 上传的原始 XML，`android-test-reports`）：mobile **发现 49、跳过 17（按需截图/动效渲染）、执行 32、失败 0**；routing **执行 16、失败 0**。
  - 健康门槛（登录页帧时 ≤ 1000 ms）只是模拟器准入，不是性能结论；`perf.txt` 为测量（本次测帧前已恢复动画：70 帧，50th 350 ms，软件 GPU）。
  - Artifacts：tunnel `12157754971`、system `12157692258`、ui `12157169775`、JVM 报告 `12157945155`、APK `12157576991`。
- 设备：Android 14 x86_64 模拟器，KVM，软件 GPU（swangle_indirect），pixel_6 配置。不是真机。

### 第 7 轮共同缺口：应用关闭时引擎死亡、通知仍显示已连接
**修复**：通知自检。引擎每次在隧道中写共享状态时，设一个 40 s 后的非精确、不唤醒闹钟；接收者在应用主进程，不依赖引擎或任何界面。它比对通知声称的阶段（引擎写在通知上）与共享状态还能担保的内容（本次开机、未过期，已连接还要求系统确有 VPN 网络）；不能担保就把通知替换为 “Tono stopped · No VPN network · Open Tono to reconnect”（系统无 VPN 网络时）或 “Status unknown”，并写日志。

**实跑故障证据（t5，真实应用、无界面、未重启）**：真实应用连上本地替身后关闭 MainActivity（无活动、ViewModel 已清），回到桌面，绑定转储显示只剩系统的 VpnService 绑定、应用的引擎绑定 `hasBound=false`；然后杀掉 `:vpn`，150 s 内每 500 ms 采样。
| | attempt 1 | 重试 |
|---|---|---|
| 旧进程消失 / VPN 网络消失 | 507 ms / 507 ms | 511 ms / 511 ms |
| Android 重启引擎 | 否（ActivityManager：`has died: prcp FGS`，无重启调度） | 否 |
| 通知仍写 “Connected” 且无 VPN 网络 | 507 ms – 57.8 s | 511 ms – 57.4 s |
| 自检替换（日志） | 57.8 s：`replaced a stale CONNECTED notification (surface UNKNOWN, VPN network false)` | 57.4 s：同 |
| 最终通知 | “Tono stopped · No VPN network …” | 同 |
断言：旧进程 10 s 内消失、VPN 网络断开；超过 90 s（共享状态过期上限）仍在无 VPN 网络时声称隧道即失败；系统保留通知且未重启引擎时，必须有自检日志且标题为 “Tono stopped”。截图：通知栏前后对比 `local-19`/`local-20`。
- **验证边界**：主进程仍在（它承载测试），闹钟送达的是运行中的进程，不是冷启动；手机醒着、无 Doze/待机限制；这两种情形未在设备验证。57 s 是本次实测，设计上手机醒着时为引擎最后一次写入后 10–70 s，不是严格上界。前台 t1 的恢复时间不外推到后台。
- **测试缺陷，已修**：上一 head `90da84e24` 的 [run 39181991820](https://github.com/raydocs/tono/actions/runs/39181991820)（三片首次通过）中 t5 是**空过**：杀进程后第一次采样仍看到旧进程和 VPN，被当作“已重连”。现在必须先观察到旧进程消失与 VPN 断开，新 pid 才算重启。该 run 不作为本轮基线。

### 前台故障注入（t1，本 head 重试中）
杀掉 `:vpn` 后 454 ms VPN 网络断开，首页同时转为 “Status unknown”，8.3 s 后应用复活的引擎给出新的 Connected；回桌面再回来 870 ms 显示 Connected，未经过 “Status unknown”。1.5 s 重绘宽限只在“移除动画”下验证；回前台首帧没有录制，只从屏幕判定。

### 7 项模拟器验收 → 真实 MainActivity（同第 7 轮映射，新增项见下）
| # | 验收项 | 测试 | 说明 |
|---|---|---|---|
| 1 | 登录与本地校验 | a1 | 真实登录页 |
| 2 | 系统 VPN 授权框 | a2 | **测试直接拉起系统框**；用户路径（Connect → Tono 说明 → 系统框）由 t1/t3 覆盖 |
| 3 | 无账号连接 | a3 | 无 VPN 网络、仍在登录页 |
| 4 | libbox ABI / 配置 | a4 | **引擎级，无界面** |
| 5 | 五态 | t3 | 真实应用连本地替身：未连接、连接中、已连接、部分可用、失败；天空亮度 27.3 / 54.7（连接中，出现即截，只记录不断言）/ 80.9 / 63.1 / 48.6 |
| 6 | 动效 | t3 录屏 | `local-real-motion` |
| 7 | 大字号 200 % | t4 | 登录、验证码、首页（未连接 + **真实已连接、部分可用、失败**）、Details、设置：无截断、控件 ≥ 48 dp 且有标签 |

### 第 7 轮建议并集的处理
- 挖孔：t2 断言系统报告的 cutout 非空并写入证据（90°：`Rect(0,470–128,588)`；270°：`Rect(2272,492–2400,610)`，2400×1080），只排除带 “Close sheet” 语义且覆盖全窗口的遮罩；补 270° 首页。三处均为 `[nothing]`。
- `CATALOG_UNAVAILABLE` 不再显示 “Home exit unavailable”，改为 “Lines unavailable right now / 线路暂不可用”（控制面对目录、身份签发与 Home 都用此码）。
- 计时器读屏 “Tunnel up for …”（部分可用时不再读 “Connected”）；引擎失联 “Tono stopped responding”。
- `A11yContract`：任何无标签的可点节点（不论角色）与行宽超出文本框都算违规。JVM（Robolectric）的字体测量复现不了不换行溢出，宽度项实际在设备副本（u1、u7、l1–l3、t4）生效。
- 连接中太阳由 0.7 降到 0.5，与已连接区分。
- CI 上传 JVM XML；`perf.txt` 测帧前恢复动画。
- 未改、照实列为未验证：玻璃/海面观感、真机流畅度、TalkBack 实际朗读、Tono 真实服务（需白名单账号，验证码在用户手机）。

### 截图与视频
- 无界面引擎死亡（通知栏前/后）：![](https://ampcode.com/user-content/artifacts/aa1ffd71b5e7d3d9bdc395fc30abfbdf4b6b58163b126187a02013ddcbe491a6-file.png)
- 200 % 真实已连接/部分可用/失败：![](https://ampcode.com/user-content/artifacts/be5a6dcb991040bc3e98c6dd6b259fb18c5415e8339f6e7b22a15c4badd69e35-file.png)
- 200 % 登录/首页/Details/设置：![](https://ampcode.com/user-content/artifacts/c83ca290aadec3bbf06433a4a0968256cca879a67cb7c3d3d4802df92fa81626-file.png)
- 横屏（含 270°）：![](https://ampcode.com/user-content/artifacts/cb31c83c7e3834fedeb63511b5bf12c9e1612548e611fcdd9722683ee3df2c42-file.png)
- 真实五态：![](https://ampcode.com/user-content/artifacts/6bf7fabcfb38670bc87a8f30547b93d977bf236b2448b8d03c7c1634bcff6ff8-file.png)
- 前台引擎死亡：![](https://ampcode.com/user-content/artifacts/3bd6d0a9db7d39707fb507130cc953db59b69d0cdb11ca9837b2c3975bbab2ba-file.png)
- 本地隧道流程：![](https://ampcode.com/user-content/artifacts/384691b1dfe146770849648c15f9e58799ef8e6b71ee8f9666c03bf13f17715e-file.png)
- 授权说明转屏：![](https://ampcode.com/user-content/artifacts/5c8031d8e27b145af414bd7ba204fd6026bd65719c2948ac3ade8d43d0638c60-file.png)
- real 系统表面：![](https://ampcode.com/user-content/artifacts/12da87455615ebc822ea0dc40759bfc6332e82eae676b8cf1d05655f01eee3b3-file.png) · real 流程：![](https://ampcode.com/user-content/artifacts/88e636eddfd69e581a2ac3603c0d371ef56fb17ec33e6db42467328ffeb79ba9-file.png)
- fixture（标注 “FIXTURE · no tunnel”）：[states](https://ampcode.com/user-content/artifacts/d6dc1b0072ec3ec47e3fee0dc3009e38eac3bcc2f5f8913c797b7b4961a8ffe3-file.png) · [sheets](https://ampcode.com/user-content/artifacts/2d7cf4bfa67cc700db63612aaeb99a3be4d7c52f12fe40559d08fa6ab8eb9db5-file.png) · [a11y](https://ampcode.com/user-content/artifacts/bcf4e4bf021d82aec3461fa9999953a613ea2d1c1d26faf5bb4ec78aa443eb0f-file.png) · [zh](https://ampcode.com/user-content/artifacts/1f0759b36bbb1bdcd605a5f00bd820e595707199ea0c29c0d08b74b5839f3e86-file.png) · [surfaces](https://ampcode.com/user-content/artifacts/de39084c5da43c6ee108d5a4fb9a9a8bbdb112f8fbf04f6538a77e5a6b80f936-file.png) · [adapt](https://ampcode.com/user-content/artifacts/b5f9046a6f59b7adc499c2d4b28cfa36bc50693a969a0c43a846bf59ceee9fed-file.png)
- 真实应用录屏（缩小版，原片在 tunnel artifact）：[local-real-motion](https://ampcode.com/user-content/artifacts/1097322ff8b4e5ccafaed09b3bc95dbcf1782f11a0dcfe36469017a3cc5b247e-file.mp4)

### 本轮 CI 记录（全部保留）
- [39180203368](https://github.com/raydocs/tono/actions/runs/39180203368)（`da80c3f97`，仅归档盲审）：success。
- [39181991820](https://github.com/raydocs/tono/actions/runs/39181991820)（`90da84e24`）：三片首次通过，但 t5 空过（见上），不作基线。
- [39184008733](https://github.com/raydocs/tono/actions/runs/39184008733)（`1cb5b59bb`，本基线）：system、ui 首次通过；tunnel attempt 1 t1 登录处失败（原因未查明），重试通过，FLAKY。

### 未验证与残余（不视为 owner 已接受）
- Tono 真实服务登录与隧道；真机（流畅度、GPU 模糊开销、触感、电量）；TalkBack 实际朗读。
- 通知自检在主进程不在、Doze/待机限制下的时延。
- Widget 自查是最后一次活状态后约 100 s 的非精确闹钟，不是严格上界。
- t1 attempt 1 的登录失败原因。
