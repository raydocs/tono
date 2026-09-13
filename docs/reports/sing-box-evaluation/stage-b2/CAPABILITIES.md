# B2 的能力只覆盖同宿主隔离真 TUN

继承 [A 实测能力矩阵](../CAPABILITIES.md)，本批次再次实际创建/销毁隔离资源，
没有仅凭 sudo 或 HTTPS 可访问判断能力。

| 能力 | 状态/本批次证据 | 限制 |
|---|---|---|
| Linux TUN、CAP_NET_ADMIN、netns、veth | PASS；三候选 HTTP 原始 socket 经 TUN 连接自有 TCP/UDP 出口 | 不是 Tono Linux 产品连接；没有绕过尚未实现的产品 fail-closed |
| 自有 Reality TCP、Hy2 UDP | PASS；57/57 smoke，1,620/1,620 正式请求含启动验证 | 全部同宿主，不代表公网/国内运营商 |
| TLS/身份拒绝 | PASS；错 CA/SNI/Reality 身份均不能取得合成成功回复 | 实验 CA，不是生产 pin/catalog 准入 |
| CPU/RSS | PASS；`/proc/<pid>/stat,status`，首尾 + 100ms 采样，客户端/服务端/origin 分开 | CPU tick 10ms；RSS 是采样最大值，不是严格峰值 |
| CPU throttling/steal | PASS 可观测；本次 cgroup throttle 增量 0，host steal 约 0.003% | 不能排除瞬时调度噪声或其他租户影响 |
| tc netem | UNAVAILABLE；A 已实测内核不支持 | 未重试安装/加载宿主模块；未做丢包/延迟/限速实验 |
| mutex/block/heap/CPU profiling | NOT_TESTED 本批次未启用 | 不得推断“无锁竞争”、分配/GC 或 CPU 差异原因 |
| 抓包 | NOT_TESTED 本批次未采集 | 不从 HTTP 总耗时反推协议内部握手阶段 |
| Mac PF/Windows WFP/原生 UI | UNAVAILABLE | 需要实际安装包与原生设备 |

机器身份由 [measurement.json](raw/measurement.json) 的 environment_before/after 保存：
Linux 6.1.158+、x86_64、8 vCPU；cgroup CPU `max 100000`，内存上限 14 GiB。
代理环境只保存是否存在，不保存值；实验 namespace 没有外部路由。

两次网络运行：`smoke-01`、`measure-01` 都 exit 0，清理后的 root `lsns -t net`
只剩宿主 namespace `4026531840`；自建 namespace 均已消失。每次客户端退出均检查
TUN 不存在、监听集为空、PID 已回收。host network 前后相等。
[原始执行命令、退出码和清理摘要](raw/provenance.json)。

实测等级：**真 TUN + 无损同宿主链路**，不含可控损伤，不含外部授权国内测试端。
