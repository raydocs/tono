# M0 冻结合同 v1：Reality TCP，无特殊路由

本目录由一个 owner 维护。版本为 `contract_version=1`，profile 为
`reality-tcp-no-special-routing-v1`，固定候选见 [candidate.json](candidate.json)。
**冻结不等于完整安全等价或已安装验收。** 本合同允许 M1 实现离线生成/拒绝/构建检查，
不允许把草稿接入产品启动。M2 必须经过 M1 审查及原生保护接线。

## 1. 范围与明确拒绝规则

v1 仅支持已准入的公网 IPv4 VLESS Reality 节点集合、用户指定的一个出口、IPv4 TCP，
以及由该出口承载的 DNS。没有家宽、DIRECT、Hy2、tailnet 或自动换出口能力。

两端不得在降低要求后再次调用生成器。必须检查 **完整目录路由、完整策略以及派生 plan**，
不能仅凭 `directPlan == nil` 判定策略没有要求，也不能从已过滤的空列表推断安全。

| 输入情况 | v1 结果（稳定错误代码，不带凭据/完整配置） |
|---|---|
| 缺失/未验证/过期/撤销的 catalog 或 policy 上下文，或身份/digest/revision 不一致 | `TONO_SINGBOX_UNTRUSTED_SNAPSHOT` |
| policy v1/v2 或未知版本；v3 的 domains/mediaEndpoints/webDomains/directSuffixes 任一非空 | `TONO_SINGBOX_UNSUPPORTED_POLICY` |
| 有任何 native/web DIRECT 要求、DIRECT lease 或派生 DirectPlan，即使 plan 暂为空 | `TONO_SINGBOX_UNSUPPORTED_POLICY` |
| 原始路由中存在 homeProxy 或 homeSocks5，即使无效/空字符串；或现有派生规则要求家宽 | `TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE` |
| 任何节点为 Hy2/其他协议，或要求 tailnet/SOCKS transport | `TONO_SINGBOX_UNSUPPORTED_TRANSPORT` |
| 要求新的 DNS、IPv6、UDP、sniff、remote rule-set 或未定义能力 | `TONO_SINGBOX_UNSUPPORTED_POLICY` |
| 选择不在完整已准入集合、节点数量不在 1..200、非法/重复/保留节点名或非法 Reality 字段 | `TONO_SINGBOX_INVALID_NODE` |
| 缺 uTLS fingerprint 或 fingerprint 不是 v1 支持的 `chrome`；不得默认猜一个 | `TONO_SINGBOX_UNSUPPORTED_FINGERPRINT` |
| listener 非 loopback、端口非法/冲突、控制 secret 不是标准 base64 的 32 bytes、平台不支持 | `TONO_SINGBOX_INVALID_CONTROL` |

v3 空策略是必要但非充分条件：现有 product defaults/派生 plan 仍有 DIRECT 或家宽要求时照样拒绝。
未知要求必须失败，不丢字段、不自动转成“全局代理”。这可能拒绝当前许多真实账户，必须在内部包
标注；不为扩大试用覆盖而修改生产目录/策略。
当前 macOS `ManagedDirectRuntimePolicy` 的 `nativeAppDirect` 默认值就是 true；Windows
`DirectPlan` 还携带 reviewed ports、进程与后缀规则。不能把这些元数据从输入删掉来满足 v1。
节点的常规浏览器 TCP 流量走本 profile 不是策略“要求全部 TCP DIRECT”；二者必须区分。

M1 fixtures 是合成离线输入，不含有效签名，不得作为已验证的产品快照或 privileged IPC。
产品信任仍由现有目录/策略准入与 owner 建立。M1 不新增接受任意 JSON 的产品接口，不伪造
`verified=true` 供 M2 消费。M2 若不能从真实已验证来源证明 v1 可用，则拒绝连接。

## 2. 两端共享的是输入/输出语义，不是新的服务端协议

M1 各平台在现有 config owner 内新增 opt-in 生成入口，**不替换既有 Mihomo 默认函数**。
不改 Worker 签发格式、Service IPC epoch、helper protocol 或 journal schema。

输入概念必须齐全（native 类型沿用已有类型，不再复制一套节点准入规则）：

