## 2026-09-30 · Bound Windows read-only service probes
- 归属：SHIP_PLAN §2 item 10; Windows Disconnect/Connect/Repair reliability.
- 来源：origin/main `d628cef8` → branch `hunt/sol-trust-release-scm-probe-timeout`; [#912](https://github.com/raydocs/tono/pull/912); source only.
- 缺陷修复：stalled SCM reads could retain the release coordinator indefinitely or block Connect/Repair tasks; read-only probes now run on the blocking pool with a five-second deadline and settle the caller without starting another operation on timeout.
- 新增/优化：none; stopped/read-error/start refusal choices and BFE known-stopped diagnosis retained. Protection is still assumed on until a Service release proves otherwise.
- 工程与测试：two narrow regressions for release-choice and blocking-thread deadlines; existing readiness-choice regression retained.
- 验证：Linux Rust 1.98.1 exact production helper/test harness: each new test failed before the corresponding bound; all 3 pass after. `git diff --check` passed. Full Windows/Tauri compilation/tests unavailable in this VM, hosted CI required.
- 候选/发布：only source; no new package, deployment or publication.
- 剩余限制：a timed-out read-only OS thread may finish late; it cannot mutate protection. Real SCM failure testing remains for hardware. WFP/DNS/routes/strict/AI policy behavior unchanged.
