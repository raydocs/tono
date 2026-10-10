## 2026-10-10 · 发布收口评审 minor 记账：三条 open 发现 + api-relay 读路径时限更正
- 归属：SHIP_PLAN 0.0.75 收口（不是 ship gate 证据）；来源 #1523、#1507 的 GPT-6.1 Sol 终审回执（PR 评论）。
- 来源：基线 main `1697303b` → 分支 `amp/release-0075-closeout-index`。
- 缺陷修复：无代码改动。
- 新增/优化：新增发现分片 [MAC-CP-RETRY-OLD-ORDER](../findings.d/MAC-CP-RETRY-OLD-ORDER.md)（#1523 M1）、
  [MAC-CP-PINNED-SILENT-WAIT](../findings.d/MAC-CP-PINNED-SILENT-WAIT.md)（#1523 M2）、
  [MAC-UPDATE-RETAIN-NO-RELAY](../findings.d/MAC-UPDATE-RETAIN-NO-RELAY.md)（#1507 M1，#1507 之前已存在），状态均为 open。
  [api-relay.md](../ops/api-relay.md)「macOS sign-in budget」把「读请求最多 25 s 到中继」限定为 pinned 连接失败时；
  pinned 接受连接却不应答时约 60 s。
- 工程与测试：仅文档；`node tooling/scripts/records.mjs findings --id MAC-UPDATE-RETAIN-NO-RELAY` 能读到分片。
- 候选/发布：仅文档，无新候选。
- 剩余限制：三条发现都未修、未在实机复现；0.0.75 发布说明是否提及由收口索引 PR 决定。
