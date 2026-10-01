# Grok W6/W8（R3-W6W8-grok）

基线 `origin/main` `71bd69d8`（开修时 `33d46892`）。席位：Windows IPC 特权边界（W6）与运行时完整性（W8）。`docs/agent-reports/` 里没有 Sol 的 W6/W8 报告；`W1_CODEX_STATUS.md` 写明 W1-sol-win-trust 的云代理没有推出分支。本轮不重复已开 PR：#873（缺席 owner 的释放）、#866（释放时 DNS）、#858/#776（更新执行器）、#769、#740、#352、#203。#792/#793 在本轮期间合入，改的是停服/更新失败后的 fail-open，不是本条。

## 修复

| 发现 | PR | 内容 |
|---|---|---|
| W8-G-F1 | [#917](https://github.com/raydocs/tono/pull/917) | owned runtime 必须 `udp: true`、`tun.auto-route: true`，且 `route-exclude-address` 只能是本文档 VLESS/Hysteria2 出口的 IPv4 `/32`。拒绝发生在取生命周期锁和武装 WFP 之前。 |

没有对应 issue，所以正文没有 `Fixes #N`。这条改的是服务会启动哪份运行配置，影响 TUN/WFP，PR 正文已写 **needs-hardware**。自动合并等 `ci-gate` 变绿再开一次；队列管理器若关掉，不再打开。

## 未另开 issue

- 规则正文仍不重推。H2-F3 的剩余限制写明由 WFP 端点约束兜住；生成器还会发出中国 DIRECT 和住宅规则，在服务里重写语法会拒掉合法连接。
- 更新 Prepare 在准入之后、另一 owner 拒绝之前推进 attempt epoch。总账 TW-anthropic-4 已记为 H9-F3：准入后被拒的 Prepare 仍推进，含另一已准入用户，按设计。
- 规划路径之后的看门狗/开机恢复不再对 core 做摘要。注释已改口；在恢复路径上因摘要失败而不拉起 core，会在 WFP 仍武装时切断网络。不改。
- 复制时源文件变短仍按已记录的设计交给复制后的 identity 检查；目标不是可执行文件（`validate_destination` 拒绝可执行扩展名）。

## 核对后排除

管道 SDDL 只给交互用户、拒绝网络登录；对端 SID、token DACL、本地盘符应用数据根、reparse 拒绝。Magic/GetVersion 不认证，但管道 ACL 仍在，只返回协议信息。OwnerGoodbye 在 wanted 或期望 core 运行时拒绝。`replace_proxy_endpoints` 要求已锁定且端点能解析。客户端用 SCM 核对服务是 LocalSystem。`channel.rs` 只有渠道常量。owner 状态目录用 SID 的哈希，不是原始 SID。core 路径先拒绝 `users\<owner>` 下的客户端暂存，再对允许位置做摘要；摘要缺失或不符即拒绝。

## 验证

[#917](https://github.com/raydocs/tono/pull/917) 的两条 `owned_config` 单测在 Linux 上通过（`cargo test --locked --features standalone,client --lib owned_config::tests`）。Windows 服务全量 `cargo`、实机 WFP 未跑。

Hunter: Grok 4.7
