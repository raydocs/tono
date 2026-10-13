## 2026-10-13 · Sparkle 2.9.6 → 2.10.0（离线 sign_update 签名工具）
- 归属：ops 工具链漂移 Issue #257（所有者 2026-10-13 决定现在升级，不等 0.0.75）；macOS 发布信任（appcast / Ed25519 签名）。
- 来源：基线 `origin/main` 358fd9da1 → 分支 `claude/toolchain-sparkle`；PR 见 GitHub。
- 缺陷修复：无。
- 新增/优化：Sparkle 钉从 2.9.6 升到 2.10.0。Tono.app 已不内嵌 Sparkle（pbxproj 无 `XCRemoteSwiftPackageReference`，`test_sparkle_tool.py` 断言这一点），所以真正生效的钉是离线签名工具：`Sparkle-for-Swift-Package-Manager.zip` 的 URL 与 SHA-256（`17e28312…d959`，与 2.10.0 `Package.swift` 的 binaryTarget checksum、GitHub 发布页 digest 三者一致），出现在 `macos-release.yml`、`desktop-update-sign.yml`、`release-macos.sh` 和三个测试里。`Package.resolved`（2.10.0，`eef1a539…`）与 `THIRD_PARTY_NOTICES.md` 版本同步。`Sparkle-LICENSE.txt` 与 2.10.0 的 `LICENSE` 逐字相同，不改。
- 工程与测试：已读 2.9.6→2.10.0 发布说明：最低系统升到 macOS 12、移除 CocoaPods、安装器/增量更新修复；没有 EdDSA 签名格式、appcast 格式或 `sign_update` 命令行的变化。Tono 自己生成 appcast（`publish-macos-appcast.mjs`），不用 Sparkle 的 `generate_appcast`，所以 `minimumSystemVersion` 提示不适用。`bin/sign_update` 与 `bin/old_dsa_scripts/sign_update` 的目录结构不变（`find-sparkle-sign-update.py` 仍只会选到一个现代签名工具）。
- 验证：见 PR 的 Verification。本机 `python3 tooling/scripts/tests/test_sparkle_tool.py` 7 个通过。
- 候选/发布：无新包，仅源码。`macos-release.yml` 与 `desktop-update-sign.yml` 的签名步骤不在 ci-gate 里运行，首个使用 2.10.0 签名工具的候选 / 清单签名才会真正证明。
- 剩余限制：`THIRD_PARTY_NOTICES.md` 写着「Tono embeds Sparkle」，但 App 已不内嵌（只用离线签名工具）；措辞没改，只改了版本。`docs/UPDATE_PROTOCOL_V1.md` 里「pinned Sparkle 2.9.6 public delegate」是对 2.9.6 公共 delegate 的历史分析，没改。
