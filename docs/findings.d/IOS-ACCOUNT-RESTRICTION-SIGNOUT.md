| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-ACCOUNT-RESTRICTION-SIGNOUT | 明确套餐/额度状态码需要保留账户配置并停隧道放行网络 | in-PR | #1745 | 高·实测 | 单测故障复现；待真机与服务端联验，尚未合 main |

历史证据（旧401兼容选项已按编排者裁决撤回；以下结果不再代表当前401要求）：Account.swift:66-90,252-258；AppModel.swift:700-717。AccountRestrictionTests 的旧401分类及套餐不刷新断言 在 `ada2fe694` 的 [RED CI](https://github.com/raydocs/tono/actions/runs/40083275707/job/120841004218) 真实失败；修复源码 `50b332d61`，[GREEN 单测 run 40083408024](https://github.com/raydocs/tono/actions/runs/40083408024/job/120841450340)：143 tests / 0 failures（后续非 T2 的路由 harness 失败，完整 workflow 非绿）。未放宽 TLS/账户隔离/权限。详细边界见 [T2 更新记录](../changelog.d/2026-10-24-t2-ios-account.md)。

Claude B1 续审：仅保留配置还不够；节点拒绝身份后必须关闭 On Demand 并停止隧道，不能把全机流量继续送入无效隧道。本轮增加 AccountNetworkRelease（account来源/epoch/at收据）、AppModel拒绝释放分支及TunnelController.stopForAccount的checked disarm/read-back/stop；保存失败不吞异常，仍请求NE stop并给出手动恢复说明。与T1的扩展停止意图保护一起集成，Merge after #1741。

当前裁决：401 UNAUTHORIZED/INVALID_REFRESH_TOKEN结束会话；明确ACCOUNT_EXPIRED/QUOTA_EXCEEDED及历史别名才保留账户/配置，并走AccountNetworkRelease停隧道。T8探针不修改。先上线T6服务端403码；此前旧服务端返回401仍登出，与现状一致。当前实现证据：Account.swift:66-90、AppModel.swift:717-753。
