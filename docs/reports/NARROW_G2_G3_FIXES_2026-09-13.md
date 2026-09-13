# 2026-09-13 窄修：DNS 失败日记与 hy2 名单

归属 SHIP_PLAN **G3 / G2**。本次只修两条确定的代码路径，不新建交接协议，不放宽 PF/WFP，不发布更新源。

## G3：DNS 恢复失败不得写清理成功

- 原路径在 `tono_restore_protected_dns` 返回 Err 后只 warn，继续记录 CleanShutdownCompleted / ProtectedHandoffRecorded。
- 现在保留 Core 已停止的 UI 状态更新，但 DNS 失败仅记录 Failed、返回错误，不进入安装。WFP 不额外 disarm。
- 窄回归直接向生产使用的日记提交函数注入 DNS Err，断言只记录 Failed、保留 armed 意图、返回错误。
- 前端原路径会等待 prepareUpdate；准备拒绝后不会调用 install。既有 update-viewer 回归 5 / 5 通过。
- 失败后进入 Protected Offline 的再次更新仍必须请求停 Core / 恢复 DNS，不能因 Connected 已清除而跳过；独立 FSM 回归覆盖这一重试选择。

这只证明上述失败路径已修，**不等于 #26 整体验收完成**。没有注入真实 Windows DNS/SCM 故障，也没有把 Failed 文件改成成功来通过测试。

## G2：hy2 使用当前 roster，而不是静态配置快照

- exit-agent 在验证 nodeId/sourceId 后，将已验证 roster 的 UUID 哈希原子替换进已有 hy2 allowlist；新增、撤销、空名单都同一条路径。
- hy2 写入失败不发 roster ACK。静态/shared 密码不再并回名单；无 hy2 的节点保持原行为。
- 服务端 Python HTTP 鉴权代码在同一个本地进程内实际验证：新增可用、旧身份撤销、新身份可用、清空后全部拒绝，读取经历原子替换，无重启。
- auth checker 的 systemd 只读绑定改为父目录，避免固定住旧 allowlist inode；已有 checker 更新会明确 restart 应用新 unit。
- agent-managed 标记出现后，旧静态同步命令拒绝覆盖，避免恢复已撤销身份。

**未部署线上节点。** systemd mount namespace、真实 Hysteria 握手及已建立 QUIC 会话均未冒充已验收。名单同步不等于踢掉现有会话，也不等于新增 hy2 计量；部署步骤与边界见 [exit-agent README](../../services/exit-agent/README.md#hy2-roster-ownership-g2)。Marina 目录仍未发布。

## 验证记录

本地输出保存在 `/tmp/tono-narrow-fixes-20260913/`：

- 集成工作树 Windows App workspace：473 / 473；DNS 错误和 Protected Offline 重试各一个窄回归。
- exit-agent Python：80 / 80，包含实际 loopback HTTP 鉴权与原子替换、替换失败、ACK 拒绝、静态同步拒绝。
- provisioner Ruby：11 tests / 150 assertions，0 failure；remote helper `bash -n` 通过。
- main 独立 PR [#157](https://github.com/raydocs/tono/pull/157) / `b5c09818`：本地 App workspace 452 / 452；Python 80 / 80；Ruby 11 tests / 150 assertions。原生 CI 结果见 PR 检查与验收评论，不将可移植测试数冒充实机结果。

## 原生 CI 与合并

[#157](https://github.com/raydocs/tono/pull/157) 已普通合入 main `d7578ff5`，审查 head 为 `b5c09818`；30 个检查全部 SUCCESS（含 push / PR 重复检查）。

- [Windows CI](https://github.com/raydocs/tono/actions/runs/34753994077)：App **443 tests**；两项新更新回归均运行通过。Service 生命周期与 real filtering engine 检查通过。
- [macOS CI](https://github.com/raydocs/tono/actions/runs/34753970347)：**269 tests、1 个既有 skip、0 failure**。
- [Services CI](https://github.com/raydocs/tono/actions/runs/34753994310)：通过，含 exit-agent **80 tests**。

以上是独立 PR 的原生 CI，不是旧版已安装设备更新或客户网络验收。集成 #147 的后续 head 单独检查，不借用本次成功状态。

## 没有扩大为重构的风险

`fail_connect` 会先让 FSM 进入 Protected Offline，某条分支的 stop_core 错误被忽略。本次 update 不再据此跳过停 Core / 恢复 DNS；但这仍不是实际 Service 故障注入或跨进程所有权验收，不声称已关闭 #26 整体风险。

下一步用安装机上的 Core PID / Service snapshot / DNS 状态验证该路径，再决定最小修复；不因此直接加入一套跨进程新协议。节点切换 toast、DIRECT reload 文案、统计窗口这三个 P2 本轮未动。客户发布仍遵守 G1–G3 的真实验收门。
