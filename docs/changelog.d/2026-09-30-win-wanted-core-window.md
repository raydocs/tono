## 2026-09-30 · Windows 有效 wanted 意图在 Core 未证明时放行

- 归属：SHIP_PLAN §2 第 10 条（装上会坏：重启后 Core 不回来，WFP 仍把机器拦死）。Windows Service 与 App。
- 来源：`main` `d2363002` → 本分支；draft PR，未合 main。
- 缺陷修复：服务启动仍先装上可读且已验证的 wanted 拦截。若 90 秒内 Core 没有在跑，且会话不是已验证的 Locked、隧道许可也未渲染，则去掉 WFP、尽量恢复 DNS、写下 `reconnect_after_release` 墓碑。应用在冷启动或已处于 Protected Offline 时于后台重连。显式 `strict_kill_switch: true` 不启动这扇窗口，紧急解除仍可打开网络。
- 新增/优化：无。未验证 wanted 仍走原来的 `retire_unverified`，不进这扇窗口。用户断开的墓碑不带重连标记。
- 工程与测试：一条服务端回归覆盖窗口到期放行、墓碑跨一次服务启动仍在、严格记录不放行。一条应用侧纯函数回归覆盖何时允许后台重连。
- 验证：本机 Cargo 1.83 不能编译 edition 2024，Windows 测试未跑。托管 CI 为验证。未在实机上跑 WFP。
- 候选/发布：仅源码，无新候选。
- 剩余限制：90 秒与应用 30 秒保护轮询需要实机校准（needs real-hardware calibration）。DNS 恢复失败仍会去掉 WFP，但该失败路径未在本机注入。与 #733 会在意图记录和看门狗上冲突，两边都要留下。macOS 会话恢复不在本 PR 改：#701 已在 Core 不在时放行，#710 不覆盖启动重装。
