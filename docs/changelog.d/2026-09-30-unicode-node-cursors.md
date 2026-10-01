## 2026-09-30 · 游标上限匹配合法 Unicode 节点名称
- 归属：control-plane ops 分页合同。
- 来源：origin/main `a864a9ca` → `hunt/sol-cp-unicode-node-cursors`，本 PR；尚未合 main。
- 缺陷修复：#770 后仍有合法长中文名称导致编码 500 或游标解析 400 → 游标按 200 UTF-16 长度名称的 percent/base64url 最坏扩展配置上限。关联 SOL-CP-CURSOR-UNICODE-LIMIT；长 ASCII 邮箱已由 #770 修复，不重复报告。
- 新增/优化：无；游标格式、冒号编码、名字校验和非法游标错误保持。
- 工程与测试：一条真实 API 创建两条 200 字符节点资料并逐页读取回归；原代码首 GET 500，修改后两页可用。
- 验证：Linux / Node24；ops-api、ops-http 完整文件及 typecheck，详见 PR；未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：少见长名称触发；没有 UI 或实机操作。
