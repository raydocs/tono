# B2：突发回复有差异，流式 AI 体验没有全面胜者

**当前证据不足以升级产品内核。** 同版本 sing-box Go 栈在部分短时 JSON 突发中
CPU 更低，但在本次逐事件 SSE 中，CPU 高于 gVisor；首事件时间没有相应改善。
这些都是无损同宿主真 TUN 数据，不能解释为国内可用性或真实 AI provider 延迟。

## 已运行的范围和预算

- 2026-09-13；原始根目录 `/tmp/tono-stage-b2-20260913`。
- `build-01`：Go 四项实际本地 HTTPS 自测 PASS；Python 四项离线编排/统计自测 PASS。
- `smoke-01`：57/57 检查 PASS（其中负向请求如预期 FAIL/TIMEOUT）。
- `measure-01`：三轮 ABC/CAB/BCA，共 81 个 case，**1,602/1,602 负载请求成功**，
  0 超时、0 失败、0 缺失；另有 **18/18 新内核启动验证成功**。
- 正式批次 wall time 50.75s；最长 case 的 worker wall time 2.790s。
  负载 HTTP bodies：提问 8.28 MiB，回复 172.42 MiB；连同启动验证 180.85 MiB。
  Smoke 另用 3.44 MiB；自测亦为小载荷，整批低于 256 MiB。
- 没有持续大流量上传/下载、真实 provider 调用、第三方压测或 1.2 秒 fallback。
  旧 A/B 数据未混入统计，未重跑旧批次来挑选较好样本。

## 内核就绪不是连接成功

计时起点是 harness 的 start intent，包含配置写入/启动、controller+TUN readiness、
实验路由安装、worker 进程启动和完整 HTTPS POST/回复验证。
**不是用户点击**，没有 UI/IPC/PF/WFP/产品策略/DNS 开销。
Readiness 有 30ms 轮询和 Python controller 子进程开销，不能据数毫秒差异排序启动速度。

| 候选 | Reality 内核就绪 ms（三轮范围） | Reality 完整 HTTPS 成功 ms | Hy2 完整 HTTPS 成功 ms |
|---|---:|---:|---:|
| A Tono Mihomo | 81.8–84.3 | 103.4–104.5 | 104.7–109.8 |
| B sing-box gVisor | 80.5–84.3 | 99.3–104.0 | 104.7–118.0 |
| C sing-box Go | 85.3–95.1 | 105.1–114.4 | 102.7–112.9 |

每候选/协议只有 3 个 startup 样本，报范围，不报 p95/p99。
所有 startup 都小于 1.2s；没有匹配的国内慢连接或备用节点证据，
**无法判断 1.2s 切换收益/误触发率**。长于 1.2s 的批处理 wall time 不是连接过慢。

## Reality JSON 突发：应用首字节和 CPU

4 KiB prompt → 128 KiB JSON text；并发是应用请求数，不是 QUIC stream/mux 配置。
下表 TTFB 从每次请求函数开始，直到实际读到第一个 HTTP 响应字节；
包含该请求可能需要的应用 TCP/TLS。不是只等 headers 解析完成。
冷请求是新应用 TCP/TLS，内核已完成一次保护隔离内的 HTTPS 预热；并非每次重启内核。
Keep-alive 每个 worker 首个请求仍冷，之后串行复用：例如 c1 每轮 32 个中 31 个复用。
所有首个冷请求和失败槽位均保留，未从批次吞吐/CPU 中删去。

| 场景；每候选总请求数 | 指标 | A Tono Mihomo | B sing-box gVisor | C sing-box Go |
|---|---|---:|---:|---:|
| 冷 HTTPS c1；72 | TTFB p50 / p95 ms | 4.17 / 5.29 | 3.88 / 4.86 | 3.79 / 4.90 |
| 同上 | 三轮回复 Mbps 范围 | 92.7–97.5 | 99.9–103.6 | 107.3–112.4 |
| Keep-alive c1；96 | TTFB p50 / p95 ms | 0.85 / 1.81 | 0.72 / 1.46 | 0.69 / 1.47 |
| 同上 | 三轮回复 Mbps 范围 | 379–458 | 442–482 | 691–727 |
| 同上 | 客户端 CPU ms/请求 | 2.40 | 1.88 | 0.63 |
| Keep-alive c8；120 | TTFB p50 / p95 ms | 4.11 / 10.01 | 2.28 / 10.66 | 2.49 / 10.66 |
| 同上 | 三轮回复 Mbps 范围 | 616–846 | 1128–1381 | 1171–1389 |
| 同上 | 客户端 CPU ms/请求 | 2.25 | 1.42 | 0.67 |
| Keep-alive c16；120 | TTFB p50 / p95 ms | 10.95 / 21.93 | 5.53 / 19.10 | 4.75 / 20.24 |
| 同上 | 三轮回复 Mbps 范围 | 499–687 | 966–1204 | 961–1246 |
| 同上 | 客户端 CPU ms/请求 | 2.92 | 1.75 | 1.25 |

