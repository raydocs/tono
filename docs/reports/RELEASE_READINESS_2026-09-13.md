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
- hy2 provisioner 的 `--servername` 现在同时控制证书 SAN、SNI、masquerade；不再无视参数硬编码 Microsoft。现有 VPS 未因此被修改或换证书。

macOS 断开总字节保持 Mihomo 顶层累计值。核对固定版本 v1.19.30 源码后，确认
`uploadTotal` / `downloadTotal` 包含已关闭流量；把它替换为抽样连接账本反而会漏短连接。
依据：[固定版本 statistic manager](https://github.com/MetaCubeX/mihomo/blob/v1.19.30/tunnel/statistic/manager.go)。

## 仍需解决，不能混写为已修

| 等级 | 问题与代码证据 | 下一步 |
|---|---|---|
| P1 | `services/control-plane/src/index.ts` 的 `/diagnostics/logs` 在设备无采集授权窗口时返回 `200` / `stored:false` / `not_enabled`；两端解码器只读 segment，仍提示成功并推进 cursor | 区分「请求成功」与「日志已存储」；按既有采集授权设计做真实端到端验证，不擅自移除服务端授权门 |
| P1 | Windows `log_upload.rs::sweep` 只在开始检查上传开关与 auth generation；`send` 和后续多段 catch-up 不再复核。cursor 也未绑定账户 | 退出/换号/关闭时停止后续段；持久账户边界与迟到回执必须共用权威。增加对应窄回归后再合 #138 |
| P2 | Windows 仅凭 `live_size < cursor.offset` 判轮转；新文件长过旧 offset 时漏判，可能跳过新文件开头。现有轮转测试只读两份文件，未覆盖漏判条件 | 使用文件身份及有界读快照，实测轮转与离线 catch-up，不把日志增速假设当证明 |
| P2 | 两端失败后 route-byte baseline 保留，但 windowStart 仍固定减 22 分钟 | 对齐字节统计区间，防止把更长时间的累计量标成短窗口 |
| P2 | Windows `sample_connections_once` 在 controller HTTP 前检查 generation，返回后直接 ingest | 提交样本前复核会话/控制器世代，拒收上一连接的迟到结果 |
| P2 | Servers toast 在派发后立即称成功；DIRECT reload 时 UI 仍显示 Connected | 产品完成状态另做窄修改和对应验证；本轮未宣称解决 |

以上未决日志路径来自代码审查，不冒充真机复现；默认开启的生产采集与隐私边界仍需验收。

## 已执行验证

| 范围 | 结果 | 限制 |
|---|---|---|
| Windows App Rust `--features clippy --lib` | 466 / 466 | 在 macOS 编译可移植测试，不替代 native Windows 分支与 WFP |
| `tono-core` | 238 unit + 10 integration | 固定工具链 1.98.1，offline / locked |
| Service 模型 `standalone,client,test --lib` | 314 / 314 | 不是真机服务安装或 WFP 接管 |
| Windows 前端 | 270 / 270；typecheck 通过 | 无实机 UI 声明 |
| macOS 连接、更新日记、遥测和偏好 XCTest | 39 / 39，0 skip | 未安装新 Helper、未改当前 Mac 网络 |
| macOS 日志边界/上传结果/遥测 wire XCTest | 7 / 7，0 skip | xcresult 已核对实际测试数 |
| macOS 独立 policy + ledger | 通过 | 夹具配置通过 Mihomo `-t`，不是节点数据面实测 |
| Worker 已签名策略两项回归 | 2 / 2 | 其余 171 项未在此定向运行中执行 |
| hy2 provisioner Ruby + shell syntax | 10 tests，0 failure；语法通过 | 不等于 Debian 11 安装或握手已通过 |

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

只读 SSH：既有主机指纹匹配；Debian 11、kernel 5.10、systemd 247、Python 3.9；
`tono-xray` active，TCP 443 PID 707990，43 个 VLESS 身份，front 为 `www.chapman.edu`。
无 hy2 服务。`https://www.ucla.edu/` TLS 1.3 校验通过、HTTP 200。
只确认管理面放行，**未证明外部 UDP 握手、未安装 hy2、未发布目录**。
两种现有运维凭据的目录只读请求均得到 HTTP 403；未绕过权限或替换完整目录。

安装计划待确认：仅此实例旁挂 hy2 / UDP 443，`www.ucla.edu` + 独立证书钉扎 +
全部现有客户端身份；先解决 Debian 11 单机兼容验证，不升级系统、不重启 Xray。
发布仍须真实客户端形状握手、错误 pin 拒绝、Google/YouTube 与最终出口验证，并核对
现有 catalog 基名与追加集合。Panstar 老文档中的东京/LAX 节点不在本次修改范围。
