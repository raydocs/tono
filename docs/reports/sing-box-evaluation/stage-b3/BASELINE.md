# B3 固定身份与事前预算

仓库 [raydocs/tono](https://github.com/raydocs/tono)；新分支
`experiment/sing-box-stage-b3-ai-streams-20260913`，worktree
`/home/user/workspace/tono-stage-b3-20260913`。起始提交为已上传 B2
[edaa6287](https://github.com/raydocs/tono/commit/edaa62871a63055acafd2b5c33f0003ab263628a)，
创建时工作树干净。原始 worktree 的本地 main 仍为
[1d00b581](https://github.com/raydocs/tono/commit/1d00b581dffdd98e84821c8789eb0c46b7a21bed)，干净。
不 fetch/rebase 到新 main，不升级内核/依赖，不改产品代码，不迁移/合并/发布。
A/B/B2 的文件和原始实验目录保留。

## 正常与诊断均复用现有固定内核

| 标签 | 固定身份 | 二进制 SHA-256 |
|---|---|---|
| A / mihomo | Tono `v1.19.30-tono-gvisor-adaptive.1`，upstream [ac017cdd](https://github.com/MetaCubeX/mihomo/commit/ac017cdd246ce8bd547653d927e7bf77d7ee73d5)，MetaCubeX sing-tun `v0.4.22`，Tono patch | `c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4` |
| B / gvisor | sing-box [93fff595](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f)，SagerNet sing-tun `v0.9.4-0.20260912075549-869f0a4d76af`，gVisor | `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df` |
| C / go | 与 B 同一二进制，仅 stack=go | 同 B |

原始构建参数见 [B2](../stage-b2/BASELINE.md)：Go 1.27.1、CGO=0、linux/amd64/v2；
A tags `with_gvisor`；B/C `with_gvisor,with_quic,with_utls,with_clash_api`。
未调用产品安装路径。本批次仅构建标准库 HTTPS 测试工具，无新模块依赖。
Normal 使用 warning/warn 日志。Profile 使用相同内核二进制；A 为暴露上游 pprof 路由
需要 log-level=debug，B/C 加 `experimental.debug.listen=127.0.0.1:19092`。
诊断端口仅在封闭 namespace 内；诊断数据不合并进正常 CPU 数字。

## 运行前计算的完整应用预算

`run_b3.py budget`：**226,905,088 bytes = 216.3935546875 MiB < 256 MiB**。

- 114 条正常 Reality SSE：两个独立批次，3 个候选，每次都新建内核；H1/H2×并发1/8，
  加 H1/c1 的 post-burst 对照。相同长度 idle 单独新进程预热后测，不混在“直接 SSE”前。
- 6 条 Hy2 SSE：每候选 H1/H2 各一条，仅正确性；另有短取消/服务端确认。
- 3 条诊断 SSE；9 个 CPU profile 窗口（每候选 idle/SSE/burst），独立于正常批次。
- 每流 30s，600 个事件，每 50ms 产生 128 字节 payload，帧额外保守预留 256 bytes/event，
  请求/预热预留 8192 bytes/stream。这是合成参数，不代表任何真实 provider/token 节奏。
- 正常 post-burst 6 次 + 诊断 burst 3 次，分别执行 B2 的前五个 JSON burst case：
  cold c1 / reuse c1 / c8 / c16 / 32KiB prompt；每次上限 20,086,784 bytes。
- Smoke、自测、启动验证与取消总预留 16 MiB。没有持续大文件或真实 AI 账号。
- 计划运行 wall time 约 26 分钟，正常与 CPU profile 总上限 30 分钟；不自动重复。

CLI 请求 timeout 45s（配置上限75s），SSE worker watchdog95s；每个隔离批次
root watchdog1200s+2s kill grace，namespace holder1220s。按实际样本保留 FAIL/TIMEOUT/CANCELLED。
CPU 窗口包括短暂 worker 启动/连接预热；原始 CPU 值不扣空闲，扣除结果仅作为另一个字段。

同宿主 veth/TUN、MTU1500；CPU affinity 为 core0–1/server2–3/worker4–5/origin6–7，
GOMAXPROCS=2，不是独占 CPU。无外部 NIC/默认路由，host DNS/路由/防火墙不修改。
netem 在本 Orb 不可用。原生 PF/WFP、点击到 Connected 和国内网络均不在本批次证据范围。
原始数据/私有合成配置/profiles：`/tmp/tono-stage-b3-20260913/`；只发布无凭据数据摘要及哈希。