Mbps = 成功验证的回复文本 bytes × 8 / **整个批次 elapsed**，不是瞬时采样峰值，
不是 NIC 线速或长期可持续速率。没有 100 Mbps 配置上限；低于 100 的冷场景原样保留。
B/C c8、c16 吞吐区间重叠、c16 Go 尾延迟不占优，不能宣称高并发吞吐有稳定赢家。
C 的 c1 和 CPU 信号值得后续验证；A 对 B/C 差异不能全部归因于栈。

另有 32 KiB prompt → 32 KiB reply，每候选 24 请求：TTFB p50 为 A/B/C
1.08/0.94/0.87ms。不是持续上传排名，全部 per-round 数据见 CSV。

## SSE：首事件基本相同，Go 栈 CPU 不总是更低

每次请求 4 KiB prompt → 64 KiB reply，分 16 个合成事件；服务端明确等待 40ms
才产生第一事件，随后间隔约 20ms。这是 **4 KiB/event 的合成流**，不是真实 token
大小/分词/生成速度，也不覆盖长会话重连、工具调用或多模态。

| Reality SSE 指标 | A Tono Mihomo | B sing-box gVisor | C sing-box Go |
|---|---:|---:|---:|
| c1 首个完整事件 p50 / p95 ms；24 请求 | 41.38 / 45.33 | 41.22 / 44.82 | 41.27 / 45.11 |
| c1 完整回复 p50 ms | 347.09 | 346.39 | 346.96 |
| c1 客户端 CPU ms/请求 | 27.92 | 10.42 | 28.33 |
| c1 三轮客户端 CPU ms（每轮 8 请求） | 170 / 230 / 270 | 80 / 80 / 90 | 230 / 220 / 230 |
| c8 首个完整事件 p50 / p95 ms；48 请求 | 44.16 / 50.43 | 44.14 / 48.88 | 44.75 / 49.75 |
| c8 客户端 CPU ms/请求 | 7.50 | 4.17 | 6.25 |
| c8 收到事件间隔 p95 ms | 20.74 | 20.75 | 20.79 |

40ms 生成等待不能算网络开销；间隔也主要由服务端节奏控制。
事件 CSV 同时保存 server emission 与 client arrival 的**相对单调时间**。
相邻 arrival gap 减 emission gap 只反映额外抖动，不能当精确单向延迟。
c1 这项差值 p95：A/B/C 为 0.123/0.091/0.121ms，样本内很小。

**Go 栈在此 SSE 节奏下没有展现更早出字，CPU 反而高于同版本 gVisor。**
这不是已定位的 Bug，更没有开启 mutex/block profile 后的锁竞争结论。
不能拿 JSON 突发带宽代替流式体验，更不能把 SSE 的生成限速用于吞吐排名。

## Hy2 仅证明备用链在本地能正确承载请求

每候选 24 个 32 KiB 突发回复和 6 个 SSE 回复，全部成功。
突发 TTFB p50 A/B/C：0.98/0.91/0.82ms；SSE 首事件 p50：42.59/42.39/42.40ms。
SSE 请求样本太少，不报请求 p95；这不是 Hy2 容量、国内抗干扰或 TCP 不通时成功率的证明。
没有叠加 Hy2 大文件下载的 mixed 性能批次；只用两个短 SSE 做同实例两 outbound smoke。

## 资源、失败与证据边界

- CPU 是 `/proc` 用户+系统 ticks 的增量，分辨率 10ms。极短 case 误差明显；
  0 tick 不等于没有 CPU 消耗。表中是三轮累计 CPU / 全部发出请求，包含内核后台活动，
  不是每个包的精确成本。[summary.json](raw/summary.json)另提供 CPU ms/HTTP-body MiB。
- c8 突发客户端 CPU 约 A 120–163%、B 137–145%、C 56–77%（100% 为一颗 CPU）。
  服务端约 27–84%，origin 约 27–84%，也会争用同宿主资源；不是独立服务器性能。
- 客户端采样最大 RSS：A 69.99 MiB、B 48.80 MiB、C 47.23 MiB。
  同一会话依次运行负载，包含此前 burst 的保留内存；不是干净启动 footprint，也不是峰值保证。
- p95 用 nearest-rank，少于 20 个观测省略；不报 p99。事件间隔不是独立连接样本。
  失败、超时和缺失都有独立计数；时间字段缺失时记录 observed 数，不伪造时间。
- 单次无损实验没有自然失败，**不证明零 Bug、国内稳定、丢包恢复或可发布**。
  未采集 contention、heap、GC profiles，不能说明 CPU 差异原因。

### 可复核数据

[原始测量 JSON](raw/measurement.json) · [请求 CSV](raw/requests.csv) ·
[事件 CSV](raw/events.csv) · [逐轮吞吐/资源 CSV](raw/cases.csv) ·
[启动阶段 CSV](raw/lifecycle.csv) · [摘要 JSON](raw/summary.json) ·
[命令、退出码、清理和原始文件哈希](raw/provenance.json) · [导出文件 SHA-256](raw/SHA256.json)。

JSON 仅省略 Orb hostname，保留原始请求、事件、资源样本；未提交测试私钥/身份配置。
export.py 可以从原始目录重建同样的导出。没有修改旧 A/B 数据。
