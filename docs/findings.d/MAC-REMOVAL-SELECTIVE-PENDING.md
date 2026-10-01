| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-REMOVAL-SELECTIVE-PENDING | App-removal cleanup deletes the helper after `.released` even when the AI-layer removal (resolver restore or route delete) stayed pending, so nothing retries it and the `/etc/resolver` AI sinkhole outlives Tono | in-PR | 待开 | 中·推导（P2） | Removal now keeps the installation (PF released, DNS restored) while the removal is pending; the 10 s idle removal check retries. `--emergency-reset` unchanged. Native verification needs hardware. |

Found in the Claude R5 macOS lifecycle hunt (2026-10-01), follow-up to #1283 / #1165 / #1251.
