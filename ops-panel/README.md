# ops-panel

跑在 ops hub 上的采集器：SSH 到各出口做质量/封锁探测，并把快照推给控制面。

## 采集节奏

- 默认全量：`python3 collect.py` — 12 小时串行 SSH（securityCheck、backtrace、大陆 agent / check-host 探测），写 `report.json` 并 `PUT /api/v1/ops-ingest/snapshot`。
  securityCheck、backtrace 以 root 在节点上运行，按 `collect.py` 里的 sha256 固定；摘要不符就删除并报 missing（节点质量记为 unknown，不是 ok），不回退镜像。换版本时同时改 URL 和摘要。
- `--agents-only`：只拉 Komari 节点列表，推一份 `{"agents": ...}` 部分快照，给 1–5 分钟的 timeseries 用。

仓库里没有全量采集的 unit 文件；部署时把 `collect.py` 拷到 `/opt/tono-ops/`，用本机已有的 collector timer 跑这两条节奏。

## 任务执行器（`--jobs`）

控制面把节点动作排进 `ops_node_jobs`，hub 用采集器同一份 collector token 租约执行。

```sh
python3 collect.py --jobs --max 1
```

一次租约、逐个跑完、把结果 POST 回去后退出。任务失败记成结果（`ok` / `error` / `timeout`），进程仍以 0 退出；只有控制面不可达或缺少 collector token 才非 0。

### 安全边界

Hub **从不执行自由文本**。租到的 `type` 只能命中硬编码 handler；未知类型立刻 POST

`status: "error", summary: "unsupported job type on this hub"`

并且不会 SSH、不会跑 shell。参数只读 schema 里出现过的字段（`sinceMinutes`、`maxLines`、`carriers`、`homeExitId`），没有“命令”通道。

上报前会脱敏：UUID、邮箱、除该节点公网 IP 以外的 IPv4、单词 `password` 都替换成 `[redacted]`。`summary` 截到 500 字，`resultJson` 超过 16 KiB 会丢掉末尾行并带 `"truncated": true`。Reality 配置只上报公钥的 sha256 指纹，私钥不离开节点。

### SSH 主机密钥（固定 known-hosts）

采集器、任务执行器和大陆探针的 SSH 全部用 `StrictHostKeyChecking=yes`，只信任
hub 上的 `/opt/tono-ops/tono-collector-known-hosts`（`GlobalKnownHostsFile=/dev/null`），
和 `tooling/scripts/check-node-in-fleet.py` 用的是同一个文件。主机密钥不在这个文件里或
与之不符时，连接直接失败，不会自动接受，也不会把 root 密码发给对端：

- 节点任务返回 `error`（ssh rc=255）；
- 大陆探针记为 `host_key_unverified`，不计入封锁判定（全部未登记时视为没有大陆数据）；
  `node_probe` 的对应运营商行带 `hostKeyUnverified` 计数。

**登记流程**：新增或重装节点、新增大陆探针时，在写进 `nodes.secrets.json` 之前，
先把该主机的主机密钥追加到上述文件，并把指纹与供应商控制台核对（与
`.claude/skills/add-tono-node/SKILL.md`「Still needs a human · host-key fingerprint」和
`check-node-in-fleet.py` 的 `HOST_KEY_UNPINNED` 提示是同一步）。指纹变了就先确认机器
确实重装过，再删旧行重登，不要为了让采集恢复而跳过核对。注意 `onboard-node.rb` 固定的是
笔记本上的 `~/.ssh/tono-fleet-known-hosts`，hub 这个文件需要单独登记。

### 安装 timer

与采集器一样部署在 `/opt/tono-ops/`（`jobs.py` 必须和 `collect.py` 同目录）：

```sh
sudo cp ops-panel/collect.py ops-panel/jobs.py /opt/tono-ops/
sudo cp ops-panel/systemd/tono-ops-jobs.service ops-panel/systemd/tono-ops-jobs.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tono-ops-jobs.timer
```

`tono-ops-jobs.timer` 每分钟跑一次 `collect.py --jobs --max 5`。token 仍读 `/opt/tono-ops/collector.token` 或 `TONO_OPS_COLLECTOR_TOKEN`。
