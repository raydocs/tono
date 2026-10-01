| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-UPGRADE-CANCEL-KEEPS-PF | macOS 旧 helper 升级预检停 Core 后保留 PF，提示未获准、取消或安装/启动失败不释放，旧版无看门狗时用户离线 | in-PR | #794 | 中·推导 | 已确认停 Core 后的失败出口尽力走 Disconnect 同用的标准释放，DNS 先恢复，保留原错误；释放回复丢失时读回确认并清除本地意图。成功升级与提示期间保持 PF。纯判断 XCTest 未运行，hosted macOS CI 待执行；旧 helper 不可达或 DNS 恢复失败仍可能阻断，stop 回复丢失后的结果不确定分支未扩展；needs-hardware。仅源码，无新候选；#738 的窄 AI 阻断与 #759 的轮询修正另行处理。 |

来源：main `378c165d` → 分支 `codex2/mac-helper-upgrade-cancel-release`；PR #794；未合 main。复核 `HelperManager.installIfNeeded`、升级预检、`KillSwitchService.disarm` 和 Connect/Disconnect 的状态消费；停 Core 后的预检状态失败也纳入本次清理。
