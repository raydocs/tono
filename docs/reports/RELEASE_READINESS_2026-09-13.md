# 2026-09-13 客户候选集成审计（G1 / G2 / G3）

## 结论

基线 `main` `677d0f1f`，本地分支 `fix/g1-telemetry-readiness-20260913`。
六项 Windows 修复已经在基线，不是未提交工作树。#137/#138 经普通 merge 保留历史，
冲突解决时保留 main 的连接/保护合同，不恢复旧堆叠分支的探针与 DNS 实现。

**可继续内部验证，不能宣布发布就绪，也不能把原始日志默认开启当成端到端验收通过。**
G1 真机、G2 真实日志采集和三网手动 hy2、G3 受保护更新均未过门。
版本仍是 0.0.72；客户下一发按 SHIP_PLAN 为 0.0.73，不重写已有标签。

## 本轮修复

- 默认新安装开启网络日志；macOS / Windows 均保留已有 false，包括无法区分历史默认与用户关闭的值。Windows 偏好读取/解析失败不默认为上传开启，不覆盖损坏证据。
- 路由字节的 HTTP 成功只确认发送前快照，保留在途新增量；账户/保护快照授权切换推进 epoch，迟到确认不得跨越边界。
- DIRECT 自有 fail-closed reload 期间，网络事件触发的 HTTPS 探针也不得拆掉 reload；真实保护失败、Core 变化及超时仍按原路径处理。
- 修复 Windows 新路由账本把 REJECT 留在活动计数表导致的失败测试。
- 修复 macOS 原始日志 HTTP 迟到成功回写旧 cursor、倒退退出账户边界的问题；加入异步窄回归。
- 独立 `TonoBytesByRoute` wire type，修复合并后 policy / isolated-runtime 独立编译工具缺失类型的真实失败。
- 修复已经落后于 main 行为的三个 CI 夹具：DIRECT 域名集合、WebSocket connect watchdog 即时重建、已签名策略 fixture 被新增内置域名白名单吞掉。
- hy2 provisioner 的 `--servername` 现在同时控制证书 SAN、SNI、masquerade；不再无视参数硬编码 Microsoft。仅本次获准的 Marina 新安装使用 UCLA；其余 VPS 未换证书。
- 两端原始日志回执识别 `stored:false` / `not-stored`，不再把业务拒收当成上传成功。Mac 用真实 API 解码 + uploader 验证失败保留 cursor、重传存储成功才消费；旧版不带 `stored` 的真实存储回执仍兼容。
- Windows 二进制日志请求区分身份 epoch 与刷新 token epoch；账户替换/退出后的迟到回执失效，401 不得把旧日志重放给新账户。窄异步测试实际挂起旧请求、换号、释放 401，确认只有一次旧 token POST。
- Windows 周期连接样本 HTTP 返回后同时复核 connect/controller generation，持状态锁完成同步入账与诊断事件提交；同连接内 controller 换代只丢本次响应，下个 tick 继续采样。

macOS 断开总字节保持 Mihomo 顶层累计值。核对固定版本 v1.19.30 源码后，确认
`uploadTotal` / `downloadTotal` 包含已关闭流量；把它替换为抽样连接账本反而会漏短连接。
依据：[固定版本 statistic manager](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/tunnel/statistic/manager.go)。

## 仍需解决，不能混写为已修

| 等级 | 问题与代码证据 | 下一步 |
|---|---|---|
| G2 未验 | `/diagnostics/logs` 无设备采集授权窗口时仍返回 `200` / `stored:false`。客户端误报已修，但默认 ON 不等于服务端已授权存储 | 按既有采集授权设计做真实存储/读取端到端验证；不擅自移除服务端授权门 |
| P1 | Windows `log_upload.rs::sweep` 只在开始检查上传开关与 auth generation；后续多段 catch-up 不复核，cursor 未绑定账户。核心 HTTP 的跨账户 401 重放已修，不等于整个补传循环已修 | 退出/换号/关闭时停止后续段；持久账户边界与迟到回执必须共用权威。增加对应窄回归后再合 #138 |
| P2 | Windows 仅凭 `live_size < cursor.offset` 判轮转；新文件长过旧 offset 时漏判，可能跳过新文件开头。现有轮转测试只读两份文件，未覆盖漏判条件 | 使用文件身份及有界读快照，实测轮转与离线 catch-up，不把日志增速假设当证明 |
| P2 | 两端失败后 route-byte baseline 保留，但 windowStart 仍固定减 22 分钟 | 对齐字节统计区间，防止把更长时间的累计量标成短窗口 |
| P2 | Servers toast 在派发后立即称成功；DIRECT reload 时 UI 仍显示 Connected | 产品完成状态另做窄修改和对应验证；本轮未宣称解决 |
| 待窄复现 | 两端失败后重新读增长中的日志，可能用同一 session/sequence 重试不同字节；服务端按该键返回既存回执。Mac 手动 sweep 与周期 sweep 还存在 actor 重入 | 固定待确认 segment 的字节和消费范围，并串行化 sweep；先用“服务端已存但响应丢失”夹具复现，不把普通 401 同字节重放测试当成覆盖 |
| P1 / G2 | hy2 `auth-allow.sha256` 是配置中的 VLESS 身份快照；exit-agent 的实时 roster 增删没有写入它，空名单还被现同步脚本拒绝 | 新增/撤销/全部撤销必须验证；仅定时重读静态 Xray 配置不能证明与实时 roster 一致。Marina 暂不发布目录 |

以上未决日志路径来自代码审查，不冒充真机复现；默认开启的生产采集与隐私边界仍需验收。

