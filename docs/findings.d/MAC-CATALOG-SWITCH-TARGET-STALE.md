| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CATALOG-SWITCH-TARGET-STALE | macOS A→B 切换期间只轮换目录中的 B，安装器仅比较 A 而跳过应用，切换提交旧 B 端点与凭据，旧拨号退役后全隧道断网 | fixed(e1156cf0) | #802 | 中·推导 | 目标变化也补排现有目录应用，切换提交后按最新 B 重载运行时与 PF，不主动断开；一条纯决策 XCTest，未编译或运行；流式连接沿用有界延后；路由/PF 端点需实机，needs-hardware；现有失败恢复及仅 clientFingerprint 变化的既有缺口未改 |

来源：main `80f4b4d0`；分支 `codex2/mac-catalog-switch-target`；PR #802；未合 main。
源码复核：`AppState+Catalog.swift` 原来只比较当前选择，`AppState+Proxy.swift` 的切换跨异步验证与 PF 收敛保留目标快照。
修复在目录安装器将切换目标变化纳入运行时应用决策；既有重载合并机制等待切换提交后读取最新目录，流式连接延后则由连接监视器继续补排。重解析只更新已找到的新目标 ID，目标缺失不清除切换标记。
不主动断开例行轮换，不另建 AI 阻断层；不修改既有失败释放路径、helper 协议版本或 #782 涉及的 pins-refresh 等待代码。仅源码，无新候选。
