## 2026-10-10 · 节点自注册第 1 版（节点持 token 上报心跳）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 第 3 批（节点身份与机队）；Amp 待办 A20，决策 D7-A
  （[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §7）。控制面 `services/control-plane`、新节点 agent
  `services/node-agent/`。
- 来源：基线 3e6aebd2（main）→ 分支 `amp/a20-node-self-register`；PR 待开；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - 迁移 0097 `ops_node_agents`：每个 catalog 名一行（与 `ops_node_profiles.catalog_name` / `ops_node_status.node_name` /
    `ops_node_identity.name` 同键），存节点 heartbeat token 的加盐 SHA-256（每 token 独立盐）与最近一次心跳：
    自报 IP、Cloudflare 看到的 `CF-Connecting-IP`、角色（`xray` / `hy2` / `relay`）、agent 版本、首次 / 最近心跳时间。
    0096 留给并行的 A5。
  - `POST /api/v1/node-agent/heartbeat`（公开 Worker，经 `src/ops/ingest.ts` 委派，`index.ts` 不加行）：token 形如
    `tna1.<id>.<secret>`，按 id 取行、常数时间比对哈希；body 的 `node` 必须是 token 绑定的节点（否则 403
    `NODE_AGENT_MISMATCH`）；UPDATE 以 `node_name + token_id + 未吊销` 为条件，只写本节点心跳列。限速：每来源地址
    15 分钟 30 次（验 token 前），每 token 15 分钟 10 次。心跳不碰目录、`ops_node_profiles.public_ip`、判定表，
    不会让节点上架（计划 §2 第 10 条）。
  - ops v1：`GET node-agents`（`nodes.read`）；`POST` / `DELETE nodes/{name}/agent-token`（`nodes.publish`，仅 owner）。
    token 只返回一次（`no-store`），再签发即作废旧 token；审计行与写入同一批。与 exit 节点 token 分开：后者能读客户
    roster，这把只能报心跳。
  - 节点侧 `services/node-agent/tono_node_agent.py`（stdlib）+ systemd service / timer（5 分钟，DynamicUser，
    `LoadCredential` 读 token）+ 安装步骤；README 写明 Notion 机队表退为备份，以控制面为准。
- 工程与测试修正：`test/ops-node-agents.test.ts` 两个 `it`（token 鉴权：坏 token 401、A 的 token 写 B 403、好 token
  存下且资料 IP 不变、吊销后 403；签发仅 owner：operator 403 且无行、owner 201 + 审计）；`services/node-agent`
  一个 unittest；`services-ci.yml` service-agents 加一步。
- 验证：见 PR 正文（vitest 全量、typecheck、check:contract、check:budgets、python unittest）。
- 未做：节点安装待做（orb 无 SSH）；无控制台 UI（列表 / 签发按钮另开）；退役节点不自动吊销 agent token（需手动
  `DELETE`；token 只能写心跳）。
- 续记（2026-10-10，独立评审 PASS 带 3 个 minor，一轮修正）：再签发清空旧 token 的心跳列（新 token 上报前行里无心跳）；
  心跳写入时输给吊销的请求回 403 `NODE_AGENT_REVOKED`（输给再签发仍 401）；吊销审计原本已按 `changes() > 0` 条件写，
  测试补上：未知节点 404、重复 `DELETE` 200 均不再记审计。现有第一个 `it` 扩展，无新测试文件。
- 续记（2026-10-10，第二轮评审 FAIL：1 major + 1 minor）：major——节点 agent 只查 `tna1.` 前缀，token 文件里两行同一 token
  会进到 HTTP 头，urllib 抛 `ValueError` 带整个 Authorization 值，systemd 日志记下 token。改后按完整语法（前缀 + 定长 +
  字符集，单行，只去一个结尾换行）校验，不合即拒；`main` 外包一层，任何异常只打印类名，不回显异常文本。python 现有
  测试加：两行 token 文件 → 非零退出，stderr 不含 token。minor——控制面心跳的 IPv6 校验改为严格解析（≤8 段、至多一个
  `::`、可选合法尾部 IPv4），`::999.999.999.999` 等回 400；现有第一个 `it` 加一条。
