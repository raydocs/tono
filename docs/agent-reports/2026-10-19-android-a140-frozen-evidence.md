# Android #1673 · a140bac84 冻结证据（盲评进行中）

- 冻结源：`a140bac84dd692781e36dbfd5a86f9ea2d1356a0`；diff merge-base `59082acfb52f31963b39e52595549875d0f01ed4`。
- [Android CI 39319514149](https://github.com/raydocs/tono/actions/runs/39319514149) 与 [ci-gate 39319514210](https://github.com/raydocs/tono/actions/runs/39319514210) 全部 job 成功，head 一致。本文件只归档证据，不改变冻结 SHA；评审期间不推送。

## Devin UI 证据

[会话 d3ed4e8a9ca44bd69b8ec7f6021711f6](https://app.devin.ai/sessions/d3ed4e8a9ca44bd69b8ec7f6021711f6)，按 owner 指定模板采集；无 `--mode`，沿用组织默认 agent。原件在
`~/.local/state/devin-cloud/runs/20261019-172437-linux-a140bac84/`。

主线程实读 summary.json、原始 JUnit XML 和 24 份 instrumentation 输出，核对如下：
- 完整 SHA 与冻结一致，初末 git porcelain 为空；固定 Libbox pin 验证成功。
- ScreenshotRender：15 实际执行/通过，0 失败/错误/跳过；MotionPreview：2 实际执行/通过，0 失败/错误/跳过。
- 设备：HorizonUi 9、DeviceEvidence 9、LargeText 1、ScreenSize 2（SmallScreen/ Landscape 两个实际类）、SystemSurfaces 3，共 24 实际通过，无跳过或重试。
- 78 个附件；清单中 77 个文件逐个核对尺寸/SHA256，清单自身为第 78 个。
- 61 张原始 PNG 全部在 manifest.csv，均记录完整 SHA、来源、语言、字号与尺寸；PNG 头有效。3 个 MP4 的视频流/尺寸/时长可解析。
- JVM 原始动效为两组各 145 帧、50 ms 测试时钟；设备 u8 为 16 ms 测试时钟。接触表标签以首个样本为零点，首样本发生在一次 clock advance 后；不是实际60fps证明。
- JVM 截图无图内 fixture 标记，但 manifest 明确 Robolectric fixture；dev-fixture 截图有标记；cloud real-* 是已交付 App 的未登录状态，不是实际隧道。

图片来源核对委派给独立截图 scout（主线程不加载图片）；15 张代表图的文字/来源与标注一致，含连接、部分可用、失联/重连、200% 和通知。其描述不能代替两个盲评者的视觉判断，不提供给盲评者作为评分意见。

## CI 原始失败不能被绿色覆盖

主线程另行复点了当前 CI 原始 instrumentation：tunnel 首次 9 个设备测试中 8 通过、t3 失败，fresh-emulator retry 9/9；每轮另有一个**主机侧**路由日志核对，不算设备测试。t3 原始断言：`a connecting state on screen before Connected`，不能仅凭重试绿推断为基础设施失败。工作流标记 FLAKY，保留两次证据。CI JVM：mobile 103 发现/86 执行通过/17 opt-in 跳过；routing 16 执行通过。Devin 后续明确执行了那 17 个渲染测试，不将两次执行相加当成不同用例数量。

额外提供当前 CI 的原始 PNG/MP4，来源为实际 MainActivity/libbox + loopback 替身，不是生产 Tono。其 ZIP digest 与 GitHub 元数据一致：`c6a75bffe4886d02d5a47d90d3dd26e31d605ad764bb68c33a4a171d31f4f28e`。只提取图片/视频，不保存配置或未脱敏 logcat。

## 盲评隔离与未验证边界

全新 GPT6.1-sol/xhigh 与 Opus5.5/high 分别以 review/worktree/async 启动；只给固定 rubric、源码 diff 与中性原件索引，禁止历史报告/自评/旧盲评/PR评论/对方报告。未形成新独立分数前不报自评分数。原始报告完成后在同目录另行归档；不提前宣称85通过。

Devin 模板未覆盖 Licenses、英文 JVM 渲染、连接中的真实桌面 widget/磁贴或 engineGone 通知；CI 替身路径提供部分额外连接/通知图，但不是生产证明。真实 TalkBack、触觉、真机 GPU/帧率/耗电、OEM 皮肤及待机限制、always-on/lockdown、真实 Tono 服务/账号/出口、正式签名包仍未验证；汇入 `2026-10-19-android-real-device-checklist.md`，等待 owner 确认后操作。
