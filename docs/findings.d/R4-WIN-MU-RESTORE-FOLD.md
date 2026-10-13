| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-MU-RESTORE-FOLD | 第二个 Windows 用户的 App 启动恢复把另一用户的全机拦截当成自己的保护：显示受保护离线，恢复上网被拒，退出时弹拒绝框 | in-PR | [#1290](https://github.com/raydocs/tono/issues/1290)，PR 待填 | 中·已确认（P2，读码） | 决策 113（provisional）：Service 报告 `kill_switch_held_by_another_user`，App 不折叠；双账号实机未验证；B 没有专门的“被另一用户占用”提示，只有点 Connect 后的 1014 文案 |
