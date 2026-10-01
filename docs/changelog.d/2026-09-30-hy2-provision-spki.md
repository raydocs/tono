## 2026-09-30 · Retain the HY2 public-key pin in provisioned catalog sources
- Ownership: SHIP_PLAN §2 item 10; HY2 availability required by the 2026-09-26 owner decision.
- Source: origin/main `51ca85b0` → branch `hunt/sol-r3ops-hy2-catalog-spki`; not yet merged.
- Defect fix: the remote helper returned a certificate SPKI pin, but the Ruby provisioner discarded it. Newly generated HY2 sources now retain the validated pin alongside the mandatory DER fingerprint, allowing existing macOS admission to use the transport.
- New features/optimization: none. AI routing, certificate verification, Xray preservation and explicit publication remain unchanged.
- Engineering/tests: one whole-CLI fixture intercepts all remote/download/upload operations and checks the generated YAML; register the existing Ruby fixture suite and its paths in Services CI.
- Verification: Linux `git diff --check` and CI filter tests passed; canonical-encoding guard accepted all 256 possible final bytes. Ruby is absent in this VM, so the new regression was written before the fix but could not execute locally; hosted CI must run it. Independent read-only review found and corrected the explicit YAML require and future path-filter registration.
- Candidate/publication: source only, no new candidate, node provisioning, deployment or catalog publication.
- Remaining limits: no real-node/macOS HY2 connection test; needs-hardware acceptance remains.

2026-09-30 continuation: [#995](https://github.com/raydocs/tono/pull/995) merged at main `140b5d9f750ff072cd2036e775fda3249aa3f3cd`. Exact head `e8a005009ed28fdddf9aa85512f8ff32c5224268` passed [ci-gate](https://github.com/raydocs/tono/actions/runs/36807049161/job/110206368443). Original fixture evidence remains tied to its tested source. No new candidate, real-host acceptance, deployment or publication.
