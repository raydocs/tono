# B2：AI 请求独立批次，保留 A/B 固定证据

本批次按用户最新指示测试 **AI 类 POST/JSON、SSE 回复和瞬时吞吐/CPU**。
不是真实 Claude/Grok/Gemini/OpenAI 服务，也不是其完整 API 或 SDK 模拟。
48 GiB 持续上传/下载方案在运行前取消；未产生那批负载。
没有替换产品内核、修改产品代码或 CI，没有使用生产身份。

## 源码快照与内核不混算

- 仓库：[raydocs/tono](https://github.com/raydocs/tono)。
- 原始 worktree `/home/user/workspace/repo`：本地 `main` 固定在
  [A 基线](https://github.com/raydocs/tono/commit/1d00b581dffdd98e84821c8789eb0c46b7a21bed)，未修改。
- A 交付：[7b7ad207](https://github.com/raydocs/tono/commit/7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1)。
- B 交付：[f3a12318](https://github.com/raydocs/tono/commit/f3a12318e39ece7ade06f2282ba0b3f7c91add88)。
- B2 worktree：`/home/user/workspace/tono-stage-b2-20260913`；分支
  `experiment/sing-box-stage-b2-throughput-20260913`（名字沿用初始任务，不表示做了持续大流量）。
  创建时 HEAD 为 B 交付，工作树干净；随后只有本批次工具/报告新增。
- B2 开始时显式 fetch 一次，记录 `origin/main` 为
  [fd6d7b5e](https://github.com/raydocs/tono/commit/fd6d7b5e10ea7259cef06ec965f63f2be5d49115)。
  相对 A：40 files，+1287/−242，包含两项 P2 修复、更新交接、依赖与 Tailscale 等变化。
  未切换到这个快照，未以它重新构建内核，也未自动追踪后续 main。
- 测量前工具冻结：[a707c02c](https://github.com/raydocs/tono/commit/a707c02c1f2aac5e9bfe1060da78d72805a1ee48)。
  导出工具/报告随后离线添加，未重跑或覆盖测量。

## 复用同样的两个固定二进制

| 标签 | 源码/依赖/栈 | SHA-256 |
|---|---|---|
| A / `mihomo` | Tono `v1.19.30-tono-gvisor-adaptive.1`，upstream [ac017cdd](https://github.com/MetaCubeX/mihomo/commit/ac017cdd246ce8bd547653d927e7bf77d7ee73d5)，MetaCubeX sing-tun `v0.4.22`，仓库 adaptive patch | `c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4` |
| B / `gvisor` | sing-box [93fff595](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f)，SagerNet sing-tun `v0.9.4-0.20260912075549-869f0a4d76af`，`stack: gvisor` | `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df` |
| C / `go` | 与 B **相同二进制**，只改 `stack: go` | 同 B |

内核构建详情见 [A](../BASELINE.md)、[B](../stage-b/BASELINE.md)：Go 1.27.1，
CGO=0，linux/amd64，GOAMD64=v2，`-trimpath -mod=readonly`，`-w -s -buildid=`。
A tags `with_gvisor`；B/C tags `with_gvisor,with_quic,with_utls,with_clash_api`。
Tono patch SHA-256：`f33ee290cc979b739505777761b87f7933441e6bc94d0fc98bb75b42477f005b`。
没有重建或升级这两个内核。A 对 B/C 是整个内核对比；B 对 C 才是同版本栈对比。

新的 Go 标准库 HTTPS fixture/worker：Go 1.27.1，CGO=0，linux/amd64/v2，
GOMAXPROCS=2，无第三方依赖/额外 tags，`-trimpath -ldflags '-s -w -buildid='`。
SHA-256 `b83bb784e86589d60acd071f93226934a3ba50e1a57bdc6164f37ec1889cd3d5`。
[构建命令和四项实际自测输出](raw/build.json)；[复现入口](../../../../tooling/experiments/sing-box-bench/stage_b2/README.md)。

## 隔离、资源与流量预算

同宿主 veth：应用 → 真 Linux TUN → 候选 → 自有 Reality/Hy2 服务 → 自有 HTTPS。
两层网络 namespace 包在独立 PID/mount namespace 树内，无外网 NIC/默认路由。
服务与身份均本地合成；host DNS、路由、防火墙不修改。

- 内核 CPU 0–1，出口服务 2–3，worker 4–5，HTTPS origin 6–7；GOMAXPROCS=2。
  affinity 不是独占 CPU；各方仍共享宿主调度和内存。运行时没有并行编译/其他本线程压测。
- MTU 1500，无 netem。Reality 参数及 TUN/DNS 路由沿用 B。
- Hy2 两端省略 bandwidth 字段，使用各实现的 BBR 路径，没有 100 Mbps 人工上限。
  **BBR 实现不相同**，不宣称所有协议内部参数等价。Proxy mux 关闭。
- 一次请求最多 3s；worker 最多 45s；root watchdog 600s + 2s 强制退出宽限。
  固定三轮 ABC / CAB / BCA，每轮串行；先新内核 Reality 验证，再负载；
  随后独立新内核 Hy2 验证及少量备用请求。没有自动重试/POST 重放。
- 计划应用载荷上限 193.15 MiB（包括保守 JSON/SSE 余量）；连同 smoke 和自测低于 256 MiB。
  实际测量 HTTP bodies 180.85 MiB（含 18 个启动验证），smoke 3.44 MiB。
  这不是 NIC 线速字节数：TLS/TCP/QUIC 封装及重传不计在 HTTP body 中。
- 原始配置、私钥、二进制、完整日志仅在仓库外 `/tmp/tono-stage-b2-20260913/`；
  Git 中是无凭据的请求/事件/计数数据和摘要。A/B 原报告与工具保持逐字节不变。
