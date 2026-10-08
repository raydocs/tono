## 2026-10-08 · macOS 首装 DMG（拖到「应用程序」的引导窗口）
- 归属：G4（0.0.75 客户发布的首装入口）；macOS 打包与发布页。
- 来源：main e99678129 → 本 PR；未合 main 前不进发布流程。
- 缺陷修复：MAC-FIRST-INSTALL-NO-DRAG-GUIDE。首装只发 zip，用户在「下载」里双击后被 /Applications 守卫拦下退出，弹窗提到的「安装窗口」并不存在。改后首装下载签名、公证并装订的 DMG，窗口里是 Tono.app、箭头和「应用程序」，背景写着中英文的拖拽说明。
- 新增/优化：`.github/workflows/macos-dmg.yml`（手动触发，输入 macos-release 运行号 + 已验收 zip 的 SHA-256）调用 `tooling/scripts/make-macos-dmg.sh`。脚本校验 zip 哈希、签名、装订，用钉死哈希的 dmgbuild 1.6.7 排版；签名、公证、装订后挂载镜像，逐文件比对 Tono.app 与 zip 内的一致，不一致就失败。app 字节不变，候选身份（7505 zip 哈希）不变；Sparkle 仍用 zip。`generate-release-center.mjs` 在 mac tag 带 `<zip 同名>.dmg` 时，下载按钮改指 DMG，manifest 记 `diskImage`。`RELEASE_LINES.md` G4 macOS 第 2 步加上 DMG 上传。
- 工程与测试修正：`generate-release-center.test.mjs` 新增一条（带 DMG 时链接 DMG、不出现 zip），旧代码上失败、新代码上通过。DMG 工作流的实际签名/公证运行结果见下方续记。
- 新记录：MAC-RENAMED-BUNDLE-NO-UPDATE、MAC-0067-HELPER-HANDOFF-UNTESTED（open）。
- 包：无新 app 候选；DMG 是 7505 zip 的第二个容器。
