## 2026-10-08 · macOS release 工作流在 XCTest 前重建 helper（7504 macOS 构建失败的修法）
- 归属：SHIP_PLAN §2 item 10（0.0.75 候选链路）；平台 macOS（仅 `.github/workflows/macos-release.yml` 与其 ruby 守卫测试，不改产品代码）。
- 来源：候选 7504 的 macOS run [37714743032](https://github.com/raydocs/tono/actions/runs/37714743032)（源码 `e0179bd55`）在「TonoTests XCTest target」失败：`BRICKM1OrdinaryInstallGuardTests.testPendingAttemptRefusesOrdinaryInstall` 运行 bundle 内 `tono-core-helper --update-install-policy-self-test` 得 exit 1、空输出。同一 SHA 的 macOS CI run 37713691305 通过。差异：`macos-ci.yml` 在测试前执行 `tooling/scripts/build-core-helper.sh`，release 工作流只在 `package-macos-test.sh` 打包时重建，XCTest 用的是仓库里提交的 `apps/macos/Tono/Resources/tono-core-helper`（最后更新于 #225，2026-09-17），该旧 helper 不认识 #1444 新增的自检参数。
- 缺陷修复：release 工作流的「Verify unsigned sing-box input」步骤改为同时 `build-core-helper.sh`（与 CI 的「Verify core and build current helper」一致），XCTest 之后的打包步骤照旧再重建一次并签名。
- 新增/优化：无。
- 工程与测试：`tooling/scripts/tests/macos-candidate-workflow.test.rb` 新增一条断言：build job 里执行 `build-core-helper.sh` 的步骤必须排在「TonoTests XCTest target」之前。本机 ruby 运行：修后树 PASS；把工作流换回 main 版本则 abort「the release XCTest step must run after build-core-helper.sh」。
- 验证：ci-gate 在精确 head；jev-route 评审回执见 PR 评论。
- 候选/发布：7504 的 macOS 包不存在；Windows 7504 run 37714752096（同 `e0179bd55`）另记。本修复合入后两端以序列 7505 从同一 main SHA 重建，7504 作废、序列只增。
- 剩余限制：`macos-release.yml` 与 `macos-ci.yml` 的测试前置步骤仍是两份手写副本（本次又同步一处）；折成可复用工作流仍是待办工程项。提交的 `tono-core-helper` 二进制与源码不同步这件事本身未改（CI/打包都会重建；是否从仓库移除该二进制另议）。
