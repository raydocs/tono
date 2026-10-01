| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-SESSION-REWIND | 延迟的会话开始上传清空已结束会话的结束时间、字节数和结果 | in-PR | hunt/sol-cp-diagnostic-session-terminal | P2·已复现 | 不排序两个已结束报告；开始中的更新及结束报告更正保持 |

The session UPSERT ignores unfinished uploads once `ended_at_ms` is set, while keeping the account guard. One API regression uploads a completed session and then its delayed initial report; the completed projection must remain intact. Before the fix every terminal field is reset.