| 输入 | 不变量 |
|---|---|
| `nodes`, `selected` | 来自同一已准入 catalog；保留节点名和集合顺序；不静默删除 Hy2/坏节点 |
| `catalogSnapshot`, `policySnapshot` | 同一 owner 捕获的不可变文档/修订/摘要和验证结果；不是只传可变全局对象 |
| `catalogRouting`, `directPlan`, `derivedRequirements` | 必须包含原始要求及现有默认/派生规则；缺少信息不是无要求 |
| `platform` | `macos-arm64` 或 `windows-amd64-v2`；Linux 仅检查 fixture，不是产品目标 |
| `controllerPort`, `mixedPort`, `controllerSecret` | controller 1..65535，mixed 0 或 1..65535；均不得为 53，非零 mixed 不得等于 controller；0 表示不生成 mixed inbound |
| `generation` | 沿用原生 owner 的 uint64 fencing；生成器不递增、不发布连接状态 |

两端输出名为 `SingBoxRuntimeDraft`，包含三个不同用途的产物：

1. `runtimeJSON`：UTF-8 JSON，无 BOM；结构化序列化，不拼接不受信任标量；包含必要凭据，
   只能交给受控 root/SYSTEM staging。最大 8 MiB，未知字段拒绝；它本身不是生效回执。
2. `runtimeSHA256`：上项实际字节的 SHA-256 小写 hex；不是 canonical JSON 的假定哈希。
   两端排版可不同，结构/数组顺序必须与 reference 等价；摘要各自绑定实际写入字节。
3. `dialEndpoints`：仅选中出口的一条 `{host, port, transport:"tcp"}`，沿用原生端点类型。
   不含 DoH 服务器、不含其他候选，不是已经装入 PF/WFP 的证明。

generation/catalog/policy 身份由调用方与 draft 一起保留，不塞进 sing-box 不支持的 JSON 字段。
现有 policy/catalog 摘要保持原来的 base64url(sha256(raw UTF-8))、revision 语义；
不要改成 config 的 hex，也不要重新序列化签名文档后验摘要。
现有 DIRECT endpoint digest 算法不改；v1 不创建 DIRECT lease。

审阅/日志输出只暴露 profile、节点数量、匿名选择、摘要和错误代码；必要的完整脱敏预览
必须结构化替换 controller secret、UUID、pin/认证材料和敏感节点字段。原始 config/secret
不得进入 debug 派生、panic、错误字符串或遥测。不要将脱敏副本当可运行配置。

## 3. 固定 runtime 形状与规则优先级

[reference.json](reference.json) 是手写期望，不是从待实现生成器反推的 golden。
包含一个双节点不对称 fixture：选择第二个节点，端口也不同；因此能抓住“总选第一项”错误。
下面是唯一允许的 v1 差异；其余字段必须按 reference，不允许平台自行增加直连规则。

- macOS `interface_name=utun199`；Windows `interface_name=Tono`。
- 每个 VLESS outbound 使用节点原名作 tag，保留 catalog 顺序。selector `Tono-Exit` 的
  default 为 selected，outbounds 数组 selected 在前，其余保持 catalog 顺序。
- UUID 使用现有准入规范化结果；server/port/SNI/Reality public key/short ID/flow 不改身份。
  `flow` 缺失时不生成；存在只能为 `xtls-rprx-vision`。`utls.enabled=true`、fingerprint 为
  显式已准入的 `chrome`。public key 必须能解码为 32 bytes，short ID 为 1..8 bytes hex。
- 节点复用现有公网 IPv4、长度、控制字符、保留名校验；Rust 的公开 `ValidatedNode` 类型
  不等于构造不可伪造，M1 边界须重新确认不变量。不能削弱现有准入以容纳 fixture。
- 在既有保留名之外，两端额外拒绝 `Tono-TUN`、`Tono-DNS`、`Tono-Mixed`、`Tono-FakeIP`、
  `Tono-DoH`，防止与本 profile 的固定 tag 混淆；`Tono-Exit` 已由原准入保留。
- port/secret 按输入生成，controller/mixed 固定 `127.0.0.1`；mixed=0 删除该 inbound。
- `route_exclude_address` 为所有已准入节点 IPv4 的去重 `/32`，按 IPv4 数值排序；这只决定路由，
  不授予权限。PF/WFP 仍只允许当前选中 tuple，不能把整个列表拿去放行。
- `stack` 字段不输出；固定 sing-tun 的空 stack 分支确实调用 NewGo。`multi_queue=false`，
  proxy mux 不生成，persistent cache 禁用，日志 warn，无 external UI/下载/profile listener。
