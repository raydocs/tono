# 第 6 轮盲审证据清单

评审：GPT-6.1 Sol (`gpt61s`)；仓库 raydocs/tono；PR #1673；指定分支 `feat/android-singbox-horizon`；唯一 head `bf449391feacb3fdc329680ca7115aea8397659a`；run 39138009249，最终 attempt 2 success。

全部路径相对于 `/home/user/workspace/repo/.amp/in/artifacts/android-pr1673-r6-sol/`，源码路径相对于 `/home/user/workspace/repo/`。未使用其他评审或旧 Android 评分。原样 Rubric 中的 iOS 91/100 暴露已在报告披露。

## 1. 原始来源与完整性

| 来源 | 本地位置 | 角色 |
|---|---|---|
| Actions run 元数据 | `raw/run.json` | SHA、分支、run_attempt、conclusion |
| attempt 1 jobs | `raw/jobs-attempt1.json` | build/UI success、system failure、内部 retry 结果 |
| attempt 2 jobs | `raw/jobs-attempt2.json` | 只有 system 新时间；build/UI 沿用旧时间 |
| Artifacts 元数据 | `raw/artifacts.json` | ID、名称、来源 |
| UI artifact 12141320388 | `raw/12141320388/evidence/` | 18 PNG、392 JPG、12 项设备测试 |
| system success artifact 12143093299 | `raw/12143093299/evidence/` | 30 PNG、1 原始 MP4、13 项设备测试和分流核对 |
| system failure artifact 12143211019 | `raw/12143211019/` | attempt 1 两个内部 emulator 会话 |
| APK artifact 12140558090 | `raw/12140558090/` | APK 及 head/checksum sidecar |
| JVM/lint artifact 12140234423 | `raw/12140234423/` | routing/mobile 原始测试与 lint HTML/SARIF |
| attempt 1 Actions 原始日志 | `raw/logs-attempt1/` | build、UI、system job 与步骤日志 |
| attempt 2 Actions 原始日志 | `raw/logs-attempt2/` | system job 与步骤日志 |

APK：`raw/12140558090/tono-mobile-0.3.1-test-bf449391f.apk`，65,049,303 bytes，SHA-256 `79ccae83fffc641d1568d8c5573c541d85ae1bdb88c6a9996736eced753bd333`。此 SHA 对应所下载文件，和 sidecar 的 source/head 一致；不是生产发布签名验收。

`evidence-sha256.txt` 记录原始文件、原样 Rubric 和派生视频/联系表/重点帧的哈希，不包含该清单自身和报告正文，避免自引用。

## 2. 48 张成功 PNG：逐张清单

已经通过联系表检查全部 48 张，并对横屏等重点状态查看原图。real=模拟器中的真实 App/Android 组件，不是真机；fixture=注入状态、无真实隧道；local=真实 App/TUN 配合本地替身服务。

### UI artifact：以下 18 张位于 `raw/12141320388/evidence/`

| 文件名 | 检查内容 / 边界 |
|---|---|
| `fixture-09-details-by-swipe.png` | 上滑打开 Details；fixture |
| `fixture-10-lines-sheet.png` | 线路 sheet、选中/延迟层级 |
| `fixture-11-settings.png` | Settings、路由模式、Always-on 文案 |
| `fixture-12-apps.png` | 应用排除列表和 Done |
| `fixture-13-font-2.0-home.png` | 2.0 字号 Home，主操作和换行 |
| `fixture-14-font-2.0-details.png` | 2.0 字号 Details，说明和路由去向 |
| `fixture-15-font-2.0-settings.png` | 2.0 字号 Settings，滚动界面 |
| `fixture-16-glass-blur.png` | 条纹模糊/tint-only/platform blur 对照 |
| `fixture-20-consent-explainer.png` | 系统授权前解释，非系统授权框本身 |
| `fixture-21-zh-idle.png` | 中文未连接 |
| `fixture-22-zh-degraded.png` | 中文降级状态及「AI 已暂停」措辞 |
| `fixture-23-zh-details.png` | 中文详情/故障原因 |
| `fixture-24-zh-settings.png` | 中文设置 |
| `fixture-25-keyboard-focus.png` | 首页键盘焦点轮廓 |
| `fixture-26-small-phone-home.png` | 360dp 小屏 Home |
| `fixture-26-small-phone-details.png` | 小屏 Details |
| `fixture-27-landscape-home.png` | 2400×1080 图 / 866×363dp，fixture ComponentActivity |
| `fixture-27-landscape-details.png` | 横屏 Details，非全部离屏内容可达性证明 |

