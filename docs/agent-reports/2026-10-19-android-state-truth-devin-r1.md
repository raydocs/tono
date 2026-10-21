# Android 状态真实性续修 · Devin 首轮失败（不是盲评）

- 精确提交：`1a5bb985ef188285af470df482fec7d22f851152`，仅 WIP 分支；PR 仍为 a140bac84。
- 云会话：https://app.devin.ai/sessions/517a6d6189b04ef19980c212ecff96cd
- 原件目录：`~/.local/state/devin-cloud/runs/20261019-201813-linux-1a5bb985e/`；同会话 send 下载副本位于 `20261019-201918-wait-517a6d618`。
- 主线程实读 `summary.result`、原始 XML、baseline provenance/receipt；未读图，不把子代理状态摘要当验证。

## 实测（保留失败，不重试刷绿）
- 第一窄集：58 项，57 通过、1 失败、0 skip/error。
- 全 mobile：118 项，100 通过、1 失败、17 opt-in skip、0 error。唯一失败：`HomeInteractionTest.stateAndPrimaryLabelsReplaceImmediatelyWithoutFadingCopies` 第 284 行；第一次手动时钟 tick 后还找不到 Connected。此结果尚不能区分测试重组同步与产品文字过渡问题，下一提交保留断言并补验新 action metadata；要跑旧行为红测证明区分力。
- routing XML 为 16/16，但 UP-TO-DATE、继承快照原件，不算本轮 fresh execution；续轮要求仅该 task 强制执行，不能把缓存旧结果冒充新结果。
- lint、主 APK、AndroidTest APK 编译成功。显式 ScreenshotRender15 + MotionPreview2 全通过、无 skip。
- 90 个具名矩阵用例在 XML 中均存在：89 通过、1 失败，无缺失或 skip。
- Horizon9、LargeText1、SmallScreen1、Landscape1、SystemSurfaces3（共15）各首次通过；另1个登录校验方法首次通过。不含下列缺失的隧道/像素证明。

## 已实际跑出的通知回归红测
- baseline a140bac84 的独立 VM checkout，仅复制新 `PersistentNotificationTest.kt`，仅追加两条编译所需资源定义，保留旧资源；main Kotlin 未改，候选 checkout 始终干净。
- 成功编译后实际 JUnit 失败：`expected:<Tono service> but was:<Connected>`；tests1/failures1/errors0/skips0。不是编译失败、不是推断。

## 不可当通过的缺口
- LocalTunnel 实际仅6个方法；先前“9个 LocalTunnel 方法”简报错误，CI tunnel shard 的另外3个是 DeviceEvidenceTest b1/b2/b3。续轮纠正清单，不删任何真实测试。
- 6 个隧道方法和 HOST 路由检查未执行：skill 的 never-store 阻止夹具在 VM 配置中生成测试 Reality key/UUID/密码；已请 owner 澄清一次性 VM 私有配置许可，不擅自放宽。
- u8 仅 normal、半尺寸 JPEG；没有原始全尺寸或 reduced u8。本地补写双模式/原尺寸证据测试，仍待云执行。
- Settings 图片遮挡同时盖住系统保护提示；不把遮挡区算作证明。通知图片文件虽名 connected，实际可能 connecting；文件名不能代替状态。差异 applied/selected 仅有 JVM 行为回归，没有设备差异录屏。
- 物理手机/OEM、TalkBack 真人朗读、触觉、GPU/电池、蜂窝切换、签名 release、真实服务未测，沿用真机清单。

## 原件校验
- `cli-raw-logs-xml.zip` SHA256 `50c7ecaba9905efba8823c4fbea1ecdf5924528ff047258d978c49ccf4a32e20`
- `ui-evidence.zip` SHA256 `991ef7076d52eb63229c298564a3f5eeccb0ef95301527118fd184e16114d49d`
- `jvm-motion-manual50ms.zip` SHA256 `52e67ad7a1fbb4c077eaa18e84277f22dd8cdffd6c38aab70dbfffe8fcfe0a4d`

结论：FAIL；不更新 PR、不冻结第二轮、不把本报告算独立评分。
