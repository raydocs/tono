| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4TS-ACCOUNT-LIVE-FAILURE-LEFTOVER | Windows replacement sign-in and account close kept the previous account's live connect failure, steps and failure time, so the next account's progress and diagnostics showed it until its first Connect | in-PR | [#1125](https://github.com/raydocs/tono/issues/1125) / [#1211](https://github.com/raydocs/tono/pull/1211) | 低·已确认（P2，跨账号诊断归属） | UI/diagnostics attribution only; no tunnel, WFP or AI-policy effect. Native Windows test runs in hosted CI only. |

Account adoption (`commands/account.rs` `adopt_sign_in_response`) and a successful account close now call `TonoInner::clear_live_connect_attempt`, which resets `connect_steps` to pending, `step_started_at`, `failed_stage`, `connect_error` and `connect_error_at_ms` beside the existing `attempt_history` reset. Ordinary same-account Disconnect keeps them.