### system artifact：以下 11 张 fixture 位于 `raw/12143093299/evidence/`

| 文件名 | 检查内容 / 边界 |
|---|---|
| `fixture-01-idle.png` | 未连接默认态 |
| `fixture-02-connecting.png` | 连接中、Cancel |
| `fixture-03-connected.png` | 已连接、Disconnect、日间场景；不是实际在线证明 |
| `fixture-04-degraded.png` | Home 不通降级态 |
| `fixture-05-failed.png` | 失败、Retry、余烬 |
| `fixture-06-details-sheet.png` | 降级详情 |
| `fixture-07-font-1.3-home.png` | 1.3 字号 Home |
| `fixture-08-font-1.3-details.png` | 1.3 字号 Details |
| `fixture-17-widget-states.png` | widget 状态集合注入 |
| `fixture-18-notification-connected.png` | 注入已连接通知 |
| `fixture-19-notification-stopped.png` | 注入停止通知 |

### system artifact：以下 14 张 real 位于 `raw/12143093299/evidence/`

| 文件名 | 检查内容 / 边界 |
|---|---|
| `real-01-signin.png` | 真实 App 登录页 |
| `real-02-signin-invalid-email.png` | 真实邮箱校验错误 |
| `real-03-system-vpn-consent.png` | Android 系统 VPN 授权框 |
| `real-04-after-consent.png` | 授权后状态 |
| `real-05-connect-without-account-stays-signed-out.png` | 无账号不能伪装连接 |
| `real-06-motion.png` | 真实 App 动画开启 |
| `real-07-remove-animations.png` | 系统 Remove animations |
| `real-08-quick-settings-tile.png` | 系统快捷设置入口 |
| `real-08b-quick-settings-full.png` | 展开快捷设置 |
| `real-09-tile-opens-sign-in.png` | Tile 打开真实 App |
| `real-10-widget.png` | Android widget host |
| `real-10b-widget-opens-sign-in.png` | widget 打开 App |
| `real-11-system-light-theme.png` | 系统浅色下品牌界面 |
| `real-12-system-dark-theme.png` | 系统深色下品牌界面 |

### system artifact：以下 5 张 local 位于 `raw/12143093299/evidence/`

| 文件名 | 检查内容 / 边界 |
|---|---|
| `local-01-signin.png` | 本地控制面替身，登录页有标识 |
| `local-02-home.png` | 替身账号/目录后的 Home |
| `local-03-connected.png` | 真实 TUN 已连接、本地替身链路 |
| `local-04-details.png` | 本地链路详情，不是生产 Home 验收 |
| `local-05-disconnected.png` | 真实 App 断开状态 |

原始成功截图总计：18 + 11 + 14 + 5 = 48；fixture 29、real 14、local 5。派生联系表不计入此数字；失败 artifact 中重复/未完成的截图也不计入。

## 3. 视频、392 帧和派生检查材料

1. **原始视频**：`raw/12143093299/evidence/fixture-motion.mp4`，20.9918s，1080×2400，可变帧率。脚本注入状态的模拟器录屏，不是线上连接录屏。重点约 00:07–08 连接中、00:09–11 到达、00:12 断开、00:17–19 失败。
2. **UI 原始帧序列**：`raw/12141320388/evidence/frames/frame-0000.jpg` 至 `frame-0391.jpg`；时间记录 `motion-frames.txt`，16ms 设计时钟步进。不是 392 张 PNG，也不能拿录制/导出速度当实机帧率。
3. **派生检查视频**：`motion-from-ui-16ms-frames.mp4`，6.272s，540×1200，62.5fps。按 `ffmpeg -framerate 62.5 -i raw/12141320388/evidence/frames/frame-%04d.jpg -c:v libx264 -pix_fmt yuv420p ...` 拼接。不是第二份原始录屏；所给 artifacts 只找到一个原始 MP4。
4. 设计序列重点：frame 25/0.400s PREPARING，62/0.992s CONNECTING，112/1.792s CONNECTED，224/3.584s DISCONNECTING，255/4.080s IDLE，317/5.072s FAILED。
5. 低可见过渡重点：frame 32/0.512s、120/1.920s、232/3.712s；可在原始 JPG 或派生视频定位。重点 JPG 保存在 `keyframes/`；没有用视频分析工具的概述代替逐帧核对。
6. 全部 PNG 的联系表保存在 `contact-sheets/sheet-0.jpg` 至 `sheet-7.jpg`，仅为原始截图缩略派生物；尺寸/文字判定回到原图和断言。

