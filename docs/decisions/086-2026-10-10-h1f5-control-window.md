## 2026-10-10 · H1-F5 (A30): armed without a tunnel, macOS reaches the control plane only through the Tono relays
- Status: owner (Option A, approved via Puck 2026-10-10: "A"; relayed by the coordinator of the Amp backlog session)
- Question: the macOS bootstrap permit let every process of the interactive user (and root) reach the API host's
  Cloudflare anycast addresses on TCP 443 while protection was armed without a tunnel (bootstrap, `restrictToBootstrap`,
  Protected Offline, the update's `retainBootstrap`). Those addresses are shared: Cloudflare routes by SNI, so a
  same-user process could reach any Cloudflare-fronted site through them (checked read-only from the orb 2026-10-10:
  `www.npmjs.com` answered through 104.20.26.170). PF matches UIDs, not programs. D4-A (decision 079) asked for a
  ≤ 15 s window around each exchange.
- Why the window was dropped: macOS PF has no kernel-enforced expiry for a permit (xnu
  `apple-oss-distributions/xnu` main `f6217f89`, `bsd/net/pfvar.h`, `pf.c`, `pf_ioctl.c`, `pf_table.c`; pfctl(8)).
  `struct pf_rule` has no lifetime or match-count field and no `PFRULE_ONCE`; its `timeout[]` array is the idle timeout of
  the states it creates. Anchors have no TTL. `pfr_kentry` has only counters and `pfrke_tzero`, so `pfctl -T expire` is a
  user-space delete; `overload` tables only grow. State expiry (`pf_state_expires`) is idle-based and refreshed by
  traffic; `max-src-conn(-rate)` count per source address, which every local process shares. `DIOCADDSTATE` imports no
  timeout class (`pf_state_import` leaves `PFTM_TCP_FIRST_PACKET`) and needs the exact five-tuple in advance.
  `pfctl -k`/`-K` are user space; macOS ships no ipfw. Every window therefore ends from a helper thread, and two
  reviewed designs (archived on `amp/a30-userspace-window-archive`, `d62b5ba2`) could not keep a hard 15 s bound when
  the helper stalls (re-review R2-M1).
- Chosen (Option A): confine the destination instead of the time. Armed without a tunnel, the helper's only
  control-plane permit is `pass out quick inet proto tcp to <relay> port 2053 user <interactive uid> keep state
  (if-bound) label "tono-api-relay"` for the two Tono relays 179.253.233.220:2053 and 179.255.154.17:2053, from the
  compiled list `ControlPlaneRelays` that the app also uses (never DNS, never the pins). Root is dropped from it. The API
  host's Cloudflare addresses (bundled 104.20.26.170 and 172.66.162.98, learned and resolved) are never permitted in
  any armed state. Connected, there is no control-plane permit (unchanged: the connected arm already dropped it). The
  existing atomic anchor load applies it; no window, no timer. Moving off a ruleset that still permitted the Cloudflare
  addresses kills their states (the targeted disposal; a helper's first arm after an upgrade takes the full flush). The
  relays are also exit nodes, so the tunnel arm, which withdraws the relay permit, spares from its host-wide state kill a
  relay address the Core still dials as its exit (a relay connection open at that moment can then outlive the permit;
  it carries TLS to the API or release host only, and no new one is admitted). The app goes to the relays first, and
  only there, while armed without a tunnel (`KillSwitchService.isArmedWithoutTunnel`, set from each committed arm):
  `TonoAPIClient` skips the system resolver and the pinned path, the updater's release-host GETs and package download go
  to the relays directly; TLS names the real host and uses default certificate validation. Unarmed and connected path
  orders are unchanged.
- Threat model: the relays run nginx `stream` with `ssl_preread`; they forward the SNIs `api.afk.ccwu.cc` and
  `releases.afk.ccwu.cc` and send every other name, or none, to a closed port (`tooling/ops/relay/tono-relay.stream.conf`,
  pinned by `test_relay_stream_conf.py`; live from the orb 2026-10-10: `-servername www.npmjs.com` gets no certificate
  on either relay, `-servername api.afk.ccwu.cc` gets `CN = afk.ccwu.cc`, verify OK). TLS passes through and the client
  verifies the API hostname. A same-user process can still reach the Tono API and release host through a relay while
  protection is armed without a tunnel, for as long as that state lasts; it can no longer reach any other site. Root
  (and every other user) can no longer use the permit. Only port 2053 is permitted on the relay addresses; `tono-xray` on
  :443 of those nodes is reachable only through the existing root-only exit permit when it is the selected exit.
- Replaces the ≤ 15 s constraint: the destination is confined to the Tono API and release hosts; there is no time bound.
- Deployment prerequisites and failure mode: both relays must run the SNI allow-list above (deployed per decision 077;
  `tooling/ops/relay/apply-relay.sh`). If both relays are down, the control plane is unreachable while protection is
  armed without a tunnel: sign-in, refresh and catalog recovery fail closed and the user can Disconnect to reach the API
  directly. Relay health is probed from the nodes (A5, `tooling/ops/relay/relay-probe.py`).
- Amends decision 077: the relays were "not in the PF bootstrap permit"; on macOS they are now the only armed-without-
  tunnel API path. 077's Windows rule stands: Windows is unchanged.
- Windows: unchanged. The Service's bootstrap API channel (`wfp_model.rs` rule C) already matches only the installed Tono
  app's AppId (#334), so no other process can use it; it keeps the Cloudflare pins and the alternate ports.
- Why stricter: the permit's reach shrinks from every Cloudflare-fronted site (and root) to two Tono-owned endpoints that
  forward only the Tono hosts, for the interactive user only; nothing is added for the connected state; no user-space
  timer is presented as a guarantee.
- Applied in: PR #1507 (`amp/a30-bootstrap-window`), helper 4.52.45.
