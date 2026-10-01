| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-GUID-CASE | Windows DNS 恢复证明用区分大小写的 GUID 比较：用户本地解析器失去实时证明豁免，断开/解除被永久拒绝，或仍在场的网卡被当作消失 | in-PR | 分支 `codex/win-dns-restore-guid-case` | 中·已确认（Linux 回归改前失败） | 四处比较统一不区分大小写；Windows 真机未验证 |

来源：GLM-5.3 bug hunt #2（`dns/mod.rs` ~1029-1046、1074-1088、1107-1120，main `ba7c8ae1`）。
