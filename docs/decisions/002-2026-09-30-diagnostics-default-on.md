## 2026-09-30 · Automatic diagnostics stay on; raw hostname logs stay gated

- Status: provisional
- Chosen: failure, usage, DNS, and chain uploads are on by default and are not
  gated on `diagnostics_log_access`. Raw network logs stay operator-granted.
  AI-service rows (claude / openai only) require explicit consent and expire
  after 60 days; other diagnostics rows expire after 90 days. A one-shot client
  migration may turn the periodic snapshot back on only when the user has not
  recorded a choice after the v2 force-off. Rejected: re-enabling hostname log
  upload, or leaving the snapshot default off.
- Why stricter: the reports the owner never received were privacy-safe failure
  facts, not browsing history. Hostname logs stay denied.
- Applied in: [diagnostics-privacy.md](../diagnostics-privacy.md);
  [#707](https://github.com/raydocs/tono/pull/707).
