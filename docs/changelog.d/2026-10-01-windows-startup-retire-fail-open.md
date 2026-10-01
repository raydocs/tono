## 2026-10-01 · Windows startup retirement failure no longer leaves the machine Blocked
- 归属：SHIP_PLAN §2 item 10; Windows Service startup recovery (decision 031).
- 来源：origin/main c57f00c0; fix/win-1259-startup-release-fail-open; source PR, not yet merged.
- 缺陷修复：#1259, when retiring an unverified startup barrier could not retire the owner or prove DNS restore, the Service only logged and nothing retried, so a non-strict machine stayed fully Blocked. Now a non-strict intent releases general traffic with the AI hold (DNS best-effort, snapshot kept) and still returns the error so desired-Core restore is skipped; a failed WFP removal arms the core window so the watchdog retries. Strict intents are unchanged.
- 新增/优化：无。
- 工程与测试：the existing DNS-failure retirement test now asserts release, AI hold, kept DNS evidence and the disarmed tombstone instead of a kept barrier.
- 验证：rustfmt check of the changed hunks passed locally; `cargo test` not run on this Mac (owner rule), hosted CI runs it.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：DNS restore is not retried after this release; installed WFP/DNS behavior needs hardware (needs-hardware).
