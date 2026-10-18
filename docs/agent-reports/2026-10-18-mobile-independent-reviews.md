# 2026-10-18 移动端独立盲审（iOS #1672 / Android #1673）

两份报告及其证据清单按评审线程交付的原文逐字提交，未修改任何评分、结论或文字（下表 SHA-256 与下载文件一致）。

| 文件 | 评审 | SHA-256 |
|---|---|---|
| `2026-10-18-mobile-opus-5-5.md` | Claude Code `claude-opus-5-5`：iOS 83、Android 79.5 | `4bf68d13913ca090e95591a733ec15933c9ef64abd47ead333a6e4dd4eb6107a` |
| `2026-10-18-mobile-opus-5-5-evidence.md` | Opus 证据清单 | `868f1547e76e5ba6218c2e7a195614d7eee5c98372635d66b716086be3f9d2b3` |
| `2026-10-18-mobile-gpt-6-1-sol.md` | GPT-6.1 Sol：iOS 83、Android 83 | `cf82a44955439d0f168ca4bd53fe3b04e2bc62286139cf36c517cab0ad562fd9` |
| `2026-10-18-mobile-gpt-6-1-sol-evidence.json` | GPT-6.1 Sol 证据清单 | `f4c005bbafbabbe69eb7c69a23cf165bc3438d7b5bf2c89c3ef0b635180baaac` |

## 不是同基线 A/B

两份报告的证据截止时间和所看 head 不同，分数不能直接相减比较：

| | GPT-6.1 Sol | Claude Opus 5.5 |
|---|---|---|
| 证据截止 | 2026-10-18 06:46:05 UTC | 2026-10-18 07:19:08 UTC |
| Android head | `ddc3d343f`（run 39103789541，20/21，s1 失败）；视觉基线为最近全绿 `0a65ffd10`（run 39098920328，21/21） | `c53eba6a5`（run 39105266597，模拟器掉线，13/21 与 19/21，l1 未运行）；对照 `ddc3d343f` 与 `0a65ffd10` |
| iOS head | `159ebad32`（run 39103718199 截止时仍在运行）；视觉基线为最近全绿 `1b7e9836b` | `159ebad32`（run 39103718199 已失败，14/15） |

两位评审互不知情，均未读取对方报告。报告中的本地路径（`/tmp/...`、`.amp/in/...`）指评审各自的工作环境，不在本仓库内。
