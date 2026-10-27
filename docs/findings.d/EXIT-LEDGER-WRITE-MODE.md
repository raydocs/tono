| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-LEDGER-WRITE-MODE | 出口 exit-agent 的计量账本（`TONO_AGENT_STATE`，含客户标签、累计用量与待发报告）写到 `state.json.new` 时按默认 umask 建文件（systemd 默认 0022 → 0644），写完并 fsync 后才 chmod 0600；写入期间同机其他本地用户可读，崩溃留下的 `.new` 一直是 0644，且旧 `.new` 若是符号链接会被跟随 | in-PR | 本 PR | 低·已确认 | 只修写入时的权限；状态目录本身仍由 `mkdir` 按 umask 建（常见 0755），文件名可见但内容不可读；已部署节点上已存在的 0644 `.new` 在下一次保存时收紧；需在节点上更新 exit-agent 才生效 |

审计发现（2026-10-27，安全与隐私第三轮）。回归 `test_save_state_never_writes_the_ledger_readable_by_others`（`services/exit-agent/test_reconcile_and_report.py`）在 umask 0022 下于旧代码失败：写入时 fstat 得到 0644（`[420] != [384]`）。同文件的名册缓存、锁文件、`adu` 临时文件本来就以 0600 创建，账本是唯一例外。
