| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-RETIRED-ROLLBACK | Windows 原生更新发布失败回滚后，`.rollback` 副本（已等于还原后的字节）在已验证 Disconnect 退休时不删除；下一次更新在 consume 之后的 `CoordinatedBinaryReplacement::prepare` 遇到它即拒绝，该设备此后每次原生更新都失败 | in-PR | [#657](https://github.com/raydocs/tono/pull/657) | 中·已确认 | 修复只清与当前安装字节相同的副本，以及已退休回滚尝试的保留计划能证明的 `.publish` 暂存文件（new digest 相符、目标已回到 old digest）；其他仍拒绝（fail-closed 不变）；未实机 |

来源：G3 只读计划的推测（`core/update.rs` 退休 RolledBack 不动文件；`install_service.rs` `prepare` 严格拒绝残留）。
红分支 `wip/win-update-after-rollback-red`（`c306b0e9`，仅测试）windows-ci run 36227225468 以断言失败：
`second update refused Tono.exe after a retired rollback: a previous runtime replacement left recovery file ...Tono.exe.rollback`（28 passed，1 failed）。

续修（#657 评审 4981e1fa opus:F1）：发布改名失败留下的 `.publish` 装新字节，第一版不清；现由执行器预清理按已退休回滚尝试的计划证明后删除。
红分支 `wip/win-update-after-rollback-red2`（`0ea6ad23`）windows-ci run 36228989902 以断言失败（29 passed，1 failed）。
