| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-EXCERPT-PRIVACY | 自动诊断日志片段仍明文保存 IPv6 和 token，违反结构化诊断隐私边界 | fixed(7264d036) | hunt/sol-cp-diagnostic-excerpt-privacy | P2·已复现 | 当前原生客户端未调用新 bundle；旧片段不追溯删除，沿用保留期 |

Automatic intake now stores null for the compatible optional excerpt field, retaining its existing validation and all structured facts. Arbitrary log text cannot be made destination/credential-free by a regex allowlist. The separate operator-granted raw-log route remains available, following the existing privacy decision. One regression demonstrates literal IPv6/token storage before the fix and their omission afterward without dropping session facts.
