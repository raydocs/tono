## 2026-10-27 · exit-agent 计量账本写入时即为 0600
- 归属：运维计划（出口节点隐私）；`services/exit-agent/reconcile_and_report.py` `save_state`，测试 `test_reconcile_and_report.py`；发现 `docs/findings.d/EXIT-LEDGER-WRITE-MODE.md`。
- 来源：分支 `amp/exit-agent-ledger-0600`（基线 origin/main `27108ce9e`）；未合 main；节点未更新。
- 缺陷修复：账本临时文件原先按 umask（常见 0644）创建、写完 fsync 后才 chmod 0600。现在用 `O_CREAT|O_TRUNC|O_NOFOLLOW` 以 0600 打开，并在写任何字节前 `fchmod` 收紧遗留的 `.new`；fsync → rename → 目录 fsync 的顺序不变。
- 新增/优化：无。
- 验证：新回归在旧代码上失败（写入时 0644），新代码通过；`python3 services/exit-agent/test_reconcile_and_report.py` 129 个测试通过，`test_systemd_cadence.py` 通过。未在真实出口节点上运行。
- 候选/发布：仅源码；需按现有流程把 exit-agent 部署到各节点后生效。
- 剩余限制：状态目录权限未改（文件内容已不可读）。