## 4. 文本证据与原始日志索引

UI 前缀 `U = raw/12141320388/evidence/`；system 前缀 `S = raw/12143093299/evidence/`；失败前缀 `F = raw/12143211019/`。

| 文件 | 支持的结论 |
|---|---|
| `U/summary.txt` + 12 个 `instrument-*.txt` | UI 12/12，包括 u9 和 l3；需结合 attempt 1 job 日志确认首次通过 |
| `U/landscape-report.txt` | 系统旋转成功、866×363dp；不是 MainActivity 生命周期/IME 验收 |
| `U/small-phone-report.txt` | 360dp fixture 布局 |
| `U/font-2.0-report.txt` | 大字断言结果，非全部父窗口裁剪证明 |
| `U/keyboard-report.txt` | Tab 顺序、焦点像素差、Enter/ACTION_CLICK |
| `U/screen-reader-order.txt` | 树遍历顺序，不是 TalkBack 实际朗读 |
| `U/a11y-report.txt`、`U/a11y-tree.txt` | 48dp、label、尺寸和 ATF/语义证据，含部分离屏控件 |
| `U/interaction-report.txt` | 真实触摸触发 fixture action，非生产连接 |
| `U/glass-report.txt` | 模糊与 tint-only/platform blur 数值对照 |
| `U/motion-frames.txt` | 392 帧设计时钟与 phase 记录 |
| `U/device.txt`、`U/shard.txt`、`U/logcat*.txt` | 设备、分片和运行背景 |
| `S/summary.txt` + 13 个 `instrument-*.txt` | attempt 2 system 13/13，额外 t1-routing PASS |
| `S/local-tunnel.txt` | 本地登录/连接/退出、标识、连接时间、PSS |
| `S/local-tunnel-requests.txt` | cloud/Home/direct 请求与 HTTP 响应 |
| `S/local-tunnel-routing.txt` | 逐请求 cloud/Home 出口匹配及 cloud→Home 链路 |
| `S/local-tunnel/exits.log` | 原始出口连接日志；不是全设备抓包 |
| `S/local-tunnel/control-plane.log` | 本地替身邮箱 start/verify、catalog、logout API 请求 |
| `S/perf.txt` | 冷启动、jank、PSS；软件 GPU 模拟器，非真机基准 |
| `S/real-motion.txt` | 正常/禁用/恢复动画的像素变化 |
| `S/real-core.txt` | 当前 ABI 核心/配置检查 |
| `S/real-tile.txt`、`S/real-widget.txt` | 真实 Android 系统 surface 操作 |
| `S/device.txt`、`S/shard.txt`、`S/logcat*.txt` | 设备与运行背景 |
| `F/evidence-attempt-1792337935/summary.txt` | a2/a3 FAIL，2186s budget stop before a4 |
| 同目录 a2/a3 `instrument-*.txt` | 未完成，不能推断最终成功或具体产品断言失败 |
| 同目录 `logcat-live.txt`、`foreign-anr.txt` | launcher/VpnDialogs ANR、Wait 操作 |
| `F/evidence/summary.txt` | 内部重试 a1–a6/s1–s3/b1 成功，2566s budget stop before b2 |
| `F/evidence/logcat-live.txt` | 内部重试 VpnDialogs ANR |
| `F/evidence/host/emulator-exit.txt` | 保存的退出码 0，不是 crash 139 证据 |
| `raw/logs-attempt1/0_emulator (system).txt` | timeout900、两次内部 emulator 与预算停止原始时间 |
| `raw/logs-attempt1/1_emulator (ui).txt` | u9、l3 的原始 PASS 及首次成功 |
| `raw/logs-attempt1/2_build.txt` | build/test/lint/assemble 成功、配置检查、APK hash 与 head |
| `raw/logs-attempt2/0_emulator (system).txt` | t1 与 t1-routing PASS 原始日志 |
| `raw/12140234423/routing/build/reports/tests/testDebugUnitTest/index.html` | 16 tests，0 failure，0 skipped |
| `raw/12140234423/mobile/build/reports/tests/testDebugUnitTest/index.html` | 41 tests，0 failure，17 skipped（24 执行） |
| `raw/12140234423/mobile/build/reports/lint-results-debug.sarif` | lint 结果明细 24 条；任务成功不等于无提示 |

