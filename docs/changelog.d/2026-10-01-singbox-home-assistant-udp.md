## 2026-10-01 · Windows sing-box rejects assistant UDP on the residential route
- Ownership: SHIP_PLAN §2 item 10; Windows sing-box runtime compiler (`tono-core`).
- Source: baseline `10ce26c9`; branch `claude/r3-singbox-home-udp-reject`; PR #1272, not merged.
- Defect fix: with a home hop (catalog home or SOCKS5) and a Hysteria2 exit selected, assistant UDP (QUIC) matched no rule and left through `final` on the cloud HY2 exit instead of retrying over the residential TCP hop. The compiler now emits UDP `reject` rows for the assistant suffixes, the Anthropic CIDR and the home process names/paths, matching mihomo (#783) and macOS sing-box. Finding C3-PC-F1.
- New/optimization: none.
- Engineering/tests: one regression, `sing_box::runtime::tests::hy2_exit_with_a_home_hop_rejects_assistant_udp`.
- Verification: not run locally (this Mac does not run native cargo per AGENTS.md); hosted Windows CI required.
- Candidate/publication: source only; no new candidate.
- Limits: QUIC→TCP fallback on a real Windows device with HY2 + home routing is unverified (needs-hardware).
