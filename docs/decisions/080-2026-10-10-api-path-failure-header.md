## 2026-10-10 · How the ops console learns a control-plane path's success rate per client ASN
- Status: provisional (coordinator for backlog A8 while the owner was asleep; the owner may revisit)
- Chosen: clients may send an optional `X-Tono-Path-Failed: <path>[,<path>...]` header (same vocabulary as
  `X-Tono-Path`: `pinned|system_dns|relay|doh|alt_port|tunnel`; unknown or malformed tokens dropped, over 96
  characters read as absent) naming the paths that attempt lost before the one it arrived on. The header being
  present, even empty, marks a reporting client. The control plane counts, per UTC day, client ASN and path, in
  `ops_api_path_daily` (migration 0099): every stamped arrival (`arrived`), and from reporting clients only the
  arrival (`ok`) and each listed failed path (`fail`, same ASN). The success rate is `ok / (ok + fail)` and is
  unknown ("无数据"), never 100 %, while no reporting client has used the path. Counts are written only when
  `recordClient` already stamps the device row (path changed or the stamp is an hour old). A request on `relay` or
  `tunnel`, or from a known exit ASN (`ops_exit_asns`), records ASN 0 (unknown) instead of the node's ASN.
  Clients sending the header are a separate follow-up PR. Rejected: inferring failures from which fallback path a
  request arrived on (depends on client order and remembered paths, so it would invent failures); reading
  macOS `control_plane_path_failed` out of uploaded diagnostics logs (raw logs stay behind their access gate);
  showing arrivals alone as a rate (every row would read 100 %).
- Why stricter: no IP, URL path, user or device id is stored, only day, ASN, AS organisation, path and counts;
  a node's ASN is never attributed to a customer; the rate is unknown rather than optimistic when nobody reports;
  the five-minute catalog poll adds no write; the header widens nothing a client is allowed to do.
- Applied in: PR #1490, branch `amp/a8-asn-path-success` (backlog A8), `GET /api/v1/ops/api-paths` (`nodes.read`).
