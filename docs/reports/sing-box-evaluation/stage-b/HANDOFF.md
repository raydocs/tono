# 受限阶段 B 已完成；目前不足以支持迁移或发布

本目录保存新增 B 证据，不覆盖阶段 A。实验工具与报告之外没有产品改动。
实验基线仍是 A 的定制 Mihomo，未换成 stock 或最新 main；B 开始时 main 的
差异另记于 [BASELINE.md](BASELINE.md)，不混入测量。GitHub 上传仅交付实验分支，
不创建/合并 PR、不打 tag、不发布、不更新客户源。

## 已执行的证据与未覆盖范围

| 分类 | 结果 |
|---|---|
| 已运行并通过 | 固定候选构建；最终功能门 68/68；同机串行 ABC/CAB/BCA 三轮真实 TUN，738/738 请求、0 超时、531,357,696 字节校验通过；自有 Reality/Hy2、错误 CA/SNI/认证拒绝、DNS TCP/UDP、fake-IP 访问、规则优先级、真实 reload、双出口并行承载、Core crash 与清理。A harness 3/3、B harness 4/4。 |
| 已运行但失败 | 前四次 parity 未过：测试 CA 初始化、reload 安全目录、隐式 DNS 与 fake-IP 地址冲突、DNS 查询目的地址落入未分配的 fake-IP 池。全部保留；最终配置修正后再测，不关闭校验或绕过安全目录。 |
| 环境不支持 | 内核未编译 netem，未做受控丢包/延迟；sing-box UDP offload ioctl 失败后走正常收发路径。不能推断国内运营商或公网损伤表现。 |
| 尚未执行 | 无上限吞吐、长时间稳态、匹配节奏的独立/混合负载对照、详细握手 hook、分配/GC、mutex/block 采样、reload 存量流连续性、完整 DNS/cache/IPv6 语义与跨机器二进制复现。没有“无锁竞争”结论。 |
| 需要原生 Mac/Windows | 已安装 Helper/Service 的 PF/WFP 精确规则和保护连续性、系统 DNS、Connected/UI 真实性、connect/cancel/retry/switch/sleep/crash、DIRECT lease、升级交接与 G1–G3。Linux harness 不能替代这些门禁。 |

命令和限额见 [工具 README](../../../../tooling/experiments/sing-box-bench/stage_b/README.md)。
逐样本 JSON/CSV、配置摘要、失败摘要和外部产物哈希见 [RESULTS.md](RESULTS.md)。
私钥、合成密码、私有配置、完整日志和二进制留在仓库外；不要上传整个 `/tmp` 目录。
外部路径只表示本 Orb 的保留记录，不是永久下载地址；可复现的小型脱敏证据已入 Git。

## 本地主线程只需接续两项产品修复验收

1. **A2-02 状态锁 / pin refresh：** [#170](https://github.com/raydocs/tono/pull/170)
   在所审源码边界已解决，已合并；真实 pending HTTP 测试与返回的 CI 结果见
   [AUDIT.md](AUDIT.md)。在 Windows 已安装包上保留慢请求，确认断开/generation
   不被刷新锁阻塞。本 Orb 没有运行原生计时验收。
2. **A2-01 热切换最终端点收敛：** [#174](https://github.com/raydocs/tono/pull/174)
   的被审修复地址明确、恢复路径保持保护；不等于 PF/WFP 故障注入已过。
   沿 [#171](https://github.com/raydocs/tono/issues/171) 在真实 union 安装、selector
   切换及受保护探测成功后，仅让第二次 exact replace 失败。确认不保持假 Connected、
   请求节点意图不丢、恢复后旧端点消失、DNS/保护不断档；再覆盖 rollback 不确定及
   switch/disconnect 冲突。macOS 区分 anchor load 前失败和 load 后失败的实际内核状态。

不另写产品补丁，不关闭 issue，不把这次源码复核当作发布验收。

## 后续实验值得收窄，不值得直接换内核

同一 sing-box 二进制下，Go 栈在每轮 24 MiB Hy2 下载中消耗 1.36/1.49/1.31
客户端 CPU 秒，gVisor 为 1.56/1.71/1.58；这是值得继续核查的有限信号。
三者吞吐约 98 Mbps，受共同 100 Mbps 配置限速，不能排容量高低；B/C 延迟范围重叠。
混合流量确实同时承载，但没有节奏匹配的独立对照，不能断言小请求“没有恶化”。

迁移前必须解决 [PARITY.md](PARITY.md) 中的合同差异：sing-box 的
`PUT /configs` 返回 204 但未应用配置，真正 SIGHUP 会重建 TUN；fake-IP TTL/cache、
DNS 地址/规则、证书 fingerprint 与 SPKI pin、统计和特权生命周期都不能机械翻译。

本轮到此暂停。若再次授权，优先做单一 CPU 诊断问题的独立 profile 轮次，或匹配
节奏的混合负载对照；扩大带宽/设备预算前先说明收益与限额。netem 缺失时不补造损伤
结论。当前证据不支持迁移，不支持发布，也不支持加入 1.2 秒隐式 fallback。
