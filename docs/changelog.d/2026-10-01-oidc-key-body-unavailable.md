## 2026-10-01 · Preserve provider-unavailable errors during sign-in
- Scope: SHIP_PLAN §2 item 9; control-plane authentication reliability.
- Source: origin/main `42fffd3d`; branch `hunt/sol-r4cpc-oidc-body-unavailable`, PR [#1176](https://github.com/raydocs/tono/pull/1176).
- Fix: a transport failure after the identity provider's key-response headers now returns `503 IDENTITY_PROVIDER_UNAVAILABLE`, consistently with a failure before the headers. It previously returned `401 OIDC_AUTHENTICATION_FAILED`.
- Added behavior: none; signature, claims, nonce, and challenge-attempt checks remain required.
- Regression: Worker/D1 endpoint test failed with expected 503 / actual 401, then passed and verified retrying the same challenge succeeds when the provider recovers.
- Verification: Linux, Node 22.14.0; focused Worker regression passed. Typecheck and Worker/OIDC suites are recorded in the PR.
- Release: source only; no package, deployment, or publication.
- Limits: OIDC native sign-in is currently a macOS debug path; no production sign-out or network outage is claimed.