## 5. 结论相关源码定位：全部来自固定 head

| 路径 | 重点 |
|---|---|
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/EngineClient.kt:21–66` | 快照持有、onServiceDisconnected/unbind 不失效旧 snapshot、空引擎 command |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/MainActivity.kt:25–81` | 真实 Activity 收集快照、生命周期绑定和 consent |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/TonoRoot.kt:50–133` | 依据快照渲染；local 标识；无首页引擎存活门控 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/HomeScreen.kt:87–235` | phase/sky/primary、限宽滚动、crossRise、肯定状态文案 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/SignInScreen.kt:69–140` | OTP、imePadding、横屏双栏和滚动；源码支持不等于动态验收 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/SettingsScreen.kt:156–169` | expanded/collapsed 英文硬编码 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/DetailsSheet.kt` | 详情滚动与流量去向 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/surface/PublicStatus.kt:63–84` | 系统 surface 的 freshness/boot/VPN-present/UNKNOWN 规则 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/TonoVpnService.kt:365–400,453–459,650–655` | 探针→状态、同 IPv6 布尔值直接返回、手动重测 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/Probes.kt:14–39` | 一次 HTTP/异常判断路径；没有全局 AI pause 执行 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/LocalTestServer.kt:23–34` | debug/私有文件/loopback 显式端口限制 |
| `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/ControlPlane.kt` | 生产 API/本地替身通路分界 |
| `apps/android/mobile/src/main/res/values/strings.xml:46–57,111–114` | AI paused、Other apps still work、Always-on/lockdown 文案 |
| `apps/android/routing/src/main/kotlin/com/raydocs/tono/routing/SingBoxConfig.kt:114–139,175–190` | terminal 路由、UDP/ICMP reject、direct、TUN 配置；不能从本次少量请求推广全流量 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/ScreenSizeDeviceTest.kt:66–108,140–185` | ComponentActivity、fixture/no-op、旋转、Home 滚入检查边界 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/A11yContract.kt:21–65` | 48dp、部分离屏 touch 例外、文字自身布局而非所有父窗口裁剪 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/HorizonUiDeviceTest.kt` | u1–u9 交互/材质/可访问性树/设计时钟/键盘动作 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/DeviceEvidenceTest.kt` | a/b 真实 Android 组件与 fixture 状态分界 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/LocalTunnelDeviceTest.kt` | t1 真实 MainActivity/TUN 配合本地控制面与出口 |
| `apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/SystemSurfacesDeviceTest.kt` | 系统 widget/tile 与注入通知/状态分界 |
| `apps/android/mobile/src/test/kotlin/com/raydocs/tono/mobile/ui/MotionPreview.kt:38` | opt-in gate，2 skipped |
| `apps/android/mobile/src/test/kotlin/com/raydocs/tono/mobile/ui/ScreenshotRender.kt:41` | opt-in gate，15 skipped |
| `apps/android/scripts/local-tunnel/fixture-servers.py:160–199` | 出口日志校验算法和边界 |
| `.github/workflows/android-ci.yml` | 分片、预算、重试与 artifact 生成 |
| `docs/ui-design-system.md`、桌面 `SeaScene` 源码 | 当前暖色/墨色日月海平线品牌方向，不以旧紫色规范替代 |

## 6. 明确未执行 / 未证明

没有重跑构建、模拟器、CI 或生产请求；没有真机、TalkBack 朗读、真实 MainActivity 横屏 OTP+IME、引擎死亡动态复现、全设备抓包、生产账号/邮件/目录/真实出口、真机帧耗时/功耗/热状态验收。F1 是源码推论，不是动态日志或泄漏结论。

报告为 `report.md`；原样 Rubric 为 `rubric-verbatim.md`。所有成果仅本地；未发布 GitHub、未联系实施线程、未修改代码或合并发布。
