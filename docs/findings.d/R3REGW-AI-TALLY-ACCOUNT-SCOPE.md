| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Replacement sign-in can display the previous account's local AI traffic tally while the new account read is pending. | fixed(2e9eb35d) | #1085; hunt/sol-r4i1085-ai-tally | 中·实测（P2） | Frontend logic only; native Windows account transitions were not exercised here. |

Baseline `6ba79f61`, `apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48`: the unscoped `tonoAccount` query reuses A's cached email after the auth guard unmounts the card and adopts B. The email digest then loads A's saved local tally. `TonoAccountCard` clears its scoped query only on explicit sign-out, so that path does not guard replacement sign-in.

Use the same process/sign-in scope as the Account card, disable the query without a ready scope, and suppress the email without an owner. Storage keys and rendered markup remain unchanged. No connection, network policy or AI blocking behavior changes.

The real-SWR component regression `hides the previous account tally while replacement sign-in is pending` failed before the fix with A's Claude row still present. It passes afterward, also proving B's own history appears on resolution and an absent scope hides the card without deleting A's stored history.
