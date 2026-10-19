# PR 1673 第 7 轮证据清单

固定 head：`c18daa3db114fb059e1190e6e0e7aa7635f715b9`。本目录根路径：`/home/user/workspace/repo/.amp/in/artifacts/pr1673-r7/`。

## 原始来源

| 保存位置 | 原始来源 | 用途 |
|---|---|---|
| raw/pr-head.json | GET repos/raydocs/tono/pulls/1673，仅提取 head/base/URL/number | 锁定完整 SHA，无 PR body/comments |
| raw/run.json | GET repos/raydocs/tono/actions/runs/39176556620 | run head、attempt、时间、结论 |
| raw/jobs.json | GET …/runs/39176556620/jobs | job ID、步骤/重试状态；首步 continue-on-error 另核源码/原日志 |
| raw/artifacts.json | GET …/runs/39176556620/artifacts | artifact ID、名称、大小、所属 head |
| raw/allowed-comment.json | GET repos/raydocs/tono/issues/comments/6256737598 | 唯一允许读取的证据评论，陈述只作核验入口 |
| raw/rubric.txt | git show 固定 head 的指定 rubric 节，经筛选只保存标准一句及门槛 | 原样评分依据；提取时意外看到 iOS 旧自评分的污染详见 REPORT |
| raw/logs.zip | GET …/runs/39176556620/logs | 原始 build、三个 emulator jobs 与步骤日志 |
| raw/old-run39170392763.json | GET …/actions/runs/39170392763 | 旧 run head/结论，严格不冒充当前 head |
| raw/old-artifacts39170392763.json | GET …/runs/39170392763/artifacts | 旧 tunnel artifact 归属 |
| raw/old-12153665259.zip | GET …/actions/artifacts/12153665259/zip | 旧 instrument-t1 的死引擎 Connected 通知事实，不使用旧评分 |

没有读取别的 PR 评论、旧 Android 分数、其他报告或实施/评审线程。没有咨询其他模型或重跑 CI。原下载 ZIP 未重新打包，hash 对下载字节。

## 本轮 artifact 校验

| ID / 名称 | ZIP SHA256 |
|---|---|
| 12155260564 / android-emulator-evidence-ui | `41a3264a7aa33fa674aa0be892b0498fc47519289022c39858af1f46151f5a80` |
| 12155056933 / android-emulator-evidence-tunnel | `59bf8a1cbed442124959cfdb53c7fbddbf6553796943e427deb8e69c400e00ea` |
| 12155007330 / android-emulator-evidence-system | `1c81ccae7ea7aef3e88062a585e31ed95956e445a594b41f57f9ce9080a4cceb` |
| 12154588071 / android-test-reports | `cc4abe37c91b9d7aed9b873b28a3483e29ff85ce526738d876f65916552a2945` |
| 12154528517 / instrumentation-apk | `138270053788f9bf08cc26f7107ab15d5df83e63ad09897226630b721db8e264` |
| 12154513635 / tono-mobile-0.3.1-test-c18daa3db | `a20e3db690ed9b2d6c8a7aa4015baacf8d4c1b1d31e3942ad56692a9b8c05502` |
| logs.zip | `4d674e152e6ca4371965a1c602c3c0a5ac75daae7e76c10b48d5e4cf6c13b13a` |
| 旧 run 的 12153665259 | `bcf61f1053e92ebaf04a3174c31810cc57c2bd2a98262eecaec06c38a6cde550` |

ZIP 内产品 APK：`tono-mobile-0.3.1-test-c18daa3db.apk`，65,072,711 bytes；本次重算 SHA256 `a1d614f976d6f63d1e35d7308180f36d008bc3d1b767afd007c5259d8b6a4280`，与 artifact 内 `.apk.sha256` 一致。没有运行此 APK 的新测试。

## 关键 ZIP 内路径

成员路径在 `EVIDENCE.tsv` 中逐一列出。下面的路径均相对相应 ZIP 根目录，不是另一个远程报告。

- UI：`evidence/summary.txt`、12 个 `instrument-*.txt`、`animations.txt`、`health.txt`、`motion-frames.txt`、`frames/frame-0000.jpg`…`frame-0391.jpg`、`glass-report.txt` 及 fixture PNG。
- Tunnel：`evidence/summary.txt`、7 个 instrument、`local-tunnel-routing.txt`、`local-tunnel-requests.txt`、`local-tunnel/exits.log` / `control-plane.log`、`logcat-live.txt`、`local-real-motion.mp4`、`local-*.png`、`real-font-2.0-report.txt`。
- System：`evidence/summary.txt`、9 个 instrument、`real-tile.txt`、`real-widget.txt`、`real-core.txt`、`real-motion.txt`、`perf.txt`、real/fixture PNG。
- System 首轮：`evidence-attempt-1792366741/summary.txt`、`instrument-s1_realQuickSettingsTileShowsSharedStatusAndOpensTheApp.txt`、`real-tile.txt`、QS PNG 与 `real-tile-panel.txt`（三次重开均无副标题）；保留 FAIL，不被重试结果覆盖。
- JVM：`mobile/build/reports/tests/testDebugUnitTest/index.html` 及其子报告；`routing/build/reports/tests/testDebugUnitTest/index.html` 及子报告。HTML 静态解析，不执行页面脚本。
- 旧 tunnel：`evidence/instrument-t1_realTunnelThroughLocalFixtureServers.txt`；后台残余的条件依据主要是当前固定源码，不是旧 head 的截图。

