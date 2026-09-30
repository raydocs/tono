## 2026-09-30 · Windows 有效 wanted 意图在 Core 未证明时放行

- 归属：SHIP_PLAN §2 第 10 条（装上会坏：重启后 Core 不回来，WFP 仍把机器拦死）。Windows Service 与 App。
- 来源：`main` `d2363002` → 本分支；draft [#740](https://github.com/raydocs/tono/pull/740)，未合 main。
- 缺陷修复：服务启动仍先装上可读且已验证的 wanted 拦截。Core 既没在跑、本开机也不会启动它时立刻去掉 WFP、尽量恢复 DNS、写下 `reconnect_after_release` 墓碑。Core 已在跑或即将启动时，最多再等 30 秒（`WANTED_CORE_PROOF_WINDOW`）看它是否成为已验证的 Locked 且隧道许可已渲染；到点或启动落空仍同样放行。应用在冷启动或已处于 Protected Offline 时于后台重连。显式 `strict_kill_switch: true` 不启动这扇窗口，紧急解除仍可打开网络。同日第一刀是 90 秒上限；零配置产品等这么久没有网，已改为立刻放行加 30 秒上限。
- 新增/优化：无。未验证 wanted 仍走原来的 `retire_unverified`，不进这扇窗口。用户断开的墓碑不带重连标记。
- 工程与测试：一条服务端回归覆盖未启动立刻放行、启动中未到点保持、到点放行、重放落空立刻放行、墓碑跨一次服务启动仍在、严格记录不放行。一条应用侧纯函数回归覆盖何时允许后台重连。
- 验证：本机 Cargo 1.83 不能编译 edition 2024，Windows 测试未跑。托管 CI 为验证。未在实机上跑 WFP。
- 工程续记：`fee8c866` 的 Windows `service` 检查编译失败，`note_core_replay_finished` 只在 `core` 里导出，crate 根没有。已把它加进 `tono_service_protocol` 的 standalone 再导出，与 `restore_windows_kill_switch` 同一道门。这是编译接线，不是新的运行时缺陷。
- 候选/发布：仅源码，无新候选。
- 剩余限制：30 秒上限与应用 30 秒保护轮询需要实机校准（needs real-hardware calibration）。窗口在连接过程中到期时，保护轮询可能已经退出，当次要用户再点一次；下次启动仍能看见墓碑。DNS 恢复失败仍会去掉 WFP，但该失败路径未在本机注入。与 #733 任意顺序合并：两边都留 `strict_kill_switch` 和 `reconnect_after_release`；本 PR 的「未启动立刻放行、启动中最多 30 秒」与 #733 的损坏状态放行和不健康看门狗（非严格约 3 秒、严格约 30 秒）都留。`emergency_armed` 以 #733 的 `strict=true` 为准。本 PR 不改不健康重装路径。macOS 会话恢复不在本 PR 改。
