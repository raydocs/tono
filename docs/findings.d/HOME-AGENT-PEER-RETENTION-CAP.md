| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| HOME-AGENT-PEER-RETENTION-CAP | 累积保留的历史 peer 基线超过 2,000 后，新的用量报告无法保存和发送 | in-PR | [R3-E2T2 audit](../agent-reports/R3-E2T2-codex-sol-20260930.md)；[#1439](https://github.com/raydocs/tono/pull/1439) | 中·已确认 | P2；reporter 尚未部署。安全清理需要计数连续性设计，不能直接删除离线 peer 后重新计费其历史流量。#1439：终身基线上限独立为 20,000（状态文件 16 MiB），不删除基线；达到上限后新 peer 不计费只告警（少计不多计） |

`services/home-agent/report_example.py:148` 将当前 inventory 的数量限制用于永久保存的 `peerCounters`。`:488–507` 只添加或更新基线，不删除历史 stable ID。因此正常设备退役/重新注册可让只有一个当前 peer 的状态累积到 2,001 条。

fixture 调用真实 `load_state`、`attribute_peer_counters` 和 `save_state`：先成功保存 2,000 条合法基线，再观察一个新的 stable ID。内存中变为 2,001 条，`save_state` 抛出 `invalid state schema`；磁盘仍有 2,000 条。`run_once` 的新报告 POST 与 metering ACK 位于保存之后，因而每次后续观察都会在同一处失败。

这是 lifetime retention 与当前 inventory 上限混用的问题，区别于已知 issue #5 的 counter generation。删除暂时不在 inventory/status 里的基线可能在 peer 返回时把原始历史重新计费；本轮不做未经证明安全的计费修复。报告记录源代码及 fixture 证据，无实机、部署或发布操作。
