## 2026-10-01 · Windows: late StartClash after a connect timeout keeps the AI hold
- Scope: ops plan; Windows App connection lifecycle (late StartClash compensation).
- Source: origin/main `0676435b`; branch `claude/fix-1134-late-timeout-ai-hold`, PR [#1216](https://github.com/raydocs/tono/pull/1216); Issue [#1134](https://github.com/raydocs/tono/issues/1134).
- Fix: an unverified Connect that times out while StartClash is still in flight, whose StartClash then commits, was compensated with a plain release that removed the secondary AI hold; the failure owner then read an unarmed Service and did not apply it. The timeout retirement is now recorded as automatic, and that compensation uses the release that keeps the AI hold. Explicit Disconnect, sign-out, Restore and quit keep the plain release.
- Added behavior: none.
- Regression: one `#[tokio::test]` in `connection/cleanup.rs` retires a timed-out generation, then retires its successor explicitly, and asserts the compensation keeps the AI hold for the first and not the second.
- Verification: not run locally (no native cargo on this Mac); hosted Windows CI runs it. Needs hardware for the real WFP/NRPT ordering.
- Release: source only; no package, deployment, or publication.
- Limits: the native sleep/late-commit ordering was not reproduced; the Service narrow layer remains best-effort.
