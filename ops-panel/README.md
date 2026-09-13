# ops-panel

跑在 ops hub 上的采集器：SSH 到各出口做质量/封锁探测，并把快照推给控制面。

## 采集节奏

- 默认全量：`python3 collect.py` — 12 小时串行 SSH（securityCheck、backtrace、大陆 agent / check-host 探测），写 `report.json` 并 `PUT /api/v1/ops-ingest/snapshot`。
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

### 安装 timer

与采集器一样部署在 `/opt/tono-ops/`（`jobs.py` 必须和 `collect.py` 同目录）：

```sh
sudo cp ops-panel/collect.py ops-panel/jobs.py /opt/tono-ops/
sudo cp ops-panel/systemd/tono-ops-jobs.service ops-panel/systemd/tono-ops-jobs.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tono-ops-jobs.timer
```

`tono-ops-jobs.timer` 每分钟跑一次 `collect.py --jobs --max 5`。token 仍读 `/opt/tono-ops/collector.token` 或 `TONO_OPS_COLLECTOR_TOKEN`。
