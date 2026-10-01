## 2026-10-01 · Windows monitor excuses the owned sing-box replacement's Locked-without-permit reading
- 归属：SHIP_PLAN §2 item 10; Windows App connection monitor (round-2 hunt, #1245 leftover).
- 来源：origin/main 626b1d74; branch hunt/claude-r2-win-monitor; source PR, not yet merged.
- 缺陷修复：WIN-SINGBOX-DIRECT-LOCKED-PERMIT-MONITOR, while this session owns a DIRECT reload, `kill_switch_unhealthy_for_monitor` now excuses a wanted, live `Locked` reading whose tunnel permit is retracted, as it already excused owned `Blocked`. The Service's pre-replacement retraction publishes that reading for as long as the selective-layer cleanup takes (up to 3 s), so two monitor ticks could reconnect a healthy session.
- 新增/优化：无。Outside an owned reload the reading is still unhealthy; the 60 s marker deadline still bounds the exemption. Release, AI-hold and strict-mode behavior unchanged.
- 工程与测试：one regression (`an_owned_sing_box_replacement_reporting_locked_without_permit_is_not_unhealthy`).
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. rustfmt --check with apps/windows/app/rustfmt.toml: no diff on the changed lines (pre-existing drift elsewhere in the file).
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware: actual cleanup duration on a device.
