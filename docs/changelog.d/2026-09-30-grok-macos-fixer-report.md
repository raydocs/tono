## 2026-09-30 · macOS 开放缺陷清点（Grok fixer）

- 归属：运维记录，非 SHIP_PLAN 发版门，也不是 ops 计划里的客户运行时改动。
- 来源：对照 `origin/main` `c32c087e` 的开放 Issue；分支 `cursor/grok-macos-fixer-report-f6c6`；仅文档。
- 缺陷修复：无。开放列表里没有一条 macOS 缺陷是既已核实、又可以在不改动武装网络行为、不猜签名身份、不改钥匙串访问组的前提下修的。
- 新增/优化：`docs/agent-reports/grok-fixer-macos.md` 记下跳过原因。#331（PF 只能按 UID，helper 重设计已被所有者拒绝作为发版条件）、#409（data-protection keychain 会让现有会话不可读）、#422（飞书/Lark 签名身份必须实机采集）保持开放。
- 工程与测试：无产品代码。
- 验证：`gh issue list` / `gh pr list` 只读。无测试命令。
- 候选/发布：无新包，仅文档。
- 剩余限制：#331、#409、#422 仍要实机或产品决定；本条不关闭它们。
