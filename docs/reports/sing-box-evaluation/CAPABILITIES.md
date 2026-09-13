# Stage A1 能力矩阵

**实际支持隔离 namespace、veth、真 TUN 包 I/O、原始 TCP/UDP 与抓包，但不支持 netem。**
不能把环境归类为“完整真 TUN + 可控损伤网络”：它具有该等级的 TUN/拓扑隔离能力，但缺延迟/丢包注入。可做无损合成链路测试；不能做本任务要求的受控丢包对照。不需要也没有索要生产密码。

## 复现入口与状态定义

```sh
python3 tooling/experiments/sing-box-bench/bench.py preflight \
  --output /tmp/tono-stage-a-20260913/preflight-02 --run-id ta-preflight-02
```

该目录已存在，复现时换一个新目录/run ID。实测 exit **1** 是 netem 能力失败，不能改成全绿。
原始 JSON/CSV：`/tmp/tono-stage-a-20260913/preflight-02/{results.json,samples.csv}`。
JSON SHA-256：`588c3afb0c360996d1bf124b01689459235805fd66293e1afabd4598bae2f1b5`。

- PASS：实际执行并取得期望证据。
- FAIL：实际尝试失败；不代表其他独立能力失败。
- UNAVAILABLE：环境/实现缺少必要能力。
- NOT_TESTED：没有执行或缺合法实验条件。

| 能力 | 状态 | 命令/退出码/证据 | 影响范围 |
|---|---|---|---|
| OS/CPU/内存/磁盘 | PASS | `uname -a; lscpu; free -h; df -h /`，0；见 BASELINE | 只读 |
| cgroup 限额 | PASS | `cat /sys/fs/cgroup/amp.slice/amp-workload.slice/{cpu.max,memory.max,cpu.stat}`，0；CPU 无额外 quota，内存 14 GiB | 只读；不是独占 8 核保证 |
| throttling/steal 可观测 | PASS | `cpu.stat`、`/proc/stat`，0；smoke-01 throttled_usec 无增长，steal 173→173 ticks | 可见 guest 统计，不是宿主争用全景 |
| Go/Rust/Node | PASS | `go version` → 1.27.1；`rustc +1.98.1 --version`；`node --version` → v24.18.0，0 | 只安装开发工具，未升级产品依赖 |
| 代理变量存在性 | PASS | Python 仅输出 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 大小写键布尔值；全部 false，0 | 不证明无透明网络代理；未打印任何凭据 |
| 外部 HTTPS 开发下载 | PASS | Go 官方 HTTPS 范围请求 206、完整文件 checksum OK，0 | 不推出公网 UDP 能力 |
| CAP_NET_ADMIN | PASS（限 sudo 子进程） | 普通用户 CapEff=0；`sudo -n capsh --print` 可见 net_admin，实际 veth/TUN 操作成功 | 权限来自已授权 Orb 实验，不碰主 namespace |
| network/PID/mount namespace | PASS | `sudo -n unshare --net --pid --mount --mount-proc --fork --kill-child=SIGKILL ...`，0；child net inode 不同 | 无 host 路由接口；新 mount namespace 内挂载 proc |
| veth 创建/删除 | PASS | `ip link add a... type veth peer name b...; ip link set ... up; ip link del a...`，0 | 两端都只在本次隔离 namespace |
| `/dev/net/tun` 实际可用 | PASS | root open + `TUNSETIFF(IFF_TUN|IFF_NO_PI)`，3 次 kernel→fd→kernel UDP payload 回包完全相同，0 | 合成 TUN plumbing，不是 Mihomo TUN 数据面回归 |
| 原始 TCP/UDP 到自建服务 | PASS | Python sockets 对隔离 loopback 自建服务双向回包校验，0 | 同宿主本地链路，没有公网结论 |
| 外部授权 TCP/UDP 服务 | NOT_TESTED | 未提供独立授权外部服务；exit N/A | 不访问生产节点，不探测第三方吞吐 |
| netem 安装 | FAIL | `tc qdisc add dev a... root netem delay 20ms limit 100` → **2**，`Specified qdisc kind is unknown` | 安装未生效；没有注入任何延迟 |
| netem 可获得性 | UNAVAILABLE | `zgrep CONFIG_NET_SCH_NETEM /proc/config.gz` → 0，`# CONFIG_NET_SCH_NETEM is not set`；无 `/lib/modules` | 不升级内核、不加载宿主模块、不换规格 |
| netem 撤销与实际损伤校验 | NOT_TESTED | add 失败，无 qdisc 可撤销；veth 随 finally 删除 | 不把 20ms 配置字面量当成 RTT 测量 |
| 抓包 | PASS | `tcpdump -Z root -U -i lo -c 1 -w ... 'udp port 43211'` → 0；pcap 含1个合成包 | 从未抓 Orb 主网络；pcap 仓库外 |
| CPU/heap/goroutine pprof | PASS（取得/解析） | 独立 debug controller 轮次下载；`go tool pprof -top` 全部0 | CPU idle profile 0 samples，不是工作负载 CPU 结论 |
| mutex/block pprof | UNAVAILABLE（有效竞争采样） | HTTP 取回、pprof 解析均0，但0 samples；固定源码未调用 SetMutexProfileFraction/SetBlockProfileRate | 不等于无竞争；不能悄悄打新采样 patch 混入性能基线 |
| PF/WFP/native UI | UNAVAILABLE | Linux Orb，不运行这些原生实现 | 必须 Mac/Windows 真机 |

## 清理与隔离证据

- preflight 失败后 `ip -j link show` 只剩 lo；非持久 TUN 的 fd 关闭自动删除接口。
- smoke/profile 退出后 Core return code 0，SOCKS/controller/合成 HTTP 端口均拒绝连接。
- 各轮 `host-network.json` 的主 namespace inode、路由、接口和 resolv.conf 摘要前后相同。
- 无全局 flush、默认路由/DNS 修改、生产 SSH、Worker/D1/目录操作。
- 自测实际制造 exit 7、超时、KeyboardInterrupt，确认没有被记为成功，并检查子进程已回收。
- 开发中发现仅杀 sudo wrapper 会留下仍存活的 root 子进程直到其自然退出（3秒合成 sleep 实测）。已给最终入口加 **root-owned timeout**：50秒 TERM、2秒后 KILL、外层60秒上限。独立网络 namespace 超时回归确认 inode 从 `lsns` 消失。
- 正常退出即时清理；父进程中断/被杀后 root watchdog 最迟52秒销毁本次隔离树。不能保证 SIGKILL 时写完 JSON，但不依赖写报告来清理网络资源。

此轮没有用“有 sudo”替代网络能力验证，也没有调用 Tono 被明确阻断的 Linux Service StartClash 路径。
