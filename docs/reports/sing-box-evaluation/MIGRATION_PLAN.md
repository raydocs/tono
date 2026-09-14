# Tono → sing-box Go：迁移实施计划，不是发布批准

日期：2026-09-14。结论：**可以把 sing-box Go 作为替换目标，但不能只换二进制。**
先交付一个有真实 TUN、保护和数据面验证的 macOS 内部测试包，再完成 Windows 与升级链。
最终包只运行一个内核，不做用户可选双内核、隐式换协议、1.2 秒 fallback 或业务 POST 重放。
本文件是后续本地主线程的实施清单；本次只新增文档，未修改产品、安装内核或发布。

## 1. 固定身份；新计划不覆盖 A/B/B2/B3

| 项目 | 本次核对值 |
|---|---|
| 仓库 | [raydocs/tono](https://github.com/raydocs/tono) |
| 计划分支 | `docs/sing-box-go-migration-plan-20260914` |
| 计划起始提交 | [5d6f8c89](https://github.com/raydocs/tono/commit/5d6f8c891408d7a775133b9b5e3f2154b8a15875)，创建时工作树干净；本次 GitHub 查询的 `main` 同此提交 |
| 原始 A 基线 | [1d00b581](https://github.com/raydocs/tono/commit/1d00b581dffdd98e84821c8789eb0c46b7a21bed)，原 worktree 保留、未替换 |
| 当前两端正式内核 | `v1.19.30-tono-gvisor-adaptive.1`，Mihomo upstream [ac017cdd](https://github.com/MetaCubeX/mihomo/commit/ac017cdd246ce8bd547653d927e7bf77d7ee73d5)，MetaCubeX sing-tun `v0.4.22`，Go `1.27.1`，Tono adaptive patch |
| 本次查询的最新 alpha | [v1.15.0-alpha.3](https://github.com/SagerNet/sing-box/releases/tag/v1.15.0-alpha.3)，2026-09-13 发布，指向 [93fff595](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f) |
| 候选依赖 | SagerNet sing-tun `v0.9.4-0.20260912075549-869f0a4d76af`；与 MetaCubeX sing-tun 不是同一版本体系 |
| 已有 sing-box 实验二进制 | Linux/amd64/v2；SHA-256 `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df`；不是待安装的 Mac/Windows 包 |

这次的“最新 alpha”恰好就是 B/B2/B3 的 sing-box 源码提交，不是另一个未经测量的新候选。
实际开始实现时再次记录 release/main 差异，但不自动把上述固定候选换成下一版 alpha。
每个原生构建必须重新记录 GOOS/GOARCH/GOAMD64、工具链、tags、补丁、配置和签名后文件哈希。

当前 main 相对 A 有 42 个文件变化，包括两项 P2 源码修复、更新恢复/相位门禁、Tailscale
及依赖变更。**从当前集成代码实施，不从 A 恢复产品代码。** A 的性能证据也不能当作当前原生包性能。

- [热切换收敛修复](../HOT_SWITCH_CONVERGENCE_2026-09-13.md) 已随 PR #174 合入；保留 dispatch generation fencing、精确端点收敛和 protected recovery。
- [pin refresh 锁修复](../PIN_REFRESH_LOCK_2026-09-13.md) 已随 PR #170 合入；保留 HTTP 前释放锁、clone client 和 generation 复核。
- [#171](https://github.com/raydocs/tono/issues/171) 仍待安装设备验收，不能把“源码已修”写成 PF/WFP 已验证。
- 本次查询时 [#179](https://github.com/raydocs/tono/pull/179)、[#184](https://github.com/raydocs/tono/pull/184) 更新相关 PR 仍打开；由原负责人继续。迁移不能覆盖其 journal/installer 修复，也不关闭 [#26](https://github.com/raydocs/tono/issues/26)。

固定旧证据入口：
[A 审计](https://github.com/raydocs/tono/blob/7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1/docs/reports/sing-box-evaluation/AUDIT.md)、
[B 等价性](https://github.com/raydocs/tono/blob/3cfac37cd675c17a828ebf21c35df27e73f46705/docs/reports/sing-box-evaluation/stage-b/PARITY.md)、
[B2 网页/JSON](https://github.com/raydocs/tono/blob/3cfac37cd675c17a828ebf21c35df27e73f46705/docs/reports/sing-box-evaluation/stage-b2/RESULTS.md)、
[B3 长 SSE](https://github.com/raydocs/tono/blob/3cfac37cd675c17a828ebf21c35df27e73f46705/docs/reports/sing-box-evaluation/stage-b3/RESULTS.md)、
[B3 CPU 归因缺口](https://github.com/raydocs/tono/blob/3cfac37cd675c17a828ebf21c35df27e73f46705/docs/reports/sing-box-evaluation/stage-b3/CPU.md)。

### 性能证据支持试用，不支持“全面更强”

- B2：Go 在串行复用 JSON 突发中 CPU 更低、批次吞吐更高；c8/c16 与 sing-box gVisor 的吞吐区间重叠。不是网页整体加载倍速。
- B3：两批 30 秒合成 SSE，114/114 Reality、6/6 Hy2 完整。sing-box gVisor 的进程 CPU 比 Go 低约 72%–83%；Go 与 Mihomo 没有稳定 CPU 胜者，首事件/间隔也没有同幅度改善。
- 长 SSE 的 CPU profile 只解释少部分进程计数，根因未定位；没有 mutex/block 采样，不能说没有竞争。
- 全部是同宿主无损 Linux 真 TUN。未覆盖国内线路、原生点击到 Connected、PF/WFP、长时间稳定性和电量。

用户实际试用满意是选择 Go 内部候选的依据之一；不是省略下面安全/兼容门禁的依据。

## 2. 保留 Tono 的控制面和保护所有权

```diagram
┌─────────────────────────────────────────────────────────┐
│ Tono UI / 登录 / Tono 签发目录 / 签名策略 / 用户选择    │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 现有连接 owner：generation、取消、DIRECT lease、健康监控│
│ 新的受控 runtime JSON；同一策略/端点快照生成保护声明    │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ macOS Swift helper + PF/DNS / Windows Service + WFP/DNS │
│ 验证包和配置 → 形成保护 → 启动/停止 → 验证实际数据面    │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 一个 sing-box 进程：Go TUN、Reality、Hy2、路由和 DNS    │
└─────────────────────────────────────────────────────────┘
```

**不需要重写：** SwiftUI、Tauri/React 产品壳、登录计费、签名策略验证、节点身份、
家宽产品规则、现有 PF/WFP 引擎及其所有权、更新 journal 的基本状态机。
这些模块有必要的接口改动，但不是另造一个 VPN 客户端。

**默认不需要改 Worker/节点：** 目录仍可传送现有受限 YAML；客户端仅提取已准入的节点，
再生成自己拥有的 JSON。不能把云端原文交给 root sing-box，也不接任意订阅。
Reality/Hy2 的服务端可保持原协议。Hy2 验证语义若决定更改，才另立签发合同任务，见下一节。

**不采用：** 启动官方 GUI、让 App 自己提权跑 sidecar、用户切内核开关、全局大 Mutex、
一套覆盖所有内核的通用插件框架、把家宽失败改成云出口、把所有 UDP 开放。
旧版恢复是包级恢复方案，不是运行中的 Mihomo 自动兜底。

## 3. 完整替换前必须关闭的四个合同缺口

下列是迁移阻塞/差异，不是给现有产品新增四个 Bug。未关闭时可以继续离线开发，不能称为完整替换。

### 3.1 Hy2 的 DER 指纹不能改名当 SPKI pin

Tono 当前 Hy2 `fingerprint` 对应证书 DER 哈希；sing-box 的
`certificate_public_key_sha256` 对应叶证书公钥的 SPKI 哈希。
同一公钥重新签发的不同证书可通过 SPKI，但不一定通过原来的 DER pin。
候选 [TLS 源码](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/common/tls/std_client.go#L116-L145)
在该 pin 路径以自定义检查代替标准校验，不能写成“普通 CA + 主机名验证再额外加 pin”。

**默认计划是保留原验证合同：** 先用合成证书冻结当前接受/拒绝行为；若官方候选不能表达，
维护一个极小、固定、单独测试的 Tono DER-pin verifier 补丁，而不是搬 Mihomo TUN patch。
具体需覆盖 sing-box 实际 Hy2 TLS backend，不能只改一个未被使用的通用函数。
验证钩子替代标准验证必须执行规定的全部认证检查；禁止配置 `insecure` 或无校验成功分支。

若要求完全使用未修改的官方二进制，则必须先获得明确批准，重新设计 Tono 签发的
CA/证书/SPKI 认证合同和轮转规则；这不再是客户端字段转换。仅填新的 SPKI、分发 PEM
或改 SNI 都不能未经证明宣布等价。未定案时 Hy2 不可作为完整迁移已完成项。

验收：正确身份通过；错误 pin、错误身份拒绝；同 key 新叶证书、过期证书、名称不匹配
分别对照旧合同；不得扩大旧合同接受集合。内部 Reality-only 包可作为明确标注的阶段成果，
不能让发布包悄悄丢失手动 Hy2 备用功能。

### 3.2 reload 必须由 Tono 的受保护 owner 接管

候选 [PUT /configs](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/configs.go#L52-L71)
只返回 204；PATCH 仅处理 mode。B 已用“新规则仍未生效”复现。
[SIGHUP](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/cmd/sing-box/cmd_run.go#L187-L220)
检查后销毁并重建实例/TUN，不是无损热重载，也不能作为 Windows 操作合同。

首版统一采用 **check → 保持保护的 stop/start → 实例、DNS、数据面复核 → commit**。
不能机械调用现有“普通断开再连接”，因为普通断开可能包含释放保护/恢复 DNS；必须使用
现有 keep-armed 恢复/事务路径，并保留有界、不可被 UI 超时中止的安全收尾。
完整流程见第 5 节。必须接受并显示必要重建可能中断 SSE，而不是后台默默重启并保持 Connected。

### 3.3 DNS/fake-IP、系统 DNS 和 WFP 不能有两个不协调的 owner

B 中机械照搬 `198.18.0.0/15` 曾导致第一个 fake IP `198.18.0.2` 与隐式 DNS 地址冲突，
连接超时。当前 Windows DNS/NRPT 合同也引用 `.2`；不能只改内核 JSON。

计划：TUN 地址、虚拟 DNS 地址和 fake-IP 分配池明确不重叠；若改变池，例如保留旧虚拟 DNS、
把 fake pool 移到另一不相交子网，需同步更新两端验证器、PF/WFP、DNS 恢复和旧缓存处理。
具体地址选择需检查局域网/VPN 冲突后冻结，不直接把 Linux fixture 地址搬进产品。

候选 `dns_mode` 默认 `hijack` 会设置原生接口 DNS。首选设计是 Tono 继续唯一管理系统 DNS，
sing-box 设置 `dns_mode: disabled`，明确提供受保护 DNS listener 和需要的 `hijack-dns` 路由；
这是一项待原生验证的配置设计，不是已通过的包。
Windows `strict_route` 还可能自行安装 WFP 子层/过滤器，不能当作无害路由开关。
要么证明其与 Tono WFP 的优先级、生命周期和撤销行为兼容，要么关闭该内核侧功能，
由现有 Tono WFP 提供完整保护，并以包级拒绝测试证明没有放宽。此选择在 M0 冻结。

保持 IPv6 禁用策略；验证 A/AAAA、UDP/TCP DNS、CNAME、bootstrap、DIRECT 解析、fake-IP
缓存跨重建与节点撤销。不能直接用公共 DNS 解开保护后的死锁，也不能把 stale fake-IP 当真实 DIRECT 地址。

### 3.4 旧 DIRECT 的 controller proof 不能原样复用

Windows 当前检查 `/rules` 顺序/AND 子条件、`/proxies` 的 `Direct` 类型和物理 `interface`；
sing-box [规则投影](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/rules.go)
是另一套字符串语义，不完整保留该合同。`/version` 或 204 更不能替代证明。

M0 要形成最小的有效应用回执设计：generation、实际 PID/启动身份、二进制身份、不可变
root/SYSTEM runtime 摘要、policy revision/digest、端点摘要、选中 outbound、TUN 身份。
只在这一进程消费这一快照、必要 controller 读回及保护/数据面验证后提交。
**只读到磁盘上的 JSON/hash 不是生效证明。** 若现有观测不足以满足旧 DIRECT 验证要求，
必须补最小的实际规则/出站读回接口，或保留该门未过，不能删掉断言来取得成功。

## 4. 需要改哪些代码；按行为所有者改，不做全仓重命名

表中路径是现有实现定位，表示后续工作范围；本次并未修改这些文件。

### 4.1 固定内核构建与身份

- 新增专用 sing-box 构建入口，不在 `build-mihomo-adaptive.sh` 中混入第二套含义。只构建
  Tono 当前支持的 CPU/平台；上游支持其他架构不等于 Tono 增加支持。
- 固定源码/模块校验、Go 1.27.1；第一内部候选保留实验 tags
  `with_gvisor,with_quic,with_utls,with_clash_api`，运行只用 Go。`with_gvisor` 编译进去不等于
  运行第二个内核；以后裁减它是新构建身份，不假装与原数据同一二进制。
- Reality 需要 `with_utls`，Hy2 需要 `with_quic`，现有控制/观测适配需要 `with_clash_api`。
- 1.15 的官方文档推荐省略 `stack` 来使用新 Go 栈；固定 sing-tun 源码也接受 `"go"`。
  正式生成器遵循官方默认，identity 记录实际 Go 栈并做构造路径检查，不能错用旧 `system`。
- 两端 `core-identity.json` 更新为实际 engine/version/commit/dependency/compiler/tags/patch
  身份；不要继续填 `mihomoUpstreamTag` 并靠假版本字符串蒙混。当前这两份是构建元数据，
  不是已经存在的通用内核切换接口。
- CLI 由 Mihomo `-d/-f` 改为 `check -c <root-config>` 和 `run -D <root-dir> -c <root-config>`；
  版本命令为 `version --name`。版本/banner 只能辅助识别，不能替代签名/哈希/进程所有权。

定位：[现有构建](../../../tooling/scripts/build-mihomo-adaptive.sh)、
[macOS identity](../../../apps/macos/Tono/Resources/core-identity.json)、
[Windows identity](../../../apps/windows/app/src-tauri/core-identity.json)。

### 4.2 生成受控 JSON，继续使用已准入节点和策略

macOS：[ConfigPipeline+Runtime.swift](../../../apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift)
的 `buildOwnedTonoRuntime`；Windows：[config.rs](../../../apps/windows/crates/tono-core/src/config.rs)
的 `build_owned_runtime_with_ports` / `OwnedRuntime`。

| 当前合同 | sing-box 目标与必须保留的限制 |
|---|---|
| VLESS Reality | 映射 server/port/UUID/flow/SNI/public key/short ID/uTLS fingerprint；不是订阅原文透传，不改认证身份 |
| 同节点 Hy2 | 独立 outbound，但共享 Tono 节点身份；固定 password/SNI/认证参数和带宽/拥塞控制语义，不照搬量纲不同的字段 |
| `Tono-Exit` | selector + 明确初始选择；验证实际选择和已有流处理，不启用 urltest 自动择优或缓存覆盖用户意图 |
| 家宽节点 | 专用单成员出口，不得隐式返回云出口 |
| 链式 home SOCKS | 用被选出口作 detour；家宽 SOCKS endpoint 不得加入物理直连放行集 |
| DIRECT | 保留 process/domain/IP/port/transport 的交集、顺序和物理接口绑定；RE2/路径大小写/进程识别差异需验证 |
| 默认路由 | 无命中走指定 Tono-Exit；明确阻断规则不能因映射丢失或 sniff 覆盖而绕过 |
| DNS/fake-IP | 独立 DNS server/rules，保持代理解析和 bootstrap 边界；配置摘要覆盖地址规划和缓存策略 |
| controller/mixed | 随 generation 分配 loopback 监听和随机 secret；不监听 LAN，不下载 external UI |

不顺带引入远程 rule-set、自动 geodata 下载、其他新协议、内核管理系统代理或任意外部路径。
若需解析器/序列化器，用现有 Swift Foundation/Rust serde；不把格式转换升格为新的通用框架。
Windows `redacted_yaml` 不能用在 JSON 上。受控运行快照必须保有内核运行必需的凭据并保持
严格权限；审阅、日志、上传副本则按用途遮蔽嵌套的 `experimental.clash_api.secret`、UUID、
Hy2 password、SOCKS 凭据和敏感节点信息，不能只遮一个顶层键。

### 4.3 特权 helper/service、启动和实例所有权

**macOS 实际路径是 Swift helper，不是 Windows service 中的旧 Rust macOS 模块。**

- [CoreRuntimeManager.swift](../../../apps/macos/Tono/Core/CoreRuntimeManager.swift)：保留后台
  config-writer actor，输出 JSON/摘要；原生连接仍通过 helper，禁止用户目录二进制 fallback。
- [HelperManager.swift](../../../apps/macos/Tono/Core/HelperManager.swift)：调整 bundle source、
  安装核验、runtime 同步协议。helper 的标识/socket/授权所有者保持，格式能力不匹配要明确拒绝。
- [CoreManager.swift](../../../tooling/scripts/core-helper/CoreManager.swift)：原子 root snapshot、
  固定路径、8 MiB 上限、权限/digest 校验继续生效；增加固定内核的有界 check、改 run 参数。
- [helper main.swift](../../../tooling/scripts/core-helper/main.swift)：`ownedRuntimeConfigIsSafe`
  当前按 YAML 标志检查，必须换成受限结构校验；不可仅把字符串替换成 JSON key 检索。
- installed path `/Library/PrivilegedHelperTools/tono-mihomo` 的改名不是本阶段目标。
  第一版可保留受控历史安装路径而准确报告内核身份；如决定改名，必须与安装/清理/更新单独一致变更。
- utun 名称、ifindex 和 core 生命周期要联合核对；不能只看到同名 utun199 就接受第三方接口。

**Windows：**

- [structure.rs](../../../apps/windows/service/src/core/structure.rs) 的 `RuntimeBundle.yaml`、
  [assets.rs](../../../apps/windows/service/src/core/runtime_generation/assets.rs) 和
  [staging.rs](../../../apps/windows/service/src/core/runtime_generation/staging.rs)：协商新的 runtime
  格式/能力，改 SYSTEM 快照/manifest 处理；不把 JSON 偷塞进旧字段让旧服务误处理。
- [manager.rs](../../../apps/windows/service/src/core/manager.rs) 的 `core_args` 去掉 Mihomo
  `-ext-ctl-pipe` 等专用参数，保留 ChildGuard、Job、重启所有权和有界退出。
- App↔Service 的认证 IPC 保持；它不是 Core 的 Clash controller，不能因去掉 Core pipe
  连带去掉 owner token/SID/协议版本检查。需要的 Core controller 使用已验证 loopback secret。
- 当前 `secure_core_ipc_socket` 还用 `GetNamedPipeServerProcessId` 核对实际 Core PID 并设 DACL。
  去掉 pipe 后不能删除这项实例保证：需验证 TCP listener 的 OS 所有者就是所启动的 PID/Job，
  配合本代随机 secret、不可变快照和进程启动身份；端口被第三方抢占必须拒绝，不能只 GET /version。
- [core_integrity.rs](../../../apps/windows/service/src/core/runtime_generation/core_integrity.rs)
  继续验证安装路径与编译进 Service 的 SHA；不能为了跑 alpha 开启 test 豁免。
- Wintun 的打包/嵌入、加载和适配器身份按候选实际实现验收；保留 WFP AppId/PID/LUID 约束，
  重建后的 LUID 不得继承旧 TUN 许可。
- 不改 `StartClash` 等历史 IPC 名称，不合并三个 Cargo workspaces。

### 4.4 controller、UI 与遥测适配

macOS：[CoreControllerClient.swift](../../../apps/macos/Tono/Core/CoreControllerClient.swift)、
ProxyService/CoreWebSocket；Windows：[controller.rs](../../../apps/windows/app/src-tauri/src/tono/connection/controller.rs)、
`tono-plugin-core`、现有 traffic/connections hooks。

- 逐个适配实际使用的 API，不假定整个 Clash API 等价：version、selector、delay、connections、
  traffic、logs、DNS。候选有 `/dns/query`，但真实地址/fake 地址、回答格式、DIRECT 解析用途仍须验证。
- 候选 delay 处理与 Mihomo 的 unified-delay 不同；统一使用授权 HTTPS 验证目标，并准确标注其含义。
  不从延迟测试反推 Reality TCP/TLS/认证内部时间，不拿它代替应用数据面验证。
- `/rules`、Direct outbound interface、chains 顺序、processPath、统计 reset/累计口径单独验证。
  不支持的观测显示“不可用”，不填 0、不伪造路由/进程归属。
- `DELETE /connections` 在候选中还会 reset network，不能当作清一个 UI 表格的无害操作。
- 连接日志改为结构化映射到现有有界管道。保留 scope/consent、重试上限和脱敏；默认日志不能
  因换内核扩大现有采集范围。凭据/Authorization 不入遥测；hostname/访问记录仍须经过现有
  明确授权和白名单，不能把 core 原始日志直接上传，也不记录 AI prompt/回复正文。
- UI 布局不重做。保留现有阶段枚举，修改其实际触发点；更新期间显示 securing/verifying 或
  受保护恢复，只有系统 TUN + 受保护 DNS + PF/WFP + HTTPS 成功才显示 Connected。

### 4.5 DNS 与 endpoint/policy 必须来自同一事务快照

macOS：`AppState+Connect.swift`、`AppState+Proxy.swift`、`AppState+Catalog.swift`、
helper `KillSwitchManager.swift` / `KillSwitchPF.swift` / DNS 合同。
Windows：`connection/{stages,direct,switch,monitor}.rs`、`connection_health.rs`、
Service `windows_kill_switch.rs` 和 `dns/mod.rs`。

- 同一 admitted node/policy/lease 快照生成 JSON 与端点 permit；不能各自重新读可变 catalog。
- Reality 只允许指定 IP:port/TCP；Hy2 只允许指定 IP:port/UDP；TUN 路由排除不等于放行权限。
- DIRECT 解析、有效期、心跳/watchdog、撤销和物理网卡绑定继续有效；晚到回调不能复活旧 lease。
- 保护必须早于内核和授权端点使用。启动/退出/崩溃/取消/重建/安装失败均不能释放新一代保护。
- 更新生成期间的健康监控认识正在进行的保护事务，不能成为第二个重启/写规则者。

## 5. 把轻量切换与破坏连接的完整重建分开

### 已加载出口间的用户切换

沿用已有 owner：临时 old ∪ new 精确端点 → selector → 实际新出口验证 → new-only
精确收敛 → 发布完成。每步携带 dispatch generation；最后收敛失败进入 keep-armed recovery，
不能继续 Connected，也不能回退到 A 的旧逻辑。

需验证 selector 的 `interrupt_exist_connections` 与实际 TUN/Hy2 流语义。
如果保留旧流需要继续开放已撤销的旧节点，则以保护合同为先，中断并解释；不能宣传无损切换。
不要无条件 close-all，把与切换无关的 SSE 一并杀掉。

### 必须修改路由/DNS/节点集合的更新

1. 捕获一个 immutable generation/policy/catalog/lease/endpoint 快照；相同有效内容不重建。
2. 生成受限 JSON，安全暂存，执行有界 `check`；失败不干扰仍合法的旧会话。
3. 进入现有受保护事务；若旧策略已撤销/过期，先限制权限，不能以保流为由延迟撤销。
4. 停止并确认旧 PID/Job/TUN 的退出；超时不启动第二个内核，不清理其他实例资源。
5. 启动新进程，确认已知二进制、只读快照、随机 controller 凭据和新 TUN 实例。
6. 校验实际选择、DNS/fake-IP、DIRECT 应用证据及系统 TUN HTTPS，完成精确保护收敛。
7. 仅仍属当前 generation 的事务提交状态/统计起点；Connected 不能早于这些证明。
8. 失败保留保护。只有旧快照仍被当前策略/lease 授权才可恢复旧配置；否则 Protected Offline。

这不是新增任意全局锁。沿用 connection coordinator/privileged writer，等待 IPC/网络/退出时
不持有 UI/TonoState 锁；取消只使结果过期，不代表特权工作已经完成。

减少 AI 流中断的首版措施是：不因统计/UI刷新 reload、无变化不 reload、合并同一已捕获更新。
**不能合并掉权限撤销、延迟过期规则执行或偷偷重放请求。** 若正常 DIRECT/pin 刷新仍频繁
重建导致 SSE 体验不可接受，则迁移包不通过体验门，另评估有证据的增量 apply，不假装是优化。

## 6. 打包、安装、恢复也要一起迁移

- Windows 保留包级 `tono-core.exe` 名称；先构建最终核心，再把对应 SHA 注入 Service，
  再构建 App/Service/Installer。核对 NSIS、sidecar、`core-sha256.txt` 和实际落盘文件一致。
  涉及 [build-windows-release.sh](../../../tooling/scripts/build-windows-release.sh)、
  [tauri.conf.json](../../../apps/windows/app/src-tauri/tauri.conf.json)、Service installer 和包核验脚本。
- macOS 核心必须与 helper/App 按现有 Developer ID 流程签名，并在包核验/公证流程中可见；
  [package-macos-dmg.sh](../../../tooling/scripts/package-macos-dmg.sh) 当前显式检查 Resources/mihomo。
  不能改个下载 URL 跳过签名，不能把下载目录作为 root 可执行入口。
- journal 当前记录 coreVersion/coreSHA 等，macOS `AppState.swift` 还有 Mihomo 固定版本。
  更新为真实受信构建身份；必要的 schema/protocol 升级需明示，不让旧 App 配新 Service/反之静默运行。
- 验证：旧 Mihomo 安装 → sing-box 候选；安装中失败；首次启动失败；保护恢复；恢复旧实现。
  每次记录实际包哈希、helper/service 协议和 journal 相位，不能把 Git checkout 当安装回滚。
- 保存已验证旧包和源码。Sparkle 不接受低 build number；客户恢复须重新发布更高 build 的
  已验证旧实现并走正常批准，不能承诺降级开关。内部手动重装也必须先完成受保护交接。
- 分发前核对 GPL-3.0-or-later、对应源码/补丁/构建说明和 Wintun 等第三方义务。
  sing-box LICENSE 还有命名/关联声明要求，需专门核对；“子进程运行”不免除分发义务，
  也不在本计划里擅自裁定整个客户端的法律结论。

## 7. 实施顺序与每阶段的完成条件

以下是未来的窄提交/工作包，不是本次自动创建 PR 的指令。本地主线程拥有产品实现与整合，
Windows owner 负责对应原生 Service/App 验证；Orb 只做实验、差异复核和证据整理。
不在共享 worktree 与本地主线程同时修改产品文件。
平台实现按 [RELEASE_LINES](../../RELEASE_LINES.md) 从各自 `release/macos` / `release/windows`
建立功能分支；若尚未包含上述 main 修复，由主线程先正常集成，不回退到 A、不改写历史。
本计划以 main 盘点代码，不授权直接推 main 或发布，也不替现有 SHIP_PLAN 指定新的客户版本号。

| 顺序 | 交付范围 | 完成条件 | 对应门 |
|---|---|---|---|
| M0：冻结合同 | 候选/build manifest；Hy2 认证决策；DNS/WFP 所有权；DIRECT 读回设计；当前 main 修复保留清单 | 四项缺口有可测试方案，不能只有“check 成功”；验证器负样本成立 | G1/G2 |
| M1：纯配置和内核验证 | Swift/Rust owned JSON、脱敏、固定核心构建；仍不替换客户包 | 同一合成节点/策略语义，两端 JSON 通过固定候选 check；端点、规则优先级和拒绝行为实际验证 | G1/G2 |
| M2：macOS 内部竖向切片 | helper 启动/停止、Go TUN、Reality、系统 DNS、真实 Connected、取消/崩溃 | 用户能装内部包、正常浏览/长 SSE；PF 全程保持，真实断开还原；明确标注尚缺的 Hy2/DIRECT 项 | G1 |
| M3：macOS 功能完整 | Hy2、家宽/链式路由、DIRECT、selector、受保护整份重建、统计/日志 | 不丢现有功能，不错误 Connected，无频繁重建导致 SSE 回归；故障注入与安全负样本通过 | G1/G2 |
| M4：Windows 功能完整 | Rust JSON、IPC 版本、Service/WFP/DNS/Wintun、controller/UI/统计 | 已安装 Windows 真机同等验收；PID/LUID/Job/旧端口恢复正确 | G1/G2 |
| M5：安装更新及内部验收 | 两平台包级身份、旧版升级/失败恢复、证据文档与许可证 | G3 真机流程和已存在 updater 修复均通过；只形成可审阅内部候选 | G3 |

M2 可以让用户先体验 Go，不必等 Windows 全部完成；但 **M2 不等于可以从正式 Tono 删除 Mihomo**。
M2 使用明确的测试范围；若已签发策略要求的家宽或 DIRECT 行为尚未实现，应拒绝该会话，
不能借“内部包”把必须走家宽的 AI 流量改送云出口，或忽略现行策略。测试夹具不是生产准入证明。
只有 M3/M4/M5 完成才考虑移除当前包构建依赖/死路径；历史产物、A/B 证据和可恢复源码不删除。
不以迁移名义清理全部 Clash 遗留名称。

粗估，不是承诺工期：已有 Mac/Windows 设备、签名能力和连续开发时，M0/M1 约 2–4 工程日，
macOS M2/M3 约 4–7 日，Windows M4 约 4–7 日，M5 约 3–5 日，串行约 **13–23 工程日**。
可能重叠的配置测试不等于可以并行修改同一生命周期代码。认证补丁、DIRECT 读回、原生 DNS/WFP
或更新门禁若卡住，单列延期；不要通过减少保护来保住估算。

## 8. 验收以网页/AI 流为中心，不再做巨大文件吞吐竞赛

### 必须执行的窄验证

| 行为 | 最窄的反例/观察点 | 环境 |
|---|---|---|
| 配置和签名准入 | 未准入字段/端点或错误身份不得因 JSON 转换被接受 | Swift/Rust + 隔离 core |
| Hy2 认证 | 正确 DER 对照同 key 不同叶证书；错误 pin 必须失败 | 合成证书 + 原生包 |
| 真正 reload | 改一个已知目标的路由/拒绝行为，必须发生实际变化；204 不能过 | 隔离 + 原生 |
| DIRECT 应用 | 错接口或删一项规则条件不能被判为目标 DIRECT 图已生效 | 原生 + 控制面读回 |
| DNS | 首个 fake IP 实际连通；DNS 目标不能落进 fake pool；TCP/UDP A/AAAA 与撤销分别核对 | 原生 |
| 快速操作 | cancel/断开与晚到启动回调竞争，旧一代不得杀新核心/释放新保护 | 真实连接 owner + 原生 |
| 最终端点收敛 | union/选择/验证成功，只让最后 new-only 更新失败；不得留 Connected | 已安装 Mac/Windows |
| 内核 crash/重建 | 包级观察 PF/WFP、DNS、旧 PID/TUN 消失、新实例验证，不能有保护空档 | 已安装 Mac/Windows |
| 默认日志与统计 | 凭据不入日志；旧 generation 的 WS 不污染新会话；计数 reset 不产生巨量流量 | 原生 UI/遥测 |
| 更新和恢复 | 旧包升级，拒绝/超时/首次启动失败时 journal 与保护仍正确 | 两台已安装设备 |

沿仓库原则：每个改动行为一项最窄真实回归，优先现有框架；不复制状态机凑测试。
必要的故障情形按修改范围运行，不自动全仓/多轮供应链审计。helper/FSM 实质改变时执行仓库
要求的较广原生套件；本计划本身是 docs-only，不跑产品测试。

### 用户实际体验的记录口径

- 一次原生连接分开记录：点击 → securing/PF或WFP → 内核/控制器就绪 → 受保护 DNS →
  系统 TUN 首次 HTTPS 成功 → Connected。只报告实际埋点；没有 hook 不拆 Reality 内部握手。
- 自有 HTTPS：小 JSON 突发、30–60 秒合成 SSE，并发 1/8；实际 H1/H2/复用与 H2 多流证据。
  首事件、间隔、完整性、失败/超时、CPU 原值、CPU/流秒、RSS；profile 与正常轮次分开。
- 新批次事前预算 ≤256 MiB，至少保留独立轮次，候选串行。不用 100 Mbps 限速结果排名，
  不上传几十 GiB。对网页价值看端到端耗时和卡顿，不把原生 CPU 与旧 Linux CPU 混算。
- 浏览器看真实页面请求、切页、多个 AI 标签页、长回复取消；不拦截 TLS、不记录 prompt/token。
  原生账户试用由用户使用其获授权账户；Orb 不接真实 AI 凭据、不压测第三方。
- Hy2 定位是用户手选备用传输；在获授权国内端验证 TCP 不好用时 UDP 是否实际可用。
  本 Orb 缺 netem，也没有三网入口，不能承诺国内弱网更稳定。

## 9. 何时可以做什么

**现在可以决定：** 以固定 sing-box Go 为内部迁移目标，授权本地主线程按 M0→M2 做竖向切片。
**仍不能决定：** Go 全面胜出、Hy2 认证已经等价、替换会根治卡顿、可以发布或关闭 G1–G3。

若用户只要尽快看到效果，第一交付应是 M2 的有保护 macOS 内部包和明确缺项，不是把官方
alpha 放进 Resources 后立即分发。完整替换前必须解决 Hy2、DIRECT、DNS 与更新交接。

本次实际执行：固定 main/候选核对、相关源码和旧实验报告读取、编写此计划、文档检查。
尚未执行：新构建、新网络实验、产品修改、包安装、原生验证、迁移、PR/合并或客户发布。
计划仅上传独立文档分支；实施/迁移以及之后的发布仍由用户与本地主线程另行授权。