- controller CORS 固定仅 `tauri://localhost`，不允许 private-network CORS；原生 HTTP/IPC
  客户端不依赖浏览器 Origin。CORS 不是认证，secret 与 OS listener 所有权必须另验。

路由顺序固定为：IPv6 reject → 专用 DNS inbound hijack → port 53 hijack → UDP/ICMP reject →
最终 Tono-Exit。DNS 规则固定为：AAAA 空 NOERROR → A fake-IP → 其余使用代理内 DoH。
不生成 DIRECT/bypass、sniff override、urltest、UDP exception、rule-set 或 platform proxy。

### DNS / TUN 所有权决策已定，原生证明未完成

| 字段 | v1 决策 |
|---|---|
| TUN address | `198.18.0.1/30` |
| 虚拟 DNS | 显式 `198.18.0.2`，与 fake pool 不相交 |
| fake IPv4 | `198.19.0.0/16`，不生成 IPv6 pool |
| DNS listener | core 提供 `127.0.0.1:53` 的 TCP/UDP；原生 owner 设置/恢复系统 DNS |
| `dns_mode` | `disabled`，不让内核同时设置系统 DNS；显式 DNS 路由仍保留 |
| `auto_route` / MTU | true / 1500；原生须先检查冲突，不能抢第三方 TUN/路由 |
| `strict_route` | false，避免内核另建 WFP 保护层；Tono PF/WFP 是唯一保护 owner |
| DoH | v1 单个 `https://1.1.1.1/dns-query`，普通 TLS 验证，detour Tono-Exit；无本地/直连 fallback |
| cache | DNS 内存缓存可用，无持久化 fake-IP/选择缓存；重建后缓存连续性不保证 |

**这是受限候选，不宣称等价于现有双 DoH 冗余。** 主 DoH 失败则连接验证失败，不切节点。
需要双 resolver、特殊 DNS 或其他网络能力的策略不属于 v1。DNS 地址/fake pool 变动必须与
原生校验器和恢复逻辑原子接线；仅生成 JSON 不授权修改机器。
关闭 core `strict_route` 只有在 Tono PF/WFP 已证明完整拒绝语义后才能用于 M2；若原生证明
失败，就阻止启动并回报，不由平台 worker 自行打开另一套过滤器或降低 Tono 保护。

## 4. 认证冻结：M1 不引入 Hy2 认证补丁

当前固定 sing-box 的 SPKI pin 与 Tono Hy2 DER pin 不等价，见原迁移计划和 B PARITY。
**v1 明确拒绝 Hy2，不转换 pin、不改 SNI、不设置 insecure，不修改签发或生产节点。**
因此 M1 构建保持 upstream 原样、patches=[]，不是“Hy2 问题已解决”。

后续启用 Hy2 需要单独合同版本：冻结现有 DER 接受/拒绝行为，覆盖真实 Hy2 TLS backend，
验证正确/错误 pin、同 key 新叶证书、名称和有效期；或由用户明确批准认证合同迁移。
平台 worker 无权在 v1 中偷偷采用 SPKI/PEM 替代。Reality 内部认证与普通 CA TLS 不混称。

## 5. 生命周期冻结：draft、启动回执、Connected 分开

M1 只返回 draft；没有权限启动、写系统 DNS/PF/WFP、持有 DIRECT lease 或发布 Connected。
M2 不新增第二个连接状态机，沿用现有 coordinator/generation 和特权资源 owner。

固定语义（不是本批新增的 IPC 路由/字段）：

1. `prepare`：检查完整要求，生成/安全暂存不可变 JSON，用固定可执行文件有界 `check`。
   `check` 成功只表示解析/构造通过，不表示端口、TUN、网络或认证成功。
2. `startProtected`：原生 owner 已捕获 generation、策略与授权端点；形成 PF/WFP 保护后
   启动已验证的 root/SYSTEM core，`run -D <owned-generation-dir> -c <immutable-json>`。
3. `verify`：实际 PID/启动身份/二进制 SHA + OS controller listener 所有者 + 本代 secret；
   新 TUN ifindex/LUID；受保护 DNS；系统 TUN HTTPS；精确选中端点收敛。
4. `commit`：全部证明属于当前 generation 才可 Connected。回执保存实际 runtime SHA、
   catalog/policy revision+digest、所选 tuple、PID/start identity、TUN identity 与验证结果。
   文件存在、HTTP 204、端口能连、version 字符串或伪造 draft 元数据都不能代替。
