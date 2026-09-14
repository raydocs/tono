# B3 是 Linux 同宿主真 TUN，不是国内或原生结果

环境身份/最初能力实测见 [A CAPABILITIES](../CAPABILITIES.md)；B3 不重建 Orb 或升级规格。
本批继续实际创建独立 net/PID/mount namespace、veth、TUN 并完成自有 HTTPS 请求，
不是根据 sudo 权限或代理 HTTPS 出网判断 TUN 可用。

| 能力 | B3 使用与边界 |
|---|---|
| Linux x86_64、8 vCPU | client 0–1、proxy server 2–3、worker 4–5、fixture 6–7；非独占 CPU |
| cgroup | `cpu.max = max 100000`，memory.max = 15,032,385,536 bytes（14GiB）；逐批 before/after 保存 |
| CPU / RSS | `/proc/<pid>/stat` utime+stime，100Hz（10ms量化）；RSS 每250ms采样；server/fixture 单列 |
| CPU throttling / steal | cgroup cpu.stat 和 `/proc/stat` 实际 before/after 保留；不是专属裸机无干扰证明 |
| TUN / veth / namespace | `run_b3.py smoke/measure/profile` 在封闭 namespace 实际运行；无外部 NIC/默认路由 |
| 原始 TCP / UDP | 到同宿主自有 Reality TCP / Hy2 UDP 服务，不调用公网 provider |
| H1 / H2 | 实际 TLS ALPN、HTTP protocol、warm connection ID；H2/c8 检查并发 handler |
| TLS 负向 | 自测 wrong CA/SNI；真 TUN smoke wrong SNI 被拒绝，不能误计成功 |
| CPU profile | 同一内核二进制的 pprof；只在私有 namespace loopback 开放；正常与诊断轮次分离 |
| mutex/block、allocation/GC profile | 非默认性能指标；是否额外采集及理由见 CPU.md，未采样不能推断为零 |
| tc netem | **UNAVAILABLE**，A/B 已记录；B3 未施加受控损伤，不把无损结果泛化到国内丢包 |
| 原生 macOS/Windows | **UNAVAILABLE**；PF/WFP、DNS保护、native UI/helper/service 必须真机验证 |

每批命令退出码、run status、`host-network.json` 和 `cleanup.json` 都保留在仓库外原始目录，
哈希及清理摘要随导出发布。隔离过程没有改 Orb 主路由、DNS 或防火墙，也没有全局 flush/kill。
具体通过/失败数量与运行后环境差值见 RESULTS.md，不用能力表代替执行结果。
