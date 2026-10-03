## 2026-10-03 · macOS：包里不再带过期的 `core-identity.json`
- 归属：SHIP_PLAN §2 第 10 项（R6 打包扫描 R6-5，Issue #1322）；所有者 2026-10-03「按你说的做」的收尾项。只删 `apps/macos/Tono/Resources/core-identity.json`。
- 来源：基线 main `bb7317c6` → 分支 `chore/macos-drop-stale-core-identity-20261003`；尚未合入 main。
- 缺陷修复：无（没有任何 Swift 代码或脚本读取这个文件，客户运行时不受影响）。
- 新增/优化：无。
- 工程与测试修正：这个文件写着 `1.15.0-alpha.3-tono-m1.1` 和 `6c86720c…`，而实际打进包的 sing-box 是 alpha.9（`verify-macos-sing-box.sh`、`prepare-macos-sing-box.sh` 钉的是 `ab0187a7…`）。签名包里放一份错的来源说明只会误导排查。Issue 给了两种修法（重新生成，或不再发布）；选「不再发布」：内核的真实来源由打包脚本钉的摘要和 `tooling/scripts/sing-box/manifests/alpha9/darwin-arm64.json` 负责，不需要第二份会过期的副本。工程用的是同步文件夹（pbxproj 里没有这个文件的条目），删掉文件即不再进包。Windows 的 `src-tauri/core-identity.json` 有校验和使用方，没动。
- 验证：`grep -rn core-identity apps/macos tooling/scripts/*macos* .github/workflows/*macos*` 无命中；macOS 构建和测试由 CI 跑（本机不跑 xcodebuild）。没有新增测试（没有行为可测）。仅源码，无新候选；下一个 macOS 候选的 `Contents/Resources` 会少这一个文件。
- Merged: #1373, merge commit `902666e9`, PR head `f7772af4`; ci-gate run 37149668541 green on that head, including `macos / build` and `macos / privileged-tests` (the bundle builds without the file). Issue #1322 closed.
