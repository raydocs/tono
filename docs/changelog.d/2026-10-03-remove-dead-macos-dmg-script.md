## 2026-10-03 · 工具：删掉没人调用、也跑不通的 `package-macos-dmg.sh`
- 归属：SHIP_PLAN §2 第 10 项（R6 打包扫描 R6-7，Issue #1324）；所有者 2026-10-03「按你说的做」的收尾项。只动 `tooling/scripts`。
- 来源：基线 main `bb7317c6` → 分支 `chore/remove-dead-macos-dmg-script-20261003`；尚未合入 main。
- 缺陷修复：无（客户运行时不受影响）。
- 新增/优化：无。
- 工程与测试修正：`tooling/scripts/package-macos-dmg.sh` 要求并校验 `Contents/Resources/mihomo`，现在的包里只有 `sing-box`，脚本一定失败；仓库里没有任何工作流、脚本或文档调用它（`grep -rn package-macos-dmg` 只剩 R6 报告那一行）。按「删除过期内容」直接删除。真正的 macOS 打包路径（`package-macos-test.sh`、候选工作流）没动。以后要 DMG 再按 sing-box 重写。
- 验证：删除前 `grep -rn package-macos-dmg .` 只命中 R6 报告。没有新增测试（没有行为可测）。仅源码，无新候选。
