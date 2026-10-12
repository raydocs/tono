## 2026-10-10 · 节点侧安装校验脚本（A5 / A7 / A20）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（中继可观测、机队）；[Amp 待办](../ops/amp-backlog-2026-10-10.md)
  §9「节点侧（A5、A7、A20）等所有者 SSH 安装」的安装后核对。不是 ship gate。
- 来源：基线 main `3d973f95` → 分支 `amp/ops-node-install-check`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：`tooling/ops/node-install/check-node-install.py`（Python 标准库，只读，不发任何请求到控制面），节点上以 root 跑
  `python3 -I check-node-install.py relay-probe relay-logrotate node-agent`，每项一行 `PASS` / `WARN` / `FAIL`，有 `FAIL` 退出 1：
  - `relay-probe`（A5）：脚本 0755、单元 0644、均 `root:root` 且父目录不可被他人写；单元含 `EnvironmentFile`、`ExecStart`、
    `DynamicUser=yes`；`/etc/tono-exit-agent/env` 0600 且设了 `TONO_HOME_AGENT_TOKEN`、`TONO_API_BASE`（只看键名）；timer
    enabled + active、service loaded 且上次结果 success；冒烟：用已装脚本自己的 `probe()` 经 `127.0.0.1:2053` 探一次，
    打印结果但**不上报**。
  - `relay-logrotate`（A7）：`/etc/nginx/tono-relay.stream.conf` 与 `/etc/logrotate.d/00-tono-relay` 0644，后者含 daily /
    rotate 14 / dateext / compress / ignoreduplicates；logrotate < 3.21 时缺文件记 WARN（脚本按设计跳过），有文件记 FAIL；
    `nginx -t`、`logrotate -d /etc/logrotate.conf` 无本文件错误或重复条目。
  - `node-agent`（A20）：脚本、单元、配置 0644，token 0600；单元含 `LoadCredential`、`ExecStart --config`；配置用已装 agent
    自己的白名单解析器与 `api_base`，token 用 agent 自己的 `read_token`（拒绝信息为固定文案）；timer / service 同上；冒烟：
    列出心跳会报的角色，不发心跳。
  - 任何输出行不含凭据值、配置值、文件内容或异常文本。只在所有权与权限通过后才导入已装脚本。
  - 文档：`docs/ops/api-relay.md`（探针安装之后）与 `services/node-agent/README.md` 安装第 3 步。
- 工程与测试：`tooling/ops/node-install/test_check_node_install.py` 两条（假节点根目录 + `systemctl` / `nginx` / `logrotate`
  桩；节点 agent 用真实脚本）：完整安装全 PASS 退出 0；坏安装（env 缺 token 键、timer inactive、`logrotate -d` 报重复、
  token 0644、配置多一行 `LD_PRELOAD=<token>`）恰好 5 条 FAIL、退出 1；两条都断言输出不含合成 token。
  `services-ci.yml` service-agents 加一步并加路径过滤；`ci-gate-changes.test.mjs` 同步路径清单。
- 验证：本机 Linux Python 3.11：`python3 tooling/ops/node-install/test_check_node_install.py` → `Ran 2 tests … OK`；
  非 root 无测试参数运行 → `run as root` 退出 2；`node --test tooling/scripts/tests/ci-gate-changes.test.mjs` 通过。
  未执行：真实节点上运行（orb 无 SSH）。
- 候选/发布：仅工具，无新包；未部署。
- 剩余限制：节点安装待做（node install pending, no SSH from orb），本校验随安装一起由所有者在节点上跑。只核对单元关键行，
  不比对已装文件与仓库规范副本的字节。`--root` / `--expect-uid` 只供测试。
