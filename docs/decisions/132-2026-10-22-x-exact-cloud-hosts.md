## 2026-10-22 · X first-party web/API/media hosts in the bundled overseas list
- Status: provisional
- Chosen: append only these exact hosts to `three-tier-template.json`'s existing
  `overseas_full`: `x.com`, `www.x.com`, `mobile.x.com`, `api.x.com`, `twitter.com`,
  `www.twitter.com`, `mobile.twitter.com`, `api.twitter.com`, `upload.twitter.com`,
  `abs.twimg.com`, `pbs.twimg.com`, `video.twimg.com`, `ton.twimg.com`,
  `cdn.syndication.twimg.com`, `t.co`. Use the existing sync scripts, never hand-edit
  generated Android/iOS/macOS contracts. Do not change signed traffic-policy,
  catalog admission, routing-mode defaults or template schema version (still 2).
- Why stricter: the listed services use cloud TCP and matched UDP/ICMP rejection;
  a failed cloud route never falls back DIRECT. No `x.com`/`twitter.com`/`twimg.com`
  suffix, IP range, X process-wide route or general CDN is added. Unlisted hosts
  retain the existing mode boundary. `grok.x.com` and its children remain Home;
  the existing AI-package and video priorities are unchanged. This changes the
  bundled default **classification list**, not the selected default mode, and is
  not authority to change production policy or declare the user's incident fixed.
- Cross-platform consequence: Android/iOS three-tier consume these exact entries;
  stable is unchanged. Windows three-tier compiles the same source; macOS three-tier
  and AI Home embed the regenerated graph. Its privileged helper must match that
  graph, so bump `HelperProtocolVersion.current` from 4.52.63 to 4.52.64 to ensure
  reinstall, rather than leaving a new GUI paired with stale admission. Windows
  Service and Core build from the same template. No policy-wire or client release
  version bump, production deploy or customer publish is authorized.
- Sources: [X's actual public HTML](https://x.com/) (2026-10-22 preconnects to
  abs/api/pbs, prefetches t.co/video/ton/cdn.syndication),
  [mobile cookie hosts](https://help.x.com/en/rules-and-policies/x-cookies),
  [API and profile images](https://developer.x.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-favorites-list),
  [historical upload/API compatibility](https://blog.x.com/developer/en_us/a/2011/photo-upload-api),
  [link service](https://help.x.com/en/using-x/url-shortener).
  These establish service ownership, not which hosts a user's unknown App/version calls.
- Applied in: `t3/android-x-twitter-routing`, draft only; ops plan §P2 Android/iOS.
  Independent routing review and platform CI remain required before merge/deploy.
