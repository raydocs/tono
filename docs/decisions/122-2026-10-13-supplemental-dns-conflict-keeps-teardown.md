## 2026-10-13 · On a supplemental DNS conflict, keep the live session or tear it down?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: keep today's deliberate teardown (R3CONN-DEC01). When a corporate VPN, profile or
  `/etc/resolver` rule sends some domains to a DNS server outside Tono's protection,
  `holdProtectedDNSSupplementalConflict` stops the session and does not reconnect until the user
  removes the rule; the end state is the selective release of decision 031 (general traffic back on
  the normal internet, AI services still blocked). Rejected: a "stay connected and warn" mode that
  preserves the live session while some domains resolve outside the protected listener, and
  loosening PF so that the foreign resolver can answer inside a session.
- Why stricter: a live session over a resolver Tono does not control would let those domains
  resolve, and be dialed, outside the protected path. Teardown ends that exposure at once, and the
  helper's selective release keeps AI-service traffic off the real address. The cost is the
  interrupted session and a manual step (turn the rule off, then connect again), which the notice
  states.
- Applied in: PR for issue #1057 (`claude/dns-pins`); no code change. The source comment on
  `holdProtectedDNSSupplementalConflict` already calls the alternative a provisional product
  decision.
