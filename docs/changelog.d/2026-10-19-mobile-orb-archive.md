## 2026-10-19 · iOS 与 Android orb 资料归档

- 归属：ops 记录（不是 ship gate）；移动端 iOS PR #1672、Android PR #1673 的实现过程资料。
- 来源：`origin/main` `acfb40aa3` → 分支 `docs/archive-mobile-orb-2026-10-19`，只加 `docs/agent-reports/archive/` 下的文件；未合 main。
  两个功能分支没有改动或推送；iOS 检出 `feat/ios-singbox-horizon` 停在已推送的 `3ab870ef0`，工作区干净。
- 缺陷修复：无。
- 新增/优化：
  - 把只在 orb 里的报告、评审草稿、派生截图、脚本、日志和 Actions artifact 副本逐字节放入 `2026-10-19-ios/` 与 `2026-10-19-android/`。
  - 每个目录都附 README、清单、sha256 与来源；说明见 `docs/agent-reports/archive/2026-10-19-mobile-README.md`。
- 工程与测试：无代码改动。iOS run 39211006109（`3ab870e`，暂停前已在运行）后来以绿 33/33 结束；只记录，未下载、未检查截图。
- 验证：
  - 两个目录的 `sha256sum -c MANIFEST.sha256` 都通过。
  - Android 分片 hash 和整包 hash 都核对通过。
  - 所有文本文件做了凭据模式扫描，所有图片做了元数据解析；缩略图目视和原图抽查的范围与限制写在 README 中。
  - 未跑产品测试，也不需要。
- 候选/发布：无。
- 剩余限制：
  - Actions artifact 在 2026-10-31 至 11-02 到期。只列清单的 iOS 较早 Actions 副本（≤20 MB 的唯一文件约 1.52 GB）到期后不再有副本，是否补交待决定。
  - 超过 20 MB 而未放入的 orb 内唯一文件：iOS 的 `r2-state-cycle.mp4`，Android 的两个早期测试 APK。
