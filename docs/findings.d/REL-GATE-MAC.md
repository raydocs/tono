| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REL-GATE-MAC | macOS 发布门 `verify-release-gate.sh` 仍要求 `Contents/Resources/mihomo`，而 App 的 Embed Executables 只嵌入 `sing-box` 与 `tono-core-helper`（mihomo 被排除）：任何真实发布包都会在门上失败，0.0.74 发布前置 | in-PR | [#659](https://github.com/raydocs/tono/pull/659) | 中·已确认 | 静态核对；Developer ID 签名下的通过路径只能在签名主机上跑 |

来源：astra6，2026-09-26（G1–G3 kit 计划 v2 的 M1，前置 PR-4）。
