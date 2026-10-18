## 2026-10-18 · 未确认的出口不再挡住已经确认的目录

- 归属：SHIP_PLAN G2（连不上要有下一手）；控制面目录与 Windows 桌面。不进客户发布。
- 来源：`origin/main` `17a588f53` → `fa5d2e7b0`；分支 `cursor/exit-identity-acked-subset-f082`；[#1674](https://github.com/raydocs/tono/pull/1674)；未合 main。
- 缺陷修复：一台设备的出口身份超过正常名册周期仍是 `EXIT_IDENTITY_PROPAGATING`。原因是目录要求每个已发布出口都确认，而退出登录不更换 `device_exit_credentials.created_at`。改后，已经确认的出口照常下发，禁用、缺失、从未确认或确认早于 15 分钟的出口从这一次响应里拿掉；一个仍在 15 分钟内确认、但还没越过这张凭据的出口，在它是唯一出口时继续 503。Windows 连续处于该状态 5 分钟后改显示明确中文，并提供「重新准备出口身份」（再拉一次目录，不轮换 UUID）。见 `docs/findings.d/EXIT-IDENTITY-UNHEALTHY-BLOCKS.md` 与决策 129。
- 新增/优化：无。共享凭据仍不在设备目录路径上铸造。家宽绑定行不删除；指向被省略出口的 `homeProxy` / `defaultProxy` 不出现在这一次响应里。
- 工程与测试：`worker-exit-roster.test.ts` 里「未确认的第二个出口让整个目录 503」改为「已确认的出口照常下发，未确认的不出现」。
- 验证：`services/control-plane` 上 `npx vitest run test/worker-exit-roster.test.ts` 25 passed；`npx tsc --noEmit --pretty false --incremental false` 退出码 0。Node v22.14.0（CI 为 Node 24）。Windows `cargo test`、前端 vitest 与实机未跑，由托管 CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：生产 Worker 在这次合入并部署之前仍是旧门。当前这名用户要靠运维对未确认出口做身份同步，或在该出口无法确认时下架。本变更不部署生产。

## 2026-10-18 · 续记
- Windows `app-rust`（run 39102190037）在测试模块里找不到 `note_identity_propagating` / `IDENTITY_PROPAGATING_BOUND`，`ci-gate` 随之失败。测试模块改为显式 `use super::`。控制面那一项当时是绿的。
