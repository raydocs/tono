| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| AI-DIRECT-SUFFIX-GUARD-GAPS | 两端与控制面直连保护名单遗漏既有助手服务，签名策略可能使受保护流量走物理出口 | in-PR | #797 | 高·推导 | needs-hardware；Swift/Xcode 与 Windows Rust 未运行；Worker vitest 全量通过；契约脚本 5/5；仅源码，无新候选 |

macOS 与 Windows 在显式保护名单之外追加既有住宅路由域名集合，控制面以独立集合补齐；显式名单是跨平台签名契约（`test-policy-signing-contract.sh`），保持不变；保留全部旧保护及后缀父子重叠拒绝。离线实际源码检查通过，原生与真实路由证据待 hosted CI / 实机，交付记录见 [2026-09-30 更新条目](../changelog.d/2026-09-30-ai-direct-suffix-guard.md)。未查看线上策略；已存策略若包含新增保护项，会被现有读取校验拒绝。标准 fail-open 释放路径未改，失败后的 AI 阻断由独立 PR #738 交付。
