## 2026-09-30 · Windows 损坏状态和不健康看门狗放行

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）。Windows Service 的 WFP。
- 来源：`origin/main` `d2363002`。分支 `cursor/win-wfp-fail-open-581a`。[#733](https://github.com/raydocs/tono/pull/733)。未合 main。
- 缺陷修复：损坏、读不出、校验失败且没有显式严格杀开关的 `kill-switch.json`，以及没有意图文件时残留的 WFP，启动时释放过滤器并尝试恢复 DNS，文件字节保留。看门狗发现不健康时不再重装；连续 3 次后放行并写墓碑。`MacosKillSwitchMode::Permanent` 以外的损坏 PF 状态不再在内存里记成永久阻断。
- 新增/优化：记录上 `strict_kill_switch: true`（或 PF 模式 Permanent）时仍先维持阻断。严格模式连续不健康 30 次后也放行，避免引擎卡住时永远出不去。当前没有用户界面写入这个字段，生产路径按未开启处理。
- 工程与测试：改了原先要求损坏即装紧急阻断的三条测试，并加了严格保留、看门狗决策两条回归。没有改 #703/#705/#706；main 上没有它们的 `network_disposition`。
- 验证：Linux `cargo test -p tono-service` 的对应 lib 测试。没有 Windows 实机，没有真实 WFP。
- 候选/发布：仅源码，无新候选。
- 剩余限制：可读的 wanted 意图在启动时仍会装回阻断（既有会话恢复，不是损坏路径）。3 次和 30 次的界、DNS 恢复失败后出口是否真通、严格字段没有界面，都需要实机。needs real-hardware testing。
