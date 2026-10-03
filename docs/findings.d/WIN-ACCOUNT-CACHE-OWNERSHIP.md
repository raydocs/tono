| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-ACCOUNT-CACHE-OWNERSHIP | Replacement sign-in displays the previous account's cached device names while the new device request is pending or fails | fixed(83a68e97) | hunt/sol-winapp-account-cache-scope | 高·已确认（P1，源码与回归） | Native Windows login flow not exercised locally; React/SWR regression covers the actual card and query wrapper |

`TonoAccountCard.tsx:52,56` used process-global account/device query keys. After account A becomes suspended, `pages/tono-login.tsx` offers replacement sign-in without the explicit sign-out cleanup. The backend intentionally supports that adoption and fences HTTP requests by identity, but remounting Account under B reuses A's frontend device cache. The local B account read succeeds immediately; a stalled or failed B devices API call leaves B's email beside A's private device names.

Account/device reads now use the existing opaque process/auth-generation scope. Reads without account ownership stay disabled, and explicit sign-out clears the captured owned keys. The scope is independent of catalog availability. Cold offline admission with no recovered account remains empty until account recovery establishes ownership. No account ID is added to IPC; no network or protection behavior changes.
