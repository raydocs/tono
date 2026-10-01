## 2026-09-30 · Windows automatic DIRECT release remains a decision item
- Ownership: SHIP_PLAN §2 item 10; Windows App/Service recovery.
- Source: main `3853f5ec` baseline; branch `hunt/sol-r3p1w-direct-auto-release`; documentation only, not merged at writing.
- Defect: verified automatic health recovery waits behind the stalled optional DIRECT reader; explicit Restore's #898 cancellation does not apply.
- Additions: records the required AI-preserving release contract; no runtime change and no revision of prior decision files.
- Engineering/tests: portable extraction of production health-release disposition plus real Tokio reader/writer demonstrates missing cancellation; no test/gate changed.
- Validation: Linux Cargo regression fails as expected; native Windows App/WFP/DNS execution unavailable here.
- Candidate/publication: source documentation only; no new candidate, deployment or publication.
- Remaining limits: cancellation-only opens AI earlier because current secondary AI hold is best-effort after WFP removal. Resolution requires a supported selective transition satisfying both availability and AI blocking. Docs PR has no auto-merge.

2026-09-30 continuation: record WIN-UPDATE-CONNECTING-CLEANUP under the same AI-preserving release blocker. Exact production update-FSM extraction with real tono-core ConnectionFsm fails immediate recovery (0 passed/1 failed); no update code changed. Replacement-account history independently failed before and passed after a reset, but #1047 appeared in the final dedupe scan, so the duplicate local implementation was dropped. PR #1046 remains documentation only with auto-merge off.
