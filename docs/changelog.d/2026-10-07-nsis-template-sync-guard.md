## 2026-10-07 · NSIS 模板与 @tauri-apps/cli 版本同步守卫
- 归属：运维计划（构建链回归守卫，不是发布门）；`apps/windows/app` 打包测试。来自 [#1431](https://github.com/raydocs/tono/pull/1431) 的剩余限制。
- 来源：main `a990641df` → 本 PR。
- 缺陷修复：无产品缺陷。
- 新增/优化：无运行时改动。
- 工程与测试：`packages/windows/installer.nsi` 是 tauri-bundler 模板的 fork，但 `utils.nsh` 仍由 bundler 在构建时提供；#1421 把 `@tauri-apps/cli` 2.11.5 → 2.12.1 时没有对照上游模板，7502 Windows 候选在 `makensis` 失败。本 PR 在模板头部加 `; TEMPLATE_SYNCED_WITH_TAURI_CLI <version>` 标记，`windows-packaging.test.mjs` 新增一条测试：`package.json` 的 `@tauri-apps/cli` 必须等于标记版本，且 2.12 契约成立（`!include "Win\RestartManager.nsh"`、两处 `CheckIfAppIsRunning` 传 `"$INSTDIR\${MAINBINARYNAME}.exe"`）。以后升 cli 必须先 diff 上游 `crates/tauri-bundler/src/bundle/windows/nsis/` 再改标记，否则 CI 红。
- 验证（MacBook，Node）：`node --test apps/windows/app/scripts/windows-packaging.test.mjs` 39/39；红测证明：标记改为 2.11.5 → 1 fail（`@tauri-apps/cli is 2.12.1 but installer.nsi was last synced with 2.11.5`）；一处调用改回裸 exe 名 → 1 fail（strict equal）；恢复后 39/39。
- 候选/发布：仅源码。不影响 7503 候选（`a990641df`）的包字节；不重出。
- 剩余限制：守卫只约束「版本号对得上」和 2.12 的两条已知契约，不能发现上游下一版引入的其它模板变化；那一步仍靠升级时的人工 diff。`macos-release.yml` 与 `macos-ci.yml` 的 XCTest 步骤复制仍是两份，合并为 reusable workflow 另开 PR。
