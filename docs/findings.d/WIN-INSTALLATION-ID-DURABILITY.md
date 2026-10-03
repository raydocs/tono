| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-INSTALLATION-ID-DURABILITY | Windows accepts an ephemeral installation ID after a vault read/write failure, so re-authentication can enroll a phantom device and revoke another device at the limit | fixed(950e366a) | hunt/sol-r4wapp-stable-installation-id | 中·已确认（P1） | Production load/admission regression failed before and passed in a Linux boundary fixture; native Credential Manager/Tauri execution requires Windows CI. No WFP/DNS behavior changed. |

Baseline `259daecb`: `commands/account.rs:86-100` ignores ID read/validation errors and dispatches an unchecked first-run write. `begin_sign_in` then uses the process UUID. The control plane identifies devices by installation ID (`services/control-plane/src/index.ts:1108`) and its existing device-rotation transaction revokes another live device/session when a new installation exceeds the limit (`:1176-1236`).

Enrollment now requires a normalized vault identity or an acknowledged first-run write inside the existing load deadline. Identity readiness is independent of refresh-token readability, so a stable installation can still replace an unreadable session. Admitted interactive auth retires late startup hydration.
