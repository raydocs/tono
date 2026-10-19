# iOS orb 资料归档（2026-10-19，PR #1672 第 8–12 轮）

来源：iOS 实现线程 [T-01a14a94](https://ampcode.com/threads/T-01a14a94-6bc1-73df-bb3b-eb8c35369b9b) 的 orb，
检出 `feat/ios-singbox-horizon` @ `3ab870ef0b5f1c3ef3d4077e277435f2cd305cd5`（与 origin 相同、工作区干净、无未推送 commit）。
归档时实现处于 PAUSED（用户经 Puck 暂停），本目录只是原样拷贝，不是新的验证或评审结论。

文件内容未改动（`shutil.copy2` 逐字节拷贝）。`INVENTORY.tsv` 逐个列出每个文件的去向、大小、sha256 与来源；
`MANIFEST.sha256` 覆盖本目录所有文件（在本目录内运行 `sha256sum -c --quiet MANIFEST.sha256`）。
生成脚本与检查脚本在 `tools/`（`make_ios_archive.py <orb .amp/in> <检出> <目标>`）。

## 目录与来源类别

| 路径 | 类别 | 说明 |
|---|---|---|
| `actions-copies/<名>-run<id>-<head>/` | **Actions 原始副本** | `gh run download` 下载的 artifact `ios-preview-screenshots`，逐字节未改。4 个 run：ci-r11f = [39184374749](https://github.com/raydocs/tono/actions/runs/39184374749) @ `c2f8762`（第 11 轮评审基线，绿 31/31）；ci-r12a = [39192116052](https://github.com/raydocs/tono/actions/runs/39192116052) @ `aae2681`（红 30/33）；ci-r12b = [39198831560](https://github.com/raydocs/tono/actions/runs/39198831560) @ `880012a`（红 32/33）；ci-r12c = [39204638991](https://github.com/raydocs/tono/actions/runs/39204638991) @ `b709be7`（绿 33/33，未冻结）。超过 20 MB 的视频未放入，见下。 |
| `orb-in/` | **orb 派生** | orb 内 `.amp/in/` 的其余资料，按原相对路径存放：评审输入/输出草稿（`review*/`、`gpt-r11.txt`、`body-r12-old.md`、`pr-body-*.md`、`self-score-r8/r9.md`）、从 Actions 截图/视频裁切或抽帧的图（`final-*.png`、`r12b-1.png`、`lk.png`、`lc/cancel.png`、`v7/`、`v8/`、`zf*/`、`r10frames/`、`frames/`）、本地测量与路由脚本、`sbwork/` 路由回放配置与日志、`handoff/` 交接包解包、构建/CI 观察日志。 |
| `orb-in/ci-r11a/failed.log`、`orb-in/ci-r11c/failed.log` | 派生（Actions 日志摘录） | `gh run view --log-failed` 的输出，分别来自 run [39167318732](https://github.com/raydocs/tono/actions/runs/39167318732) 与 [39171778053](https://github.com/raydocs/tono/actions/runs/39171778053)。`orb-in/ci-r11c/ax5.png` 是 orb 内裁切图。这两个目录中其余文件是 Actions 原件，只列清单。 |
| `checkout-ignored/` | orb 派生（检出根目录被 git 忽略的文件） | `SESSION_STATE.md`（会话状态，止于暂停前）、`tono-android-ui-overview.png`、`tono-mobile-handoff.tgz`（移动端交接包，**含 Android 源码片段作为参考**，已解包做文本扫描）。 |
| `tools/` | 归档工具 | 生成与检查脚本副本。 |
| `actions-runs.tsv` | Actions API 摘录 | 本轮相关 34 个 iOS CI run：head、结论、起止时间、artifact id/大小/到期时间、本归档如何处理。 |

## Actions artifact 不是永久保存

GitHub Actions artifact 保留 14 天。本目录涉及的 artifact **全部会在 2026-10-31T17:58Z 至 2026-11-02T07:49Z 之间到期**
（逐个见 `actions-runs.tsv`）。到期后：

- `actions-copies/` 中 ≤20 MB 的文件仍在本仓库；
- 下面“只列清单”的较早 Actions 副本与超过 20 MB 的视频**不再有任何副本**（orb 也会被回收）。
  `NOT-ARCHIVED-actions-copies.tsv` 只保留了路径、大小、sha256、run、artifact 链接和到期时间，**不是永久归档**。

### 只列清单、未放入的 Actions 副本（需要决定）

orb 里 `shots-<head>/`（25 个 run）与 `ci-r11a/`、`ci-r11c/`、`ci-r11d/`、`ci-r11e/`（4 个 run）共 1,912 个文件、13,140,710,585 字节，
是 artifact 的下载副本（文件名与已拷贝 run 的 artifact 文件集合一致；上面 3 个派生文件除外）。原件在 GitHub 上、到期前仍可下载，
按“GitHub 已有原件用稳定来源 + hash 清单避免重复”处理，没有放入。其中 1,825 个文件不超过 20 MB；去掉与本归档已有文件
字节相同者后为 1,642 个唯一文件、1,522,668,732 字节。**若要在到期后仍保留它们，需要在 2026-10-31 前另行决定是否提交这约 1.52 GB。**

## 超过 20 MB、未放入（17 个）

| 路径 | 字节 | 原因 / 是否另有副本 |
|---|---:|---|
| `orb-in/artifacts/r2-state-cycle.mp4` | 65,585,579 | 超过 20 MB。orb 内录屏，**无其他副本**，orb 回收后丢失。 |
| `orb-in/sbwork/sing-box-1.15.0-alpha.12-linux-amd64.tar.gz` | 31,082,764 | 超过 20 MB；第三方 sing-box 官方发布包，可从上游重新下载（sha256 见 `INVENTORY.tsv`）。 |
| `actions-copies/ci-r11f-…/dl/ios-preview-screenshots/ui-tests.mp4` | 404,857,789 | 超过 20 MB；Actions artifact 12159295214 原件，2026-11-02 到期。 |
| `actions-copies/ci-r11f-…/state-cycle.mp4` / `state-cycle-en.mp4` | 69,739,250 / 74,877,392 | 同上。 |
| `actions-copies/ci-r12a-…/ui-tests.mp4` | 432,427,221 | artifact 12162950239，2026-11-02 到期。 |
| `actions-copies/ci-r12a-…/state-cycle.mp4` / `state-cycle-en.mp4` / `sheet-zoom.mp4` | 55,421,344 / 61,318,126 / 26,912,163 | 同上。 |
| `actions-copies/ci-r12b-…/ui-tests.mp4` | 543,738,036 | artifact 12164718334，2026-11-02 到期。 |
| `actions-copies/ci-r12b-…/state-cycle.mp4` / `state-cycle-en.mp4` / `sheet-zoom.mp4` | 47,708,327 / 69,934,161 / 29,493,538 | 同上。 |
| `actions-copies/ci-r12c-…/ui-tests.mp4` | 452,670,642 | artifact 12167153324，2026-11-02 到期。 |
| `actions-copies/ci-r12c-…/state-cycle.mp4` / `state-cycle-en.mp4` / `sheet-zoom.mp4` | 51,911,606 / 51,863,706 / 28,135,440 | 同上。 |

## 已在 GitHub 上、未重复放入（30 个）

与 `feat/ios-singbox-horizon` @ `3ab870e`（PR #1672，**未合入 main**）中的文件字节相同，`INVENTORY.tsv` 写明对应路径。
其中只有 `orb-in/handoff/.../desktop-multi-vless-reality.yaml`（= `tooling/scripts/tests/fixtures/multi-vless-reality.yaml`）也在 main 上；
其余 29 个（第 8–11 轮 Opus/GPT 评审原文与 hash、第 10/11 轮密封自评、`lc/label.py`、3 个 stub）只在该功能分支上。

## 排除（不是证据）

| orb 路径 | 原因 |
|---|---|
| `.amp/in/tools/` | 工具链（Swift、Go、XcodeGen、sing-box 二进制），可重新下载 |
| `.amp/in/pyenv/` | Python virtualenv |
| `.amp/in/src/` | 第三方源码检出（sing-box、apple），可从上游取得 |
| `.amp/in/xcodegen-out/` | XcodeGen 由已跟踪的 project.yml 生成 |
| `.amp/in/sbwork/sing-box-1.15.0-alpha.12-linux-amd64/` | 第三方发布包解包（二进制、.so、LICENSE） |
| `.amp/in/stubcheck/mod`、`flat`、`flat2` | 生成的 Swift 模块与已跟踪源码的平铺副本 |
| `.amp/in/archive-tools/` | 归档工具与中间结果（脚本副本在 `tools/`） |
| `.amp/in/archive-android-2026-10-19*` | Android 归档的传输分片，内容已解到 `../2026-10-19-android/` |
| `services/control-plane/.dev.vars` | 本地密钥文件（git 忽略）：**敏感，未打开、未复制** |

缺失：Puck 点名的 `.amp/in/ci-r12*`、`ci-r11f`、`lc`、`gpt-r11.txt`、`body-r12-old.md`、`final-*.png`、`r12b-1.png`、`lk.png` 全部在位，无缺失。
`lc/label.py` 已在 GitHub（见上），`lc/cancel.png` 在 `orb-in/lc/`。

## 敏感内容检查（方法与范围）

- **文本**：`tools/scan.py` 对所有文本文件（含 `tono-mobile-handoff.tgz` 解包后的 44 个文本文件）做模式扫描：GitHub/AWS/OpenAI/Anthropic/Slack/Google
  密钥形态、私钥头、JWT、Bearer、Authorization 头、`password=`/`secret=` 类赋值、`CF_API_TOKEN`、非 example 域邮箱。本目录 **0 命中**。
  `sbwork/configs/`、`configs/` 中的 UUID `11111111-…`/`22222222-…`、`short_id`、Reality 公钥 `3p7bfX…` 与 SOCKS 口令 `home-pass` 是测试夹具，
  与已跟踪的 `apps/ios/TonoKit/Sources/TonoKit/SampleCatalog.swift`、`apps/ios/tools/route-harness.py` 中的值相同；地址是 8.8.4.4、9.9.9.9、1.0.0.1。
  App 内唯一出现的邮箱是夹具 `preview@example.com`。
- **图片元数据**：`tools/imgmeta.py` 解析了全部 2,836 张图片（PNG 的 tEXt/zTXt/iTXt/eXIf，JPEG 的 APPn/COM，GIF 扩展块）。
  只有时间戳、像素尺寸、色彩空间、ICC、`Screenshot` 描述与空的 XMP；EXIF 没有 GPS、设备型号、软件或作者字段。
- **图片内容（人工目视，不是 OCR）**：iOS 与 Android 首批合计所有非视频抽帧图片（1,417 张）与视频抽帧中每 5 帧取 1 帧（404 张），
  以及 Android 补档 `orb-only/` 的全部 292 张图片，做成约 100×200 px 缩略图拼图逐张看过；
  另以原分辨率抽查了含账号/输入框/系统界面的若干原图（设置页“Signed in as preview@example.com”、Android 登录页、快速设置面板等）。
  看到的都是模拟器、夹具预览或设计稿画面，没有发现凭据或个人信息。**限制**：缩略图读不出极小文字；视频抽帧的其余 4/5 未目视；
  本目录 5 段 MP4（`actions-copies/` 下的 `state-cycle-reduce-motion.mp4`、`sheet-zoom.mp4`，均为 Actions 原件）只检查了容器元数据，未逐帧看。不能据此声称“全部无敏感信息”，只能说上述范围内未发现。
