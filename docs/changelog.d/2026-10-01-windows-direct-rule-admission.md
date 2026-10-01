## 2026-10-01 · Windows Service admits DIRECT rules only in compiler shapes
- Scope: ship plan; Windows Service admission for mihomo and sing-box runtimes ([#1204](https://github.com/raydocs/tono/issues/1204), finding WIN-CORE-DIRECT-RULE-ADMISSION).
- Source: origin/main `e2bf1603`; branch `fix/win-1204-direct-admission`, PR [#1248](https://github.com/raydocs/tono/pull/1248).
- Fix: before a runtime runs as LocalSystem, every rule that names a DIRECT outbound must match a shape the product compiler emits: an exact domain plus /32 pin, a signed-app process rule on reviewed ports after all assistant pins, a reviewed UDP media endpoint, or an address-free China web suffix that does not overlap an assistant domain. Direct outbounds must carry the compiler's names, and no selectable group may offer them. mihomo's two loopback rules stay admitted.
- Shared lists: the assistant and China suffix lists moved to `crates/tono-core/src/direct_domains.rs`; the Service compiles that file by path, so the compilers and admission read one source.
- Compiler: the sing-box no-home DIRECT branch now pins every assistant domain and range to the exit (it pinned only the four Model Studio children), the same pins mihomo emits.
- Regression: one Service test per core refuses an out-of-shape DIRECT rule; one App test compiles a DIRECT plan with a per-process rule through both real compilers and admits the result.
- Verification: `rustfmt --check` on the new files only; cargo runs in hosted CI.
- Release: source only; no package, deployment, or publication.
- Limits: the WFP DIRECT permit is still not bounded by destination; a process-path regex is admitted as any regex once every assistant pin precedes it. Port-set mismatch between the App and the sing-box compiler is tracked in [#1247](https://github.com/raydocs/tono/issues/1247).
