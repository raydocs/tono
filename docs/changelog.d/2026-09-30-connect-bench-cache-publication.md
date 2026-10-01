## 2026-09-30 · Publish benchmark executable caches only after successful extraction
- Ownership: SHIP_PLAN §2 item 10 reliability; T2 local connection benchmark.
- Source: origin/main `55cfb675` → branch `hunt/sol-r3ops-bench-cache-publication`; not yet merged.
- Defect fix: interrupted gzip/copy published partial final files and later runs trusted existence. Re-extract each executable from its already verified archive into a staging file, chmod then replace; failures preserve complete prior outputs and discard staging.
- New features/optimization: none; archive pins, member names, core versions and benchmark limits are unchanged. Existing stale outputs cannot override the current checked archive.
- Engineering/tests: two narrow local gzip/tar fixture regressions, in the existing CI-registered Python suite. No actual core binary is downloaded or executed.
- Verification: Linux fixture suite failed before (2/3 failures), passed after (3/3); diff check passed. Independent read-only review verified output paths, mandatory hashes and failure cleanup.
- Candidate/publication: source only, no new candidate, deployment or publication.
- Remaining limits: full loopback performance benchmark not run locally; hosted Connect bench CI runs it. The benchmark's fixed ports/work directory still do not support concurrent runs.

2026-09-30 continuation: source merged in [#998](https://github.com/raydocs/tono/pull/998), main merge `7e5c333a22bcae174b0ded31d97c47bd92dc30e4`, with ci-gate success. Original fixture evidence above remains tied to the original tested source; no new package, device acceptance, deployment or publication.
