| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-CURSOR-UNICODE-LIMIT | 已接受的长 Unicode 节点名超过游标编码/解码上限，分页 500 或后页 400 | fixed(9b9bdc0c) | hunt/sol-cp-unicode-node-cursors | P2·已复现 | 长合法名称的少见触发；不改变名字校验或游标格式 |

Residual after #770: 86–88 Chinese characters can emit a token exceeding the decoder cap; 89+ exceed the encoded-part cap. One API regression creates two legitimate 200-character node profiles, then fetches both pages. Before the fix the first GET returns 500. Bounds now cover the percent-encoded and base64url worst case of supported names: 1800 per part and 4802 per token.
