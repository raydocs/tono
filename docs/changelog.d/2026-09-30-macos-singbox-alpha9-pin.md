## 2026-09-30 · macOS sing-box 安装针从 alpha.3 改到 alpha.9
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；只改 `prepare-macos-sing-box.sh` 和 `verify-macos-sing-box.sh`。不改连接、PF 或失败打开的 Swift 行为。
- 来源：叠在 alpha.9 认证提交 `80268dec` 上；分支 `cursor/macos-singbox-alpha9-pin-01d4`；未合 main。上游 `v1.15.0-alpha.9` / `132b38e9caaba1a1959354d518e54d2d08419afe`。
- 缺陷修复：无。
- 新增/优化：无客户行为。CI 安装的 darwin-arm64 核心改为横幅 `1.15.0-alpha.9-tono-a9.1`，二进制 SHA-256 `ab0187a774e2515e7e6761e23ece0b656818cb4c31c983070b3fd023db172258`。清单 SHA-256 `4932227756b774f2132f272878d554574584c7ebb69454c3c3ae44ccd1e1a40c`。
- 工程与测试：沿用现有 macOS CI：编出核心后，XCTest 把产品 JSON 写到 `TEST_RUNNER_TONO_EMIT_SINGBOX`，再对该文件跑 `sing-box check` 和 helper `--runtime-contract-check`。本机不能跑 XCTest。
- 验证：Linux 上重跑 `prepare-macos-sing-box.sh`，认证 `build`/`verify` 均为 ok，二进制与清单 SHA 与上面两行一致。该文件是 darwin-arm64，本机不能执行。`sh -n` 通过。macOS CI 的 XCTest 发出 JSON 后的 `check`、以及 Mac Studio 浸泡，都未在本机运行。
- 候选/发布：仅源码针脚，无新客户包。`release.json` 仍记录 alpha.3，选定身份要等浸泡后再换。
- 剩余限制：needs Mac Studio soak before release。发布前不能把这颗核心当客户候选。
