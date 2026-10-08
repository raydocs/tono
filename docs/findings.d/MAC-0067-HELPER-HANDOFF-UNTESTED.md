| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-0067-HELPER-HANDOFF-UNTESTED | 客户 0.0.67（helper 3.12.2，无 `/helper/upgrade`）经 Sparkle 升 0.0.75 后首次连接回落到管理员密码重装 helper（`HelperManager.swift:288-297`）；与真实 3.12.2 的交接（停 Core、保留 PF、新 helper 接管）没有自动测试跑过 | open | — | 中·推导（读码，2026-10-08 安装审查） | G4.2 在一台 0.0.67 Mac 上走 Sparkle→候选、连接、断开即可关闭；标准（非管理员）用户无法装 helper，发布说明只写了可能要密码 |
