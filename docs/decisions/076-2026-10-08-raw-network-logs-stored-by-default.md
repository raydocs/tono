## 2026-10-08 · The server stores raw network logs by default
- Status: owner
- Chosen: `POST /api/v1/diagnostics/logs` stores every upload from a signed-in
  device. The client's upload switch (on by default, stated in Settings and
  Support) is the consent; an operator `diagnostics_log_access` window is no
  longer required. Retention (14 days), the 2 MiB gzip cap, the per-user rate
  limits and account-delete cascade stay. Rejected: keeping the operator window
  (decision 002's "raw network logs stay operator-granted"), under which
  production stored zero segments while the 0.0.75 release notes tell users
  upload is on.
- Owner, 2026-10-08: "得存 默认上传我才知道用户还遇到哪些问题 已经写明了为什么没做" (store
  them; default upload is how I learn what users still hit; the reason it was not
  done is already written down). This supersedes the raw-log part of
  [002](002-2026-09-30-diagnostics-default-on.md); the rest of 002 stands.
- Why: the gate stored nothing (`diagnostics_log_access` had 0 rows in
  production on 2026-10-08), so field problems that leave no failure event
  were invisible. What it widens: hostnames and process paths of devices whose
  switch is on now reach R2 and the parsed traffic tables for 14 days.
- Applied in: [diagnostics-privacy.md](../diagnostics-privacy.md),
  [ingest-limits.md](../ops/ingest-limits.md); changelog
  [2026-10-08-cp-raw-logs-stored-by-default.md](../changelog.d/2026-10-08-cp-raw-logs-stored-by-default.md).
