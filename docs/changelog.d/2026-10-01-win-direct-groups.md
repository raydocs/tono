## 2026-10-01 · Windows sing-box admission treats groups that reach DIRECT as DIRECT
- Ownership: SHIP_PLAN §2 item 10; Windows sing-box runtime admission (#1279).
- Source: baseline `5831e1ec`; branch `fix/win-1279-direct-groups`, source PR only, not yet merged.
- Defect fix: `admit_sing_box_direct_rules` now grows the DIRECT tag set to a fixpoint over every outbound's `outbounds` members and `default`, so a selector (or nested selector, cycles included) that can choose `Tono-China-Direct` counts as DIRECT. A rule to such a group must then be a compiler DIRECT shape, which only names `Tono-China-Direct`, so it is refused; earlier pins must also target a non-DIRECT outbound. `route.final` stays fixed to `Tono-Exit`, which may choose only VLESS/Hysteria2 exits.
- New/optimization: none. The compiler emits only the `Tono-Exit` selector over exits, so compiled documents are unchanged.
- Engineering/tests: one test, `assistant_rule_to_a_selector_reaching_direct_is_refused` (AI-Bypass selector → Tono-China-Direct, `claude.ai` routed to it).
- Verification: `rustfmt --edition 2024 --check` on both touched files passed. No local cargo (MacBook rule); hosted Windows CI runs the test.
- Candidate/publication: source only; no package, signing, deployment or publication.
- Limits: needs-hardware; the WFP reviewed-port permit path is not exercised here.
