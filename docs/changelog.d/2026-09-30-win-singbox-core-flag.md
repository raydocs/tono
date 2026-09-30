## 2026-09-30 · Windows sing-box 核心按设备开关，默认关闭
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；影响 `apps/windows/crates/tono-core` 的 sing-box 模块。不改连接、WFP、安装包或客户通道。
- 来源：基线 `d2363002`；分支 `cursor/singbox-core-flag-01d4`；未合 main。
- 缺陷修复：无。
- 新增/优化：每台设备一份 schema 1 记录，只有 `sing_box_core: true` 且 `device_id` 完全一致才为开。缺文件、坏 JSON、别人的设备、空设备号、未知字段都保持关。关着时用户仍走现有 mihomo，网络不因这份记录改变。连接路径尚未读取它。
- 工程与测试：`sing_box::flag` 单元测试覆盖缺省、按设备隔离和损坏记录。
- 验证：Linux 上 `cargo test -p tono-core --lib sing_box::flag`。macOS XCTest 与 Windows 实机未运行。
- 候选/发布：仅源码，无新候选。mihomo 仍是安装包里的核心，也是回退开关。
- 剩余限制：开关默认保持关闭，直到实机清单通过。Service 改读 JSON、DIRECT 重载仍等 #703、#705、#706 合并后再决定。本记录不授权把默认改成开。
