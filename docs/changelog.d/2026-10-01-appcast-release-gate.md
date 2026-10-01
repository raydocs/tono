## 2026-10-01 · Sparkle 发布先过 macOS 发布门
- 归属：SHIP_PLAN §2 第 10 项。发布工具。
- 来源：main `4453e258`。分支 `cursor/appcast-require-release-gate-d3c7`。未合 main。
- 缺陷修复：`publish-macos-appcast.mjs` 在 dry-run 和真正写 feed 之前都跑 `verify-release-gate.sh`。`macos-release.yml` 的构建作业同样跑这道门。`release-macos.sh` 改为使用门脚本的退出码，不再只数 `ok:` 行。关联 REL-APPCAST-GATE。
- 新增/优化：无。
- 工程与测试：`sparkle publish refuses an app the release gate does not accept`。
- 验证：修复前该测试退出码是 0，feed 被写上。修复后 `node --test tooling/scripts/tests/publish-macos-appcast-gate.test.mjs tooling/scripts/tests/publish-macos-appcast.test.mjs` 27 passed。bash 复现：六条 `ok:` 且管道退出 1 时，旧的 `>= 6` 判断打印 PASS。
- 候选/发布：仅源码，无新候选。
- 剩余限制：门检查的是 `--app`，不是 zip 里的另一份包。未实机，未跑 `macos-release` workflow。
