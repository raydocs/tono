## 2026-10-22 · 目录发布补齐两桌面客户端名称集合准入（C3-PC-F3）
- 归属：ops plan [§7.2 目录 schema 与后台归属](../ops/plan-2026-09-11.md)；仅控制面目录发布可靠性，不推进桌面发布冻结或客户发布门。
- 来源：基线 `d1232520a742b3e747f7b9a228361d696f24a172` → 本 PR head；分支 `t3/catalog-publish-validation`；未合 main。
- 缺陷修复：`managedCatalogYAML` 原来只逐条查名称/身份，重复节点名、客户端保留名或 macOS 拒收前缀仍能经 `PUT exit-catalog` 返回 200。
  现在按完整 proxy 名做集合校验，拒绝两桌面客户端保留名的并集和 `Tono-WeChat-TCP-` 前缀，返回 400 `INVALID_CATALOG`，已存目录不变。
  对照合同为 macOS `ConfigPipeline.validatedOwnedNodes`（`ConfigPipeline+Nodes.swift`，常量在 `ConfigPipeline.swift`）与 Windows `node.rs` 的 `validate_node_set` / `RESERVED_NODE_NAMES`。
- 新增/优化：无。名称保持精确、大小写敏感；不折叠 ` · hy2` 后缀，因此同节点 VLESS 与 hy2 两块仍可发布。Tono 身份占位、过滤与证书保护不变；未改 quota。
- 工程与测试：新增重复名、16 个保留名并集、拒收前缀的三个窄单测，以及一个真实 Worker PUT/D1 测试，证明合法双传输返回 200、非法替换返回 400 且已存行不变。
  既有字段准入测试中误用 `Tono-Exit` 的正对照改为非保留名；不改变该测试原有字段拒绝断言。
  完整回归首次为 `1 failed | 64 passed` / `9 failed | 1043 passed`：9 项 roster 测试同样以保留名发布目录；仅将其发布夹具及对应 roster 名称引用改为非保留名（17 处），不改断言或身份逻辑。
- 验证：MacBook / Node 24；旧源码实跑新回归，`Tests 4 failed | 25 skipped (29)`，其中发布入口原始输出 `AssertionError: expected 200 to be 400`，三个单测为 `Error: expected INVALID_CATALOG`。
  修复后 `npx vitest run test/catalog-yaml.test.ts test/worker-catalog.test.ts test/worker-exit-roster.test.ts`：`Test Files 3 passed (3)` / `Tests 55 passed (55)`。
  `npm run typecheck` 退出 0，unchecked indexed access 为 `520 (baseline 521)` / `76 (baseline 99)`；只读合同对照确认 16 个名称并集与拒收前缀一致。
  原始日志在实施主机 `/tmp/tono-c3-pc-f3/{red,green,typecheck,client-contract-parity}.log`；完整服务回归 `npm test`（含覆盖率门）：`Test Files 65 passed (65)` / `Tests 1052 passed (1052)`，原始日志 `full-test.log`。
- 候选/发布：仅源码，无新候选、无部署、无生产访问或写入、无 merge/auto-merge。
- 剩余限制：独立高风险 diff 审查、exact-head hosted CI、两桌面 native/设备及真实目录验证未执行，不声称已发布或实机通过。
  YAML 类型/父级解析问题 [C3-PC-F4](../findings.d/C3-PC-F4.md) 留给独立任务；本次不重写 YAML 解析、不补其它字段/节点数限制。
