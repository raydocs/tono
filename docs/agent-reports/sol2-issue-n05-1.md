**Severity:** P2, latent. Google sign-in is off in the checked-in config (`services/control-plane/wrangler.jsonc:105` `GOOGLE_CLIENT_ID: ""`). **Fix this before Google sign-in is turned on.**

Found by the GPT-6.1 Sol bug hunt (chunk n05, finding n05-1; duplicate n07-1). The operator verified it against main `378c165d`. Per the 2026-09-30 decision it is tracked here and **not fixed**.

## What happens
When an OIDC identity is not linked yet, `accountForOidcIdentity` (`services/control-plane/src/index.ts:930-975`) trusts the provider's `email` + `email_verified` claims (`src/oidc.ts:238-239`). It picks the existing Tono account with that email through `accountForVerifiedEmail` (`index.ts:887-928`, `SELECT * FROM users WHERE email = ?`) and inserts an `auth_identities` row that links the new Google `sub` to that account (`index.ts:952-966`). No `hd` (hosted-domain) check is made, and the user is not asked to prove they control the mailbox.

## Scenario
1. Someone creates a Google account for a **non-Gmail** address they control at the time, e.g. `[redacted-email]` (Google accounts backed by an unmanaged external email).
2. They later lose the mailbox (they leave the company and the address is reassigned). Their Google account can still assert `email=[redacted-email]`, `email_verified=true`, with no `hd` claim.
3. The new owner of that mailbox signs up for Tono with email-code sign-in.
4. The former owner signs in to Tono with Google. The worker finds the current customer's account by email, links the former owner's Google subject to it, and issues session credentials. **That is an account takeover.**

Dependency: this relies on how Google treats `email_verified` for unmanaged external addresses. That could not be checked offline. For `@gmail.com` addresses, or when `hd` is present and matches the email domain, Google is authoritative.

## Suggested fix
The fix should be small and limited to the control plane. When linking a Google subject that isn't linked yet to an **existing** account, auto-link only if Google is authoritative for the address:
- the domain is `gmail.com` or `googlemail.com`; or
- `hd` is present and equal to the email's domain.

Otherwise, require a fresh email-code verification of that mailbox before inserting the `auth_identities` row. Creating a brand-new account from a verified claim can stay as it is. Test: vitest in the existing control-plane auth tests. It should check that a non-Gmail, no-`hd` Google claim for an existing email is refused or challenged, and that `gmail.com` and matching-`hd` claims still link.

Refs: `services/control-plane/src/oidc.ts:140,238-245`, `services/control-plane/src/index.ts:887-975`.
