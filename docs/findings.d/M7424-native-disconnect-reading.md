| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M7424-native-disconnect-reading | Mac 原生更新 Disconnect 已释放 PF 后响应或账本写失败，App 未读回就宣称直连仍被阻断 | in-PR | [#686](https://github.com/raydocs/tono/pull/686) | 高·已确认 | 修复工作分支增加只读 wanted/live 回读及代际校验；未知或 wanted=true/live=false 显示未确认，激活也沿用相同判断。更新账本和 Core/DNS 清理证据不因 PF 回读被冒充完成。红候选 70fa658d 在 hosted XCTest 实际失败，回读修复与评审发现的启动标志/迟到激活竞态回归待最终绿 CI/re-review；实机未执行，首次 panic 根因未证明 |

基线 seq 7424：`3635fc93b6dbab75054978138b4c109ad4613666`；修复基线 main `b9c50b60`。
原生更新释放后的后置记账与 PF 释放是不同事实。辅助器 CLI 的同类错误输出另待修复。
