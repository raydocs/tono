| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-ROUND-DEADLINE | Xray API 卡住时，每次 CLI 调用等 30 秒，listing 超时后仍逐个尝试全部新增，一轮可达 30×(N+1) 秒（46 个身份 23.5 分钟），期间 flock 挡住后续 timer | in-PR | [#1378](https://github.com/raydocs/tono/pull/1378) | 中·已确认（审计 F-D5，Codex 复核 PARTIAL） | 只截断新增；撤销仍逐个执行，撤销很多时一轮仍是 N×30 秒，需另行设计。CLI 单次 30 秒、HTTP 20/30 秒及 usage 退避仍无整轮总截止。仓库内无 deployed agent service，不能排除 systemd 外层截止；未部署、未在真实节点验证 |

Codex 复核纠正：mutation 失败在 stats 之前就抛 Refusal，不会进入 counter 读取或 marker 重试，报告的「重试加倍」不成立。「listing 一超时就停止所有 RPC」会破坏撤销，未采用。

修复：`services/exit-agent/reconcile_and_report.py` `reconcile` 中，新增调用第一次 `subprocess.TimeoutExpired` 后停止余下新增：超时的标签照旧保守记入库存（可供后续撤销），再记一条「remaining adds skipped」失败，整轮以 Refusal 结束、不 ACK。撤销先于新增、仅完整对账后 ACK、listing 超时仍按持久库存撤销三条不变量不变。OSError 仍逐个继续。
