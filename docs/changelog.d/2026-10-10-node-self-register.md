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
- 续记（2026-10-10，第三轮评审 FAIL：1 major）：`TONO_NODE_AGENT_TOKEN_FILE` 误填成 token 本身时，读失败的拒绝信息带出
  路径值即 token。改后所有拒绝 / 日志行只用固定文案（最多点出变量名与异常类名），不含任何环境变量值、路径、文件内容或
  异常文本；成功行也不再打印节点名与 IP。python 现有测试加：变量填合成 token → 非零退出，stderr 不含 token。
- 续记（2026-10-10，第四轮评审 FAIL：1 major + 1 minor）：major——`systemctl` 子进程继承整个环境与 stdout/stderr，
  token 误填进 `SYSTEMD_LOG_LEVEL` / `SYSTEMD_LOG_TARGET` 时会被它回显进日志。改后子进程用绝对路径
  `/usr/bin/systemctl`、固定参数、最小环境（`PATH`、`LANG=C`），stdin/stdout/stderr 全接 `/dev/null`，只取退出码；
  脚本里没有别的子进程调用。python 现有测试加：桩 `systemctl` 把环境与参数写到 fd 2，环境里放合成 token，fd 1/2 均不含
  token。minor——吊销回执改在同一 batch 里读（事务内 SELECT），不再事后另查；现有 `it` 加：两次 `DELETE` 回同一
  `tokenRevokedAt`。
- 续记（2026-10-10，第五轮评审 FAIL：1 major）：unit 的 `EnvironmentFile` 把任意变量交给解释器，token 误填进
  `LD_PRELOAD` / `LD_AUDIT` / `LD_DEBUG` 时 ld.so 会在 Python 启动前把它写进日志。改后 unit 去掉 `EnvironmentFile`，
  不设任何运营者可写的环境；配置改为 root 所有的 `/etc/tono/node-agent.conf`（unit 用 `--config` 固定路径），脚本只
  接受 `TONO_API_BASE` / `TONO_NODE_NAME` 两个键，其余行、重复键、超 4 KiB 一律拒绝，错误只报行号；token 只从
  `LoadCredential` 读。`node-agent.env.example` 改为 `node-agent.conf.example`，README 安装步骤同步。python 现有测试
  覆盖：未知键（`LD_PRELOAD=<token>`、以 token 为键）拒绝、token 形值放进 API base 拒绝、两行 credential 拒绝，均不回显。
- 续记（2026-10-10，第六轮评审 FAIL：1 major，仅文档）：README 安装步骤原把 token 写在 `printf` 命令行里（进 shell 历史
  与终端记录）。改为先建 0600 空文件，再在不回显的提示下粘贴（`stty -echo` + `read`，内建 `printf` 写入），注明勿用
  `set -x`、清剪贴板；签发步骤注明把响应写入 0600 文件而非终端，用后删除。其余文档无命令行带 token 的写法。无代码改动。
- 续（评审第七轮，文档）：签发令牌的响应写进 `mktemp -d` 新建的 0700 目录，不再依赖 `umask`（已存在的 0644 文件会保留旧权限）。
