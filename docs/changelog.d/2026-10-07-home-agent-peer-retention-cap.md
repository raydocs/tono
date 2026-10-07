## 2026-10-07 · home-agent 历史 peer 基线不再受 inventory 上限约束
- 归属：SHIP_PLAN §2 item 10（0.0.75 修复批次，owner 2026-10-07）；`services/home-agent`。修复 HOME-AGENT-PEER-RETENTION-CAP。
- 来源：main `f2cb79522` → 本 PR。
- 缺陷修复：`validate_state` 把单次 inventory 上限（`MAX_INVENTORY_DEVICES` = 2,000）用于永久保留的 `peerCounters`，而 `attribute_peer_counters` 从不删除退役设备的基线。设备正常退役/重新注册累积到 2,001 条后，`save_state` 抛 `invalid state schema`，之后每一轮 `run_once` 都在报告 POST 与 metering ACK 之前失败，用量报告停止保存和发送。现在持久化基线使用独立的终身上限 `MAX_RETAINED_PEER_BASELINES` = 20,000，`MAX_STATE_BYTES` 从 1 MiB 提到 16 MiB（20,000 条最长 ID 的基线约 7.5 MB）。不删除任何基线：暂时离线的 peer 回来时不会被重新计费历史流量。
- 新增/优化：即使达到 20,000 条终身上限，agent 也继续报告：已有基线的 peer 照常计量；没有基线的新 peer 本轮不计费、不写基线，并在 stderr 打一行警告。不写基线就不能证明下一轮的增量，所以只能不计费，不能重复计费。
- 工程与测试：`test_report_example.py` 新增 `test_retired_peer_baselines_beyond_inventory_limit_do_not_stop_reports`：用真实 `save_state` 存 2,000 条合法基线，再经 `main()`（mock inventory 与 tailscale status）观察一个新 stable ID，断言新用户的报告被发送、metering ACK 发出、状态保存为 2,001 条。
- 验证（MacBook，Python）：旧代码上该测试失败（`RuntimeError: invalid state schema`）；新代码 `python3 -I services/home-agent/test_report_example.py` 27/27 OK（CI 的 services-ci 同一命令）。
- 候选/发布：无新包，仅源码。reporter 尚未部署。
- 剩余限制：达到 20,000 条终身上限后的新 peer 不计费（少计，不多计），该分支没有单独回归测试；安全清理退役基线仍需要计数连续性设计，本 PR 不做。
