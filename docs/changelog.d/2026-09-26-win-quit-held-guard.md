## 2026-09-26 · Windows：退出拒绝框的「仍受保护」以 Service 进行中操作为准；欢迎页存储失败不再循环
- 归属：G1；Windows App `feat/window.rs` 的退出/重启拒绝框，`pages/_layout/tono-guard.ts` 的欢迎页标记。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/win-quit-held-guard-20260926-red`（`f410ebb6`），修复分支
  `fix/win-quit-held-guard-20260926`，[#648](https://github.com/raydocs/tono/pull/648)（Part of [#602](https://github.com/raydocs/tono/issues/602)）；未合 main。
- 缺陷修复：F520-1：退出/重启拒绝框只看本 App 的释放登记和 `/kill-switch/status`，另一用户 App 发起的释放、或本 App
  响应丢失的释放都看不到，仍会写「网络保护仍开启」。现在改读已有的 `/status` 聚合（`tono_service_status_snapshot`，同样
  2 秒上限），其中同时带 kill switch 状态和 Service 的 `active_operation`；有任何进行中的生命周期操作即归为
  `ReleaseMayComplete`。没有新协议，释放/WFP 路径未改，文案只会变弱不会变强。
  H22-C-F1：`writeTonoIntroSeen` 写 `localStorage` 失败被吞，读回仍为未看过，守卫把未登录用户从 `/login` 送回 `/intro`，
  无限循环。现在本次会话内同时记在内存里。
- 新增/优化：无。
- 工程与测试：新增 `#[test]` `refusal_dialog_does_not_promise_protection_while_the_service_runs_a_mutation`（屏障在线、
  `active_operation = ReleaseKillSwitch`、本地无释放 → `ReleaseMayComplete`；红分支骨架忽略 `active_operation`，应按断言失败）；
  vitest `intro-seen flag > remembers intro in memory when localStorage cannot store it`。
- 验证：vitest `tono-guard.test.ts` 本地跑过：红分支按断言失败（expected false to be true），修复后 7/7 通过（借用
  ops-console 的 vitest，临时配置只含该文件）。Rust 未在本地编译（MacBook 不是构建机），`rustfmt --check` 无新增差异；
  以 `windows-2025` CI 为准。`tono-auth-guard.test.tsx`、`intro.test.tsx`（jsdom）本地未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`/status` 读不到时仍为「未确认」；内存标记只在本次会话有效，重启 App 且存储仍不可写时会再看到一次欢迎页。
