## 2026-10-16 · 0.0.76 双端客户测试候选准备

- 归属：SHIP_PLAN G1–G3 测试候选；所有者最新授权「直接升级，升级最新的我给客户测试」。不是稳定验收或 G4 正式更新源推进。
- 来源：安全主线 [71d33e8](https://github.com/raydocs/tono/commit/71d33e8f80bc265c3ffb45d25754370bc9e2f0c3)；分支 `release/desktop-0.0.76-test-20261016`。最终构建源码、run、哈希和签名结果在实际产生后续记。
- 缺陷修复：无新运行时改动；已有 #1569/#1591/#1599/#1646/#1648/#1659 等主线成果进入新候选，不重复计为本 PR 修复。#1504/#1605/#1643/#1571/#1572 不合入。
- 新增/优化：双端营销版本 0.0.76，Mac build77；新候选命名空间，不覆盖 0.0.75 等已有资产。两端拟用相同 releaseSequence 7601，签名/公证使用既有受控流程。
- 工程与测试：同步 Windows 四处版本（通过既有 release-version 脚本）、Mac 两个配置、候选 workflow/artifact/manifest 守护和中英发布说明。分支、密钥、权限、签名门禁不放宽；正式 feeds 和 v1 latest 不动。
- 验证：Linux Orb 定点检查通过：`verify-desktop-version.py --expected 0.0.76`（source consistency only）、`macos-candidate-workflow.test.rb`（11 个分支案例、无效序列/错误源码/旧包/权限守护，synthetic unsigned fixtures）、`node --test tooling/scripts/tests/windows-ci-paths.test.cjs`（14 pass / 0 fail）、`git diff --check`。准确 head 的 ci-gate、真正构建/签名/公证与产物核验另记，尚未执行者不计通过。无新行为回归，不伪造红检查。
- 候选/发布：本提交仅准备源码；客户测试包待 hosted 构建。以新 prerelease 分发手动安装包，不把 GitHub prerelease 称为稳定客户频道。
- 升级边界：先在旧客户端恢复网络并退出，再手动覆盖；Windows 0.0.32–0.0.34 的 legacy 文件名风险仍按既有方案先正常卸载、重启再装，未实机复现，不承诺直接覆盖。其它旧版本覆盖与 G3 成功/故障待用户实测。
- 剩余限制：#1071 未修；#1605 的 DNS fallback 与 #1643 多用户接管未包含；Windows 现有 updater 签名不等于 Authenticode；没有新的真机验收、稳定发布或全量更新源授权。
