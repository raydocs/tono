## 2026-09-30 · Clean up benchmark core children when startup fails
- Ownership: SHIP_PLAN §2 item 10 reliability; T2 local connection benchmark.
- Source: original baseline `1abae1ec`, rebased onto `2a7d73d7` after #998 merged → branch `hunt/sol-r3ops-bench-startup-cleanup`; not yet merged.
- Defect fix: Core/SingBox constructor timeouts raised before callers obtained a cleanup handle, leaving live children behind. Close on startup errors/interruption, close sing-box logs on spawn failure, and reap after a forced stop.
- New features/optimization: none; startup still has its original 5-second admission budget; cleanup uses bounded 2-second TERM and 2-second KILL waits.
- Engineering/tests: four narrow mocked child/log regressions in the already registered benchmark fixture suite.
- Verification: Linux suite failed before (4/5 failures), passed after (5/5), then combined cache/startup suite passed after rebase (7/7); diff check and independent read-only review passed. No native core execution or network operation.
- Candidate/publication: source only, no new candidate, deployment or publication.
- Remaining limits: full loopback benchmark delegated to hosted CI; exceptions during successfully started samples are a separate unmodified lifecycle path.