## 固定源码定位

所有路径在 `source/` 下，与固定 Git blob 原字节一致。审查时还用行号读取下列文件：

| 路径（省略 source/） | 重点行 | 核验内容 |
|---|---|---|
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/EngineClient.kt | 68–97,129–164 | 失联通知替换、复活的存活/前台/绑定条件 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/MainActivity.kt | 58–70,90–96 | UI 生命周期、consent、EngineModel 所有权 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/TonoNotifications.kt | 19–54,70–94 | Connected 通知无独立过期；UI 替换 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/TonoVpnService.kt | 105–120,590–614,703–709 | START_STICKY、notify 路径、错误归因 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/surface/PublicStatus.kt | 68–84,114–121 | freshness、VPN network 检查 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/surface/TonoWidget.kt | 34–40,75–86 | launcher 更新与 inexact 非唤醒 alarm |
| apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/LocalTunnelDeviceTest.kt | 123–190,295–365,428–526,554–562,624–765 | 故障注入、返回、真实转屏、cutout、天空、200% |
| apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/DeviceEvidenceTest.kt | 89–175,184–269,300–344 | a1–a4、Remove animations、fixture 边界 |
| apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/HorizonUiDeviceTest.kt | 188–241,272–305 | glass 对照、设计时钟帧 |
| apps/android/mobile/src/androidTest/kotlin/com/raydocs/tono/mobile/A11yContract.kt | 21–65 | 布局/触达/标签/截断 checker 边界 |
| .github/workflows/android-ci.yml | 218–236,279–329,344–418 | health gate、动画设置、真实 instrument、路由核对、重试保留 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/SeaScene.kt | 39–66,111–149 | 天空/转场/线条反射 |
| apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/Glass.kt | 43–99 | 共享 backdrop 与模糊/tint/rim |
| apps/macos/Tono/Views/SeaSceneWater.swift | 13–45,105 起 | 当前桌面水面和流量 sparkle，仅源码对照 |
| apps/windows/app/src/tono-ui/sea-scene.css | 374 起,509 起,786 起 | ripple/grain/glints，仅源码对照 |
| services/control-plane/src/catalog-yaml.ts | 157,199 | CATALOG_UNAVAILABLE 不只表示 Home 故障 |

## 视觉复核记录

`visuals/review-images/` 12 张联系表：五态、200%、真实横屏、真实系统入口、前台引擎死亡、系统表面、首轮 s1、fixture 全状态/面板/中文小屏/横屏、真实视频全时轴抽样。它们由原始 PNG/视频缩放与排版，无图像生成或产品重绘。

`visuals/video-dock/page-01.jpg`…`page-10.jpg`：完整 444 个原始编码帧的底部 dock 区，每格保留源帧序号/PTS，用于审阅文本/按钮转场，不是更流畅的新录像。裁剪不代表原全屏画面；完整原始录像同时保留。

`visuals/fixture-frame-dock/`：u8 关键设计时钟帧，包含 Preparing→Connecting、Connected→Disconnecting、Failed；不能当真实引擎证据。

`visuals/original/`：原始 t3 五态 PNG、t4 四张 PNG及原始 t3 MP4，字节未变。其余原图均完整保留在原 ZIP。65 为最终 `evidence/` 顶层 PNG 数，不把设计时钟 JPG 或首轮失败图重复计入。

报告视觉判断来自本人看图；没有用另一个模型的视觉结论代替本人评分。没有新生成产品截图。

## 清单和复算的使用方式

- `EVIDENCE.tsv`：列为 `kind`、`container`、`member_or_path`、`bytes`、`sha256`。`zip-member` 是原始 ZIP 内解压字节；`fixed-source` 是固定源码原字节；`metadata` 是限定 API/标准摘录。列出某个成员只表示保存/可定位，不表示逐字读过每条 log 或逐帧作过独立断言。
- `receipts/independent-recompute.txt`：从原始文件重算各 shard instrument 数/OK 数、JVM、65 图分类、天空亮度、视频编码帧、APK checksum、首轮失败与旧 run 通知采样时间，不运行产品代码。
- `SHA256SUMS`：校验全部实际交付文件，包含 REPORT、EVIDENCE.md、EVIDENCE.tsv。命令：在本目录 `sha256sum -c SHA256SUMS`。manifest 自身的 SHA256 与报告/证据说明 hash 在最终回复另列，避免自引用。
- 上述工具结果是原证据分析，不是新增端到端测试。未做真机、真实账号服务或 TalkBack；未对当前 head 后台故障做注入。
