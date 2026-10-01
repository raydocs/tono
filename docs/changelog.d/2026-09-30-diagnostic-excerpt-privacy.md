## 2026-09-30 · 自动诊断不落库任意日志片段
- 归属：control-plane 自动诊断隐私；既有 structured-facts / operator-granted-logs 边界。
- 来源：origin/main `4453e258` → `hunt/sol-cp-diagnostic-excerpt-privacy`，本 PR；尚未合 main。
- 缺陷修复：任意 logExcerpt 经不完整 regex 后仍存储 IPv6/token → 保留兼容字段校验，仅 log_excerpt 绑定 null，结构化事实照常接受。关联 SOL-CP-EXCERPT-PRIVACY。
- 新增/优化：无；不更改单独的 operator-granted 原始日志通道；更新隐私文档说明。
- 工程与测试：一条真实 API 回归，原代码明文保存测试 IPv6/token，修改后存 null 并保留字节/结果。
- 验证：Linux / Node24；diagnostics-clusters、typecheck 和全量 npm test 结果见 PR；未部署或访问生产数据。
- 候选/发布：仅源码，无新候选。
- 剩余限制：当前原生客户端无新 bundle 调用；历史片段沿用保留期，不追溯清理。

- 2026-09-30 续记：实际冲突后 rebase 至 origin/main `236d76cd`，保留 #918 原子 batch 与 null 片段绑定。新 indexed-access 门发现此前本轮 bundle 回归对第二跳未收窄；新增显式 fixture guard，不改断言或 baseline。合并后 diagnostics-clusters 14 测试及完整 typecheck（521/521、99/99）通过；全量 45 文件 / 961 测试通过；未部署。
