## 2026-09-30 · Failure-cluster alerts are off until both webhook settings exist

- Status: provisional
- Chosen: the engineering webhook sends only when `FAILURE_ALERT_WEBHOOK_URL`
  and `FAILURE_ALERT_WEBHOOK_SECRET` are both set, the secret is at least 32
  characters, and the URL is public https. One open cluster per
  code+stage+app version+platform+node. A 30-minute quiet gap closes it. Spike
  alerts need a 5× growth of at least 10 events and 15 minutes since the last
  send, with at most 12 sends an hour. The read API is GET-only and uses a
  separate `DIAGNOSTICS_READ_TOKEN`. Rejected: posting to the human alert
  allowlist, or a token that can write.
- Why stricter: an unset bot cannot be reached, and one outage is one alert.
- Applied in: [diagnostics-privacy.md](../diagnostics-privacy.md);
  [#707](https://github.com/raydocs/tono/pull/707).
