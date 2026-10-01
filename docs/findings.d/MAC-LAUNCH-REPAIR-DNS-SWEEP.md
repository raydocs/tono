| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LAUNCH-REPAIR-DNS-SWEEP | macOS 启动时 helper 不可用、修复后没有 DNS 快照就跳过恢复，核心已停而遗留的 `127.0.0.1` 解析器让用户无法解析域名 | in-PR | 分支 `codex/macos-launch-repair-dns-sweep` | 中·推导（触发窄，影响为断网级） | 修复后只要 recheck 可用就请求恢复；需托管 macOS CI，强杀窗口未实机复现 |

来源：GLM-5.3 bug hunt #6（`RuntimeCleanup.swift` ~376-416，main `ba7c8ae1`）。
