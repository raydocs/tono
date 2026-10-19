# 移动端 orb 资料归档（2026-10-19）

用户要求“没有资料只留在 orb”。iOS（PR #1672）与 Android（PR #1673）两个实现 orb 在暂停实现后，把 orb 里的报告、评审、截图和回顾资料
放进这一个 docs-only PR。功能分支没有推送新内容，也没有触发、重跑 CI 或评审。

| 目录 | 来源 | 说明 |
|---|---|---|
| [`2026-10-19-ios/`](2026-10-19-ios/README.md) | iOS 线程 T-01a14a94 | 2,981 个文件，546,568,102 字节；`MANIFEST.sha256`、`INVENTORY.tsv`、`NOT-ARCHIVED-actions-copies.tsv`、`actions-runs.tsv` |
| [`2026-10-19-android/`](2026-10-19-android/README.md) | Android 线程 T-01a14a6e | 1,711 个文件（含 README 与 MANIFEST），492,335,102 字节；`MANIFEST.sha256`（1,710 行）、`INVENTORY-orb.tsv`、`actions-artifacts.tsv` |

Android 目录由 Android 线程打包，原样解入、未改写：首批 33 个分片（整包 128,347,915 字节）与补档 39 个分片（整包 154,158,573 字节，
sha256 `3653fed2…fdcc`）的分片 hash 与整包 hash 都核对通过，tar 内没有符号链接或 `..` 路径；先解首批再解补档后，
`sha256sum -c MANIFEST.sha256` 全部通过（README `3c3f7c12…`、MANIFEST `8d1edeb4…`）。单个文件都不超过 20 MB。

## 两端都要知道的限制

- **Actions artifact 会到期，不是永久归档。** iOS 的 artifact 在 2026-10-31 至 11-02 到期；Android 各 artifact 的到期时间见其
  `actions-artifacts.tsv`。只列 hash 清单、未放入的 Actions 副本，到期后不再有副本。iOS 侧约 1.52 GB（1,642 个 ≤20 MB 的唯一文件）是否
  在到期前补交，需要决定（见 iOS README）。
- **超过 20 MB、未放入**：
  - iOS 17 个：Actions 的大视频（到期前可从 artifact 下载）、`orb-in/artifacts/r2-state-cycle.mp4`（65,585,579 字节，**orb 内唯一**），以及第三方 sing-box 发布包。
  - Android 4 个：两个早期本地构建的测试 APK，**orb 内唯一、无 Actions 副本**，按用户例外未归档——
    - `artifacts/android/tono-mobile-0.3.0-test-df28144.apk`（69,671,990 字节）；
    - `artifacts/android/r2/tono-mobile-0.3.0-test-4bb6536.apk`（69,681,820 字节）。

    另有两个超限的 `libbox-out/x/jni/{arm64-v8a,x86_64}/libbox.so`（46,673,952 / 49,563,328 字节，可由固定源码再生成）。
- **因敏感排除**：
  - Android `lt/client.json`、`lt/cat.json`、`lt/work/server.json`：本地替身出口的测试 UUID、Reality 密钥和 SOCKS 口令，不是 Tono 凭据，但按凭据形态不入库。
  - iOS 检出里的 `services/control-plane/.dev.vars`：未打开、未复制。

## 合入时对两端二进制做的补充检查（iOS 线程执行）

方法与限制写在这里，不把未检查的部分说成安全：

- **图片元数据**：解析了两端全部 3,728 张 PNG/JPEG/GIF。
  - PNG 文本块只有时间戳、尺寸、色彩空间、ICC、`Screenshot` 描述和空 XMP。
  - EXIF 只有像素尺寸、色彩空间、方向、描述与 UserComment，没有 GPS、设备型号、软件或作者。
  - GIF 只有 `NETSCAPE2.0` 循环扩展。
  - 两端 19 段 MP4 的容器标签只有编码器、创建时间与 `com.android.version=14`，没有位置标签。
- **`settings.dat`（7 个，均 40 字节）**：它是 Android 模拟器 `emu-crash-37.2.12.db` 下的 Crashpad 设置文件，已按格式解析：
  - 魔数 `sdPC`，版本 1；
  - options = 0，即未开启崩溃上传；
  - 上次上传时间为 0；
  - 末尾 16 字节是 Crashpad 为这次模拟器安装随机生成的 client UUID，不对应账号，不是凭据。

  解析后确认可以保留，未改动 Android 目录。
- **图片内容（人工目视，不是 OCR）**：
  - 用缩略图拼图逐张看过：
    - 首批两端的全部非抽帧图片（1,417 张）；
    - 视频抽帧中每 5 帧取 1 帧（404 张）；
    - Android 补档 `orb-only/` 的全部 292 张图片。
  - 按原分辨率抽查了含账号、输入框或系统界面的原图，包括：
    - Android 登录页 `real-02-signin-invalid-email.png`（输入为 `not-an-email`）；
    - `orb-only/artifacts/android/r2/screenshots/02-signin-code.png`（`tester@example.com`）；
    - `orb-only/ci1/run13/qsfull.png`（模拟器快速设置：T-Mobile/AndroidWifi）；
    - iOS 设置页（`preview@example.com`）。
  - 结论：只看到模拟器、夹具和设计稿画面，没有发现凭据或个人信息。
  - 限制：缩略图读不出极小文字；视频抽帧其余 4/5 和 MP4 画面没有逐帧看。
- **文本补扫**：对 Android 补档的 166 个文本文件重跑了同一模式扫描，只命中 15 处 email 模式，都是 logcat/dmesg 里的内核版权字符串
  （WireGuard 作者地址、`dm-devel` 邮件列表）。
