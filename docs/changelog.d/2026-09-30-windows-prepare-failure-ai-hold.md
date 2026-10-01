## 2026-09-30 · Windows failed-update preparation keeps the AI hold
- Ownership: SHIP_PLAN §2 item 10; Windows Service native update.
- Source: baseline `08aac566`; branch `hunt/sol-r3svc-prepare-failure-ai-hold`; not yet merged.
- Bug fix: non-strict preparation failure after a Core-stop attempt now applies the existing secondary AI hold after releasing general traffic.
- New features: none. Strict admission, durable recovery obligation and explicit Restore behavior remain.
- Engineering/tests: move the existing failure-cleanup block into a function used by production and one focused regression; no other lifecycle change.
- Verification: Linux syntax parsed with rustfmt; `git diff --check` passed. A targeted service cargo invocation reported zero tests because update.rs is Windows-only; this is not qualification. Native regression was authored before the change and awaits hosted Windows CI.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: existing cleanup failures and best-effort AI layer remain; installed WFP/DNS acceptance requires hardware.
