| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CORE-SINGBOX-OPTIONAL-FINGERPRINT | The Windows sing-box product compiler rejects an admitted VLESS node with an omitted optional client fingerprint | in-PR | branch `hunt/sol-r4core-singbox-fingerprint` | 中·已确认（P1，Linux regression） | Requires the authenticated sing-box binary selected by the new default; missing-binary packages still take the existing pre-arm Mihomo fallback. Native Windows acceptance remains. |

`node.rs` admission accepts an omitted `client-fingerprint`; Mihomo and the macOS sing-box product both use Chrome by default. `sing_box/runtime.rs:233` nevertheless required an explicit `Some("chrome")`. The Windows product caller (`tono/connection/core_select.rs:100–113`) compiles every admitted node, so even an unselected node with this valid omission aborts connection preparation with `UnsupportedFingerprint`.

The regression removes the optional field from an admitted fixture and selects a different node. It failed before the fix and passes after defaulting only the omitted value to Chrome. Explicit unsupported fingerprints still fail. Reality, TLS verification, AI routing and strict/fallback controls are unchanged; there is no claim of persistent network loss or of every currently packaged installer including sing-box.
