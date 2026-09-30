| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M7424-native-disconnect-reading | Mac 原生更新 Disconnect 已释放 PF 后响应或账本写失败，App 未读回就宣称直连仍被阻断 | fixed (8d1b48f2) | [#686](https://github.com/raydocs/tono/pull/686) | 高·已确认 | 修复工作分支增加只读 wanted/live 回读及代际校验；未知或任何 live=false 显示未确认（helper 当前把 PF 读取错误折成 false，不能据此确认释放），激活也沿用相同判断。更新账本和 Core/DNS 清理证据不因 PF 回读被冒充完成。三轮 hosted red 已实跑；最终1f0e91bc CI36682257824四 jobs通过，283330d4源码独立Codex high无major，文档头源码一致。低影响 retire/suspend overlap 另列 open；实机未执行，首次panic根因未证明 |

基线 seq 7424：`3635fc93b6dbab75054978138b4c109ad4613666`；修复基线 main `b9c50b60`。
原生更新释放后的后置记账与 PF 释放是不同事实。辅助器 CLI 的同类错误输出另待修复。
