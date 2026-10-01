# Grok macOS fixer report (2026-09-30)

Fixer: Grok 4.7. Scope: open GitHub issues on `raydocs/tono` whose bug is in the macOS app (`apps/macos`), the root helper / PF (`tooling/scripts/core-helper`), or the macOS sing-box integration. Base at survey: `origin/main` `c32c087e`.

No product code changed. Nothing below was claimed with `Taking this (Grok macOS fixer)`, because each item was skipped before a fix started.

## Fixed

None. No open macOS bug was both verified and safe to patch in this pass.

## Skipped macOS issues

| Issue | Area | Why skipped |
|---|---|---|
| [#331](https://github.com/raydocs/tono/issues/331) | PF `tono-control` rule matches the interactive UID, not the signed Tono binary (ledger H1-F5) | Product decision plus `needs-hardware`. Owner 2026-09-26: do not hold the customer release for a helper/PF redesign (rejected five times in plan review); ship 0.0.74 with this as a known limitation and continue it for 0.0.75 (`docs/DECISIONS.md`). Partial fix is already on main (#335, comment-only: PF cannot name a code signature). The remaining close path is to proxy control-plane calls through the root helper and narrow the rule to `user root`. That changes armed network behavior. A wrong rule can cut ordinary internet or the control plane. Not implemented. Do not close. |
| [#409](https://github.com/raydocs/tono/issues/409) | Device identity can leave the Mac that created it (ledger H11-F2) | Product / signing decision plus `needs-hardware`. macOS half of the hardware anchor is on main (#414, `5da90232`). Still open: login-keychain items ignore `kSecAttrAccessible` unless the query uses the data-protection keychain and the app has a keychain access group and an application-identifier entitlement. A wrong access group makes the stored session unreadable. Comment on the issue (2026-09-30): no further code change. Do not close. |
| [#422](https://github.com/raydocs/tono/issues/422) | Feishu/Lark stay in the tunnel after reviewed app-direct (#336) | Needs a real install. The issue is to capture Identifier and TeamIdentifier from a signed Feishu/Lark bundle. Those values are not in the repo. Guessing them would either do nothing or direct traffic for the wrong identity. Current behavior is fail-closed (those apps stay in the tunnel). No open PR. |
| [#664](https://github.com/raydocs/tono/issues/664) | Official Hysteria 2 v2.12.3 vs Niagara and Erie | `blocked-external`. Comment on the issue: not a client patch; check the certificate served for the catalog SNI and UDP reachability on those nodes. |
| [#317](https://github.com/raydocs/tono/issues/317) | Policy `revision` outside the signed bytes until the embed switch is on | `blocked-external`. Client checks are on main (#473). Turning on `TRAFFIC_POLICY_EMBED_REVISION` is a control-plane deploy after a customer publish. Deploy is out of scope. |
| [#183](https://github.com/raydocs/tono/issues/183) | Ops-console Playwright screenshots on a Mac runner | Not the macOS app, helper, or sing-box. Ops visual debt. |
| [#257](https://github.com/raydocs/tono/issues/257) | Toolchain drift (includes Sparkle) | Label `toolchain-drift`. Not a verified customer bug. A pin bump is a separate decision. |

## Out of area (left open)

Windows: #662 (open PR #663), #602. Control plane / agents: #789 (explicitly not fixed until Google sign-in is enabled), #811, #810, #4, #5. Ops: #208, #188. iOS: #210.

## Already covered by other open PRs (not touched)

These macOS fixes were already open, so this fixer did not start them: #804, #802, #799, #797, #796, #795, #794, #788, #785, #782, #781, #778, #774, #773, #765, #763, #762, #761, #760, #759, #744 (draft), #730 (draft), #725 (draft), #721, #720, #719, #717. #691 was left alone as instructed.

No open PR body referenced #331, #409, or #422 as `Fixes #N`.

## Claims

No issue had a `Taking this` comment from another fixer in the two hours before this pass. The 2026-09-30 comments on #331, #409, #664, and #317 are status notes (`Do not close` / `Not a client patch`), not claims.

## Hypotheses

Examined the full open issue list (17 issues at `c32c087e`). Seven are macOS-related or macOS-adjacent; all seven are skipped above. No new code hypothesis was promoted to a patch: the fixer scope was open issues, and the three real macOS leftovers are the deferred identity/PF items.
