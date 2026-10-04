| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-RESTART-IDENTITY-GAP | API 新增的身份不写入 Xray 配置，hub `xray_restart` 只重启并检查 :443，不接身份同步，重启后这些身份要等下一次 exit-agent 成功对账才恢复 | in-PR | [#1378](https://github.com/raydocs/tono/pull/1378) | 中·已确认（审计 F-D2，Codex 复核 PARTIAL） | 只覆盖 hub 发起的重启；节点侧 systemd 自重启、OOM、手工 `systemctl restart` 仍等下一次 timer。未加 Xray unit 的 `ExecStartPost`：unit 以 `User=tono-xray` 运行，可能无权启动 agent，`-` 前缀会吞掉失败。follow-up 结果只写 hub 日志，不是控制面 job 行（hub 无入队接口）；未部署、未在真实节点验证 |

审计 F-D2 的「所有共享身份消失」和自动目录换城被夸大（Codex 复核）：静态旧客户端保留在配置里，Windows 目录轮换未接 live 路径，macOS `CatalogCityFailover.shouldRotate` 恒为 false。恢复只能界定为「下一次成功对账」，没有 30/62 秒的代码保证。

修复：`ops-panel/jobs.py` `run_jobs` 在 `xray_restart` 状态为 ok 并已提交结果后，用独立的 `execute_bounded`（`identity_sync` 超时，默认 120 秒）运行既有 `identity_sync` handler，结果单独记日志，不改 restart job 的结果；restart 失败不触发。同步仍是 `systemctl start tono-exit-agent.service`，若一轮 timer 正在运行，systemd 会合并到那一轮，而不是在它结束后再补跑一次。
