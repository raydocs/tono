## 2026-10-10 · An unpublished v1 update channel (404 for `latest/manifest.json`) is "no update", not a failed check
- Status: provisional
- Chosen: when the release host answers 404 for the discovery object
  `desktop/v1/latest/manifest.json`, the native updaters (macOS `NativeUpdateDownload.discover`,
  Windows `tono_check_update`) report no update: no error state, no failure alert, no legacy
  fallback, and the normal check cadence (macOS 6 h; Windows SWR daily instead of the hourly
  recheck after an error). A manual macOS check says "No update available" (not "You're up to
  date"); Windows shows its existing "latest version" notice. The same holds when a relay carries
  the GET, because the relay passes the TLS session through and the 404 is the release host's own.
  Rejected: keeping every 404 as a failed check, which shows customers "Couldn't check for
  updates" / "Update not completed" for the whole period before the first v1 publication (G4).
- Why stricter: nothing is admitted that was refused before. Only that one status for that one
  object changes; a 404 for the signature of a published manifest, oversized or invalid metadata
  still fail. Other statuses behave as before this decision: macOS accepts only a 200 for the
  exact URL (a redirect fails); Windows rejects 4xx/5xx (`error_for_status`) and does not follow a
  3xx (`Policy::none`), but a 3xx (or another 2xx) body is still read under the same cap and goes
  to the Service's signature check, which decides (pre-existing, recorded in #1521's limitations).
  TLS, the Helper/Service signature check, the signed size and hash, and PF/WFP are untouched. A
  404 cannot be forged without the release host's TLS identity, and anyone who holds it could
  already withhold updates with any other status.
- Applied in: branch `amp/releases-manifest-404`; amends the "Missing or mismatched metadata"
  sentence of [UPDATE_INTEGRATION_V1](../UPDATE_INTEGRATION_V1.md#detached-transport).