5. `stopProtected`：沿用现有 keep-armed cleanup，确认旧 PID/Job/TUN 退出后才允许下一次启动。
   超时/取消只使 UI/attempt 结果过期，不视为资源已释放，不启动第二个实例。
6. 必须完整 reload 时走以上受保护 stop/start；禁止 `PUT /configs` 假成功、Windows SIGHUP
   假设、普通 disconnect 隐式释放保护。相同有效配置不重建；过期/撤销不能为保 SSE 延迟。

v1 不提供在线 selector 切换给产品。将来启用时仍需 union → selector → 新出口验证 →
new-only 的精确收敛，保留 #171 已修 generation fencing；收敛失败不得保持 Connected。
旧快照只有仍被当前授权允许才可恢复，否则 Protected Offline；不 replay POST，不自动 fallback。
DIRECT 生效读回目前不够，v1 以拒绝处理，不用空 `/rules` 证明它已实现。

### 与 #26/#179 的边界

M0/M1 不修改 installer、journal、AppUpdater、NSIS、helper 安装入口或 Service 协议。
M1 不把产物复制到 Resources/sidecar，不修改正式 core-identity，也不调用产品安装模式。
M2 必须在审查时列出将修改的安装/协议文件，与 #26/#179 owner 协调；出现文件级重叠先停写。
保留已合入 journal 原子性/相位/恢复修复；版本兼容失败必须拒绝，不由新内核绕过更新门禁。

## 6. M1 分工接口与审查门槛

Puck 分派前引用本批精确 commit，不能仅说“最新文档”。任何 worker 发现无法满足时回报
PARITY_GAP/UNSUPPORTED，不能修改本目录或私自发明同名 v2。

| 工作包 | 建议独占路径 | 必须产出 |
|---|---|---|
| 构建/固定认证边界 | 新 `tooling/scripts/build-sing-box.sh`、`tooling/scripts/sing-box/**` | 消费 candidate.json；固定源码/模块/编译器；只构建/check 到显式仓库外目录；每目标 manifest+SHA；无产品安装/Hy2 patch |
| macOS 离线 emitter | 新 `apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBox.swift`、对应一个 XCTest 文件 | 复用节点准入；要求拒绝；按 reference 生成 draft；不接 start/helper/UI |
| Windows 离线 emitter | 新 `apps/windows/crates/tono-core/src/sing_box.rs`、`src/lib.rs` 的单行模块导出、该模块窄测试 | 同一 profile 与错误语义；不改 Service/App launch、Cargo 锁或 journal |
| 集成证据/共享合同 | 本线程独占本目录；必要的跨平台 fixture 检查由协调 owner 单独拥有 | 固定源码与构建哈希，结构差异解释；审查所有要求拒绝路径后决定是否允许 M2 |

这些是路径分配建议，不是已经启动的并发任务。root AGENTS/正式构建脚本/CI 不在 M1 默认修改范围。
跨平台 API native 类型可以不同，**支持范围、错误代码、字段映射、规则顺序、身份与拒绝条件不可不同**。

M1 最小证明：正向 reference 结构一致；选择第二节点不被第一节点覆盖；必要家宽/非空 policy/
派生 DIRECT/Hy2/未知要求不能产出可运行 draft；secret 脱敏；实际固定 core check；坏配置/超时
不能计为成功。每个变化行为一个窄回归，不复制状态机，不自动跑全仓迁移测试。
Swift 的实际 XCTest 交 GitHub-hosted macos-26；Rust 在 Orb 可跑 portable tests，Windows 原生
验证交 windows-2025/Windows 设备。MacBook 不编译。测试必须与每批提交 SHA 对齐。

M1 的 parser/check 不能证明 TLS 握手、规则数据面或 PF/WFP。需跑真实隔离 I/O 时必须先列出
获授权的合成服务与隔离方案；不能启动 reference 中的公网示例地址。
M2 审查门：M1 证据完整、未支持要求确实拒绝、无生产调用点、原生保护/安装路径所有权已协调。
没有内部安装包、没有性能承诺、没有发布许可，不能把阶段交付写成 Tono 已更换内核。

本批实际检查与源码锚点见 [VALIDATION.md](VALIDATION.md)。M0 的“冻结”是把 v1 的实现输入固定
供 M1 交审，不是关闭原迁移计划的四项完整替换缺口。产品拒绝回归、Hy2 合同、DIRECT 生效读回
与原生保护仍不能用本批 core `check` 代替。
