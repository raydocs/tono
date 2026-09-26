## 2026-09-26 · macOS 发布门改查实际嵌入的 sing-box 核心
- 归属：SHIP_PLAN G3/G4（客户 0.0.74 发布前置）；影响 `tooling/scripts/verify-release-gate.sh`、macOS CI policy-tests。发现 REL-GATE-MAC。
- 来源：基线 origin/main `184b1a0c`；分支 `fix/macos-release-gate-singbox-20260926`（红 `b81e0c82`，仅测试，macOS CI run 36228978135 的 policy-tests 以该断言失败），PR 待开；未合 main。
- 缺陷修复：发布门对嵌入可执行文件逐个核对 Developer ID 签名，清单仍是 `tono-core-helper` 与 `mihomo`；App 的 Embed Executables
  （`project.pbxproj`，dstSubfolderSpec 7 即 Resources）只嵌入 `sing-box` 与 `tono-core-helper`，于是任何真实发布包都会报
  「missing embedded executable: Contents/Resources/mihomo」。现在清单改为 `sing-box`，并对它额外要求签名标识 `sing-box` 与 hardened runtime
  （与「Pin sing-box codesign identifier」构建阶段的发布签名一致）。每个嵌入文件仍只输出一条 `ok:`，`release-macos.sh` 的 6 条计数不变。
  不跳过检查，也不加假的 mihomo。
- 新增/优化：无。
- 工程与测试：新增 `tooling/scripts/tests/test_macos_release_gate_core.py`（解析 pbxproj 的 Embed Executables 阶段，断言门的清单与其一致），
  接入 `macos-ci.yml` policy-tests。
- 验证：MacBook 上 `python3 tooling/scripts/tests/test_macos_release_gate_core.py`：修复前失败（mihomo ≠ sing-box），修复后通过；
  `sh -n` 通过；用 ad-hoc 签名的假包跑门，缺失与 ad-hoc 两种失败都正确报出且不因 `set -e` 中途退出。
  本机没有 Developer ID 身份，签名通过路径未运行；修复以 PR 的 macOS CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：门的 Developer ID 通过路径（含新加的标识与 hardened runtime 检查）只能在签名主机上对真实发布包验证。
