# 2026-10-01 · Claude 审查：Windows sing-box 路径

范围：main `14347158` 上已合入的 #1140，加上 #1159 在 `e22db2b4` 时的内容（只读）。#1175 和按进程直连仍由另一个代理在写，不在本次范围内。没有向 #1159 或 #1175 的分支推送。

方法：只读代码，单元测试交给托管 CI 跑。本机不跑 `cargo`。没有执行任何会改 PF、DNS、路由、helper 或系统服务的命令。

## 结论

| # | 发现 | 等级 | 处理 |
|---|---|---|---|
| 1 | Service 启动核心后要等 mihomo 的控制器命名管道。sing-box 不建这条管道，每次启动约 2 秒后被杀。结果是 sing-box 永远连不上，也不回退到 mihomo。 | 高·推导 | 已修：#1196（Fixes #1195）。必须在任何带 `sing-box.exe` 的包发出之前合入，已在 #1159 留言。 |
| 2 | Service 以 SYSTEM 运行 sing-box 前，只对配置做黑名单检查。缺少 mihomo 和 macOS helper 都有的白名单：文件路径、非回环监听、`route.final`、Go 键折叠。 | 高·推导 | 已修：#1188（Fixes #1187）。 |
| 3 | 代码判断"已武装"用的是 `active_runtime_resume`，比 WFP 实际武装的范围窄。Protected Offline 下重连时，仍可能在武装状态下换到 mihomo。另外，显式写了 mihomo 偏好时也会在武装状态下换核。 | 低·推导 | 未修，#1197。要在可用性和决策 040 之间取舍，需所有者拍板。 |
| 4 | 查询 Service 版本时只要出错，就报成"Service 太旧"，提示用户重装。 | 低·推导 | 未修，#1197。 |

### 重点核对项

- **回退 mihomo 的条件**：`resolve` 只在二进制缺失或认证失败、且未武装时才自动回退。核对结果与代码一致。但"未武装"的判断偏宽，见发现 3。另外，二进制已认证但启动失败（发现 1）时不会回退。
- **WFP 已生效时误换内核**：正常的已连接重连会被判为武装，不会换核。Protected Offline 时可能换核（发现 3）。StartClash 会为新核心实例重新放行隧道，所以不会泄漏。
- **协议 18 新旧版本混用**：旧 App 配新 Service 时仍走 mihomo，正常。新 App 配旧 Service 时，有已认证的 sing-box 就拒绝连接，没有就回退 mihomo，正常；只是版本查询失败时报错文案不对（发现 4）。#1188 和 #1196 只改 Service 内部行为，不改通信格式，所以协议版本不变。两者都应在第一个带 `sing-box.exe` 的包之前合入。
- **失败时会不会断网**：StartClash 中核心启动失败后，Service 调 `release_applying_narrow`：回到普通网络，AI 继续拦。核实无误。发现 1 只会导致连不上，不会断网。

### #1159（只读）

- 新增文件的发布和回滚（`prepare_introduced`、删除式回滚）、pin 文件随二进制一起替换、与 mihomo/Service/App 一起收敛，都没看出问题。
- 全新安装时，要求 `Program Files\Tono\sing-box.exe` 与 alpha.9 摘要一致，否则 Service 安装失败。这与 mihomo 的核心位置限制一致。
- 在 #1196 合入之前，不能发布这个 PR 打出的包。

## 验证

- #1188：Windows CI `windows/service` 在 `f9919bd6` 上通过，新的准入测试已在 Windows 上实跑。其余作业见 PR。
- #1196：等 Windows CI。
- 独立审查：#1188 和 #1196 属于特权路径或核心生命周期，属高风险，交给 Codex（gpt-6-sol，high）审查，结果见各 PR 的评论。审查完成前不合并。
- 未执行：本机 `cargo test`、实机 sing-box 启动。
