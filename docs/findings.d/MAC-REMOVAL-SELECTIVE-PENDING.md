| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-REMOVAL-SELECTIVE-PENDING | App-removal cleanup deletes the helper after `.released` even when the AI-layer removal (resolver restore or route delete) did not finish, so nothing retries it and the `/etc/resolver` AI sinkhole outlives Tono | in-PR | [#1302](https://github.com/raydocs/tono/pull/1302) | 中·推导（P2） | Removal now reads the system (sinkhole resolver body, blackhole route readback), retries the removal once, and keeps the installation (PF released, DNS restored) while the layer remains; the 10 s idle removal check retries. A corrupt receipt with the sinkhole still present keeps the helper indefinitely; an unrunnable `route get` counts as present. `--emergency-reset` unchanged. Native verification needs hardware. |

Found in the Claude R5 macOS lifecycle hunt (2026-10-01), follow-up to #1283 / #1165 / #1251. Codex gpt-6.1-sol high review of 9a9f34bf: decision moved off the recovery record.