## 已执行验证

| 范围 | 结果 | 限制 |
|---|---|---|
| Windows App Rust `--features clippy --lib` | 467 / 467 | 在 macOS 编译可移植测试，不替代 native Windows 分支与 WFP |
| `tono-core` | 240 unit + 10 integration | 固定工具链 1.98.1，offline / locked |
| `tono-core` 本轮认证回归 | 49 / 49 | 含 no-store 回执、迟到 401 换号；原有同账户刷新重放仍通过 |
| Service 模型 `standalone,client,test --lib` | 314 / 314 | 不是真机服务安装或 WFP 接管 |
| Windows 前端 | 270 / 270；typecheck 通过 | 无实机 UI 声明 |
| macOS 连接、更新日记、遥测和偏好 XCTest | 39 / 39，0 skip | 未安装新 Helper、未改当前 Mac 网络 |
| macOS 日志边界/上传结果/遥测 wire XCTest | 7 / 7，0 skip | xcresult 已核对实际测试数 |
| macOS 本轮回执 + 上传结果 + 账户 cursor XCTest | 6 / 6，0 skip | xcresult `Test-Tono-2026.09.13_02-17-18--0600`；不是生产采集验证 |
| macOS 独立 policy + ledger | 通过 | 夹具配置通过 Mihomo `-t`，不是节点数据面实测 |
| Worker 已签名策略两项回归 | 2 / 2 | 其余 171 项未在此定向运行中执行 |
| hy2 provisioner Ruby + shell syntax | 11 tests / 150 assertions，0 failure；语法通过 | Debian 11 只放行 hy2 补装路径，另有下述单机真实证据 |
| PR #147 CI，源 `e1d9641f` | Windows / macOS / Services 全绿 | 本轮后续改动尚需新 SHA CI；CI 不替代 G1/G3 真机 |

本地原始输出：`/tmp/tono-release-audit-20260913/`。未执行 Worker 部署、远程 D1、
客户 appcast/windows-updates 发布、系统 PF/TUN/DNS 修改。

## PR / issue 处置

- #137/#138：仅集成候选，不在上述 P1 未决时强行合 main。
- #65/#146：依赖更新存在红 CI，且尚未归属当前 ship gate；不搭车合入。
- #26：真实 Windows/macOS 受保护更新及失败证据保留未验，保持打开。
- #80：客户更新源尚未推进，保持打开，不把 GitHub .72 标签误当客户发布。
- #4/#5：计量切换/代际问题按 SHIP_PLAN 明确不进本轮；不以客户端改动虚假关闭。

## Panstar #7012 单机测试

2026-09-13 通过 ego-lite 对 `vm-jPZp8D` 添加唯一规则：IPv4 / Inbound / UDP / 443 /
`0.0.0.0/0` / Allow / Enabled。防火墙仍 Enabled，规则 Synced，原四条 TCP/ICMP 规则保留。

既有主机指纹匹配；实际 Debian 11、kernel 5.10、systemd 247、Python 3.9、OpenSSL 1.1.1w。
Debian 11 原先被脚本平台名单拒绝，**不是 hy2 运行失败证据**。本轮检查 systemd/Python/SAN
能力和 SHA 校验后可执行性，仅对 hy2 补装路径放行；未升级系统或扩大 Reality 安装合同。

经用户确认后，部署 `20260913T080226Z-727a8909`，官方 Hysteria v2.12.2，UDP 443；
SAN/SNI/masquerade 都为 `www.ucla.edu`，没有 skip-cert-verify。localhost HTTP auth
仅监听 `127.0.0.1:18765`，43/43 已有 UUID 可认证、随机 UUID 被拒。
Xray TCP 443 PID **707990** 与配置 SHA-256 始终不变；hy2 零重启、约 14 MiB 内存。

实际客户端形状（产品 ConfigPipeline + 固定 Mihomo，临时 loopback，无 TUN/PF/系统 DNS）：

- 隔离 fake-IP DNS、Google/Google Search/YouTube HTTPS 均通过，出口 `144.225.255.114`。
- 五个新 Mihomo 进程独立握手：Google **5/5 HTTP 204**，0.125–0.268 秒。
- 错误 fingerprint 握手拒绝，日志确认 fingerprint mismatch。
- 连续下载 **8,388,608 bytes / 31.99 秒 / HTTP 200**。
- 本机路径证据不代表中国电信/联通/移动家宽；自动备用切换仍关闭。

用户完成 Cloudflare Access 登录后，经 ego-lite 正常管理 API 只读核对：现行目录
**revision 54 / 19 条**，Marina 的 VLESS front 是 `www.chapman.edu`。
旧 Mac 9 月 8 日缓存中的 Bing 不是当前目录，未改用户运行配置。
原先 Keychain 请求 403 的具体拒绝层未定，不再把它直接解释为 token 无效。

追加候选 **`Los Angeles · Marina · hy2`** 与原 19 条合并 dry-run 通过（20 个名称、20 个
身份占位，无删除）。**未 PUT，revision 仍为 54**：先修授权 roster 生命周期，再在发布前
复核新 revision / 删除集合并取得明确确认。私有源和回滚收据仅存 Operations 目录。
严格 SSH 的临时部署 key 已精准撤销、验证认证失败、本地 key/agent/密码剪贴板已清理。
回滚命令是远程 helper `rollback 20260913T080226Z-727a8909`，只撤销本次 hy2/auth，不动 Xray。
Panstar 老文档中的东京/LAX 节点不在本次修改范围。
