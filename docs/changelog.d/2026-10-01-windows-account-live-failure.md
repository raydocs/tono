## 2026-10-01 · Windows: a new account no longer shows the previous account's connect failure
- Scope: ops plan; Windows App account lifecycle and diagnostics.
- Source: origin/main `0676435b`; branch `claude/fix-1125-account-live-failure`, PR [#1211](https://github.com/raydocs/tono/pull/1211); Issue [#1125](https://github.com/raydocs/tono/issues/1125).
- Fix: replacement sign-in and account close kept account A's live `connect_error`, `failed_stage`, `connect_error_at_ms` and step record, so account B's connect progress and diagnostics report showed A's failure until B's first Connect. Both paths now reset them with the retained attempt history; ordinary Disconnect keeps them.
- Added behavior: none.
- Regression: one `#[tokio::test]` in `commands/account.rs` seeds A's failure, adopts B, and asserts the live fields are clear.
- Verification: not run locally (no native cargo on this Mac); hosted Windows CI runs it.
- Release: source only; no package, deployment, or publication.
- Limits: diagnostics attribution only; no network or protection behavior changed.
